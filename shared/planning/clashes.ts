import type { Meal } from '../schema'
import { weekdayOf, type Constraint, type ISODate } from './calendar'
import { scoreCandidates, type Candidate, type DayContext, type PlannedSlot } from './engine'

// Calendar clashes: a planned meal that no longer fits the calendar (a busy
// evening added midweek, a dinner out, an early start). Pure: the caller loads
// the week and decides what to do. Nothing here changes a plan.

export type ClashKind = 'max_minutes' | 'eat_out' | 'grab_and_go'

export type ClashFix = { kind: 'swap'; recipeId: string; title: string } | { kind: 'eat_out' }

export interface Clash {
  date: ISODate
  meal: Meal
  kind: ClashKind
  reason: string // the constraint's reason, e.g. "Soccer 5:30–7 → 25 min or less"
  recipeId: string
  recipeTitle: string
  locked: boolean
  fingerprint: string // date|meal|kind|recipeId|reason
  fix: ClashFix | null // null when no recipe fits
}

// A planned slot plus what the clash needs to know about its recipe.
export interface ClashSlot extends PlannedSlot {
  title: string | null
  totalMinutes: number | null
}

export const GRAB_AND_GO_MINUTES = 15

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const clashFingerprint = (c: Pick<Clash, 'date' | 'meal' | 'kind' | 'recipeId' | 'reason'>) =>
  [c.date, c.meal, c.kind, c.recipeId, c.reason].join('|')

/** "Soccer 5:30–7 → 25 min or less" → "Soccer 5:30–7". */
export const clashEvent = (reason: string) => reason.split('→')[0]!.trim() || 'the calendar'

/** "Thu dinner clashes with Soccer 5:30–7" */
export const clashSummary = (c: Pick<Clash, 'date' | 'meal' | 'reason'>) =>
  `${DAY_SHORT[weekdayOf(c.date)]} ${c.meal} clashes with ${clashEvent(c.reason)}`

function limitOf(k: Constraint): number | null {
  if (k.kind === 'max_minutes') return k.minutes
  if (k.kind === 'grab_and_go') return GRAB_AND_GO_MINUTES
  return null
}

/** Every planned recipe that breaks a calendar constraint on its day: over a
 *  max_minutes limit (unknown minutes never clash), planned on an eat_out meal,
 *  or a grab_and_go breakfast over 15 minutes. Locked slots are included. The fix
 *  for a time clash is the scorer's top pick for that slot that fits the limit. */
export function detectClashes(args: {
  days: DayContext[]
  slots: ClashSlot[]
  candidates: Candidate[]
  seed: string
}): Clash[] {
  const { days, slots, candidates, seed } = args
  const out: Clash[] = []
  for (const slot of slots) {
    if (slot.kind !== 'recipe' || !slot.recipeId) continue
    const day = days.find((d) => d.date === slot.date)
    if (!day) continue
    for (const k of day.constraints) {
      if (!k.meals.includes(slot.meal) || k.kind === 'servings') continue
      const limit = limitOf(k)
      if (limit !== null && (slot.totalMinutes === null || slot.totalMinutes <= limit)) continue

      let fix: ClashFix | null = { kind: 'eat_out' }
      if (limit !== null) {
        const fits = new Map(
          candidates
            .filter((c) => c.recipeId !== slot.recipeId && c.totalMinutes !== null && c.totalMinutes <= limit)
            .map((c) => [c.recipeId, c]),
        )
        const top = scoreCandidates({
          date: slot.date,
          meal: slot.meal,
          day,
          week: slots.filter((s) => !(s.date === slot.date && s.meal === slot.meal)),
          candidates: [...fits.values()],
          seed,
        })[0]
        fix = top ? { kind: 'swap', recipeId: top.recipeId, title: fits.get(top.recipeId)!.title } : null
      }

      const base = { date: slot.date, meal: slot.meal, kind: k.kind, reason: k.reason, recipeId: slot.recipeId }
      out.push({
        ...base,
        recipeTitle: slot.title ?? 'this recipe',
        locked: slot.locked,
        fingerprint: clashFingerprint(base),
        fix,
      })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
