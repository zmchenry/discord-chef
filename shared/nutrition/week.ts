// Week nutrition per person, and the default portion split. Pure: no I/O.

import { MEALS, type Meal, type SlotKind } from '../schema'
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

// Quarter servings: fine enough to portion, coarse enough to read.
const STEP = 0.25
export const roundPortion = (n: number) => Math.max(0, Math.round(n / STEP) * STEP)

// Each person at home gets one serving on average, split by their share of
// the kcal goals ("Zach 1.25 · Liz 0.75"). Even when anyone at home has no
// kcal goal.
export function defaultPortions(home: readonly string[], goals: Goals): Portions {
  const kcal = home.map((p) => goals[p]?.kcal ?? null)
  const sum = kcal.reduce<number>((a, k) => a + (k ?? 0), 0)
  const even = kcal.some((k) => !k) || sum <= 0
  return Object.fromEntries(
    home.map((p, i) => [p, even ? 1 : Math.max(STEP, roundPortion((home.length * kcal[i]!) / sum))]),
  )
}

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
  const { dates, people, goals, recipes } = input
  const slotAt = new Map(input.slots.map((s) => [`${s.date}:${s.meal}`, s]))
  const scoreSum: Record<string, number> = {}
  let lastDinner: string | null = null

  const days = dates.map((date): DayNutrition => {
    const away = new Set(input.away[date] ?? [])
    const home = people.filter((p) => !away.has(p))
    const fallback = defaultPortions(home, goals)
    const day: Record<string, PersonDay> = Object.fromEntries(
      people.map((p) => [p, { home: !away.has(p), totals: ZERO, known: 0, gaps: 0 }]),
    )
    const previousDinner = lastDinner

    const meals = MEALS.map((meal): MealNutrition => {
      const slot = slotAt.get(`${date}:${meal}`)
      const stored = slot?.portions ?? null
      const portions: Portions = Object.fromEntries(home.map((p) => [p, stored?.[p] ?? fallback[p] ?? 1]))
      const sourceId = slot?.kind === 'recipe' ? slot.recipeId : slot?.kind === 'leftovers' ? previousDinner : null
      const recipe = sourceId ? recipes[sourceId] : undefined
      if (meal === 'dinner' && slot?.kind === 'recipe' && slot.recipeId) lastDinner = slot.recipeId
      const status: MealStatus = !slot ? 'empty' : recipe ? 'known' : 'gap'

      for (const p of home) {
        const d = day[p]!
        if (recipe) {
          d.totals = addNutrients(d.totals, recipe.nutrition.perServing, portions[p]!)
          d.known++
          scoreSum[p] = (scoreSum[p] ?? 0) + recipe.nutrition.score
        } else {
          d.gaps++
        }
      }
      return {
        meal,
        kind: slot?.kind ?? null,
        status,
        recipeId: recipe ? sourceId : null,
        title: recipe?.title ?? null,
        portions,
        custom: !!stored,
        perServing: recipe ? roundNutrients(recipe.nutrition.perServing) : null,
        confidence: recipe ? recipe.nutrition.confidence : null,
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
