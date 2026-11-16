import type { Meal } from '../schema'

// Calendar → per-day planning constraints. Pure: no I/O, no clock.
//
// parseIcs reads the family calendar's secret iCal feed (Google Calendar's
// export, but nothing Google-specific) and expands the events that touch a
// date range. eventsToConstraints turns those events into rules the scorer
// understands (busy evening, eating out, someone away, early start).

export type ISODate = string // 'YYYY-MM-DD', in America/New_York

export const HOME_TZ = 'America/New_York'

export interface CalEvent {
  title: string
  // Timed: ISO datetime with the New York offset, e.g. '2026-11-17T17:30:00-05:00'.
  // All-day: ISODate. `end` is exclusive, as in iCal: a trip on Fri–Sun has
  // start '…-20' and end '…-23'.
  start: string
  end: string
  allDay: boolean
}

export type Constraint =
  | { kind: 'max_minutes'; minutes: number; meals: Meal[]; reason: string } // busy evening → dinner ≤ N min
  | { kind: 'servings'; count: number; meals: Meal[]; reason: string } // someone away
  | { kind: 'eat_out'; meals: Meal[]; reason: string } // dinner at the Parkers
  | { kind: 'grab_and_go'; meals: Meal[]; reason: string } // early start → quick breakfast

// ---------------------------------------------------------------------------
// Date and timezone helpers (Intl only, no dependency)

const DAY_MS = 86_400_000

export function addDays(date: ISODate, n: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0=Sun..6=Sat */
export function weekdayOf(date: ISODate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, f)
  }
  return f
}

function validTz(tz: string | undefined): string {
  if (!tz) return HOME_TZ
  try {
    formatterFor(tz)
    return tz
  } catch {
    return HOME_TZ // e.g. Windows names like "Eastern Standard Time"
  }
}

interface WallTime {
  date: ISODate
  h: number
  m: number
  s: number
}

/** The wall-clock time in `tz` at instant `ms`. */
export function wallTime(ms: number, tz: string): WallTime {
  const p: Record<string, string> = {}
  for (const part of formatterFor(tz).formatToParts(new Date(ms))) p[part.type] = part.value
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    h: Number(p.hour) % 24,
    m: Number(p.minute),
    s: Number(p.second),
  }
}

function offsetMs(ms: number, tz: string): number {
  const w = wallTime(ms, tz)
  const [y, mo, d] = w.date.split('-').map(Number)
  return Date.UTC(y!, mo! - 1, d!, w.h, w.m, w.s) - Math.floor(ms / 1000) * 1000
}

/** The instant at which the wall clock in `tz` reads `w`. */
function zonedToUtc(w: WallTime, tz: string): number {
  const [y, mo, d] = w.date.split('-').map(Number)
  const guess = Date.UTC(y!, mo! - 1, d!, w.h, w.m, w.s)
  let utc = guess - offsetMs(guess, tz)
  const second = offsetMs(utc, tz)
  if (guess - second !== utc) utc = guess - second
  return utc
}

const pad = (n: number) => String(n).padStart(2, '0')

/** '2026-11-17T17:30:00-05:00' */
function formatHome(ms: number): string {
  const w = wallTime(ms, HOME_TZ)
  const off = Math.round(offsetMs(ms, HOME_TZ) / 60_000)
  const sign = off < 0 ? '-' : '+'
  const abs = Math.abs(off)
  return `${w.date}T${pad(w.h)}:${pad(w.m)}:${pad(w.s)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

// ---------------------------------------------------------------------------
// ICS parsing

interface Prop {
  name: string
  params: Record<string, string>
  value: string
}

// One iCal date value: a date (all-day), a UTC instant, or a wall time in a zone.
type IcsTime =
  | { kind: 'date'; date: ISODate }
  | { kind: 'utc'; ms: number }
  | { kind: 'zoned'; wall: WallTime; tz: string }

function parseProp(line: string): Prop | null {
  // NAME;PARAM=a;PARAM2="b:c":value. Colons can appear inside quoted params.
  let i = 0
  let inQuote = false
  for (; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuote = !inQuote
    else if (c === ':' && !inQuote) break
  }
  if (i >= line.length) return null
  const [rawName, ...rawParams] = line.slice(0, i).split(';')
  const params: Record<string, string> = {}
  for (const p of rawParams) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: rawName!.toUpperCase(), params, value: line.slice(i + 1) }
}

function parseIcsTime(value: string, params: Record<string, string>): IcsTime | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim())
  if (!m) return null
  const date = `${m[1]}-${m[2]}-${m[3]}`
  if (m[4] === undefined || params.VALUE === 'DATE') return { kind: 'date', date }
  const wall = { date, h: Number(m[4]), m: Number(m[5]), s: Number(m[6] ?? 0) }
  if (m[7]) return { kind: 'utc', ms: Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, wall.h, wall.m, wall.s) }
  // Floating times (no TZID) are read as home time.
  return { kind: 'zoned', wall, tz: validTz(params.TZID) }
}

function toMs(t: IcsTime): number {
  if (t.kind === 'utc') return t.ms
  if (t.kind === 'zoned') return zonedToUtc(t.wall, t.tz)
  return zonedToUtc({ date: t.date, h: 0, m: 0, s: 0 }, HOME_TZ)
}

function parseDurationMs(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim())
  if (!m) return null
  const ms =
    ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86_400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) *
    1000
  return m[1] === '-' ? -ms : ms
}

function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c)).trim()
}

interface RawEvent {
  uid: string | null
  summary: string
  start: IcsTime
  end: IcsTime | null
  durationMs: number | null
  rrule: Record<string, string> | null
  exdates: IcsTime[]
  recurrenceId: IcsTime | null
  cancelled: boolean
}

function readEvents(text: string): RawEvent[] {
  // Unfold continuation lines (RFC 5545 §3.1).
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const out: RawEvent[] = []
  let cur: Partial<RawEvent> | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = { uid: null, summary: '', end: null, durationMs: null, rrule: null, exdates: [], recurrenceId: null, cancelled: false }
      continue
    }
    if (!cur) continue
    if (line === 'END:VEVENT') {
      if (cur.start) out.push(cur as RawEvent)
      cur = null
      continue
    }
    const p = parseProp(line)
    if (!p) continue
    switch (p.name) {
      case 'UID':
        cur.uid = p.value.trim()
        break
      case 'SUMMARY':
        cur.summary = unescapeText(p.value)
        break
      case 'DTSTART':
        cur.start = parseIcsTime(p.value, p.params) ?? undefined
        break
      case 'DTEND':
        cur.end = parseIcsTime(p.value, p.params)
        break
      case 'DURATION':
        cur.durationMs = parseDurationMs(p.value)
        break
      case 'RRULE':
        cur.rrule = Object.fromEntries(
          p.value.split(';').map((kv) => {
            const [k, v = ''] = kv.split('=')
            return [k!.toUpperCase(), v]
          }),
        )
        break
      case 'EXDATE':
        for (const v of p.value.split(',')) {
          const t = parseIcsTime(v, p.params)
          if (t) cur.exdates!.push(t)
        }
        break
      case 'RECURRENCE-ID':
        cur.recurrenceId = parseIcsTime(p.value, p.params)
        break
      case 'STATUS':
        cur.cancelled = p.value.trim().toUpperCase() === 'CANCELLED'
        break
    }
  }
  return out
}

// The calendar date of a time in its own frame (UTC times by their UTC date).
function icsDate(t: IcsTime): ISODate {
  return t.kind === 'utc' ? new Date(t.ms).toISOString().slice(0, 10) : t.kind === 'date' ? t.date : t.wall.date
}

const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

// Occurrence start times of a (possibly recurring) event, in the event's own
// frame: dates for all-day events, wall times for zoned ones, instants for UTC.
function occurrences(ev: RawEvent, lastDate: ISODate): IcsTime[] {
  const rule = ev.rrule
  if (!rule || (rule.FREQ !== 'WEEKLY' && rule.FREQ !== 'DAILY')) return [ev.start]

  const s = ev.start
  const startDate = icsDate(s)
  const at = (date: ISODate): IcsTime =>
    s.kind === 'date'
      ? { kind: 'date', date }
      : s.kind === 'zoned'
        ? { kind: 'zoned', wall: { ...s.wall, date }, tz: s.tz }
        : { kind: 'utc', ms: s.ms + daysBetween(startDate, date) * DAY_MS }

  const interval = Math.max(1, Number(rule.INTERVAL ?? 1) || 1)
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity
  const until = rule.UNTIL ? parseIcsTime(rule.UNTIL, {}) : null
  const pastUntil = (t: IcsTime): boolean => {
    if (!until) return false
    if (until.kind === 'date') return icsDate(t) > until.date
    return toMs(t) > toMs(until)
  }

  const days =
    rule.FREQ === 'WEEKLY'
      ? (rule.BYDAY ? rule.BYDAY.split(',').map((d) => BYDAY[d.slice(-2).toUpperCase()]) : [weekdayOf(startDate)])
          .filter((d): d is number => d !== undefined)
          .map((d) => (d + 6) % 7) // Monday-based offset within the week (WKST=MO)
          .sort((a, b) => a - b)
      : [0]
  const firstPeriod = rule.FREQ === 'WEEKLY' ? addDays(startDate, -((weekdayOf(startDate) + 6) % 7)) : startDate
  const step = rule.FREQ === 'WEEKLY' ? 7 * interval : interval

  const out: IcsTime[] = []
  let n = 0
  for (let period = firstPeriod, guard = 0; period <= lastDate && guard < 2000; period = addDays(period, step), guard++) {
    for (const off of days) {
      const date = addDays(period, off)
      if (date < startDate) continue
      if (date > lastDate) return out
      const t = at(date)
      if (n >= count || pastUntil(t)) return out
      n++
      out.push(t)
    }
  }
  return out
}

function sameStart(a: IcsTime, b: IcsTime): boolean {
  if (a.kind === 'date' || b.kind === 'date') {
    const da = a.kind === 'date' ? a.date : wallTime(toMs(a), HOME_TZ).date
    const db = b.kind === 'date' ? b.date : wallTime(toMs(b), HOME_TZ).date
    return da === db
  }
  return toMs(a) === toMs(b)
}

/** Minimal ICS parser: VEVENT with DTSTART/DTEND (TZID, UTC 'Z', or VALUE=DATE),
 *  SUMMARY, and simple RRULE FREQ=WEEKLY|DAILY with BYDAY/UNTIL/COUNT, plus EXDATE.
 *  Expands occurrences that overlap [rangeStart, rangeEnd]. Times converted to
 *  America/New_York. */
export function parseIcs(text: string, rangeStart: ISODate, rangeEnd: ISODate): CalEvent[] {
  const raw = readEvents(text)
  const rangeStartMs = zonedToUtc({ date: rangeStart, h: 0, m: 0, s: 0 }, HOME_TZ)
  const rangeEndMs = zonedToUtc({ date: addDays(rangeEnd, 1), h: 0, m: 0, s: 0 }, HOME_TZ)

  // Moved or edited instances of a series arrive as their own VEVENT with a
  // RECURRENCE-ID; the series must skip the original slot.
  const overridden = new Map<string, IcsTime[]>()
  for (const ev of raw) {
    if (ev.uid && ev.recurrenceId) overridden.set(ev.uid, [...(overridden.get(ev.uid) ?? []), ev.recurrenceId])
  }

  const out: Array<CalEvent & { sortMs: number }> = []
  for (const ev of raw) {
    const allDay = ev.start.kind === 'date'
    const startMs0 = toMs(ev.start)
    let durationMs: number
    if (ev.end) durationMs = allDay ? daysBetween(icsDate(ev.start), icsDate(ev.end)) * DAY_MS : toMs(ev.end) - startMs0
    else durationMs = ev.durationMs ?? (allDay ? DAY_MS : 0)
    durationMs = Math.max(0, durationMs)

    const exclusions = ev.rrule && ev.uid ? [...ev.exdates, ...(overridden.get(ev.uid) ?? [])] : ev.exdates
    for (const occ of occurrences(ev, rangeEnd)) {
      if (ev.cancelled) break
      if (exclusions.some((x) => sameStart(occ, x))) continue
      if (allDay) {
        const start = icsDate(occ)
        const days = Math.max(1, Math.round(durationMs / DAY_MS))
        const end = addDays(start, days)
        if (start > rangeEnd || end <= rangeStart) continue
        out.push({ title: ev.summary, start, end, allDay: true, sortMs: toMs(occ) })
      } else {
        const startMs = toMs(occ)
        const endMs = startMs + durationMs
        const overlaps = startMs < rangeEndMs && (endMs > rangeStartMs || (durationMs === 0 && startMs >= rangeStartMs))
        if (!overlaps) continue
        out.push({ title: ev.summary, start: formatHome(startMs), end: formatHome(endMs), allDay: false, sortMs: startMs })
      }
    }
  }
  out.sort((a, b) => a.sortMs - b.sortMs || a.title.localeCompare(b.title))
  return out.map(({ sortMs: _sortMs, ...e }) => e)
}

// ---------------------------------------------------------------------------
// Events → constraints

const AWAY = /\b(out of town|trip|away|travel(?:ing|ling)?|vacation|conference)\b/i
const EAT_OUT = /\b(dinner|restaurant|party at|birthday party|cookout|potluck)\b/i
const LUNCH_OUT = /\blunch\b/i
const BUSY_MINUTES = 25

/** '5:30' or '7' (12-hour clock, no am/pm: the context makes it obvious). */
function clock(h: number, m: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? String(h12) : `${h12}:${pad(m)}`
}

const minutesOfDay = (w: WallTime) => w.h * 60 + w.m

/** Rule-based (keywords + time windows), e.g. events 4–8pm on a weekday → max_minutes 25
 *  for dinner; titles with "dinner", "restaurant", "party at" spanning 5–9pm → eat_out
 *  dinner; all-day/multi-day with "out of town", "trip", "away", "travel" → servings
 *  (household minus one; the title usually names the person); start before 8am →
 *  grab_and_go breakfast. Each constraint carries a short human reason built from the
 *  event title, e.g. "Soccer 5:30–7 → 25 min or less". Every day in `days` gets an
 *  entry, possibly empty. */
export function eventsToConstraints(
  events: CalEvent[],
  days: ISODate[],
  household: { people: string[] },
): Record<ISODate, Constraint[]> {
  const out: Record<ISODate, Constraint[]> = {}
  for (const d of days) out[d] = []
  const add = (date: ISODate, c: Constraint) => out[date]?.push(c)

  for (const ev of events) {
    const title = ev.title.trim() || 'Busy'
    if (ev.allDay) {
      if (!AWAY.test(title)) continue
      const named = household.people.filter((p) => p && new RegExp(`\\b${escapeRe(p)}\\b`, 'i').test(title))
      const awayCount = named.length || 1
      const count = Math.max(1, household.people.length - awayCount)
      const who = named.length ? named.join(' and ') : title
      const reason = `${who} away → cook for ${count}`
      for (let d = ev.start; d < ev.end; d = addDays(d, 1)) {
        add(d, { kind: 'servings', count, meals: ['breakfast', 'lunch', 'dinner'], reason })
      }
      continue
    }

    const startMs = Date.parse(ev.start)
    const endMs = Date.parse(ev.end)
    const s = wallTime(startMs, HOME_TZ)
    const e = wallTime(endMs, HOME_TZ)
    const date = s.date
    if (!(date in out)) continue
    const startMin = minutesOfDay(s)
    // An event that runs past midnight counts as ending at midnight.
    const endMin = e.date > date ? 24 * 60 : minutesOfDay(e)
    const span = `${clock(s.h, s.m)}–${clock(e.h, e.m)}`
    const overlaps = (from: number, to: number) => startMin < to * 60 && endMin > from * 60
    const longEnough = endMin - startMin >= 30

    if (EAT_OUT.test(title) && overlaps(17, 21)) {
      add(date, { kind: 'eat_out', meals: ['dinner'], reason: `${title} → eating out` })
    } else if (LUNCH_OUT.test(title) && overlaps(11, 14)) {
      add(date, { kind: 'eat_out', meals: ['lunch'], reason: `${title} → eating out` })
    } else if (longEnough && overlaps(16, 20) && weekdayOf(date) >= 1 && weekdayOf(date) <= 5) {
      add(date, {
        kind: 'max_minutes',
        minutes: BUSY_MINUTES,
        meals: ['dinner'],
        reason: `${title} ${span} → ${BUSY_MINUTES} min or less`,
      })
    }
    if (startMin >= 4 * 60 && startMin < 8 * 60) {
      add(date, { kind: 'grab_and_go', meals: ['breakfast'], reason: `${title} ${clock(s.h, s.m)} → grab-and-go breakfast` })
    }
  }

  for (const d of days) out[d] = mergeConstraints(out[d]!)
  return out
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// One constraint per kind and meal set, keeping the strictest. A meal that is
// eaten out needs no time limit.
function mergeConstraints(list: Constraint[]): Constraint[] {
  const byKey = new Map<string, Constraint>()
  for (const c of list) {
    const key = `${c.kind}:${c.meals.join(',')}`
    const prev = byKey.get(key)
    if (!prev) byKey.set(key, c)
    else if (c.kind === 'max_minutes' && prev.kind === 'max_minutes' && c.minutes < prev.minutes) byKey.set(key, c)
    else if (c.kind === 'servings' && prev.kind === 'servings' && c.count < prev.count) byKey.set(key, c)
  }
  const merged = [...byKey.values()]
  const out = new Set(merged.filter((c) => c.kind === 'eat_out').flatMap((c) => c.meals))
  return merged.filter((c) => c.kind !== 'max_minutes' || !c.meals.every((m) => out.has(m)))
}
