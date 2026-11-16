import { z } from 'zod'

import { ROTATION_MAX } from './planning/breakfastLunch'
import { weekViewSchema } from './planningApi'
import { isoDateSchema } from './schema'

// The wire contract for the guided week (api/src/guidedDinners): breakfast and
// lunch rules and their settings. Dinners use the planning endpoints.

export const recipeRefSchema = z.object({ id: z.string(), title: z.string(), icon: z.string().nullable() })
export type RecipeRef = z.infer<typeof recipeRefSchema>

// GET /api/settings/breakfast-lunch. When nothing is saved, the lists are the
// defaults and the matching flag is true.
export const breakfastLunchSettingsSchema = z.object({
  breakfastRotation: z.array(recipeRefSchema),
  lunchStaples: z.array(recipeRefSchema),
  rotationIsDefault: z.boolean(),
  staplesIsDefault: z.boolean(),
})
export type BreakfastLunchSettings = z.infer<typeof breakfastLunchSettingsSchema>

// PUT /api/settings/breakfast-lunch. Ordered recipe ids; [] means "use the default".
export const breakfastLunchInputSchema = z.object({
  breakfastRotation: z.array(z.string().min(1)).max(ROTATION_MAX),
  lunchStaples: z.array(z.string().min(1)).max(ROTATION_MAX),
})
export type BreakfastLunchInput = z.infer<typeof breakfastLunchInputSchema>

// POST /api/weeks/:start/fill-breakfast-lunch, body {} or {refill: true}.
// Refill first clears the unlocked breakfasts and lunches that were auto-filled.
export const fillBreakfastLunchInputSchema = z.object({ refill: z.boolean().optional() })

export const fillBreakfastLunchResponseSchema = z.object({
  week: weekViewSchema,
  filled: z.number().int(),
  // Lunch date → the dinner title its leftovers come from (leftovers lunches only).
  leftoversFrom: z.record(isoDateSchema, z.string()),
  rotationIsDefault: z.boolean(),
})
export type FillBreakfastLunchResponse = z.infer<typeof fillBreakfastLunchResponseSchema>
