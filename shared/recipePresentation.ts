import { z } from 'zod'

import { FLAVORS } from './recipeStructure'
import {
  recipeIngredientInputSchema,
  recipeIngredientSchema,
  recipeInputSchema,
  recipeSchema,
} from './schema'

// The recipe contract with structure (recipe-presentation): the recipe body
// from shared/schema.ts, where `instructions` may hold step objects and each
// ingredient line carries its group and flavors. A client that only sends
// plain strings and no groups still validates.

// One element of recipes.instructions as stored and returned. Read it with
// parseSteps (shared/recipeStructure.ts).
export const storedStepSchema = z.union([
  z.string(),
  z.object({
    title: z.string().nullable(),
    text: z.string(),
    ingredientRefs: z.array(z.number().int().nonnegative()),
  }),
])
export type StoredStep = z.infer<typeof storedStepSchema>

export const structuredIngredientSchema = recipeIngredientSchema.extend({
  group: z.string().nullable(),
  flavors: z.array(z.enum(FLAVORS)),
})
export type StructuredIngredient = z.infer<typeof structuredIngredientSchema>

// GET /api/recipes/:id and the body of POST/PUT /api/recipes.
export const structuredRecipeSchema = recipeSchema.extend({
  instructions: z.array(storedStepSchema),
  ingredients: z.array(structuredIngredientSchema),
})
export type StructuredRecipe = z.infer<typeof structuredRecipeSchema>

// --- Writes ------------------------------------------------------------------

export const stepInputSchema = z.union([
  z.string().trim().min(1).max(2000),
  z.object({
    title: z.string().trim().max(120).nullable().default(null),
    text: z.string().trim().min(1).max(6000),
    ingredientRefs: z.array(z.number().int().min(0).max(99)).max(100).default([]),
  }),
])
export type StepInput = z.input<typeof stepInputSchema>

export const groupLabelSchema = z.string().trim().max(60).nullable().default(null)

// POST /api/recipes and PUT /api/recipes/:id.
export const structuredRecipeInputSchema = recipeInputSchema.extend({
  instructions: z.array(stepInputSchema).max(100).default([]),
  ingredients: z
    .array(recipeIngredientInputSchema.extend({ group: groupLabelSchema }))
    .max(100)
    .default([]),
})
export type StructuredRecipeInput = z.input<typeof structuredRecipeInputSchema>
export type StructuredRecipeInputParsed = z.output<typeof structuredRecipeInputSchema>

// --- Organize ("Tidy up with AI") --------------------------------------------

// What Claude proposes for a recipe: a group per ingredient line (null for
// all when the recipe has no natural components) and the titled steps.
export const organizeProposalSchema = z.object({
  groups: z.array(z.string().trim().max(60).nullable()).max(100).nullable(),
  steps: z
    .array(
      z.object({
        title: z.string().trim().max(120).nullable(),
        text: z.string().trim().min(1).max(6000),
        ingredientRefs: z.array(z.number().int().min(0).max(99)).max(100),
      }),
    )
    .min(1)
    .max(100),
})
export type OrganizeProposal = z.infer<typeof organizeProposalSchema>

// POST /api/recipes/:id/organize/preview -> { proposal }.
export const organizePreviewResponseSchema = z.object({ proposal: organizeProposalSchema })
export type OrganizePreviewResponse = z.infer<typeof organizePreviewResponseSchema>

// POST /api/recipes/:id/organize -> StructuredRecipe. With a proposal (from
// the preview) it is applied as is; without one Claude is asked first.
export const organizeRequestSchema = z.object({ proposal: organizeProposalSchema.optional() })
export type OrganizeRequest = z.infer<typeof organizeRequestSchema>

// POST /api/recipes/organize-all -> 202. Starts one batch in the background
// and says how much is left before it; call again until both are 0.
export const organizeAllResponseSchema = z.object({
  recipes: z.number().int(),
  ingredients: z.number().int(),
  remainingRecipes: z.number().int(),
  remainingIngredients: z.number().int(),
})
export type OrganizeAllResponse = z.infer<typeof organizeAllResponseSchema>
