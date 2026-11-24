// Week nutrition per person, and the default portion split. Pure: no I/O.

import { planServings, splitPortions, type MealServings } from '../household/servings'
import type { MealEntry, MealStatus as HistoryStatus } from '../mealHistory'
import type { Meal, SlotKind } from '../schema'
import { ADHERENCE, adherenceOf, mealsCountedFor, type Adherence, type LoggedFood } from './counted'
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
  // Optional; goals saved before it existed have none.
  fiber?: number | null
}
export type Goals = Record<string, Goal>
export type Portions = Record<string, number>

// The split of a meal's servings lives with the servings math.
export { roundPortion, splitPortions } from '../household/servings'

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
  // Servings set while planning, or null for the default (2).
  servings: number | null
}

export interface WeekNutritionInput {
  dates: readonly string[]
  people: readonly string[]
  goals: Goals
  slots: readonly WeekSlotIn[]
  recipes: Record<string, { title: string; nutrition: RecipeNutritionResult }>
  // date -> people away that day.
  away: Record<string, readonly string[]>
  // recipe id -> servings as written, for recipes with no nutrition too.
  // Absent: the servings of `recipes`.
  recipeServings?: Record<string, number | null>
  // What was actually eaten (shared/mealHistory resolveEntries), for past
  // meals. Absent: the plan.
  history?: ReadonlyArray<Pick<MealEntry, 'date' | 'meal' | 'status' | 'recipeId'>>
  // The personal food log (shared/foodLog): each item for its person.
  // Absent: nothing logged.
  foodLog?: readonly LoggedFoodIn[]
}

// A food log item with its numbers (null: unknown, a gap).
export interface LoggedFoodIn extends LoggedFood {
  nutrients: Nutrients | null
  confidence: Confidence | null
}

// How a person's planned meals went (counted/adherenceOf), plus extras:
// logged items that were not instead of a planned meal (snacks, drinks,
// a meal nothing was planned for).
export type AdherenceCounts = Record<Adherence, number> & { extras: number }
export const NO_ADHERENCE: AdherenceCounts = { followed: 0, swapped: 0, ate_out: 0, skipped: 0, logged: 0, extras: 0 }

export interface AdherenceSummary extends AdherenceCounts {
  // Planned meals that have happened, and the share followed (null: none).
  planned: number
  rate: number | null
}

export function adherenceSummary(days: ReadonlyArray<{ adherence: AdherenceCounts }>): AdherenceSummary {
  const sum = { ...NO_ADHERENCE }
  for (const d of days) for (const k of [...ADHERENCE, 'extras'] as const) sum[k] += d.adherence[k]
  const planned = ADHERENCE.reduce((a, k) => a + sum[k], 0)
  return { ...sum, planned, rate: planned ? Math.round((sum.followed / planned) * 100) / 100 : null }
}

// How much to trust a logged item's numbers, like a recipe's line score.
const LOG_SCORE: Record<Confidence, number> = { high: 0.85, medium: 0.65, low: 0.4 }

// known: we have numbers. gap: eaten but unknown (eat out, skip, leftovers
// with nothing to be left over from). empty: nothing planned yet.
export type MealStatus = 'known' | 'gap' | 'empty'

export interface MealNutrition {
  meal: Meal
  kind: SlotKind | null
  status: MealStatus
  // What meal history says happened (eaten, swapped, ate out, skipped), or
  // null when it says nothing (still to come).
  history: HistoryStatus | null
  // People who logged their own food for this meal instead: it does not
  // count for them.
  replacedFor: string[]
  // The recipe eaten: the slot's own, for leftovers the dinner before, or
  // what was swapped in. Null when unknown.
  recipeId: string | null
  title: string | null
  portions: Portions
  custom: boolean
  perServing: Nutrients | null
  confidence: Confidence | null
  // How many it makes and how far the recipe scales (household/servings).
  serves: Pick<MealServings, 'sourceId' | 'servings' | 'leftovers' | 'factor'>
}

export interface PersonDay {
  home: boolean
  totals: Nutrients
  // Planned meals and logged items with numbers, and those without.
  known: number
  gaps: number
  // What the plan alone would have given (known planned recipes).
  plan: Nutrients
  // Food log items that day. A day with any counts even when away.
  logged: number
  adherence: AdherenceCounts
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
  // Days averaged (at home, at least one known meal) and how many of
  // those had a meal unknown too.
  daysKnown: number
  partialDays: number
  known: number
  gaps: number
  confidence: Confidence | null
  // Average per day of what the plan would have given, over the same days.
  planPerDay: Nutrients
  adherence: AdherenceSummary
}

// The day counts for the person: at home, or they logged something.
export const countsDay = (d: Pick<PersonDay, 'home'> & { logged?: number }) => d.home || (d.logged ?? 0) > 0

export interface WeekNutritionResult {
  days: DayNutrition[]
  people: Record<string, PersonWeek>
}

export function weekNutrition(input: WeekNutritionInput): WeekNutritionResult {
  const { dates, people, recipes } = input
  const scoreSum: Record<string, number> = {}
  const servings = planServings({
    dates,
    slots: input.slots,
    recipeServings:
      input.recipeServings ?? Object.fromEntries(Object.entries(recipes).map(([id, r]) => [id, r.nutrition.servings])),
  })

  const days = dates.map((date, i): DayNutrition => {
    const away = new Set(input.away[date] ?? [])
    const home = people.filter((p) => !away.has(p))
    const day: Record<string, PersonDay> = Object.fromEntries(
      people.map((p) => [
        p,
        { home: !away.has(p), totals: ZERO, known: 0, gaps: 0, plan: ZERO, logged: 0, adherence: { ...NO_ADHERENCE } },
      ]),
    )

    const planned = servings.slice(i * 3, i * 3 + 3)
    const dayLog = (input.foodLog ?? []).filter((l) => l.date === date)
    const counted = mealsCountedFor({ date, meals: planned }, input.history, dayLog)
    const meals = planned.map((s, j): MealNutrition => {
      const c = counted[j]!
      const recipe = c.recipeId ? recipes[c.recipeId] : undefined
      const status: MealStatus = !s.kind && !c.history ? 'empty' : recipe ? 'known' : 'gap'
      // The people home split the first servings; the rest are guests.
      const portions = status !== 'empty' ? splitPortions(home, s.servings, input.goals) : {}
      const plannedRecipe = s.kind && s.sourceId ? recipes[s.sourceId] : undefined
      for (const p of home) {
        const d = day[p]!
        if (plannedRecipe) d.plan = addNutrients(d.plan, plannedRecipe.nutrition.perServing, portions[p] ?? 0)
        const a = adherenceOf(s, c, p, dayLog)
        if (a) d.adherence[a]++
        if (c.replacedFor.includes(p)) continue
        if (recipe) {
          d.totals = addNutrients(d.totals, recipe.nutrition.perServing, portions[p] ?? 0)
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
        history: c.history,
        replacedFor: c.replacedFor,
        recipeId: recipe ? c.recipeId : null,
        title: recipe?.title ?? null,
        portions,
        custom: s.custom,
        perServing: recipe ? roundNutrients(recipe.nutrition.perServing) : null,
        confidence: recipe ? recipe.nutrition.confidence : null,
        serves: { sourceId: s.sourceId, servings: s.servings, leftovers: s.leftovers, factor: s.factor },
      }
    })
    // Logged items count for their person, home or away.
    for (const l of dayLog) {
      const d = day[l.person]
      if (!d) continue
      d.logged++
      if (l.meal === 'snack' || !planned.find((m) => m.meal === l.meal)?.kind) d.adherence.extras++
      if (l.nutrients) {
        d.totals = addNutrients(d.totals, l.nutrients)
        d.known++
        scoreSum[l.person] = (scoreSum[l.person] ?? 0) + (l.confidence ? LOG_SCORE[l.confidence] : 0.5)
      } else {
        d.gaps++
      }
    }
    for (const p of people) {
      day[p]!.totals = roundNutrients(day[p]!.totals)
      day[p]!.plan = roundNutrients(day[p]!.plan)
    }
    return { date, meals, people: day }
  })

  const week: Record<string, PersonWeek> = {}
  for (const p of people) {
    const mine = days.map((d) => d.people[p]!).filter(countsDay)
    const totals = mine.reduce((a, d) => addNutrients(a, d.totals), ZERO)
    const known = mine.reduce((a, d) => a + d.known, 0)
    const gaps = mine.reduce((a, d) => a + d.gaps, 0)
    const knownDays = mine.filter((d) => d.known > 0)
    const daysKnown = knownDays.length
    const planTotals = knownDays.reduce((a, d) => addNutrients(a, d.plan), ZERO)
    // Gaps pull the confidence down: a week of guesses shouldn't look precise.
    const score = known ? ((scoreSum[p] ?? 0) / known) * (known / (known + gaps)) : null
    week[p] = {
      totals: roundNutrients(totals),
      perDay: roundNutrients(daysKnown ? scaleNutrients(totals, 1 / daysKnown) : ZERO),
      daysHome: mine.length,
      daysKnown,
      partialDays: mine.filter((d) => d.known > 0 && d.gaps > 0).length,
      known,
      gaps,
      confidence: score === null ? null : confidenceOf(score),
      planPerDay: roundNutrients(daysKnown ? scaleNutrients(planTotals, 1 / daysKnown) : ZERO),
      adherence: adherenceSummary(days.map((d) => d.people[p]!)),
    }
  }
  return { days, people: week }
}
