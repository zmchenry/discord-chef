import { z } from 'zod'

import {
  ingredientSchema,
  isoDateSchema,
  shoppingItemSchema,
  shoppingListSchema,
  shoppingSortSchema,
  storeSchema,
} from './schema'

// The shopping API contract (phase 4). Pure helpers live in shared/shopping/.

// An item as the app shows it. `amount` is the display text ("2 lb",
// "1 cup + 2 tbsp"), null when no recipe gave a quantity. `storeId` is the
// ingredient's store pin: null when it can be bought at any store.
export const shoppingItemViewSchema = shoppingItemSchema.extend({
  amount: z.string().nullable(),
  storeId: z.number().int().nullable(),
  // The ingredient is in the pantry (on hand, not low). Unchecked, the
  // item goes in the "Already have" group (shared/shopping/pantry.ts).
  onHand: z.boolean().optional(),
})
export type ShoppingItemView = z.infer<typeof shoppingItemViewSchema>

export const storeTotalSchema = z.object({
  storeId: z.number().int(),
  cents: z.number().int().nonnegative(),
  priced: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
})
export type StoreTotalView = z.infer<typeof storeTotalSchema>

export const learnedRanksSchema = z.object({
  sections: z.record(z.string(), z.number()),
  ingredients: z.record(z.string(), z.number()),
})

export const shoppingListViewSchema = shoppingListSchema.extend({
  items: z.array(shoppingItemViewSchema),
  sort: shoppingSortSchema,
  // One per store, in the order of `stores` in the week response. Only
  // unpinned items count: pinned ones cost the same wherever the trip goes.
  totals: z.array(storeTotalSchema),
  // The pinned items, each priced at its own store: one per pinned store.
  pinnedTotals: z.array(storeTotalSchema),
  // The cheapest store when at least 70% of unpinned items have a price there.
  recommendation: z.object({ storeId: z.number().int(), cents: z.number().int() }).nullable(),
  // Walking order learned at this list's store, for the Smart sort.
  learned: learnedRanksSchema,
})
export type ShoppingListView = z.infer<typeof shoppingListViewSchema>

// GET /api/weeks/:start/shopping, and the body of every list-level write.
// `lists` is empty before the first generate; one list (trip null) or two
// (weekend then midweek) after.
export const shoppingWeekResponseSchema = z.object({
  weekId: isoDateSchema,
  twoTrips: z.boolean(),
  lists: z.array(shoppingListViewSchema),
  // Titles of the recipes named in items' recipeIds.
  recipes: z.record(z.string(), z.string()),
  stores: z.array(storeSchema),
})
export type ShoppingWeekResponse = z.infer<typeof shoppingWeekResponseSchema>

// POST /api/weeks/:start/shopping/generate. twoTrips absent keeps the
// current split.
export const generateShoppingInputSchema = z.object({
  twoTrips: z.boolean().optional(),
})
export type GenerateShoppingInput = z.infer<typeof generateShoppingInputSchema>

// PATCH /api/shopping/items/:id -> ShoppingItemView. `quantity` is free
// text ("2 lb") and replaces the generated amount.
export const shoppingItemPatchSchema = z.object({
  checked: z.boolean().optional(),
  manualRank: z.number().finite().nullable().optional(),
  quantity: z.string().trim().max(60).nullable().optional(),
  name: z.string().trim().min(1).max(100).optional(),
})
export type ShoppingItemPatch = z.infer<typeof shoppingItemPatchSchema>

// POST /api/shopping/lists/:id/items -> 201 ShoppingWeekResponse. A name
// may carry an amount ("2 lb chicken"); it is parsed and normalised.
export const addShoppingItemSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    ingredientId: z.number().int().optional(),
  })
  .refine((b) => (b.name === undefined) !== (b.ingredientId === undefined), {
    message: 'send exactly one of name or ingredientId',
  })
export type AddShoppingItem = z.infer<typeof addShoppingItemSchema>

// PUT /api/shopping/lists/:id -> ShoppingWeekResponse.
export const shoppingListUpdateSchema = z.object({
  storeId: z.number().int().optional(),
  sort: shoppingSortSchema.optional(),
})
export type ShoppingListUpdate = z.infer<typeof shoppingListUpdateSchema>

// GET and PUT /api/stores/:id/sections. PUT takes the walking order; names
// are normalised to the fixed section list and any section left out is
// appended in its default place.
export const storeSectionsSchema = z.object({
  sections: z.array(z.string().trim().min(1).max(40)).max(40),
})
export type StoreSections = z.infer<typeof storeSectionsSchema>

// PUT /api/ingredients/:id/prices. cents null removes that store's price.
export const ingredientPricesInputSchema = z.object({
  prices: z
    .array(
      z.object({
        storeId: z.number().int(),
        cents: z.number().int().min(0).max(1_000_000).nullable(),
        unit: z.string().trim().max(30).nullable().default(null),
      }),
    )
    .max(20),
})
export type IngredientPricesInput = z.input<typeof ingredientPricesInputSchema>

export const ingredientPriceSchema = z.object({
  ingredientId: z.number().int(),
  storeId: z.number().int(),
  cents: z.number().int(),
  unit: z.string().nullable(),
  source: z.enum(['estimate', 'manual']),
  updatedAt: z.number().int(),
})
export type IngredientPrice = z.infer<typeof ingredientPriceSchema>

export const ingredientPricesResponseSchema = z.object({ prices: z.array(ingredientPriceSchema) })

// A catalog entry with its store pin (null = any store).
export const pinnedIngredientSchema = ingredientSchema.extend({ storeId: z.number().int().nullable() })
export type PinnedIngredient = z.infer<typeof pinnedIngredientSchema>

// PUT /api/ingredients/:id/store -> PinnedIngredient. storeId null unpins.
export const ingredientStoreInputSchema = z.object({ storeId: z.number().int().nullable() })
export type IngredientStoreInput = z.infer<typeof ingredientStoreInputSchema>

// GET /api/store-pins: every pinned ingredient, for badges outside the
// shopping list (the recipe page).
export const storePinsResponseSchema = z.object({
  pins: z.array(z.object({ ingredientId: z.number().int(), storeId: z.number().int() })),
})
export type StorePinsResponse = z.infer<typeof storePinsResponseSchema>

// GET /api/staples: every staple, for the add-item autocomplete.
export const stapleListResponseSchema = z.object({ staples: z.array(pinnedIngredientSchema) })
export type StapleListResponse = z.infer<typeof stapleListResponseSchema>
