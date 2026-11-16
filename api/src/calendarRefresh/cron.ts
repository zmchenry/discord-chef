import type { ClashWire } from '../../../shared/calendarRefresh'
import { clashSummary } from '../../../shared/planning/clashes'
import { addDays, sundayOf, todayIn } from '../../../shared/planningApi'
import { sendToUsers, subscribedUsersWithPrefs } from '../notifications/store'
import { vapidKeysFrom, type PushMessage } from '../notifications/webpush'
import { refreshCalendar } from '../planning/calendar'
import { loadWeek } from '../planning/routes'
import { openClashes } from './clashes'

// Hourly, from the 15-minute cron in index.ts: refetch the family calendar,
// look for planned meals that now clash with it (this week and next), and send
// one push about any clash nobody has been told about. calendar_alert_log
// (migrations/0007) means a fingerprint is never pushed twice. Nothing in the
// plan is ever changed here.

const ALERT_LOG_DAYS = 30

export type WeekClash = ClashWire & { weekId: string }

// One push for the lot: the first clash by date, plus a count of the rest.
export function clashPushMessage(clashes: WeekClash[]): PushMessage | null {
  const first = clashes[0]
  if (!first) return null
  const more = clashes.length - 1
  return {
    title: 'Calendar changed',
    body: `Heads up: ${clashSummary(first)}${more ? ` (and ${more} more)` : ''}. Tap to fix.`,
    url: `/week?start=${first.weekId}`,
    tag: 'calendar_clash',
  }
}

export async function runCalendarCron(env: Env, scheduledTime: number, fetchFn: typeof fetch = fetch): Promise<void> {
  // The cron fires every 15 minutes; only the first run in each hour does this.
  if (new Date(scheduledTime).getUTCMinutes() >= 15) return
  const refreshed = await refreshCalendar(env.DB, fetchFn)
  if (refreshed.status === 'none') return

  const today = todayIn(undefined, new Date(scheduledTime))
  const thisWeek = sundayOf(today)
  const clashes: WeekClash[] = []
  for (const weekId of [thisWeek, addDays(thisWeek, 7)]) {
    const w = await loadWeek(env, weekId)
    for (const c of await openClashes(env.DB, weekId, w, today)) clashes.push({ ...c, weekId })
  }
  await notifyClashes(env, clashes)
}

async function notifyClashes(env: Env, clashes: WeekClash[]): Promise<void> {
  await env.DB.prepare('DELETE FROM calendar_alert_log WHERE sent_at < ?')
    .bind(Date.now() - ALERT_LOG_DAYS * 86_400_000)
    .run()
  if (clashes.length === 0 || !vapidKeysFrom(env)) return

  // No calendar_clash pref kind exists (the kinds are fixed in shared/schema.ts),
  // so anyone with any notification turned on gets it.
  const users = await subscribedUsersWithPrefs(env.DB)
  const recipients = [...users].filter(([, prefs]) => prefs.some((p) => p.enabled)).map(([id]) => id)
  if (recipients.length === 0) return

  // Claim each fingerprint first, so an overlapping run cannot send it again.
  const fresh: WeekClash[] = []
  for (const c of clashes) {
    const claim = await env.DB.prepare('INSERT OR IGNORE INTO calendar_alert_log (fingerprint, sent_at) VALUES (?, ?)')
      .bind(c.fingerprint, Date.now())
      .run()
    if (claim.meta.changes === 1) fresh.push(c)
  }
  const message = clashPushMessage(fresh)
  if (!message) return
  const result = await sendToUsers(env, recipients, message)
  console.log(JSON.stringify({ event: 'calendar_clash_sent', clashes: fresh.length, ...result }))
}
