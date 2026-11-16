// STUB (drop at merge): the real parser and rules come from the engine agent.
import type { Meal } from '../schema'

export type ISODate = string

export interface CalEvent {
  title: string
  start: string
  end: string
  allDay: boolean
}

export type Constraint =
  | { kind: 'max_minutes'; minutes: number; meals: Meal[]; reason: string }
  | { kind: 'servings'; count: number; meals: Meal[]; reason: string }
  | { kind: 'eat_out'; meals: Meal[]; reason: string }
  | { kind: 'grab_and_go'; meals: Meal[]; reason: string }

// Naive: unfolded lines, DTSTART/DTEND/SUMMARY only, no RRULE, no TZ maths.
export function parseIcs(text: string, rangeStart: ISODate, rangeEnd: ISODate): CalEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const events: CalEvent[] = []
  let cur: Partial<CalEvent> | null = null
  const toIso = (v: string) => {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/)
    if (!m) return { value: v, allDay: true }
    return m[4]
      ? { value: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, allDay: false }
      : { value: `${m[1]}-${m[2]}-${m[3]}`, allDay: true }
  }
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {}
    else if (line === 'END:VEVENT' && cur) {
      if (cur.start && cur.start.slice(0, 10) <= rangeEnd && (cur.end ?? cur.start).slice(0, 10) >= rangeStart) {
        events.push({ title: cur.title ?? '', start: cur.start, end: cur.end ?? cur.start, allDay: !!cur.allDay })
      }
      cur = null
    } else if (cur) {
      const idx = line.indexOf(':')
      const key = line.slice(0, idx).split(';')[0]
      const val = line.slice(idx + 1)
      if (key === 'SUMMARY') cur.title = val
      if (key === 'DTSTART') {
        const t = toIso(val)
        cur.start = t.value
        cur.allDay = t.allDay
      }
      if (key === 'DTEND') cur.end = toIso(val).value
    }
  }
  return events
}

// Naive: an event starting 16:00-19:59 on a day → dinner ≤ 25 min.
export function eventsToConstraints(
  events: CalEvent[],
  days: ISODate[],
  _household: { people: string[] },
): Record<ISODate, Constraint[]> {
  const out: Record<ISODate, Constraint[]> = {}
  for (const d of days) out[d] = []
  for (const e of events) {
    const day = e.start.slice(0, 10)
    if (!out[day] || e.allDay) continue
    const hour = Number(e.start.slice(11, 13))
    if (/dinner|restaurant|party at/i.test(e.title)) {
      out[day].push({ kind: 'eat_out', meals: ['dinner'], reason: `${e.title} → eat out` })
    } else if (hour >= 16 && hour < 20) {
      out[day].push({ kind: 'max_minutes', minutes: 25, meals: ['dinner'], reason: `${e.title} → 25 min or less` })
    } else if (hour < 8) {
      out[day].push({ kind: 'grab_and_go', meals: ['breakfast'], reason: `${e.title} → grab-and-go breakfast` })
    }
  }
  return out
}
