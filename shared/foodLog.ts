import { z } from 'zod'

import type { Nutrients } from './nutrition/recipe'
import { isoDateSchema } from './schema'

// The wire contract for the food log (api/src/foodLog): what one person
// actually ate, item by item. The counting rules live with the nutrition
// math (shared/nutrition/counted.ts): logging breakfast, lunch or dinner
// replaces that planned meal for that person; snacks always add.

export const FOOD_MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export const foodMealSchema = z.enum(FOOD_MEALS)
export type FoodMeal = z.infer<typeof foodMealSchema>

export const FOOD_MEAL_LABEL: Record<FoodMeal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
}

// The meal a log defaults to by the local time it is made, in minutes after
// midnight: before 10:30 breakfast, to 14:30 lunch, to 17:00 a snack, then dinner.
export function defaultMealAt(minutes: number): FoodMeal {
  if (minutes < 10 * 60 + 30) return 'breakfast'
  if (minutes < 14 * 60 + 30) return 'lunch'
  if (minutes < 17 * 60) return 'snack'
  return 'dinner'
}

// Same values as shared/nutrition.ts confidenceSchema (which imports this file).
const confidenceSchema = z.enum(['high', 'medium', 'low'])

export const foodSourceSchema = z.enum(['estimate', 'manual', 'recipe'])
export type FoodSource = z.infer<typeof foodSourceSchema>

const amount = (max: number) => z.number().min(0).max(max).nullable()

// The editable part of an item: what the confirm list shows and saves.
export const foodItemFieldsSchema = z.object({
  meal: foodMealSchema,
  label: z.string().trim().min(1).max(200),
  quantity: z.string().trim().max(60).nullable().default(null),
  kcal: amount(10_000),
  protein: amount(1_000),
  carbs: amount(2_000),
  fat: amount(1_000),
  fiber: amount(300).default(null),
  source: foodSourceSchema,
  recipeId: z.string().max(100).nullable().default(null),
  servings: z.number().min(0.1).max(20).nullable().default(null),
  confidence: confidenceSchema.nullable().default(null),
  brand: z.string().trim().max(80).nullable().default(null),
})
export type FoodItemFields = z.infer<typeof foodItemFieldsSchema>
export type FoodItemInput = z.input<typeof foodItemFieldsSchema>

export const foodLogItemSchema = foodItemFieldsSchema.extend({
  id: z.string(),
  person: z.string(),
  date: isoDateSchema,
  recipeTitle: z.string().nullable().default(null),
  createdBy: z.string().nullable(),
  createdAt: z.number(),
})
export type FoodLogItem = z.infer<typeof foodLogItemSchema>

// POST /api/food-log/parse: free text (one item per line, or a sentence)
// into items with estimates. Nothing is saved. source 'none': no key or
// Claude failed, so each line comes back as a label with no numbers.
export const parseInputSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  meal: foodMealSchema,
})
export type ParseInput = z.infer<typeof parseInputSchema>
export const parsedItemSchema = foodItemFieldsSchema.extend({ recipeTitle: z.string().nullable().default(null) })
export type ParsedItem = z.infer<typeof parsedItemSchema>
export const parseResponseSchema = z.object({
  items: z.array(parsedItemSchema),
  source: z.enum(['claude', 'none']),
  message: z.string().nullable().default(null),
})
export type ParseResponse = z.infer<typeof parseResponseSchema>

// POST /api/food-log: save items for one or more people (one row each).
export const saveInputSchema = z.object({
  date: isoDateSchema,
  people: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
  items: z.array(foodItemFieldsSchema).min(1).max(40),
})
export type SaveInput = z.input<typeof saveInputSchema>

// PUT /api/food-log/items/:id: change one item (all fields).
export const updateInputSchema = foodItemFieldsSchema
// GET /api/food-log?from=&to=
export const foodLogListSchema = z.object({ items: z.array(foodLogItemSchema) })
export type FoodLogList = z.infer<typeof foodLogListSchema>

// GET/PUT /api/food-log/me: which household person the signed-in user is.
// null until known (the user's display name, or an email that starts with
// a person's name, else they pick once).
export const meSchema = z.object({ person: z.string().nullable(), people: z.array(z.string()) })
export type FoodLogMe = z.infer<typeof meSchema>
export const meInputSchema = z.object({ person: z.string().trim().min(1).max(40) })

// The numbers of an item, or null when unknown. Missing macros next to
// known calories count as zero.
export function itemNutrients(i: Pick<FoodItemFields, 'kcal' | 'protein' | 'carbs' | 'fat' | 'fiber'>): Nutrients | null {
  if (i.kcal == null) return null
  return { kcal: i.kcal, protein: i.protein ?? 0, carbs: i.carbs ?? 0, fat: i.fat ?? 0, fiber: i.fiber ?? 0 }
}
