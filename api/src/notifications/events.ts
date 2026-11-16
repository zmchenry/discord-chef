import type { PushSendResult } from '../../../shared/notifications'
import { shortDate } from './cron'
import { sendToUsers, subscribedUsersWithPrefs } from './store'
import { vapidKeysFrom } from './webpush'

// Event-driven notifications. Call from request handlers inside
// c.executionCtx.waitUntil(...) so the response does not wait on the push
// services. Never throws: a failed push must not fail the caller.

// "Shopping list is ready" for the week starting `weekId` (YYYY-MM-DD), to
// every user who has list_ready enabled (the default).
export async function notifyListReady(env: Env, weekId: string): Promise<PushSendResult> {
  const none: PushSendResult = { sent: 0, removed: 0, failed: 0 }
  try {
    if (!vapidKeysFrom(env)) return none
    const users = await subscribedUsersWithPrefs(env.DB)
    const ids = [...users]
      .filter(([, prefs]) => prefs.some((p) => p.kind === 'list_ready' && p.enabled))
      .map(([id]) => id)
    return await sendToUsers(env, ids, {
      title: 'Shopping list is ready',
      body: `For the week of ${shortDate(weekId)}.`,
      url: '/shop',
      tag: 'list_ready',
    })
  } catch (err) {
    console.error(err)
    return none
  }
}
