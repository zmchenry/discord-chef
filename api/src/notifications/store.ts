import { DEFAULT_PREFS, NOTIFICATION_KINDS, type NotificationPref, type PushSendResult } from '../../../shared/notifications'
import type { NotificationKind } from '../../../shared/schema'
import { sendPush, vapidKeysFrom, type PushMessage, type PushTarget } from './webpush'

// --- Subscriptions --------------------------------------------------------------

export async function saveSubscription(db: D1Database, userId: string, sub: PushTarget): Promise<void> {
  // Keyed by endpoint: re-subscribing the same browser (or a different user
  // signing in on it) moves the row instead of duplicating it.
  await db
    .prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    )
    .bind(userId, sub.endpoint, sub.p256dh, sub.auth, Date.now())
    .run()
}

export async function deleteSubscription(db: D1Database, userId: string, endpoint: string): Promise<void> {
  await db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').bind(userId, endpoint).run()
}

// --- Prefs ------------------------------------------------------------------------

interface PrefRow {
  user_id: string
  kind: NotificationKind
  enabled: number
  local_time: string | null
}

function withDefaults(rows: PrefRow[]): NotificationPref[] {
  return NOTIFICATION_KINDS.map((kind) => {
    const row = rows.find((r) => r.kind === kind)
    const def = DEFAULT_PREFS[kind]
    if (!row) return def
    return { kind, enabled: row.enabled === 1, localTime: def.localTime === null ? null : (row.local_time ?? def.localTime) }
  })
}

export async function getPrefs(db: D1Database, userId: string): Promise<NotificationPref[]> {
  const { results } = await db.prepare('SELECT * FROM notification_prefs WHERE user_id = ?').bind(userId).all<PrefRow>()
  return withDefaults(results)
}

// Every user with at least one device, with their prefs (defaults filled in).
export async function subscribedUsersWithPrefs(db: D1Database): Promise<Map<string, NotificationPref[]>> {
  const users = await db.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all<{ user_id: string }>()
  const prefs = await db.prepare('SELECT * FROM notification_prefs').all<PrefRow>()
  const out = new Map<string, NotificationPref[]>()
  for (const { user_id } of users.results) out.set(user_id, withDefaults(prefs.results.filter((r) => r.user_id === user_id)))
  return out
}

export async function putPrefs(db: D1Database, userId: string, prefs: NotificationPref[]): Promise<void> {
  if (prefs.length === 0) return
  await db.batch(
    prefs.map((p) =>
      db
        .prepare(
          `INSERT INTO notification_prefs (user_id, kind, enabled, local_time) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, kind) DO UPDATE SET enabled = excluded.enabled, local_time = excluded.local_time`,
        )
        .bind(userId, p.kind, p.enabled ? 1 : 0, p.kind === 'list_ready' ? null : p.localTime),
    ),
  )
}

// --- Sending ----------------------------------------------------------------------

// Sends to every device of each user. Subscriptions the push service reports
// as gone (404/410) are deleted. Throws if the VAPID secrets are unset.
export async function sendToUsers(env: Env, userIds: string[], message: PushMessage): Promise<PushSendResult> {
  const keys = vapidKeysFrom(env)
  if (!keys) throw new Error('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set')
  const result: PushSendResult = { sent: 0, removed: 0, failed: 0 }
  if (userIds.length === 0) return result

  const { results: subs } = await env.DB.prepare(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${userIds.map(() => '?').join(',')})`,
  )
    .bind(...userIds)
    .all<PushTarget & { id: number }>()

  await Promise.all(
    subs.map(async (sub) => {
      let status: number
      try {
        status = await sendPush(sub, message, keys)
      } catch (err) {
        console.error(err)
        result.failed++
        return
      }
      if (status === 404 || status === 410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run()
        result.removed++
      } else if (status >= 200 && status < 300) {
        result.sent++
      } else {
        result.failed++
      }
    }),
  )
  return result
}
