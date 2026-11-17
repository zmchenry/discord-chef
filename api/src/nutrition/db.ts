import type { GoalWire } from '../../../shared/nutrition'
import {
  recipeNutrition,
  type Confidence,
  type IngredientNutrition,
  type RecipeLine,
  type RecipeNutritionResult,
} from '../../../shared/nutrition/recipe'
import type { Goals, WeekSlotIn } from '../../../shared/nutrition/week'
import { addDays } from '../../../shared/planningApi'
import type { Meal, SlotKind } from '../../../shared/schema'
import { getSetting, setSetting } from '../planning/db'

// D1 access for nutrition. snake_case rows in, shared shapes out.

const parseJson = <T>(s: string | null, fallback: T): T => {
  if (s === null) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// --- Recipes -----------------------------------------------------------------

interface LineRow {
  recipe_id: string
  title: string
  servings: number | null
  ingredient_id: number | null
  quantity: number | null
  unit: string | null
  optional: number
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  fiber: number | null
  unit_grams: string | null
  typical_grams: number | null
  confidence: Confidence | null
}

export interface LoadedRecipe {
  title: string
  nutrition: RecipeNutritionResult
  // Linked ingredients with no nutrition yet.
  missingIds: number[]
}

// Every line of the given recipes joined to its ingredient's nutrition, then
// the per-serving math. Recipes with no ingredient lines are left out.
export async function loadRecipes(db: D1Database, recipeIds: readonly string[]): Promise<Map<string, LoadedRecipe>> {
  const out = new Map<string, LoadedRecipe>()
  if (!recipeIds.length) return out
  const { results } = await db
    .prepare(
      `SELECT r.id AS recipe_id, r.title, r.servings, ri.ingredient_id, ri.quantity, ri.unit, ri.optional,
              n.kcal, n.protein, n.carbs, n.fat, n.fiber, n.unit_grams, n.typical_grams, n.confidence
       FROM recipes r
       JOIN recipe_ingredients ri ON ri.recipe_id = r.id
       LEFT JOIN ingredient_nutrition n ON n.ingredient_id = ri.ingredient_id
       WHERE r.id IN (SELECT value FROM json_each(?1))
       ORDER BY r.id, ri.position`,
    )
    .bind(JSON.stringify([...new Set(recipeIds)]))
    .all<LineRow>()
  const byRecipe = new Map<string, LineRow[]>()
  for (const r of results) byRecipe.set(r.recipe_id, [...(byRecipe.get(r.recipe_id) ?? []), r])
  for (const [id, rows] of byRecipe) {
    const lines: RecipeLine[] = rows.map((r) => ({
      quantity: r.quantity,
      unit: r.unit,
      optional: r.optional === 1,
      nutrition: r.kcal === null ? null : toNutrition(r),
    }))
    out.set(id, {
      title: rows[0]!.title,
      nutrition: recipeNutrition(lines, rows[0]!.servings),
      missingIds: [...new Set(rows.filter((r) => r.kcal === null && r.ingredient_id !== null).map((r) => r.ingredient_id!))],
    })
  }
  return out
}

function toNutrition(r: LineRow): IngredientNutrition {
  return {
    per100g: { kcal: r.kcal!, protein: r.protein!, carbs: r.carbs!, fat: r.fat!, fiber: r.fiber! },
    unitGrams: parseJson(r.unit_grams, {}),
    typicalGrams: r.typical_grams,
    confidence: r.confidence ?? 'low',
  }
}

export async function recipeExists(db: D1Database, id: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 AS x FROM recipes WHERE id = ?1').bind(id).first())
}

// Linked ingredient ids for a refresh: one recipe, one week's recipes, or
// every active recipe.
export async function ingredientIdsFor(db: D1Database, scope: { recipeId?: string; weekId?: string }): Promise<number[]> {
  const where = scope.recipeId
    ? { sql: 'ri.recipe_id = ?1', arg: scope.recipeId }
    : scope.weekId
      ? { sql: `ri.recipe_id IN (SELECT recipe_id FROM plan_slots WHERE week_id = ?1 AND recipe_id IS NOT NULL)`, arg: scope.weekId }
      : { sql: `ri.recipe_id IN (SELECT id FROM recipes WHERE archived_at IS NULL) AND ?1 IS NOT NULL`, arg: '' }
  const { results } = await db
    .prepare(`SELECT DISTINCT ri.ingredient_id AS id FROM recipe_ingredients ri WHERE ri.ingredient_id IS NOT NULL AND ${where.sql}`)
    .bind(where.arg)
    .all<{ id: number }>()
  return results.map((r) => r.id)
}

// --- Goals ---------------------------------------------------------------------

const GOALS_KEY = 'goals'

export async function getGoals(db: D1Database): Promise<Goals> {
  return parseJson<Goals>(await getSetting(db, GOALS_KEY), {})
}

// One row per person, in household order; people with no goals get nulls.
export function goalRows(people: readonly string[], goals: Goals): GoalWire[] {
  return people.map((person) => ({
    person,
    kcal: goals[person]?.kcal ?? null,
    protein: goals[person]?.protein ?? null,
    carbs: goals[person]?.carbs ?? null,
    fat: goals[person]?.fat ?? null,
  }))
}

// Replaces the goals of the people listed. Goals for people not listed
// (someone removed from the household) are kept, harmlessly.
export async function saveGoals(db: D1Database, rows: readonly GoalWire[]): Promise<void> {
  const goals = await getGoals(db)
  for (const { person, ...g } of rows) goals[person] = g
  await setSetting(db, GOALS_KEY, JSON.stringify(goals))
}

// --- Slots and portions -----------------------------------------------------

interface SlotRow {
  id: number
  day: number
  meal: Meal
  kind: SlotKind
  recipe_id: string | null
  slot_key: string | null
  total: number | null
}

export const slotKey = (kind: SlotKind, recipeId: string | null) => (kind === 'recipe' ? recipeId! : kind)

// The week's slots with the servings set while planning, when they still
// match what the slot holds. plan_slot_portions keeps them in `total`.
export async function weekSlots(db: D1Database, weekId: string): Promise<Array<WeekSlotIn & { id: number }>> {
  const { results } = await db
    .prepare(
      `SELECT ps.id, ps.day, ps.meal, ps.kind, ps.recipe_id, p.slot_key, p.total
       FROM plan_slots ps LEFT JOIN plan_slot_portions p ON p.slot_id = ps.id
       WHERE ps.week_id = ?1`,
    )
    .bind(weekId)
    .all<SlotRow>()
  return results.map((r) => ({
    id: r.id,
    date: addDays(weekId, r.day),
    meal: r.meal,
    kind: r.kind,
    recipeId: r.recipe_id,
    servings: r.slot_key === slotKey(r.kind, r.recipe_id) && r.total ? r.total : null,
  }))
}

export async function setServings(
  db: D1Database,
  slot: { id: number; kind: SlotKind; recipeId: string | null },
  servings: number | null,
  userId: string,
): Promise<void> {
  if (servings === null) {
    await db.prepare('DELETE FROM plan_slot_portions WHERE slot_id = ?1').bind(slot.id).run()
    return
  }
  await db
    .prepare(
      `INSERT INTO plan_slot_portions (slot_id, slot_key, portions, total, updated_by, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (slot_id) DO UPDATE SET slot_key = excluded.slot_key, portions = excluded.portions,
         total = excluded.total, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .bind(slot.id, slotKey(slot.kind, slot.recipeId), '{}', servings, userId, Date.now())
    .run()
}
