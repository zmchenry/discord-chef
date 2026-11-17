import { z } from 'zod'

// The API contract: every request and response body on /api.
//
// web/ and api/ both import this file directly off disk. There is no build
// step, no OpenAPI document and no generated client between them: renaming a
// field here fails `tsc` in the Worker and in the React app on the same run.
//
// Conventions
//   * camelCase on the wire. The Worker maps from snake_case D1 columns.
//   * Timestamps are integer milliseconds since the epoch.
//   * Optional scalar fields are `null` in responses, never absent.
//   * Request schemas accept absent optional fields and default them, so
//     `RecipeInput` (z.input) is what a client builds and `RecipeInputParsed`
//     (z.output) is what the Worker receives after validation.
//   * Enum values match the CHECK constraints in migrations/0001_init.sql.

// ---------------------------------------------------------------------------
// Primitives and enums

export const timestampSchema = z.number().int().nonnegative()

// The ISO date (YYYY-MM-DD) of a week's first day. Week ids and plan days are
// both relative to it: plan slot `day` 0 is this date.
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

export const recipeIdSchema = z.string().uuid()

export const mealSchema = z.enum(['breakfast', 'lunch', 'dinner'])
export type Meal = z.infer<typeof mealSchema>
export const MEALS = mealSchema.options

export const slotKindSchema = z.enum(['recipe', 'leftovers', 'eat_out', 'skip'])
export type SlotKind = z.infer<typeof slotKindSchema>

export const slotSourceSchema = z.enum(['manual', 'auto', 'suggested'])
export type SlotSource = z.infer<typeof slotSourceSchema>

export const weekStatusSchema = z.enum(['draft', 'planned'])
export type WeekStatus = z.infer<typeof weekStatusSchema>

export const tripSchema = z.enum(['midweek', 'weekend'])
export type Trip = z.infer<typeof tripSchema>

export const shoppingListStatusSchema = z.enum(['open', 'done'])
export type ShoppingListStatus = z.infer<typeof shoppingListStatusSchema>

export const shoppingItemSourceSchema = z.enum(['generated', 'manual', 'staple'])
export type ShoppingItemSource = z.infer<typeof shoppingItemSourceSchema>

export const notificationKindSchema = z.enum(['plan_week', 'daily_cooking', 'list_ready'])
export type NotificationKind = z.infer<typeof notificationKindSchema>

// Any string is accepted; the Worker applies normalizeTag (shared/normalize.ts:
// lowercase, hyphens, [a-z0-9-] only) and dedupes before storing.
export const tagSchema = z.string().trim().min(1).max(40)

// ---------------------------------------------------------------------------
// Generic responses

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  now: z.string().datetime(),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>

// The body of every non-2xx /api response. `issues` is present on 400s from
// request validation (zod issues, passed through as-is). `existingId` is
// present on a 409 'conflict': the recipe that already has that title.
export const errorResponseSchema = z.object({
  error: z.string(),
  issues: z.array(z.unknown()).optional(),
  existingId: z.string().optional(),
})
export type ErrorResponse = z.infer<typeof errorResponseSchema>

// GET /api/me. The user id is the Access-verified email.
export const meSchema = z.object({
  email: z.string().email(),
  displayName: z.string().nullable(),
})
export type Me = z.infer<typeof meSchema>

// ---------------------------------------------------------------------------
// Ingredients

// A catalog entry. `name` is canonical (lowercase, single spaces). `section`
// is a store section name, e.g. "Produce", or null while unclassified.
export const ingredientSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  section: z.string().nullable(),
  perishable: z.boolean(),
  isStaple: z.boolean(),
  aliases: z.array(z.string()),
})
export type Ingredient = z.infer<typeof ingredientSchema>

// GET /api/ingredients?q=  (autocomplete: prefix matches first, then
// substring matches; at most `limit`, default 20, max 50).
export const ingredientSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})
export const ingredientListResponseSchema = z.object({
  ingredients: z.array(ingredientSchema),
})
export type IngredientListResponse = z.infer<typeof ingredientListResponseSchema>

// One line of a recipe's ingredient list, as stored.
export const recipeIngredientSchema = z.object({
  id: z.number().int(),
  position: z.number().int().nonnegative(),
  rawText: z.string(),
  ingredientId: z.number().int().nullable(),
  // The canonical catalog name, joined in for display. Null when unmatched.
  ingredientName: z.string().nullable(),
  quantity: z.number().positive().nullable(),
  unit: z.string().nullable(),
  note: z.string().nullable(),
  optional: z.boolean(),
})
export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>

// One line of a recipe's ingredient list, as sent. Order in the array is the
// position. `name` is the ingredient to match in the catalog; when absent the
// Worker uses `rawText` itself. Either way it is normalised, then matched by
// name or alias, and created in the catalog if new.
export const recipeIngredientInputSchema = z.object({
  rawText: z.string().trim().min(1).max(300),
  name: z.string().trim().min(1).max(100).optional(),
  quantity: z.number().positive().nullable().default(null),
  unit: z.string().trim().max(30).nullable().default(null),
  note: z.string().trim().max(200).nullable().default(null),
  optional: z.boolean().default(false),
})
export type RecipeIngredientInput = z.input<typeof recipeIngredientInputSchema>

// ---------------------------------------------------------------------------
// Recipes

const optionalText = (max: number) => z.string().trim().max(max).nullable().default(null)
const optionalUrl = z.string().trim().url().max(2000).nullable().default(null)
// A web address, or a photo the Worker stores itself (POST /api/recipes/:id/photo,
// served from /api/photos/..., see shared/dishPhotos.ts).
const optionalImageUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((s) => /^\/api\/photos\/[\w/-]+\.(jpg|png|webp)$/.test(s) || z.string().url().safeParse(s).success, 'Invalid url')
  .nullable()
  .default(null)
const optionalMinutes = z.number().int().min(0).max(24 * 60).nullable().default(null)

// POST /api/recipes and PUT /api/recipes/:id. PUT is a full replace: the
// ingredient list and tags are replaced, not merged.
export const recipeInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  sourceUrl: optionalUrl,
  imageUrl: optionalImageUrl,
  icon: z.string().trim().max(16).nullable().default(null),
  servings: z.number().int().min(1).max(100).nullable().default(null),
  prepMinutes: optionalMinutes,
  cookMinutes: optionalMinutes,
  instructions: z.array(z.string().trim().min(1).max(2000)).max(100).default([]),
  notes: optionalText(5000),
  tags: z.array(tagSchema).max(30).default([]),
  ingredients: z.array(recipeIngredientInputSchema).max(100).default([]),
  // Set only by the Notion import, so re-running it updates rather than
  // duplicates.
  notionPageId: z.string().trim().max(64).nullable().default(null),
})
export type RecipeInput = z.input<typeof recipeInputSchema>
export type RecipeInputParsed = z.output<typeof recipeInputSchema>

// GET /api/recipes/:id, and the 200/201 body of POST and PUT.
export const recipeSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  icon: z.string().nullable(),
  servings: z.number().int().nullable(),
  prepMinutes: z.number().int().nullable(),
  cookMinutes: z.number().int().nullable(),
  instructions: z.array(z.string()),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  ingredients: z.array(recipeIngredientSchema),
  createdBy: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  // Non-null once DELETEd. Archived recipes stay readable by id (old plans
  // link to them) but drop out of the list.
  archivedAt: timestampSchema.nullable(),
  notionPageId: z.string().nullable(),
})
export type Recipe = z.infer<typeof recipeSchema>

// A row in GET /api/recipes.
export const recipeSummarySchema = recipeSchema
  .pick({
    id: true,
    title: true,
    description: true,
    icon: true,
    imageUrl: true,
    servings: true,
    prepMinutes: true,
    cookMinutes: true,
    tags: true,
    updatedAt: true,
  })
  .extend({ ingredientCount: z.number().int().nonnegative() })
export type RecipeSummary = z.infer<typeof recipeSummarySchema>

// GET /api/recipes?q=&tag=. `q` matches title and description
// (case-insensitive substring). `tag` is an exact tag. Archived recipes are
// excluded. Sorted by title.
export const recipeListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  tag: tagSchema.optional(),
})
export type RecipeListQuery = z.infer<typeof recipeListQuerySchema>

export const recipeListResponseSchema = z.object({
  recipes: z.array(recipeSummarySchema),
})
export type RecipeListResponse = z.infer<typeof recipeListResponseSchema>

// ---------------------------------------------------------------------------
// Week plan (phase 3)

// The minimal recipe reference embedded in a slot so the week view needs no
// second fetch.
export const recipeRefSchema = recipeSchema.pick({ id: true, title: true, icon: true, imageUrl: true })
export type RecipeRef = z.infer<typeof recipeRefSchema>

export const planSlotSchema = z.object({
  id: z.number().int(),
  weekId: isoDateSchema,
  day: z.number().int().min(0).max(6),
  meal: mealSchema,
  kind: slotKindSchema,
  // Non-null exactly when kind === 'recipe'.
  recipeId: z.string().nullable(),
  recipe: recipeRefSchema.nullable(),
  servings: z.number().int().positive().nullable(),
  source: slotSourceSchema,
  locked: z.boolean(),
  updatedBy: z.string().nullable(),
  updatedAt: timestampSchema,
})
export type PlanSlot = z.infer<typeof planSlotSchema>

// Setting one slot. A slot that is not set has no row and is "empty".
export const planSlotInputSchema = z
  .object({
    day: z.number().int().min(0).max(6),
    meal: mealSchema,
    kind: slotKindSchema,
    recipeId: z.string().nullable().default(null),
    servings: z.number().int().min(1).max(100).nullable().default(null),
    source: slotSourceSchema.default('manual'),
    locked: z.boolean().default(false),
  })
  .refine((s) => (s.kind === 'recipe') === (s.recipeId !== null), {
    message: 'recipeId is required when kind is "recipe" and must be null otherwise',
    path: ['recipeId'],
  })
export type PlanSlotInput = z.input<typeof planSlotInputSchema>

export const weekSchema = z.object({
  id: isoDateSchema,
  status: weekStatusSchema,
  notes: z.string().nullable(),
  // Only filled slots; at most one per (day, meal).
  slots: z.array(planSlotSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})
export type Week = z.infer<typeof weekSchema>

// ---------------------------------------------------------------------------
// Stores

export const storeSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  // Section names in walking order.
  sectionOrder: z.array(z.string()),
  isDefault: z.boolean(),
})
export type Store = z.infer<typeof storeSchema>

// GET /api/stores (default store first, then by name).
export const storeListResponseSchema = z.object({
  stores: z.array(storeSchema),
})
export type StoreListResponse = z.infer<typeof storeListResponseSchema>

// ---------------------------------------------------------------------------
// Shopping (phase 4)

export const shoppingItemSchema = z.object({
  id: z.number().int(),
  listId: z.number().int(),
  ingredientId: z.number().int().nullable(),
  name: z.string(),
  quantity: z.number().positive().nullable(),
  unit: z.string().nullable(),
  section: z.string().nullable(),
  // The recipes in the week that need this item.
  recipeIds: z.array(z.string()),
  source: shoppingItemSourceSchema,
  manualRank: z.number().nullable(),
  checkedAt: timestampSchema.nullable(),
  checkedBy: z.string().nullable(),
})
export type ShoppingItem = z.infer<typeof shoppingItemSchema>

export const shoppingListSchema = z.object({
  id: z.number().int(),
  weekId: isoDateSchema,
  trip: tripSchema.nullable(),
  storeId: z.number().int(),
  status: shoppingListStatusSchema,
  generatedAt: timestampSchema.nullable(),
  items: z.array(shoppingItemSchema),
})
export type ShoppingList = z.infer<typeof shoppingListSchema>

export const shoppingSortSchema = z.enum(['aisle', 'alpha', 'manual', 'smart'])
export type ShoppingSort = z.infer<typeof shoppingSortSchema>
