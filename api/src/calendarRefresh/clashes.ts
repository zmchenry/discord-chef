import type { ClashWire } from '../../../shared/calendarRefresh'
import { detectClashes, type ClashSlot } from '../../../shared/planning/clashes'
import type { Candidate, DayContext, PlannedSlot } from '../../../shared/planning/engine'
import { addDays, sundayOf, todayIn, type WeekSlot } from '../../../shared/planningApi'
import { getSetting, setSetting } from '../planning/db'

// Live clash detection for one loaded week, minus dismissed ("Keep it")
// fingerprints and days already past. Dismissals live in household_settings
// as a JSON array of fingerprints, pruned to this week and next.

export const DISMISSED_KEY = 'dismissed_clashes'

export interface LoadedWeek {
  slots: WeekSlot[]
  planned: PlannedSlot[]
  days: DayContext[]
  candidates: Candidate[]
}

export async function getDismissed(db: D1Database): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse((await getSetting(db, DISMISSED_KEY)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Adds a fingerprint and drops any whose date is outside this week and next. */
export async function dismissClash(db: D1Database, fingerprint: string, today = todayIn()): Promise<string[]> {
  const from = sundayOf(today)
  const to = addDays(from, 13)
  const kept = [...new Set([...(await getDismissed(db)), fingerprint])].filter((fp) => {
    const date = fp.slice(0, 10)
    return date >= from && date <= to
  })
  await setSetting(db, DISMISSED_KEY, JSON.stringify(kept))
  return kept
}

export async function openClashes(db: D1Database, weekId: string, w: LoadedWeek, today = todayIn()): Promise<ClashWire[]> {
  const recipes = new Map(w.slots.map((s) => [`${s.date}|${s.meal}`, s.recipe]))
  const slots: ClashSlot[] = w.planned.map((p) => {
    const r = recipes.get(`${p.date}|${p.meal}`)
    return { ...p, title: r?.title ?? null, totalMinutes: r?.totalMinutes ?? null }
  })
  const clashes = detectClashes({ days: w.days, slots, candidates: w.candidates, seed: weekId })
  if (clashes.length === 0) return []
  const dismissed = new Set(await getDismissed(db))
  return clashes.filter((c) => c.date >= today && !dismissed.has(c.fingerprint))
}
