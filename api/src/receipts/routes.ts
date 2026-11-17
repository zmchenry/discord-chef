import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'

import { RECEIPT_MAX_BYTES, RECEIPT_UPLOAD_HEADER, receiptSaveInputSchema, type ReceiptView } from '../../../shared/receipts'
import type { ErrorResponse } from '../../../shared/schema'
import { ClaudeError } from '../linkImport/claude'
import { requireSession, type AppEnv } from '../session'
import { matchWithClaude, readReceiptImage, type ReadLine } from './claude'
import { getReceipt, insertReceipt, saveReceipt } from './db'
import { matchLine } from './match'

// Receipt scanning, mounted at the app root (index.ts adds /api).
//
// CSRF: the upload is multipart/form-data, a "simple" content type a page on
// another origin could POST. So it also requires the RECEIPT_UPLOAD_HEADER
// header: a custom header forces a CORS preflight, which nothing here
// answers (see the CSRF note in index.ts). The save is a JSON body.

const fail = (c: Context, status: 400 | 403 | 404 | 413 | 415 | 422 | 502 | 503, error: string) =>
  c.json<ErrorResponse>({ error }, status)

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type ImageType = (typeof IMAGE_TYPES)[number]
const MAX_LINES = 150

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : null
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

// Only well-formed lines survive.
export function cleanLines(lines: unknown): ReadLine[] {
  if (!Array.isArray(lines)) return []
  return lines.slice(0, MAX_LINES).flatMap((l: Partial<Record<keyof ReadLine, unknown>>) => {
    const t = text(l?.text, 120)
    const price = int(l?.price_cents, 0, 100_000)
    if (!t || price === null) return []
    const qty = typeof l.quantity === 'number' && l.quantity > 0 && l.quantity <= 100 ? l.quantity : 1
    return [
      {
        text: t,
        price_cents: price,
        quantity: qty,
        unit_price_cents: int(l.unit_price_cents, 0, 100_000),
        weight: text(l.weight, 30),
        size: text(l.size, 30),
      },
    ]
  })
}

// A printed date we can trust: real, not in the future, within a year.
export function cleanDate(d: unknown, now: number): string | null {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isFinite(t) && t <= now + 86_400_000 && t >= now - 366 * 86_400_000 ? d : null
}

export const receiptRoutes = new Hono<AppEnv>()
  .post('/receipts', requireSession, async (c) => {
    if (c.req.header(RECEIPT_UPLOAD_HEADER) !== '1') return fail(c, 403, `missing ${RECEIPT_UPLOAD_HEADER} header`)
    let form: FormData
    try {
      form = await c.req.formData()
    } catch {
      return fail(c, 415, 'expected multipart/form-data')
    }
    const image = form.get('image')
    const storeId = Number(form.get('storeId'))
    if (!(image instanceof File)) return fail(c, 400, 'image is required')
    if (!IMAGE_TYPES.includes(image.type as ImageType)) return fail(c, 415, 'The photo must be a JPEG, PNG or WebP image.')
    if (image.size > RECEIPT_MAX_BYTES) return fail(c, 413, 'That photo is too large.')
    const store = Number.isInteger(storeId)
      ? await c.env.DB.prepare('SELECT id FROM stores WHERE id = ?1').bind(storeId).first<{ id: number }>()
      : null
    if (!store) return fail(c, 400, 'unknown store')

    const apiKey = c.env.ANTHROPIC_API_KEY
    if (!apiKey) return fail(c, 503, 'Reading receipts needs an Anthropic API key, and none is set.')

    // The photo lives only in this request: it goes to Claude and is dropped.
    let read
    try {
      read = await readReceiptImage(apiKey, { data: toBase64(await image.arrayBuffer()), mediaType: image.type as ImageType })
    } catch (err) {
      return fail(c, 502, err instanceof ClaudeError ? `${err.message} Try again.` : 'Reading the receipt failed. Try again.')
    }
    const lines = cleanLines(read?.lines)
    if (!lines.length) return fail(c, 422, 'No items found on that photo. Try again with the whole receipt flat and in focus.')

    // Match by name first, then ask Claude about the rest in one call.
    const { results: catalog } = await c.env.DB.prepare('SELECT id, name FROM ingredients ORDER BY name').all<{ id: number; name: string }>()
    const matched = lines.map((l) => {
      const hit = matchLine(l.text, catalog)
      return { ...l, ingredientId: hit?.id ?? null, match: (hit ? 'name' : null) as 'name' | 'claude' | null }
    })
    const leftovers = matched.flatMap((l, index) => (l.ingredientId == null ? [{ index, text: l.text }] : []))
    if (leftovers.length && catalog.length) {
      try {
        const byClaude = await matchWithClaude(apiKey, leftovers, catalog)
        for (const [index, ingredientId] of byClaude) matched[index] = { ...matched[index]!, ingredientId, match: 'claude' }
      } catch (err) {
        console.error(JSON.stringify({ event: 'receipt_match_failed', error: String(err) }))
      }
    }

    const now = Date.now()
    const id = await insertReceipt(
      c.env.DB,
      { storeId: store.id, purchasedOn: cleanDate(read?.date, now), userId: c.var.session!.userId, now },
      matched,
    )
    const view = await getReceipt(c.env.DB, id, text(read?.store, 40))
    return c.json<ReceiptView>(view!, 201)
  })
  .post(
    '/receipts/:id/save',
    requireSession,
    zValidator('json', receiptSaveInputSchema, (r, c) => {
      if (!r.success) return c.json<ErrorResponse>({ error: 'invalid', issues: r.error.issues }, 400)
    }),
    async (c) => {
      const id = Number(c.req.param('id'))
      const result = Number.isInteger(id) ? await saveReceipt(c.env.DB, id, c.req.valid('json')) : null
      return result ? c.json(result) : fail(c, 404, 'not found')
    },
  )
