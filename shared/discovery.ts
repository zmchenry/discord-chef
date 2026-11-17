import { z } from 'zod'

import { reasonSchema } from './planningApi'

// The wire contract for recipe discovery (api/src/discovery): ideas for new
// recipes, found on the web by Claude, waiting in the Ideas inbox.

export const ideaStatusSchema = z.enum(['new', 'saved', 'dismissed'])
export type IdeaStatus = z.infer<typeof ideaStatusSchema>

export const ideaSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  site: z.string().nullable(),
  why: z.array(reasonSchema),
  minutes: z.number().int().nullable(),
  ingredients: z.array(z.string()),
  // The group it is shown under: a day theme label, or "Like <recipe>".
  theme: z.string().nullable(),
  status: ideaStatusSchema,
  createdAt: z.number(),
})
export type Idea = z.infer<typeof ideaSchema>

// POST /api/ideas/generate. theme is a day theme's label (its tags are
// looked up) or free text. With neither theme nor likeRecipeId it looks for
// dinners like the household's favourites.
export const generateIdeasInputSchema = z.object({
  theme: z.string().trim().min(1).max(80).optional(),
  likeRecipeId: z.string().min(1).max(100).optional(),
  count: z.number().int().min(3).max(8).optional(),
})
export type GenerateIdeasInput = z.infer<typeof generateIdeasInputSchema>

export const generateIdeasResponseSchema = z.object({
  ideas: z.array(ideaSchema),
  // True when the same search ran in the last 24 hours and these are its ideas.
  cached: z.boolean(),
})
export type GenerateIdeasResponse = z.infer<typeof generateIdeasResponseSchema>

// GET /api/ideas: new and saved ideas, newest first.
export const ideaListResponseSchema = z.object({ ideas: z.array(ideaSchema) })
export type IdeaListResponse = z.infer<typeof ideaListResponseSchema>

// PATCH /api/ideas/:id
export const ideaStatusInputSchema = z.object({ status: ideaStatusSchema })
