import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RECEIPT_UPLOAD_HEADER, type ReceiptSaveResponse, type ReceiptView } from '../../shared/receipts'
import { linePrice, pickPrice, priceKind, RECEIPT_FRESH_MS, type PriceSource } from '../../shared/receipts/prices'
import type { Recipe } from '../../shared/schema'
import type { ShoppingWeekResponse } from '../../shared/shopping'
import { matchLine } from '../src/receipts/match'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

// --- Matching ---------------------------------------------------------------

const CATALOG = [
  'shredded mozzarella cheese',
  'mozzarella cheese',
  'fresh mozzarella',
  'chicken breast',
  'chicken thigh',
  'ground beef',
  'bananas',
  'roma tomato',
  'tomato',
  'yellow onion',
  'eggs',
  'heavy cream',
  'sour cream',
  'salt',
  'corn tortilla',
  'flour tortilla',
  'peanut butter',
  'butter',
].map((name, i) => ({ id: i + 1, name }))

describe('matchLine', () => {
  it.each([
    ['GV SHRD MOZZ 8OZ', 'shredded mozzarella cheese'],
    ['BNLS SKNLS CHKN BRST', 'chicken breast'],
    ['GRND BF 80/20', 'ground beef'],
    ['BANANAS', 'bananas'],
    ['ROMA TOMATOES', 'roma tomato'],
    ['MM YEL ONIONS 3LB', 'yellow onion'],
    ['LG EGGS 18CT', 'eggs'],
    ['HVY WHP CRM', 'heavy cream'],
    ['SOUR CRM', 'sour cream'],
    ['CORN TORT 30CT', 'corn tortilla'],
    ['GV PB CRMY', 'peanut butter'],
    ['PAPER TOWELS', null],
    ['SALTINES', null],
    ['MSN TORT', null], // ambiguous: left for Claude
  ])('%s -> %s', (text, want) => {
    expect(matchLine(text, CATALOG)?.name ?? null).toBe(want)
  })
})

// --- Prices -----------------------------------------------------------------

describe('linePrice', () => {
  it.each([
    ['weighed, unit price printed', { priceCents: 134, quantity: 1, unitPriceCents: 58, weight: '2.31 lb', size: null }, { cents: 58, unit: '1 lb' }],
    ['weighed, no unit price', { priceCents: 600, quantity: 1, unitPriceCents: null, weight: '1.5 lbs', size: null }, { cents: 400, unit: '1 lb' }],
    ['package size printed', { priceCents: 248, quantity: 1, unitPriceCents: null, weight: null, size: '8 OZ' }, { cents: 248, unit: '8 oz' }],
    ['two at a price', { priceCents: 300, quantity: 2, unitPriceCents: 150, weight: null, size: null }, { cents: 150, unit: 'each' }],
    ['two, no unit price', { priceCents: 500, quantity: 2, unitPriceCents: null, weight: null, size: '1 gal' }, { cents: 250, unit: '1 gal' }],
  ])('%s', (_name, line, want) => {
    expect(linePrice(line)).toEqual(want)
  })
})

describe('pickPrice', () => {
  const now = 1_000 * RECEIPT_FRESH_MS
  const day = 86_400_000
  type P = { source: PriceSource; updatedAt: number }
  const manual: P = { source: 'manual', updatedAt: now - 400 * day }
  const estimate: P = { source: 'estimate', updatedAt: now - day }
  const receipt: P = { source: 'receipt', updatedAt: now - 10 * day }
  const newerReceipt: P = { source: 'receipt', updatedAt: now - 2 * day }
  const staleReceipt: P = { source: 'receipt', updatedAt: now - 91 * day }

  it.each([
    ['manual beats a fresh receipt', [receipt, manual], manual],
    ['a fresh receipt beats an estimate', [estimate, receipt], receipt],
    ['an estimate beats a receipt over 90 days old', [staleReceipt, estimate], estimate],
    ['a stale receipt beats nothing', [staleReceipt], staleReceipt],
    ['the newer of two receipts', [receipt, newerReceipt], newerReceipt],
    ['the older receipt does not replace the newer', [newerReceipt, receipt], newerReceipt],
  ])('%s', (_name, candidates, want) => {
    expect(pickPrice(candidates, now)).toBe(want)
  })

  it('labels a stale receipt price as an estimate', () => {
    expect(priceKind(receipt, now)).toBe('receipt')
    expect(priceKind(staleReceipt, now)).toBe('estimate')
    expect(pickPrice([], now)).toBeNull()
  })
})

// --- API: upload -> lines -> save -> totals ----------------------------------

describe('receipts API', () => {
  let testDb: TestDb
  let env: Env

  beforeEach(async () => {
    testDb = await createTestDb()
    env = { ...devEnv(testDb.db), ANTHROPIC_API_KEY: 'test-key' } as Env
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await testDb.dispose()
  })

  const WEEK = '2026-11-22'
  const today = new Date().toISOString().slice(0, 10)

  const RECEIPT = {
    store: 'Walmart',
    date: today,
    lines: [
      { text: 'GV SHRD MOZZ 8OZ', price_cents: 248, quantity: 1, unit_price_cents: null, weight: null, size: '8 oz' },
      { text: 'GRND BF 80/20', price_cents: 549, quantity: 1, unit_price_cents: null, weight: null, size: '1 lb' },
      { text: 'MSN TORT', price_cents: 300, quantity: 2, unit_price_cents: 150, weight: null, size: null },
      { text: 'BANANAS', price_cents: 134, quantity: 1, unit_price_cents: 58, weight: '2.31 lb', size: null },
      { text: 'PAPER TOWELS', price_cents: 1197, quantity: 1, unit_price_cents: null, weight: null, size: null },
    ],
  }

  // The first call (content blocks with the image) reads the receipt; the
  // second places "MSN TORT" as the flour tortillas and nothing else.
  function mockClaude() {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      const content = body.messages[0].content
      const answer = Array.isArray(content)
        ? RECEIPT
        : {
            matches: [...(content as string).matchAll(/^(\d+): (.+)$/gm)]
              .filter((m) => m[2] === 'MSN TORT')
              .map((m) => ({ line: Number(m[1]), ingredient_id: Number((content as string).match(/^(\d+): flour tortillas$/m)![1]) })),
          }
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  async function json<T>(e: Env, req: Request, status = 200): Promise<T> {
    const res = await call(e, req)
    expect(res.status, await res.clone().text()).toBe(status)
    return (await res.json()) as T
  }

  function upload(storeId: number, header = true): Request {
    const form = new FormData()
    form.set('image', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'receipt.jpg', { type: 'image/jpeg' }))
    form.set('storeId', String(storeId))
    const headers: Record<string, string> = { 'x-dev-user-id': 'zach@example.com' }
    if (header) headers[RECEIPT_UPLOAD_HEADER] = '1'
    return new Request('https://chef.zmchenry.com/api/receipts', { method: 'POST', headers, body: form })
  }

  it('reads a receipt photo, matches its lines, saves receipt prices and changes the totals', async () => {
    const recipe = await json<Recipe>(
      env,
      devRequest('POST', '/api/recipes', {
        title: 'Taco Night',
        ingredients: [{ rawText: 'shredded mozzarella cheese' }, { rawText: '1 lb ground beef' }, { rawText: 'flour tortillas' }, { rawText: 'banana' }],
      }),
      201,
    )
    const { results } = await testDb.db.prepare('SELECT id, name FROM ingredients').all<{ id: number; name: string }>()
    const ids = Object.fromEntries(results.map((r) => [r.name, r.id]))
    const walmart = (await testDb.db.prepare(`SELECT id FROM stores WHERE name = 'Walmart'`).first<number>('id'))!
    await testDb.db.batch([
      testDb.db.prepare('INSERT INTO weeks (id, created_at, updated_at) VALUES (?1, 0, 0)').bind(WEEK),
      testDb.db
        .prepare(`INSERT INTO plan_slots (week_id, day, meal, kind, recipe_id, updated_at) VALUES (?1, 1, 'dinner', 'recipe', ?2, 0)`)
        .bind(WEEK, recipe.id),
      // Estimates of $1 everywhere, and a manual $6 for the beef at Walmart.
      testDb.db.prepare(
        `INSERT INTO ingredient_prices (ingredient_id, store_id, cents, unit, source, updated_at)
         SELECT i.id, s.id, 100, 'each', 'estimate', 0 FROM ingredients i, stores s`,
      ),
      testDb.db
        .prepare(`UPDATE ingredient_prices SET cents = 600, source = 'manual' WHERE ingredient_id = ?1 AND store_id = ?2`)
        .bind(ids['ground beef'], walmart),
    ])
    const before = await json<ShoppingWeekResponse>(env, devRequest('POST', `/api/weeks/${WEEK}/shopping/generate`, {}))
    const walmartTotal = (w: ShoppingWeekResponse) => w.lists[0]!.totals.find((t) => t.storeId === walmart)!
    expect(walmartTotal(before)).toEqual({ storeId: walmart, cents: 900, priced: 4, total: 4 })

    // No API key: a clear 503. No upload header: refused (CSRF).
    expect((await call(devEnv(testDb.db), upload(walmart))).status).toBe(503)
    const fetchMock = mockClaude()
    expect((await call(env, upload(walmart, false))).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()

    const receipt = await json<ReceiptView>(env, upload(walmart), 201)
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body as string)
    expect(sent.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: btoa('\xff\xd8\xff\xe0\x01\x02\x03') } })
    expect(sent.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } })
    expect(fetchMock).toHaveBeenCalledTimes(2) // read, then one batch for the leftovers

    expect(receipt).toMatchObject({ storeId: walmart, printedStore: 'Walmart', purchasedOn: today, status: 'review' })
    expect(receipt.lines.map((l) => [l.text, l.ingredientName, l.match])).toEqual([
      ['GV SHRD MOZZ 8OZ', 'shredded mozzarella cheese', 'name'],
      ['GRND BF 80/20', 'ground beef', 'name'],
      ['MSN TORT', 'flour tortillas', 'claude'],
      ['BANANAS', 'banana', 'name'],
      ['PAPER TOWELS', null, null],
    ])

    // Save, with the tortillas turned into "not a recipe item".
    const tort = receipt.lines.find((l) => l.text === 'MSN TORT')!
    const saved = await json<ReceiptSaveResponse>(
      env,
      devRequest('POST', `/api/receipts/${receipt.id}/save`, { lines: [{ id: tort.id, ingredientId: null }] }),
    )
    expect(saved).toEqual({ saved: 2, keptManual: 1 })

    const rows = await testDb.db
      .prepare(`SELECT ingredient_id, cents, unit, source FROM ingredient_prices WHERE store_id = ?1 ORDER BY ingredient_id`)
      .bind(walmart)
      .all<{ ingredient_id: number; cents: number; unit: string; source: string }>()
    const byId = new Map(rows.results.map((r) => [r.ingredient_id, r]))
    expect(byId.get(ids['shredded mozzarella cheese']!)).toMatchObject({ cents: 248, unit: '8 oz', source: 'receipt' })
    expect(byId.get(ids['banana']!)).toMatchObject({ cents: 58, unit: '1 lb', source: 'receipt' })
    expect(byId.get(ids['ground beef']!)).toMatchObject({ cents: 600, source: 'manual' })
    expect(byId.get(ids['flour tortillas']!)).toMatchObject({ cents: 100, source: 'estimate' })

    // Totals: 248 + 600 + 100 + 58, two of four from the receipt.
    const after = await json<ShoppingWeekResponse>(env, devRequest('GET', `/api/weeks/${WEEK}/shopping`))
    expect(walmartTotal(after)).toMatchObject({ cents: 1006, priced: 4, fromReceipt: 2 })
  })
})
