import { eventsToConstraints, parseIcs, type Constraint } from '../../../shared/planning/calendar'
import { addDays, type HouseholdSettings } from '../../../shared/planningApi'
import { getSetting, setSetting } from './db'

// The family calendar: a secret iCal address stored in household_settings,
// fetched server-side and cached in D1 for six hours. Any failure leaves the
// week usable with no constraints.

export const ICAL_KEY = 'calendar_ical_url'
const CACHE_ID = 'family'
const TTL_MS = 6 * 60 * 60 * 1000

export async function setCalendarUrl(db: D1Database, url: string | null): Promise<void> {
  await setSetting(db, ICAL_KEY, url)
  await db.prepare('DELETE FROM calendar_cache WHERE id = ?1').bind(CACHE_ID).run()
}

async function calendarText(db: D1Database, url: string, fetchFn: typeof fetch): Promise<string | null> {
  const cached = await db
    .prepare('SELECT fetched_at, body FROM calendar_cache WHERE id = ?1')
    .bind(CACHE_ID)
    .first<{ fetched_at: number; body: string }>()
  if (cached && Date.now() - cached.fetched_at < TTL_MS) return cached.body
  try {
    const res = await fetchFn(url, { headers: { accept: 'text/calendar' } })
    if (!res.ok) throw new Error(`calendar fetch ${res.status}`)
    const body = await res.text()
    await db
      .prepare(
        `INSERT INTO calendar_cache (id, fetched_at, body) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at, body = excluded.body`,
      )
      .bind(CACHE_ID, Date.now(), body)
      .run()
    return body
  } catch (err) {
    console.warn('calendar unavailable', String(err))
    // A stale copy beats nothing.
    return cached?.body ?? null
  }
}

export async function weekConstraints(
  db: D1Database,
  days: string[],
  household: HouseholdSettings,
  fetchFn: typeof fetch = fetch,
): Promise<{ status: 'none' | 'ok' | 'error'; byDay: Record<string, Constraint[]> }> {
  const empty = Object.fromEntries(days.map((d) => [d, [] as Constraint[]]))
  const url = await getSetting(db, ICAL_KEY)
  if (!url) return { status: 'none', byDay: empty }
  const text = await calendarText(db, url, fetchFn)
  if (text === null) return { status: 'error', byDay: empty }
  try {
    const events = parseIcs(text, days[0]!, addDays(days[days.length - 1]!, 1))
    return { status: 'ok', byDay: { ...empty, ...eventsToConstraints(events, days, household) } }
  } catch (err) {
    console.warn('calendar parse failed', String(err))
    return { status: 'error', byDay: empty }
  }
}
