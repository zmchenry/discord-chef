// Week nutrition per person, and the default portion split. Pure: no I/O.

import type { Member } from '../household'
import { adult, planServings, type MealServings } from '../household/servings'
import type { Meal, SlotKind } from '../schema'
import {
  addNutrients,
  confidenceOf,
  roundNutrients,
  scaleNutrients,
  ZERO,
  type Confidence,
  type Nutrients,
  type RecipeNutritionResult,
} from './recipe'

export interface Goal {
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
}
export type Goals = Record<string, Goal>
export type Portions = Record<string, number>

// The default split and the quarter-serving rounding live with the
// household servings math; re-exported here for existing callers.
export { defaultPortions, roundPortion } from '../household/servings'

// Who a day's calendar constraints say is away. The calendar writes
// "Liz away → cook for 1"; a reason naming nobody marks nobody away.
export function awayPeople(constraints: ReadonlyArray<{ kind: string; reason: string }>, people: readonly string[]): string[] {
  const away = new Set<string>()
  for (const c of constraints) {
    if (c.kind !== 'servings') continue
    const who = c.reason.split(/\baway\b/i)[0] ?? ''
    for (const p of people) {
      if (new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(who)) away.add(p)
    }
  }
  return people.filter((p) => away.has(p))
}

export interface WeekSlotIn {
  date: string
  meal: Meal
  kind: SlotKind
  recipeId: string | null
  // A stored split, or null for the default.
  portions: Portions | null
}

export interface WeekNutritionInput {
  dates: readonly string[]
  people: readonly string[]
  goals: Goals
  slots: readonly WeekSlotIn[]
  recipes: Record<string, { title: string; nutrition: RecipeNutritionResult }>
  // date -> people away that day.
  away: Record<string, readonly string[]>
  // Everyone who eats at home, kids included. Absent: `people` as adults
  // who eat every meal at home.
  members?: readonly Member[]
  // recipe id -> servings as written, for recipes with no nutrition too.
  // Absent: the servings of `recipes`.
  recipeServings?: Record<string, number | null>
}

// known: we have numbers. gap: eaten but unknown (eat out, skip, leftovers
// with nothing to be left over from). empty: nothing planned yet.
export type MealStatus = 'known' | 'gap' | 'empty'

export interface MealNutrition {
  meal: Meal
  kind: SlotKind | null
  status: MealStatus
  // The recipe eaten: the slot's own, or for leftovers the dinner before.
  recipeId: string | null
  title: string | null
  portions: Portions
  custom: boolean
  perServing: Nutrients | null
  confidence: Confidence | null
  // Who the meal feeds and how far the recipe scales (household/servings).
  serves: Pick<MealServings, 'sourceId' | 'adults' | 'kids' | 'total' | 'leftovers' | 'factor'>
}

export interface PersonDay {
  home: boolean
  totals: Nutrients
  known: number
  gaps: number
}

export interface DayNutrition {
  date: string
  meals: MealNutrition[]
  people: Record<string, PersonDay>
}

export interface PersonWeek {
  totals: Nutrients
  // Per day over the days at home with at least one known meal.
  perDay: Nutrients
  daysHome: number
  known: number
  gaps: number
  confidence: Confidence | null
}

export interface WeekNutritionResult {
  days: DayNutrition[]
  people: Record<string, PersonWeek>
}

export function weekNutrition(input: WeekNutritionInput): WeekNutritionResult {
  const { dates, people, recipes } = input
  const scoreSum: Record<string, number> = {}
  const servings = planServings({
    dates,
    members: input.members ?? people.map(adult),
    goals: input.goals,
    slots: input.slots,
    away: input.away,
    recipeServings:
      input.recipeServings ?? Object.fromEntries(Object.entries(recipes).map(([id, r]) => [id, r.nutrition.servings])),
  })

  const days = dates.map((date, i): DayNutrition => {
    const away = new Set(input.away[date] ?? [])
    const home = people.filter((p) => !away.has(p))
    const day: Record<string, PersonDay> = Object.fromEntries(
      people.map((p) => [p, { home: !away.has(p), totals: ZERO, known: 0, gaps: 0 }]),
    )

    const meals = servings.slice(i * 3, i * 3 + 3).map((s): MealNutrition => {
      const recipe = s.sourceId ? recipes[s.sourceId] : undefined
      const status: MealStatus = !s.kind ? 'empty' : recipe ? 'known' : 'gap'
      // Someone home that day but not eating this meal at home is a gap too.
      for (const p of home) {
        const d = day[p]!
        if (recipe && p in s.portions) {
          d.totals = addNutrients(d.totals, recipe.nutrition.perServing, s.portions[p]!)
          d.known++
          scoreSum[p] = (scoreSum[p] ?? 0) + recipe.nutrition.score
        } else {
          d.gaps++
        }
      }
      return {
        meal: s.meal,
        kind: s.kind,
        status,
        recipeId: recipe ? s.sourceId : null,
        title: recipe?.title ?? null,
        portions: s.portions,
        custom: s.custom,
        perServing: recipe ? roundNutrients(recipe.nutrition.perServing) : null,
        confidence: recipe ? recipe.nutrition.confidence : null,
        serves: { sourceId: s.sourceId, adults: s.adults, kids: s.kids, total: s.total, leftovers: s.leftovers, factor: s.factor },
      }
    })
    for (const p of people) day[p]!.totals = roundNutrients(day[p]!.totals)
    return { date, meals, people: day }
  })

  const week: Record<string, PersonWeek> = {}
  for (const p of people) {
    const mine = days.map((d) => d.people[p]!).filter((d) => d.home)
    const totals = mine.reduce((a, d) => addNutrients(a, d.totals), ZERO)
    const known = mine.reduce((a, d) => a + d.known, 0)
    const gaps = mine.reduce((a, d) => a + d.gaps, 0)
    const daysKnown = mine.filter((d) => d.known > 0).length
    // Gaps pull the confidence down: a week of guesses shouldn't look precise.
    const score = known ? ((scoreSum[p] ?? 0) / known) * (known / (known + gaps)) : null
    week[p] = {
      totals: roundNutrients(totals),
      perDay: roundNutrients(daysKnown ? scaleNutrients(totals, 1 / daysKnown) : ZERO),
      daysHome: mine.length,
      known,
      gaps,
      confidence: score === null ? null : confidenceOf(score),
    }
  }
  return { days, people: week }
}
