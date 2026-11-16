import type { NotificationPref } from '../../../shared/notifications'
import type { NotificationKind } from '../../../shared/schema'
import { sendToUsers, subscribedUsersWithPrefs } from './store'
import { vapidKeysFrom, type PushMessage } from './webpush'

// Runs every 15 minutes (wrangler.jsonc triggers.crons). Each run works out
// the household-local time, finds the users whose reminder time falls in the
// current 15-minute window, and sends what is due. notification_sent_log
// (migrations/0004) makes it at most once per user, kind and local date.

export const HOUSEHOLD_TZ = 'America/New_York'
const WINDOW_MINUTES = 15

type CronKind = Exclude<NotificationKind, 'list_ready'>

export interface LocalNow {
  date: string // YYYY-MM-DD in HOUSEHOLD_TZ
  weekday: number // 0 = Sunday
  minutes: number // minutes since local midnight
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: HOUSEHOLD_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
})

export function localNow(at: Date): LocalNow {
  const p = Object.fromEntries(formatter.formatToParts(at).map((x) => [x.type, x.value]))
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS.indexOf(p.weekday),
    minutes: Number(p.hour) * 60 + Number(p.minute),
  }
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Weeks start on Sunday and are keyed by that date.
export const weekIdOf = (now: LocalNow) => addDays(now.date, -now.weekday)

// True when HH:MM falls in the 15-minute window that contains `minutes`.
export function inWindow(localTime: string, minutes: number): boolean {
  const [h, m] = localTime.split(':').map(Number)
  const t = h * 60 + m
  const start = minutes - (minutes % WINDOW_MINUTES)
  return t >= start && t < start + WINDOW_MINUTES
}

export const sentKey = (userId: string, kind: NotificationKind, date: string) => `${userId}|${kind}|${date}`

// Which cron notifications are due right now. Pure: `sent` holds sentKey()s
// already in notification_sent_log.
export function dueNotifications(
  now: LocalNow,
  users: Map<string, NotificationPref[]>,
  sent: Set<string>,
): { userId: string; kind: CronKind }[] {
  const due: { userId: string; kind: CronKind }[] = []
  for (const [userId, prefs] of users) {
    for (const p of prefs) {
      if (p.kind === 'list_ready' || !p.enabled || !p.localTime) continue
      if (p.kind === 'plan_week' && now.weekday !== 6) continue // Saturdays only
      if (!inWindow(p.localTime, now.minutes)) continue
      if (sent.has(sentKey(userId, p.kind, now.date))) continue
      due.push({ userId, kind: p.kind })
    }
  }
  return due
}

// --- Messages ------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const shortDate = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`

// "a", "a and b", "a, b and c"
const listJoin = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

const MEAL_ORDER = ['breakfast', 'lunch', 'dinner']
const MEAL_LABEL: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }
const KIND_LABEL: Record<string, string> = { leftovers: 'Leftovers', eat_out: 'Eating out' }

export interface TodaySlot {
  meal: string
  kind: string
  title: string | null
}

// Null when nothing is planned today (skipped slots do not count).
export function dailyCookingMessage(slots: TodaySlot[], thaw: string[]): PushMessage | null {
  const lines = slots
    .filter((s) => s.kind !== 'skip')
    .sort((a, b) => MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal))
    .map((s) => `${MEAL_LABEL[s.meal]}: ${s.kind === 'recipe' ? s.title : KIND_LABEL[s.kind]}`)
  if (lines.length === 0) return null
  const dinner = slots.find((s) => s.meal === 'dinner' && s.kind === 'recipe')
  if (thaw.length) lines.push(`Thaw the ${listJoin(thaw)} tonight for tomorrow.`)
  return {
    title: dinner ? `Tonight: ${dinner.title}` : "Today's meals",
    body: lines.join('\n'),
    url: '/week',
    tag: 'daily_cooking',
  }
}

async function buildDailyCooking(db: D1Database, now: LocalNow): Promise<PushMessage | null> {
  const week = weekIdOf(now)
  const { results: slots } = await db
    .prepare(
      `SELECT s.meal, s.kind, r.title FROM plan_slots s LEFT JOIN recipes r ON r.id = s.recipe_id
       WHERE s.week_id = ? AND s.day = ?`,
    )
    .bind(week, now.weekday)
    .all<TodaySlot>()

  // Tomorrow is day 0 of next week on a Saturday.
  const [tWeek, tDay] = now.weekday === 6 ? [addDays(week, 7), 0] : [week, now.weekday + 1]
  const { results: thawRows } = await db
    .prepare(
      `SELECT i.name FROM plan_slots s
       JOIN recipe_ingredients ri ON ri.recipe_id = s.recipe_id
       JOIN ingredients i ON i.id = ri.ingredient_id
       WHERE s.week_id = ? AND s.day = ? AND s.meal = 'dinner' AND s.kind = 'recipe'
         AND ri.optional = 0 AND i.section IN ('Meat & Seafood', 'Frozen')
       ORDER BY ri.position`,
    )
    .bind(tWeek, tDay)
    .all<{ name: string }>()

  return dailyCookingMessage(slots, [...new Set(thawRows.map((r) => r.name))])
}

async function buildPlanWeek(db: D1Database, now: LocalNow): Promise<PushMessage | null> {
  const next = addDays(weekIdOf(now), 7)
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM plan_slots WHERE week_id = ? AND meal = 'dinner'`)
    .bind(next)
    .first<{ n: number }>()
  const filled = row?.n ?? 0
  if (filled >= 7) return null
  return {
    title: "Next week isn't planned yet",
    body: `${filled} of 7 dinners picked for the week of ${shortDate(next)}. Tap to plan.`,
    url: `/week?start=${next}`,
    tag: 'plan_week',
  }
}

const BUILDERS: Record<CronKind, (db: D1Database, now: LocalNow) => Promise<PushMessage | null>> = {
  plan_week: buildPlanWeek,
  daily_cooking: buildDailyCooking,
}

// --- Entry point -----------------------------------------------------------------------

export async function runNotificationCron(env: Env, scheduledTime: number): Promise<void> {
  const now = localNow(new Date(scheduledTime))
  const users = await subscribedUsersWithPrefs(env.DB)
  if (users.size === 0) return

  const { results: sentRows } = await env.DB.prepare(
    'SELECT user_id, kind FROM notification_sent_log WHERE local_date = ?',
  )
    .bind(now.date)
    .all<{ user_id: string; kind: NotificationKind }>()
  const sent = new Set(sentRows.map((r) => sentKey(r.user_id, r.kind, now.date)))

  const due = dueNotifications(now, users, sent)
  if (due.length === 0) return
  if (!vapidKeysFrom(env)) {
    console.warn(JSON.stringify({ event: 'notifications_skipped', reason: 'VAPID secrets unset' }))
    return
  }

  for (const kind of new Set(due.map((d) => d.kind))) {
    const message = await BUILDERS[kind](env.DB, now)
    if (!message) continue
    // Claim each row first, so an overlapping run cannot send it again.
    const recipients: string[] = []
    for (const { userId } of due.filter((d) => d.kind === kind)) {
      const claim = await env.DB.prepare(
        'INSERT OR IGNORE INTO notification_sent_log (user_id, kind, local_date, sent_at) VALUES (?, ?, ?, ?)',
      )
        .bind(userId, kind, now.date, Date.now())
        .run()
      if (claim.meta.changes === 1) recipients.push(userId)
    }
    const result = await sendToUsers(env, recipients, message)
    console.log(JSON.stringify({ event: 'notifications_sent', kind, date: now.date, ...result }))
  }
}
