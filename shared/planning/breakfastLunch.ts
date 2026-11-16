import type { Meal } from '../schema'
import type { Constraint, ISODate } from './calendar'
import type { PlannedSlot } from './engine'

// Breakfast and lunch rules for the guided week (dinners are picked by hand):
// - Breakfast cycles through a short rotation. Day k of the week gets
//   rotation[(start + k) % n], and the next week starts where this one ended.
//   On a grab-and-go morning a slow pick gives way to the next quick one in the
//   rotation, if there is one.
// - Lunch is leftovers when the previous day's dinner makes leftovers, else
//   the next lunch staple in turn. A calendar eat-out means eat out.
// Only empty, unlocked slots are filled; everything filled is source 'auto'.

export interface BLRecipe {
  id: string
  title: string
  tags: string[]
  totalMinutes: number | null
  servings: number | null
  timesPlanned?: number
}

export const LEFTOVERS_TAG = 'makes-leftovers'
export const DEFAULT_STAPLE_TITLE = 'Turkey and Cheese with Veggies'
export const ROTATION_MAX = 8

export const makesLeftovers = (r: BLRecipe | undefined): boolean =>
  !!r && (r.tags.includes(LEFTOVERS_TAG) || (r.servings ?? 0) >= 6)

const isQuick = (r: BLRecipe | undefined) => !!r && (r.tags.includes('fast') || (r.totalMinutes !== null && r.totalMinutes <= 10))

const byUse = (a: BLRecipe, b: BLRecipe) => (b.timesPlanned ?? 0) - (a.timesPlanned ?? 0) || a.title.localeCompare(b.title)

/** The rotation when none is set: the 6 breakfast recipes planned most often. */
export function defaultRotation(recipes: BLRecipe[]): string[] {
  return recipes
    .filter((r) => r.tags.includes('breakfast'))
    .sort(byUse)
    .slice(0, 6)
    .map((r) => r.id)
}

/** The staples when none are set: Turkey and Cheese with Veggies, else the most planned lunch. */
export function defaultStaples(recipes: BLRecipe[]): string[] {
  const turkey = recipes.find((r) => r.title.toLowerCase() === DEFAULT_STAPLE_TITLE.toLowerCase())
  if (turkey) return [turkey.id]
  const lunch = recipes.filter((r) => r.tags.includes('lunch')).sort(byUse)[0]
  return lunch ? [lunch.id] : []
}

/** The dinner whose leftovers a lunch on `dates[i]` would eat: the day before's
 *  dinner recipe (for the first day, `prevDinnerId` from the week before). */
export function dinnerBefore(dates: ISODate[], i: number, slots: PlannedSlot[], prevDinnerId: string | null): string | null {
  if (i === 0) return prevDinnerId
  const s = slots.find((x) => x.date === dates[i - 1] && x.meal === 'dinner')
  return s?.kind === 'recipe' ? s.recipeId : null
}

export function fillBreakfastLunch(args: {
  dates: ISODate[] // the week's 7 days, in order
  slots: PlannedSlot[] // what's planned now (empty slots may be absent)
  constraints: Record<ISODate, Constraint[]>
  recipes: BLRecipe[]
  rotation: string[]
  cursor: number // rotation index for the week's first day
  staples: string[]
  prevDinnerId: string | null // last Saturday's dinner, for Sunday lunch
}): { filled: PlannedSlot[]; nextCursor: number } {
  const { dates, slots, constraints } = args
  const byId = new Map(args.recipes.map((r) => [r.id, r]))
  const rotation = args.rotation.filter((id) => byId.has(id))
  const staples = args.staples.filter((id) => byId.has(id))
  const n = rotation.length
  const start = n ? ((args.cursor % n) + n) % n : 0
  const filled: PlannedSlot[] = []
  let staple = 0

  const isEmpty = (date: ISODate, meal: Meal) => {
    const s = slots.find((x) => x.date === date && x.meal === meal)
    return !s || (!s.locked && s.kind === 'recipe' && s.recipeId === null)
  }
  const has = (date: ISODate, meal: Meal, kind: Constraint['kind']) =>
    (constraints[date] ?? []).some((c) => c.kind === kind && c.meals.includes(meal))
  const put = (date: ISODate, meal: Meal, kind: PlannedSlot['kind'], recipeId: string | null = null) =>
    filled.push({ date, meal, kind, recipeId, locked: false, source: 'auto' })

  dates.forEach((date, k) => {
    if (isEmpty(date, 'breakfast')) {
      if (has(date, 'breakfast', 'eat_out')) put(date, 'breakfast', 'eat_out')
      else if (n) {
        let pick = rotation[(start + k) % n]!
        if (has(date, 'breakfast', 'grab_and_go') && !isQuick(byId.get(pick))) {
          const quick = Array.from({ length: n }, (_, j) => rotation[(start + k + j) % n]!).find((id) => isQuick(byId.get(id)))
          if (quick) pick = quick
        }
        put(date, 'breakfast', 'recipe', pick)
      }
    }
    if (isEmpty(date, 'lunch')) {
      if (has(date, 'lunch', 'eat_out')) put(date, 'lunch', 'eat_out')
      else if (makesLeftovers(byId.get(dinnerBefore(dates, k, slots, args.prevDinnerId) ?? ''))) put(date, 'lunch', 'leftovers')
      else if (staples.length) put(date, 'lunch', 'recipe', staples[staple++ % staples.length]!)
    }
  })

  return { filled, nextCursor: n ? (start + dates.length) % n : 0 }
}
