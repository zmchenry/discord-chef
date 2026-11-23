// Which of a day's meals count toward what each person ate. Pure: no I/O.
//
// The one place that decides it, so every nutrition view agrees. Today
// it reads the plan: every planned meal counts, as known numbers when its
// recipe has an estimate and as a gap (unknown, never zero) when it hasn't
// (eat out, skip, leftovers with nothing before them, no estimate yet).
// Empty meals don't count at all.
//
// When meal history ("what we actually ate": eaten / skipped / ate out)
// lands, point this at it for past days: skipped meals drop out, ate-out
// meals become gaps, and eaten meals count as planned.

import type { MealNutrition } from './week'

export interface CountedMeal {
  meal: MealNutrition
  as: 'known' | 'gap'
}

export function mealsCountedFor(day: { date: string; meals: readonly MealNutrition[] }): CountedMeal[] {
  return day.meals.map((meal) => ({ meal, as: meal.status === 'known' ? 'known' : 'gap' }))
}
