// How many servings each planned meal makes, and how much to buy for it.
// Pure: no I/O. Nutrition, shopping and cooking mode all read it.
//
// Every planned meal makes 2 servings (the two adults) unless it was changed
// while planning, in half servings. Recipes stay as written ("makes 4"); a
// recipe's factor is the meal's servings, plus any leftover meals eaten from
// it, over the recipe's servings (4 when unknown), up or down.

import type { Goals, Portions } from '../nutrition/week'
import { MEALS, type Meal, type SlotKind } from '../schema'

export const DEFAULT_SERVINGS = 2
export const SERVINGS_STEP = 0.5
export const MIN_SERVINGS = 0.5
export const MAX_SERVINGS = 12
export const ASSUMED_SERVINGS = 4

const round3 = (n: number) => Math.round(n * 1000) / 1000

// Half servings, within bounds.
export const clampServings = (n: number) =>
  Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, Math.round(n / SERVINGS_STEP) * SERVINGS_STEP))

// Quarter servings for a person's portion: fine enough to split, coarse
// enough to read.
const PORTION_STEP = 0.25
export const roundPortion = (n: number) => Math.max(0, Math.round(n / PORTION_STEP) * PORTION_STEP)

// What each person eats of a meal. The first servings, one per person,
// are split by kcal goals ("Zach 1.25 · Liz 0.75"), evenly when anyone has
// no kcal goal; servings beyond that are guests or extra and count for
// nobody. Fewer servings than people shrink everyone's share.
export function splitPortions(people: readonly string[], servings: number, goals: Goals): Portions {
  const base = Math.min(servings, people.length)
  const kcal = people.map((p) => goals[p]?.kcal ?? null)
  const sum = kcal.reduce<number>((a, k) => a + (k ?? 0), 0)
  const even = kcal.some((k) => !k) || sum <= 0
  return Object.fromEntries(
    people.map((p, i) => {
      const share = even ? base / people.length : (base * kcal[i]!) / sum
      return [p, base > 0 ? Math.max(PORTION_STEP, roundPortion(share)) : 0]
    }),
  )
}

export interface ServingSlotIn {
  date: string
  meal: Meal
  kind: SlotKind
  recipeId: string | null
  // Servings set while planning, or null for the default.
  servings: number | null
}

export interface MealServings {
  date: string
  meal: Meal
  kind: SlotKind | null
  servings: number
  custom: boolean
  // The recipe eaten: the slot's own, or for leftovers the dinner before.
  sourceId: string | null
  // Servings later leftover meals eat from this one (recipe slots).
  leftovers: number
  // (servings + leftovers) / recipe servings, for recipe slots; else null.
  factor: number | null
}

export interface PlanServingsInput {
  dates: readonly string[]
  slots: readonly ServingSlotIn[]
  // recipe id -> its servings (null: unknown, assume 4).
  recipeServings: Record<string, number | null>
}

// Every date x meal of the plan, in order, empty meals included.
export function planServings(input: PlanServingsInput): MealServings[] {
  const slotAt = new Map(input.slots.map((s) => [`${s.date}:${s.meal}`, s]))
  const out: MealServings[] = []
  let lastDinner: MealServings | null = null

  for (const date of input.dates) {
    const previousDinner = lastDinner
    for (const meal of MEALS) {
      const slot = slotAt.get(`${date}:${meal}`)
      const servings = slot?.servings ?? DEFAULT_SERVINGS
      const ms: MealServings = {
        date,
        meal,
        kind: slot?.kind ?? null,
        servings,
        custom: slot?.servings != null,
        sourceId: slot?.kind === 'recipe' ? slot.recipeId : slot?.kind === 'leftovers' ? (previousDinner?.sourceId ?? null) : null,
        leftovers: 0,
        factor: null,
      }
      if (slot?.kind === 'leftovers' && previousDinner) previousDinner.leftovers += servings
      if (meal === 'dinner' && slot?.kind === 'recipe' && slot.recipeId) lastDinner = ms
      out.push(ms)
    }
  }
  for (const ms of out) {
    if (ms.kind !== 'recipe' || !ms.sourceId) continue
    const servings = input.recipeServings[ms.sourceId] || ASSUMED_SERVINGS
    ms.factor = round3((ms.servings + ms.leftovers) / servings)
  }
  return out
}

// --- Cooking mode ----------------------------------------------------------------

// Where the servings stepper starts: what was planned (leftovers included),
// else 2, or the whole recipe when it makes fewer than 2.
export const cookStartServings = (recipeServings: number | null, planned: number | null) =>
  planned ?? (recipeServings && recipeServings < DEFAULT_SERVINGS ? recipeServings : DEFAULT_SERVINGS)

// Cooking more than was planned: the groceries may not cover it.
export const overPlanned = (planned: number | null, servings: number) => planned !== null && servings > planned + 0.001

// --- Text ------------------------------------------------------------------------

const GLYPH: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' }
// 3 -> "3", 2.5 -> "2½", 0.25 -> "¼"
export function formatServings(n: number): string {
  const whole = Math.floor(n)
  const frac = round3(n - whole)
  if (!frac) return String(whole)
  const g = GLYPH[frac]
  return g ? `${whole || ''}${g}` : String(round3(n))
}

// --- Shopping amounts ------------------------------------------------------------

// Units you buy whole: no unit ("2 avocados"), cloves, cans, slices...
const WHOLE_UNITS = new Set(['clove', 'can', 'jar', 'package', 'bunch', 'head', 'slice', 'piece', 'pinch', 'stick'])
const SMALL_UNITS = new Set(['g', 'ml'])
const NICE = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1]
// Float noise and near misses (2.99 bagels) don't buy one more.
const EPS = 0.02

// A scaled amount, rounded up to something you can buy or measure: whole
// units for countable things, whole grams and millilitres, else the next
// quarter or third (⅓ cup, 1¾ lb).
export function roundUpAmount(quantity: number, unit: string | null): number {
  if (!(quantity > 0)) return quantity
  if (!unit || WHOLE_UNITS.has(unit) || SMALL_UNITS.has(unit)) return Math.max(1, Math.ceil(quantity - EPS))
  const whole = Math.floor(quantity)
  const frac = quantity - whole
  if (frac < EPS && whole > 0) return whole
  return round3(whole + NICE.find((f) => f >= frac - EPS)!)
}
