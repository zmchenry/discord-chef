import {
  eventsByDay,
  eventsToConstraints,
  parseIcs,
  type Constraint,
  type DayEvent,
} from '../../../shared/planning/calendar'
import { addDays, todayIn, type CalendarSettings, type HouseholdSettings } from '../../../shared/planningApi'
import { getSetting, setSetting } from './db'

// The family calendar: a secret iCal address stored in household_settings,
// fetched server-side and cached in D1 for fifteen minutes (the hourly cron in
// api/src/calendarRefresh also refreshes it). Any failure leaves the week
// usable with no constraints, and the reason is kept for the settings page.

export const ICAL_KEY = 'calendar_ical_url'
const ERROR_KEY = 'calendar_last_error'
const CACHE_ID = 'family'
const TTL_MS = 15 * 60 * 1000
const STATUS_DAYS = 28

export async function setCalendarUrl(db: D1Database, url: string | null): Promise<void> {
  await setSetting(db, ICAL_KEY, url)
  await setSetting(db, ERROR_KEY, null)
  await db.prepare('DELETE FROM calendar_cache WHERE id = ?1').bind(CACHE_ID).run()
}

const REFUSED = 'Google refused this link. Use the “Secret address in iCal format”, not the public one.'

class FeedError extends Error {}

function fetchError(status: number): FeedError {
  if (status === 401 || status === 403 || status === 404) return new FeedError(REFUSED)
  return new FeedError(`The calendar server answered ${status}. Try again later.`)
}

interface CalendarText {
  body: string | null
  fetchedAt: number | null
  ok: boolean // false when a fetch was due and failed
}

async function cachedText(db: D1Database) {
  return db
    .prepare('SELECT fetched_at, body FROM calendar_cache WHERE id = ?1')
    .bind(CACHE_ID)
    .first<{ fetched_at: number; body: string }>()
}

async function calendarText(db: D1Database, url: string, fetchFn: typeof fetch, force = false): Promise<CalendarText> {
  const cached = await cachedText(db)
  if (cached && !force && Date.now() - cached.fetched_at < TTL_MS) {
    return { body: cached.body, fetchedAt: cached.fetched_at, ok: true }
  }
  try {
    const res = await fetchFn(url, { headers: { accept: 'text/calendar' } })
    if (!res.ok) throw fetchError(res.status)
    const body = await res.text()
    // A public address for a private calendar can answer 200 with a web page.
    if (!body.includes('BEGIN:VCALENDAR')) throw new FeedError(REFUSED)
    const now = Date.now()
    await db
      .prepare(
        `INSERT INTO calendar_cache (id, fetched_at, body) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at, body = excluded.body`,
      )
      .bind(CACHE_ID, now, body)
      .run()
    await setSetting(db, ERROR_KEY, null)
    return { body, fetchedAt: now, ok: true }
  } catch (err) {
    console.warn('calendar unavailable', String(err))
    const message = err instanceof FeedError ? err.message : 'Couldn’t reach the calendar. Check the address.'
    await setSetting(db, ERROR_KEY, message)
    // A stale copy beats nothing.
    return { body: cached?.body ?? null, fetchedAt: cached?.fetched_at ?? null, ok: false }
  }
}

/** Refetch the feed now, whatever the cache age. */
export async function refreshCalendar(
  db: D1Database,
  fetchFn: typeof fetch = fetch,
): Promise<{ status: 'none' | 'ok' | 'error'; fetchedAt: number | null }> {
  const url = await getSetting(db, ICAL_KEY)
  if (!url) return { status: 'none', fetchedAt: null }
  const text = await calendarText(db, url, fetchFn, true)
  return { status: text.ok ? 'ok' : 'error', fetchedAt: text.fetchedAt }
}

/** The feed's status for the settings page, from the cache alone (no fetch). */
export async function calendarStatus(db: D1Database): Promise<CalendarSettings> {
  const url = await getSetting(db, ICAL_KEY)
  if (!url) return { configured: false, host: null, fetchedAt: null, eventCount: null, error: null }
  let host: string | null = null
  try {
    host = new URL(url).host
  } catch {
    // Stored before validation existed; report it as set anyway.
  }
  const [cached, error] = await Promise.all([cachedText(db), getSetting(db, ERROR_KEY)])
  let eventCount: number | null = null
  if (cached) {
    try {
      const today = todayIn()
      eventCount = parseIcs(cached.body, today, addDays(today, STATUS_DAYS - 1)).length
    } catch {
      // Leave the count unknown.
    }
  }
  return { configured: true, host, fetchedAt: cached?.fetched_at ?? null, eventCount, error }
}

export async function weekConstraints(
  db: D1Database,
  days: string[],
  household: HouseholdSettings,
  fetchFn: typeof fetch = fetch,
): Promise<{
  status: 'none' | 'ok' | 'error'
  fetchedAt: number | null
  byDay: Record<string, Constraint[]>
  eventsByDay: Record<string, DayEvent[]>
}> {
  const empty = <T>() => Object.fromEntries(days.map((d) => [d, [] as T[]]))
  const none = { byDay: empty<Constraint>(), eventsByDay: empty<DayEvent>() }
  const url = await getSetting(db, ICAL_KEY)
  if (!url) return { status: 'none', fetchedAt: null, ...none }
  const { body, fetchedAt } = await calendarText(db, url, fetchFn)
  if (body === null) return { status: 'error', fetchedAt, ...none }
  try {
    const events = parseIcs(body, days[0]!, addDays(days[days.length - 1]!, 1))
    return {
      status: 'ok',
      fetchedAt,
      byDay: { ...none.byDay, ...eventsToConstraints(events, days, household) },
      eventsByDay: eventsByDay(events, days),
    }
  } catch (err) {
    console.warn('calendar parse failed', String(err))
    return { status: 'error', fetchedAt, ...none }
  }
}
