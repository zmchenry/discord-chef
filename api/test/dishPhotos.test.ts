import { describe, expect, it, vi } from 'vitest'

import { recipeInputSchema } from '../../shared/schema'
import { runPhotoReminders } from '../src/dishPhotos/reminders'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb } from './setup/testDb'

// A tiny but real JPEG header is not needed: the route trusts the type the
// client sends, and R2 stores bytes.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])

function upload(id: string, withHeader = true): Request {
  const form = new FormData()
  form.set('image', new File([JPEG], 'dish.jpg', { type: 'image/jpeg' }))
  return new Request(`https://chef.zmchenry.com/api/recipes/${id}/photo`, {
    method: 'POST',
    headers: { 'x-dev-user-id': 'zach@example.com', ...(withHeader ? { 'x-chef-upload': '1' } : {}) },
    body: form,
  })
}

describe('dish photos', () => {
  it('stores an upload, serves it, and sends a due reminder once unless a photo arrived', async () => {
    const t = await createTestDb({ photos: true })
    try {
      const env: Env = {
        ...devEnv(t.db),
        PHOTOS: t.photos!,
        VAPID_PUBLIC_KEY: 'pub',
        VAPID_PRIVATE_KEY: 'priv',
        VAPID_SUBJECT: 'mailto:test@example.com',
      }
      await t.db.batch([
        t.db.prepare("INSERT INTO users (id, created_at) VALUES ('zach@example.com', 0)"),
        t.db.prepare("INSERT INTO recipes (id, title, created_at, updated_at) VALUES ('r1', 'Shrimp Tacos', 0, 0), ('r2', 'Pad Thai', 0, 0)"),
      ])

      // Reminders for both bare recipes; then r2 gets a photo before they are due.
      for (const id of ['r1', 'r2']) {
        const res = await call(env, devRequest('POST', `/api/recipes/${id}/photo-reminder`, {}))
        expect(res.status).toBe(202)
      }

      expect((await call(env, upload('r2', false))).status).toBe(403)
      const res = await call(env, upload('r2'))
      expect(res.status).toBe(201)
      const { imageUrl } = (await res.json()) as { imageUrl: string }
      expect(imageUrl).toMatch(/^\/api\/photos\/recipes\/r2\/\d+\.jpg$/)

      const recipe = (await (await call(env, devRequest('GET', '/api/recipes/r2'))).json()) as { imageUrl: string }
      expect(recipe.imageUrl).toBe(imageUrl)

      const img = await call(env, devRequest('GET', imageUrl))
      expect(img.status).toBe(200)
      expect(img.headers.get('content-type')).toBe('image/jpeg')
      expect(img.headers.get('cache-control')).toContain('max-age=31536000')
      expect(new Uint8Array(await img.arrayBuffer())).toEqual(JPEG)

      // The edit form can save the path back; other paths are still rejected.
      expect(recipeInputSchema.safeParse({ title: 'x', imageUrl }).success).toBe(true)
      expect(recipeInputSchema.safeParse({ title: 'x', imageUrl: '/etc/passwd' }).success).toBe(false)

      // A recipe with a photo takes no new reminder.
      expect(await (await call(env, devRequest('POST', '/api/recipes/r2/photo-reminder', {}))).json()).toEqual({ dueAt: null })

      const send = vi.fn(async () => ({ sent: 1, removed: 0, failed: 0 }))
      const later = Date.now() + 16 * 60_000
      expect(await runPhotoReminders(env, Date.now(), send)).toBe(0) // not due yet
      expect(await runPhotoReminders(env, later, send)).toBe(1)
      expect(await runPhotoReminders(env, later + 15 * 60_000, send)).toBe(0) // once
      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(env, ['zach@example.com'], {
        title: 'How did Shrimp Tacos turn out?',
        body: 'Take a photo for next time.',
        url: '/recipes/r1?photo=1',
        tag: 'photo_r1',
      })
    } finally {
      await t.dispose()
    }
  })
})
