// Which recipe each meal of a day counts as. Pure: no I/O.
//
// The one place that decides it, so every nutrition view agrees. It merges
// the plan with meal history ("what we actually ate", shared/mealHistory):
//   * no history for the meal (still to come, or nothing planned and
//     nothing logged): the plan, so leftovers count as the dinner before.
//   * eaten: what was planned (or the recipe logged as eaten).
//   * swapped: the recipe swapped in; a free-text swap is unknown.
//   * ate out, skipped: unknown. A gap, never zero: they ate something.
// Past planned meals nobody logged arrive here as eaten (resolveEntries
// assumes the plan happened), so the result matches the plan until someone
// says otherwise.

import type { MealEntry, MealStatus } from '../mealHistory'
import type { Meal, SlotKind } from '../schema'

export interface PlannedMeal {
  meal: Meal
  kind: SlotKind | null
  // The planned recipe eaten: the slot's own, or for leftovers the dinner before.
  sourceId: string | null
}

export interface CountedMeal {
  meal: Meal
  // The recipe to count, or null when what was eaten is unknown.
  recipeId: string | null
  // What history says happened, or null when it says nothing.
  history: MealStatus | null
}

export function mealsCountedFor(
  day: { date: string; meals: readonly PlannedMeal[] },
  history: ReadonlyArray<Pick<MealEntry, 'date' | 'meal' | 'status' | 'recipeId'>> = [],
): CountedMeal[] {
  return day.meals.map((m): CountedMeal => {
    const e = history.find((h) => h.date === day.date && h.meal === m.meal)
    if (!e) return { meal: m.meal, recipeId: m.sourceId, history: null }
    const recipeId = e.status === 'eaten' ? (e.recipeId ?? m.sourceId) : e.status === 'swapped' ? e.recipeId : null
    return { meal: m.meal, recipeId, history: e.status }
  })
}
