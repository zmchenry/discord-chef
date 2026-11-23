import { inWindow, localNow } from '../notifications/cron'
import { sendToUsers } from '../notifications/store'
import { vapidKeysFrom } from '../notifications/webpush'
import { getLog, plannedSlot } from './db'

// From the 15-minute cron: at 8pm household time, "How was dinner? Rate
// <title>" to everyone with a device subscribed, when tonight's dinner is a
// planned recipe nobody has rated yet. meal_rating_push_log keeps it to once
// per user and day.

export const RATING_PUSH_TIME = '20:00'

export async function runDinnerRatingPush(env: Env, scheduledTime: number, send = sendToUsers): Promise<number> {
  const now = localNow(new Date(scheduledTime))
  if (!inWindow(RATING_PUSH_TIME, now.minutes) || !vapidKeysFrom(env)) return 0
  const slot = await plannedSlot(env.DB, now.date, 'dinner')
  if (slot?.kind !== 'recipe' || !slot.recipeId) return 0
  const log = await getLog(env.DB, now.date, 'dinner')
  if (log && (log.rating !== null || log.status !== 'eaten')) return 0
  const recipe = await env.DB.prepare('SELECT title FROM recipes WHERE id = ?1').bind(slot.recipeId).first<{ title: string }>()
  if (!recipe) return 0

  const { results } = await env.DB.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all<{ user_id: string }>()
  const recipients: string[] = []
  for (const { user_id } of results) {
    const claim = await env.DB.prepare('INSERT OR IGNORE INTO meal_rating_push_log (user_id, local_date, sent_at) VALUES (?1, ?2, ?3)')
      .bind(user_id, now.date, Date.now())
      .run()
    if (claim.meta.changes === 1) recipients.push(user_id)
  }
  if (!recipients.length) return 0
  await send(env, recipients, {
    title: 'How was dinner?',
    body: `Rate ${recipe.title}`,
    url: '/week',
    tag: 'dinner_rating',
  }).catch((err: unknown) => console.error(err))
  return recipients.length
}
