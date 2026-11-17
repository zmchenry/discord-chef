import { z } from 'zod'

// The pantry: what is already in the house, per catalog ingredient.
// Items whose ingredient is in the pantry go into the shopping list's
// "Already have" group (shared/shopping/pantry.ts) instead of the list.

// Basics nobody buys every week. With no pantry row yet they are assumed on
// hand, as long as the ingredient is filed under Pantry (or has no section
// yet: ingredients first seen in a recipe have none). Canonical names, as
// normalizeIngredientName writes them.
export const PANTRY_BASICS: readonly string[] = [
  'salt',
  'kosher salt',
  'sea salt',
  'black pepper',
  'pepper',
  'olive oil',
  'extra virgin olive oil',
  'vegetable oil',
  'canola oil',
  'cooking spray',
  'garlic powder',
  'onion powder',
  'paprika',
  'smoked paprika',
  'chili powder',
  'ground cumin',
  'cumin',
  'dried oregano',
  'italian seasoning',
  'red pepper flakes',
  'crushed red pepper',
  'ground cinnamon',
  'cinnamon',
  'bay leaves',
  'sugar',
  'brown sugar',
  'all-purpose flour',
  'flour',
  'baking soda',
  'baking powder',
  'vanilla extract',
  'soy sauce',
  'water',
]

const BASICS = new Set(PANTRY_BASICS)

export function isPantryBasic(ingredient: { name: string; section: string | null }): boolean {
  return (ingredient.section === null || ingredient.section === 'Pantry') && BASICS.has(ingredient.name)
}

// A stored pantry row, or null when nobody has said anything yet.
export interface PantryState {
  onHand: boolean
  low: boolean
}

// On hand as the pantry screen shows it: the stored answer, else the default.
export function isOnHand(state: PantryState | null, ingredient: { name: string; section: string | null }): boolean {
  return state ? state.onHand : isPantryBasic(ingredient)
}

// Whether the shopping list can skip it: on hand and not running low.
export function haveEnough(state: PantryState | null, ingredient: { name: string; section: string | null }): boolean {
  return isOnHand(state, ingredient) && !state?.low
}

// GET /api/pantry: every catalog ingredient with its pantry state.
// `assumed` is true when no one has set it and the default applies.
export const pantryItemSchema = z.object({
  ingredientId: z.number().int(),
  name: z.string(),
  section: z.string().nullable(),
  onHand: z.boolean(),
  low: z.boolean(),
  assumed: z.boolean(),
  updatedAt: z.number().int().nullable(),
  updatedBy: z.string().nullable(),
})
export type PantryItem = z.infer<typeof pantryItemSchema>

export const pantryResponseSchema = z.object({ items: z.array(pantryItemSchema) })
export type PantryResponse = z.infer<typeof pantryResponseSchema>

// PUT /api/pantry/:ingredientId -> PantryItem. Out (onHand false) clears low.
export const pantryUpdateSchema = z.object({
  onHand: z.boolean(),
  low: z.boolean().default(false),
})
export type PantryUpdate = z.input<typeof pantryUpdateSchema>
