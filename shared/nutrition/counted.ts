// Which recipe each meal of a day counts as, and for whom. Pure: no I/O.
//
// The one place that decides it, so every nutrition view agrees. It merges
// the plan with meal history ("what we actually ate", shared/mealHistory)
// and the personal food log (shared/foodLog):
//   * no history for the meal (still to come, or nothing planned and
//     nothing logged): the plan, so leftovers count as the dinner before.
//   * eaten: what was planned (or the recipe logged as eaten).
//   * swapped: the recipe swapped in; a free-text swap is unknown.
//   * ate out, skipped: unknown. A gap, never zero: they ate something.
//   * someone logged food for that breakfast, lunch or dinner: the
//     household meal no longer counts for them (replacedFor); they ate what
//     they logged. Snacks never replace anything, they always add.
// Past planned meals nobody logged arrive here as eaten (resolveEntries
// assumes the plan happened), so the result matches the plan until someone
// says otherwise.

import type { FoodMeal } from '../foodLog'
import type { MealEntry, MealStatus } from '../mealHistory'
import type { Meal, SlotKind } from '../schema'

export interface PlannedMeal {
  meal: Meal
  kind: SlotKind | null
  // The planned recipe eaten: the slot's own, or for leftovers the dinner before.
  sourceId: string | null
}

// A food log item as the counting sees it.
export interface LoggedFood {
  date: string
  meal: FoodMeal
  person: string
  recipeId?: string | null
}

export interface CountedMeal {
  meal: Meal
  // The recipe to count, or null when what was eaten is unknown.
  recipeId: string | null
  // What history says happened, or null when it says nothing.
  history: MealStatus | null
  // People who logged their own food for this meal: the household meal
  // does not count for them.
  replacedFor: string[]
}

export function mealsCountedFor(
  day: { date: string; meals: readonly PlannedMeal[] },
  history: ReadonlyArray<Pick<MealEntry, 'date' | 'meal' | 'status' | 'recipeId'>> = [],
  logged: readonly LoggedFood[] = [],
): CountedMeal[] {
  return day.meals.map((m): CountedMeal => {
    const replacedFor = [...new Set(logged.filter((l) => l.date === day.date && l.meal === m.meal).map((l) => l.person))]
    const e = history.find((h) => h.date === day.date && h.meal === m.meal)
    if (!e) return { meal: m.meal, recipeId: m.sourceId, history: null, replacedFor }
    const recipeId = e.status === 'eaten' ? (e.recipeId ?? m.sourceId) : e.status === 'swapped' ? e.recipeId : null
    return { meal: m.meal, recipeId, history: e.status, replacedFor }
  })
}

// How one person's planned meal went, for plan adherence. null: nothing
// planned, or still to come.
//   followed  eaten as planned. A planned eat-out or skip that happened
//             counts, and so does logging the planned recipe itself.
//   logged    they logged something else instead.
export const ADHERENCE = ['followed', 'swapped', 'ate_out', 'skipped', 'logged'] as const
export type Adherence = (typeof ADHERENCE)[number]

// `logged` is that day's food log.
export function adherenceOf(
  planned: PlannedMeal,
  counted: CountedMeal,
  person: string,
  logged: readonly LoggedFood[] = [],
): Adherence | null {
  if (!planned.kind) return null
  if (counted.replacedFor.includes(person)) {
    if (planned.kind === 'eat_out') return 'followed'
    const mine = logged.filter((l) => l.person === person && l.meal === planned.meal)
    return planned.sourceId && mine.some((l) => l.recipeId === planned.sourceId) ? 'followed' : 'logged'
  }
  switch (counted.history) {
    case null:
      return null
    case 'eaten':
      return 'followed'
    case 'swapped':
      return 'swapped'
    case 'ate_out':
      return planned.kind === 'eat_out' ? 'followed' : 'ate_out'
    case 'skipped':
      return planned.kind === 'skip' ? 'followed' : 'skipped'
  }
}
