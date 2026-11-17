import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z, type ZodTypeAny } from 'zod'

import {
  organizeRequestSchema,
  type OrganizeAllResponse,
  type OrganizePreviewResponse,
  type OrganizeProposal,
} from '../../../shared/recipePresentation'
import { parseSteps } from '../../../shared/recipeStructure'
import type { ErrorResponse } from '../../../shared/schema'
import { getRecipe } from '../db'
import { ClaudeError } from '../linkImport/claude'
import { requireSession, type AppEnv } from '../session'
import { waitUntilFor } from '../shopping/prices'
import {
  applyOrganization,
  countBacklog,
  estimateFlavors,
  FLAVOR_BATCH,
  nextRecipesToOrganize,
  organizeById,
  proposeOrganization,
  toProposal,
} from './organize'

// "Organize this recipe" (Tidy up with AI) and the backfill. Mounted at the
// app root (index.ts adds /api). Every write takes a JSON body, per the CSRF
// note in index.ts.

const routes = new Hono<AppEnv>()

const err = (c: Context, status: 404 | 422 | 502 | 503, error: string) => c.json<ErrorResponse>({ error }, status)
const validJson = <T extends ZodTypeAny>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) return c.json<ErrorResponse>({ error: 'invalid', issues: result.error.issues }, 400)
  })

const NO_KEY = 'AI is not set up here'
const NOTHING = 'This recipe has no ingredients or steps to tidy up.'
const NO_RESULT = "The AI couldn't tidy up this recipe."

// Starts one batch in the background: up to RECIPE_BATCH recipes with
// untitled steps and FLAVOR_BATCH ingredients with no flavors. Idempotent:
// call again until both remaining counts are 0.
routes.post('/recipes/organize-all', requireSession, validJson(z.object({})), async (c) => {
  const key = c.env.ANTHROPIC_API_KEY
  if (!key) return err(c, 503, NO_KEY)
  const db = c.env.DB
  const backlog = await countBacklog(db)
  const ids = await nextRecipesToOrganize(db)
  const later = waitUntilFor(c)
  later(Promise.all(ids.map((id) => organizeById(db, key, id))))
  if (backlog.ingredients) later(estimateFlavors(db, key))
  const body: OrganizeAllResponse = {
    recipes: ids.length,
    ingredients: Math.min(backlog.ingredients, FLAVOR_BATCH),
    remainingRecipes: backlog.recipes,
    remainingIngredients: backlog.ingredients,
  }
  return c.json(body, 202)
})

// Claude's proposal, not saved: for the confirm preview.
routes.post('/recipes/:id/organize/preview', requireSession, validJson(z.object({})), async (c) => {
  const r = await getRecipe(c.env.DB, c.req.param('id'))
  if (!r) return err(c, 404, 'not found')
  const key = c.env.ANTHROPIC_API_KEY
  if (!key) return err(c, 503, NO_KEY)
  if (!r.ingredients.length && !parseSteps(r.instructions).length) return err(c, 422, NOTHING)
  try {
    const proposal = await proposeOrganization(r, key)
    if (!proposal) return err(c, 422, NO_RESULT)
    const body: OrganizePreviewResponse = { proposal }
    return c.json(body)
  } catch (e) {
    if (e instanceof ClaudeError) return err(c, 502, e.message)
    throw e
  }
})

// Saves a proposal: the one sent (from the preview), or a fresh one from
// Claude. Also estimates flavors for this recipe's new ingredients.
routes.post('/recipes/:id/organize', requireSession, validJson(organizeRequestSchema), async (c) => {
  const db = c.env.DB
  const r = await getRecipe(db, c.req.param('id'))
  if (!r) return err(c, 404, 'not found')
  const key = c.env.ANTHROPIC_API_KEY
  const hadSteps = parseSteps(r.instructions).length > 0
  let proposal: OrganizeProposal | null
  const sent = c.req.valid('json').proposal
  if (sent) {
    // Re-checked against the recipe as it is now.
    proposal = toProposal(
      {
        groups: sent.groups
          ? [...new Set(sent.groups.filter((g): g is string => !!g))].map((name) => ({
              name,
              ingredients: sent.groups!.flatMap((g, n) => (g === name ? [n] : [])),
            }))
          : null,
        steps: sent.steps.map((s) => ({ title: s.title ?? '', paragraphs: s.text.split(/\n\s*\n/), ingredients: s.ingredientRefs })),
      },
      r.ingredients.length,
      hadSteps,
    )
  } else {
    if (!key) return err(c, 503, NO_KEY)
    if (!r.ingredients.length && !hadSteps) return err(c, 422, NOTHING)
    try {
      proposal = await proposeOrganization(r, key)
    } catch (e) {
      if (e instanceof ClaudeError) return err(c, 502, e.message)
      throw e
    }
  }
  if (!proposal) return err(c, 422, NO_RESULT)
  await applyOrganization(db, r, proposal)
  const ids = r.ingredients.flatMap((i) => (i.ingredientId !== null && !i.flavors.length ? [i.ingredientId] : []))
  if (key && ids.length) waitUntilFor(c)(estimateFlavors(db, key, ids))
  return c.json(await getRecipe(db, r.id))
})

export { routes as recipePresentationRoutes }
