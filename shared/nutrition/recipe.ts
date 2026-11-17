// Recipe nutrition from estimated per-ingredient data. Pure: no I/O.
//
// Everything here is an estimate. Each line gets a score (how much to trust
// it) and the recipe's confidence is the average score of its lines.

export interface Nutrients {
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number
}

export type Confidence = 'high' | 'medium' | 'low'

// Units Claude gives typical grams for. Mass units are fixed math, volume
// units go through grams per cup, 'piece' is 'each'.
export const COUNT_UNITS = ['each', 'cup', 'slice', 'clove', 'can', 'jar', 'package', 'bunch', 'head', 'stick'] as const
export type CountUnit = (typeof COUNT_UNITS)[number]

export interface IngredientNutrition {
  per100g: Nutrients
  unitGrams: Partial<Record<CountUnit, number>>
  // What a line with no amount usually means, in grams.
  typicalGrams: number | null
  confidence: Confidence
}

export const ZERO: Nutrients = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
export const NUTRIENT_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber'] as const

export const addNutrients = (a: Nutrients, b: Nutrients, times = 1): Nutrients => ({
  kcal: a.kcal + b.kcal * times,
  protein: a.protein + b.protein * times,
  carbs: a.carbs + b.carbs * times,
  fat: a.fat + b.fat * times,
  fiber: a.fiber + b.fiber * times,
})

export const scaleNutrients = (a: Nutrients, by: number): Nutrients => addNutrients(ZERO, a, by)

export const roundNutrients = (a: Nutrients): Nutrients => ({
  kcal: Math.round(a.kcal),
  protein: Math.round(a.protein),
  carbs: Math.round(a.carbs),
  fat: Math.round(a.fat),
  fiber: Math.round(a.fiber),
})

const MASS_G: Record<string, number> = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 }
const VOLUME_ML: Record<string, number> = { ml: 1, l: 1000, tsp: 4.929, tbsp: 14.787, cup: 236.588, 'fl oz': 29.574 }
const PINCH_G = 0.36

// Grams for an amount of one ingredient. exact is false when it fell back
// to a guess (water density, "each" for a can, the typical portion). null
// when nothing applies.
export function gramsFor(
  quantity: number,
  unit: string | null,
  n: Pick<IngredientNutrition, 'unitGrams' | 'typicalGrams'>,
): { grams: number; exact: boolean } | null {
  const u = unit === 'piece' || unit === null ? 'each' : unit
  if (u in MASS_G) return { grams: quantity * MASS_G[u]!, exact: true }
  if (u === 'pinch') return { grams: quantity * PINCH_G, exact: true }
  if (u in VOLUME_ML) {
    const ml = quantity * VOLUME_ML[u]!
    const cup = n.unitGrams.cup
    return cup ? { grams: (ml * cup) / VOLUME_ML.cup!, exact: true } : { grams: ml, exact: false }
  }
  const per = n.unitGrams[u as CountUnit]
  if (per) return { grams: quantity * per, exact: true }
  if (u !== 'each' && n.unitGrams.each) return { grams: quantity * n.unitGrams.each, exact: false }
  if (n.typicalGrams) return { grams: quantity * n.typicalGrams, exact: false }
  return null
}

export interface RecipeLine {
  quantity: number | null
  unit: string | null
  optional: boolean
  // null when the line's ingredient has no nutrition yet (or is unmatched).
  nutrition: IngredientNutrition | null
}

export interface RecipeNutritionResult {
  perServing: Nutrients
  servings: number
  // true when the recipe has no servings and DEFAULT_SERVINGS was used.
  servingsAssumed: boolean
  confidence: Confidence
  // 0..1, the average line score.
  score: number
  // Lines counted (optional ones are left out) and lines with no data.
  lines: number
  missing: number
}

export const DEFAULT_SERVINGS = 4

const INGREDIENT_TRUST: Record<Confidence, number> = { high: 1, medium: 0.8, low: 0.55 }

export const confidenceOf = (score: number): Confidence => (score >= 0.8 ? 'high' : score >= 0.55 ? 'medium' : 'low')

// Per-serving totals. A line with an amount counts in full; one without uses
// the typical portion at half trust; one with no data counts zero.
export function recipeNutrition(lines: readonly RecipeLine[], servings: number | null): RecipeNutritionResult {
  let total = ZERO
  let scoreSum = 0
  let counted = 0
  let missing = 0
  for (const line of lines) {
    if (line.optional) continue
    counted++
    const n = line.nutrition
    if (!n) {
      missing++
      continue
    }
    const trust = INGREDIENT_TRUST[n.confidence]
    let grams: number | null = null
    let lineScore = 0
    if (line.quantity != null) {
      const g = gramsFor(line.quantity, line.unit, n)
      if (g) {
        grams = g.grams
        lineScore = g.exact ? 1 : 0.7
      }
    }
    if (grams === null && n.typicalGrams) {
      grams = n.typicalGrams
      lineScore = 0.5
    }
    if (grams === null) {
      missing++
      continue
    }
    total = addNutrients(total, n.per100g, grams / 100)
    scoreSum += lineScore * trust
  }
  const servingsAssumed = !servings || servings <= 0
  const s = servingsAssumed ? DEFAULT_SERVINGS : servings
  let score = counted ? scoreSum / counted : 0
  if (servingsAssumed) score *= 0.8
  return {
    perServing: scaleNutrients(total, 1 / s),
    servings: s,
    servingsAssumed,
    confidence: confidenceOf(score),
    score,
    lines: counted,
    missing,
  }
}
