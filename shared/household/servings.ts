// How many servings each planned meal feeds, and how much to buy for it.
// Pure: no I/O. Nutrition (portions per person) and shopping (the scale of
// each recipe) both read the same numbers from here.
//
// Recipes stay as written ("makes 4"). A meal's eaters are the members home
// for it: adults not away on the calendar that day, kids, and only those who
// usually eat that meal at home. Adults split their servings by kcal goals,
// kids take their portion. A stored split (plan_slot_portions) overrides it.
// A recipe's factor is the servings eaten, plus any leftover meals eaten
// from it, over the recipe's servings (4 when unknown).

import { DEFAULT_PORTION, type HomeMeal, type Member } from '../household'
import type { Goals, Portions } from '../nutrition/week'
import { MEALS, type Meal, type SlotKind } from '../schema'

// Quarter servings: fine enough to portion, coarse enough to read.
const STEP = 0.25
export const roundPortion = (n: number) => Math.max(0, Math.round(n / STEP) * STEP)

export const ASSUMED_SERVINGS = 4
const ALL_MEALS: HomeMeal[] = ['breakfast', 'lunch', 'dinner', 'snack']

export const adult = (name: string): Member => ({ name, kind: 'adult', portion: DEFAULT_PORTION.adult, meals: ALL_MEALS })

// The household: every adult in `people` order (with their stored settings,
// if any), then the kids. Kids with no name become "Kid 1", "Kid 2"...
// Names are unique: a clash gets a number.
export function householdMembers(people: readonly string[], stored: readonly Member[] | null): Member[] {
  const saved = stored ?? []
  const adults = people.map((p) => {
    const s = saved.find((m) => m.kind === 'adult' && m.name === p)
    return s ? { ...s, name: p } : adult(p)
  })
  const taken = new Set(adults.map((a) => a.name.toLowerCase()))
  const kids: Member[] = []
  for (const k of saved.filter((m) => m.kind === 'kid')) {
    let name = k.name.trim()
    if (!name || taken.has(name.toLowerCase())) {
      const base = name || 'Kid'
      let n = 0
      do name = `${base} ${++n}`
      while (taken.has(name.toLowerCase()))
    }
    taken.add(name.toLowerCase())
    kids.push({ ...k, name })
  }
  return [...adults, ...kids]
}

// One meal's default split. Adults share their servings by kcal goals
// ("Zach 1.25 · Liz 0.75"), evenly when any adult at home has no kcal goal;
// kids just take their portion. Plain names are adults with one serving.
export function defaultPortions(eaters: ReadonlyArray<string | Member>, goals: Goals): Portions {
  const ms = eaters.map((e) => (typeof e === 'string' ? adult(e) : e))
  const adults = ms.filter((m) => m.kind === 'adult')
  const kcal = adults.map((a) => goals[a.name]?.kcal ?? null)
  const sum = kcal.reduce<number>((a, k) => a + (k ?? 0), 0)
  const even = kcal.some((k) => !k) || sum <= 0
  const base = adults.reduce((a, m) => a + m.portion, 0)
  return Object.fromEntries(
    ms.map((m) => {
      if (m.kind === 'kid' || even) return [m.name, m.portion]
      const i = adults.indexOf(m)
      return [m.name, Math.max(STEP, roundPortion((base * kcal[i]!) / sum))]
    }),
  )
}

// Who eats a meal at home: usually home for it, and not away that day.
export const eatersFor = (members: readonly Member[], meal: HomeMeal, away: readonly string[]): Member[] =>
  members.filter((m) => m.meals.includes(meal) && !(m.kind === 'adult' && away.includes(m.name)))

export interface ServingSlotIn {
  date: string
  meal: Meal
  kind: SlotKind
  recipeId: string | null
  // A stored split, or null for the default.
  portions: Portions | null
}

export interface MealServings {
  date: string
  meal: Meal
  kind: SlotKind | null
  // Everyone home for the meal, with their servings (0 is allowed).
  portions: Portions
  custom: boolean
  // People with a portion above 0.
  adults: number
  kids: number
  total: number
  // The recipe eaten: the slot's own, or for leftovers the dinner before.
  sourceId: string | null
  // Servings later leftover meals eat from this one (recipe slots).
  leftovers: number
  // (total + leftovers) / recipe servings, for recipe slots; else null.
  factor: number | null
}

export interface PlanServingsInput {
  dates: readonly string[]
  members: readonly Member[]
  goals: Goals
  slots: readonly ServingSlotIn[]
  // date -> adults away that day.
  away: Record<string, readonly string[]>
  // recipe id -> its servings (null: unknown, assume 4).
  recipeServings: Record<string, number | null>
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

// Every date x meal of the plan, in order, empty meals included.
export function planServings(input: PlanServingsInput): MealServings[] {
  const { members, goals } = input
  const kind = new Map(members.map((m) => [m.name, m.kind]))
  const slotAt = new Map(input.slots.map((s) => [`${s.date}:${s.meal}`, s]))
  const out: MealServings[] = []
  let lastDinner: MealServings | null = null

  for (const date of input.dates) {
    const previousDinner = lastDinner
    for (const meal of MEALS) {
      const slot = slotAt.get(`${date}:${meal}`)
      const eaters = eatersFor(members, meal, input.away[date] ?? [])
      const fallback = defaultPortions(eaters, goals)
      const stored = slot?.portions ?? null
      const portions: Portions = Object.fromEntries(eaters.map((m) => [m.name, stored?.[m.name] ?? fallback[m.name]!]))
      const eating = Object.entries(portions).filter(([, n]) => n > 0)
      const total = eating.reduce((a, [, n]) => a + n, 0)
      const ms: MealServings = {
        date,
        meal,
        kind: slot?.kind ?? null,
        portions,
        custom: !!stored,
        adults: eating.filter(([p]) => kind.get(p) === 'adult').length,
        kids: eating.filter(([p]) => kind.get(p) === 'kid').length,
        total,
        sourceId: slot?.kind === 'recipe' ? slot.recipeId : slot?.kind === 'leftovers' ? (previousDinner?.sourceId ?? null) : null,
        leftovers: 0,
        factor: null,
      }
      if (slot?.kind === 'leftovers' && previousDinner) previousDinner.leftovers += total
      if (meal === 'dinner' && slot?.kind === 'recipe' && slot.recipeId) lastDinner = ms
      out.push(ms)
    }
  }
  for (const ms of out) {
    if (ms.kind !== 'recipe' || !ms.sourceId) continue
    const servings = input.recipeServings[ms.sourceId] || ASSUMED_SERVINGS
    ms.factor = round3((ms.total + ms.leftovers) / servings)
  }
  return out
}

// "Serves 3 (2 adults, 2 kids)"
export function servesText(s: Pick<MealServings, 'adults' | 'kids' | 'total'>): string {
  const who = [
    s.adults ? `${s.adults} adult${s.adults === 1 ? '' : 's'}` : null,
    s.kids ? `${s.kids} kid${s.kids === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return `Serves ${formatServings(s.total)}${who.length ? ` (${who.join(', ')})` : ''}`
}

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
