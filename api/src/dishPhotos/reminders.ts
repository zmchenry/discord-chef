import { sendToUsers } from '../notifications/store'
import { vapidKeysFrom } from '../notifications/webpush'

// From the 15-minute cron: sends each "take a photo" reminder that is due,
// once. A recipe that got a picture in the meantime is marked done without a
// push, and so is a reminder more than STALE_MS late (VAPID keys were unset,
// say), since "how did it turn out?" makes no sense the next day.

const STALE_MS = 6 * 3600_000

export async function runPhotoReminders(env: Env, now: number, send = sendToUsers): Promise<number> {
  if (!vapidKeysFrom(env)) return 0
  const { results } = await env.DB.prepare(
    `SELECT p.user_id, p.recipe_id, p.due_at, r.title, r.image_url, r.archived_at
     FROM photo_reminders p JOIN recipes r ON r.id = p.recipe_id
     WHERE p.sent_at IS NULL AND p.due_at <= ?1`,
  )
    .bind(now)
    .all<{ user_id: string; recipe_id: string; due_at: number; title: string; image_url: string | null; archived_at: number | null }>()

  let sent = 0
  for (const r of results) {
    // Claim first, so an overlapping run cannot send it again.
    const claim = await env.DB.prepare(
      'UPDATE photo_reminders SET sent_at = ?3 WHERE user_id = ?1 AND recipe_id = ?2 AND sent_at IS NULL',
    )
      .bind(r.user_id, r.recipe_id, now)
      .run()
    if (claim.meta.changes !== 1 || r.image_url || r.archived_at || now - r.due_at > STALE_MS) continue
    await send(env, [r.user_id], {
      title: `How did ${r.title} turn out?`,
      body: 'Take a photo for next time.',
      url: `/recipes/${encodeURIComponent(r.recipe_id)}?photo=1`,
      tag: `photo_${r.recipe_id}`,
    }).catch((err: unknown) => console.error(err))
    sent++
  }
  return sent
}
