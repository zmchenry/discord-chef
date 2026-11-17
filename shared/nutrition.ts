import { z } from 'zod'

import { isoDateSchema, mealSchema, slotKindSchema } from './schema'

// The wire contract for the nutrition endpoints (api/src/nutrition). The
// math lives in shared/nutrition/. Every number is an estimate.

export const confidenceSchema = z.enum(['high', 'medium', 'low'])

export const nutrientsSchema = z.object({
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  fiber: z.number(),
})

// GET /api/nutrition/recipes/:id
export const recipeNutritionSchema = z.object({
  recipeId: z.string(),
  perServing: nutrientsSchema,
  servings: z.number(),
  servingsAssumed: z.boolean(),
  confidence: confidenceSchema,
  lines: z.number().int(),
  missing: z.number().int(),
  // An estimate for missing ingredients is running; ask again shortly.
  filling: z.boolean(),
})
export type RecipeNutritionWire = z.infer<typeof recipeNutritionSchema>

// GET/PUT /api/settings/goals: one row per household person, daily targets.
const goalNumber = (max: number) => z.number().int().min(0).max(max).nullable()
export const goalSchema = z.object({
  person: z.string().trim().min(1).max(40),
  kcal: goalNumber(10_000),
  protein: goalNumber(1_000),
  carbs: goalNumber(2_000),
  fat: goalNumber(1_000),
})
export type GoalWire = z.infer<typeof goalSchema>
export const goalsSettingsSchema = z.object({ goals: z.array(goalSchema).max(10) })
export type GoalsSettings = z.infer<typeof goalsSettingsSchema>

const portionsSchema = z.record(z.string(), z.number())

export const mealNutritionSchema = z.object({
  meal: mealSchema,
  kind: slotKindSchema.nullable(),
  status: z.enum(['known', 'gap', 'empty']),
  recipeId: z.string().nullable(),
  title: z.string().nullable(),
  portions: portionsSchema,
  custom: z.boolean(),
  perServing: nutrientsSchema.nullable(),
  confidence: confidenceSchema.nullable(),
  // How many it makes: "Serves 2½". leftovers is what later leftover meals
  // eat from it; factor scales the recipe (recipe meals). sourceId is the
  // recipe eaten, known nutrition or not.
  serves: z.object({
    sourceId: z.string().nullable(),
    servings: z.number(),
    leftovers: z.number(),
    factor: z.number().nullable(),
  }),
})
export type MealNutritionWire = z.infer<typeof mealNutritionSchema>

export const dayNutritionSchema = z.object({
  date: isoDateSchema,
  meals: z.array(mealNutritionSchema),
  people: z.record(
    z.string(),
    z.object({ home: z.boolean(), totals: nutrientsSchema, known: z.number().int(), gaps: z.number().int() }),
  ),
})
export type DayNutritionWire = z.infer<typeof dayNutritionSchema>

// GET /api/nutrition/weeks/:start
export const weekNutritionSchema = z.object({
  weekId: isoDateSchema,
  people: z.array(z.string()),
  goals: z.array(goalSchema),
  days: z.array(dayNutritionSchema),
  week: z.record(
    z.string(),
    z.object({
      totals: nutrientsSchema,
      perDay: nutrientsSchema,
      daysHome: z.number().int(),
      known: z.number().int(),
      gaps: z.number().int(),
      confidence: confidenceSchema.nullable(),
    }),
  ),
  filling: z.boolean(),
})
export type WeekNutritionWire = z.infer<typeof weekNutritionSchema>

// PUT /api/nutrition/weeks/:start/servings/:date/:meal: how many servings
// a planned meal makes, in halves. null goes back to the default (2).
export const servingsInputSchema = z.object({
  servings: z.number().min(0.5).max(12).nullable(),
})
export type ServingsInput = z.infer<typeof servingsInputSchema>

// POST /api/nutrition/refresh: estimate nutrition for ingredients that have
// none. weekId or recipeId narrows it; neither means every active recipe.
export const nutritionRefreshInputSchema = z.object({
  weekId: isoDateSchema.optional(),
  recipeId: z.string().optional(),
})
export const nutritionRefreshResponseSchema = z.object({
  estimated: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
})
export type NutritionRefreshResponse = z.infer<typeof nutritionRefreshResponseSchema>
