import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'

import {
  PHOTO_MAX_BYTES,
  PHOTO_REMINDER_DELAY_MS,
  PHOTO_UPLOAD_HEADER,
  PHOTO_URL_PREFIX,
  photoReminderInputSchema,
  type PhotoReminderResponse,
  type PhotoUploadResponse,
} from '../../../shared/dishPhotos'
import type { ErrorResponse } from '../../../shared/schema'
import { requireSession, type AppEnv } from '../session'

// Dish photos, mounted at the app root (index.ts adds /api). Contract in
// shared/dishPhotos.ts.
//
// CSRF: the upload is multipart/form-data, a "simple" content type, so it also
// requires PHOTO_UPLOAD_HEADER, which forces a CORS preflight nothing answers
// (the receipts pattern, see the note in index.ts). The reminder is a JSON body.

const fail = (c: Context, status: 400 | 403 | 404 | 413 | 415, error: string) => c.json<ErrorResponse>({ error }, status)

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export const dishPhotoRoutes = new Hono<AppEnv>()
  .post('/recipes/:id/photo', requireSession, async (c) => {
    if (c.req.header(PHOTO_UPLOAD_HEADER) !== '1') return fail(c, 403, `missing ${PHOTO_UPLOAD_HEADER} header`)
    const id = c.req.param('id')
    const recipe = await c.env.DB.prepare('SELECT image_url FROM recipes WHERE id = ?1')
      .bind(id)
      .first<{ image_url: string | null }>()
    if (!recipe) return fail(c, 404, 'not found')
    let form: FormData
    try {
      form = await c.req.formData()
    } catch {
      return fail(c, 415, 'expected multipart/form-data')
    }
    const image = form.get('image')
    if (!(image instanceof File)) return fail(c, 400, 'image is required')
    const ext = EXT[image.type]
    if (!ext) return fail(c, 415, 'The photo must be a JPEG, PNG or WebP image.')
    if (image.size > PHOTO_MAX_BYTES) return fail(c, 413, 'That photo is too large.')

    const now = Date.now()
    const key = `recipes/${id}/${now}.${ext}`
    await c.env.PHOTOS.put(key, await image.arrayBuffer(), { httpMetadata: { contentType: image.type } })
    const imageUrl = PHOTO_URL_PREFIX + key
    await c.env.DB.prepare('UPDATE recipes SET image_url = ?2, updated_at = ?3 WHERE id = ?1').bind(id, imageUrl, now).run()
    // A replaced photo of ours is not referenced anywhere else.
    if (recipe.image_url?.startsWith(PHOTO_URL_PREFIX)) await c.env.PHOTOS.delete(recipe.image_url.slice(PHOTO_URL_PREFIX.length))
    return c.json<PhotoUploadResponse>({ imageUrl }, 201)
  })
  .get('/photos/*', requireSession, async (c) => {
    const key = c.req.path.slice(PHOTO_URL_PREFIX.length)
    const object = key ? await c.env.PHOTOS.get(key) : null
    if (!object) return fail(c, 404, 'not found')
    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? 'image/jpeg',
        // Keys carry a timestamp and are never rewritten.
        'cache-control': 'private, max-age=31536000, immutable',
        etag: object.httpEtag,
      },
    })
  })
  .post(
    '/recipes/:id/photo-reminder',
    requireSession,
    zValidator('json', photoReminderInputSchema, (r, c) => {
      if (!r.success) return c.json<ErrorResponse>({ error: 'invalid', issues: r.error.issues }, 400)
    }),
    async (c) => {
      const id = c.req.param('id')
      const recipe = await c.env.DB.prepare('SELECT image_url FROM recipes WHERE id = ?1')
        .bind(id)
        .first<{ image_url: string | null }>()
      if (!recipe) return fail(c, 404, 'not found')
      if (recipe.image_url) return c.json<PhotoReminderResponse>({ dueAt: null })
      const dueAt = Date.now() + PHOTO_REMINDER_DELAY_MS
      await c.env.DB.prepare(
        `INSERT INTO photo_reminders (user_id, recipe_id, due_at, sent_at) VALUES (?1, ?2, ?3, NULL)
         ON CONFLICT (user_id, recipe_id) DO UPDATE SET due_at = excluded.due_at, sent_at = NULL`,
      )
        .bind(c.var.session!.userId, id, dueAt)
        .run()
      return c.json<PhotoReminderResponse>({ dueAt }, 202)
    },
  )
