import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { ZodTypeAny } from 'zod'

import {
  ingredientSearchQuerySchema,
  recipeInputSchema,
  recipeListQuerySchema,
  type ErrorResponse,
  type HealthResponse,
  type IngredientListResponse,
  type RecipeListResponse,
  type StoreListResponse,
} from '../../shared/schema'
import { normalizeRecipeInput } from '../../shared/recipeInput'
import {
  archiveRecipe,
  createRecipe,
  ensureUser,
  getMe,
  getRecipe,
  listRecipes,
  listStores,
  searchIngredients,
  updateRecipe,
} from './db'
import { runNotificationCron } from './notifications/cron'
import { notificationRoutes } from './notifications/routes'
import {
  localSessionProvider,
  makeAccessSessionProvider,
  makeCachingJwksFetcher,
  parseAllowedEmails,
  requireSession,
  sessionMiddleware,
  type AppEnv,
} from './session'

// CSRF posture: session.ts reads Cf-Access-Jwt-Assertion OR the ambient
// CF_Authorization cookie, and a cookie that rides along on every request to
// this hostname is exactly the shape of thing CSRF exploits: a page on
// another origin can make the browser send it without the user's intent.
// This is closed with no CORS middleware at all. Every state-changing route
// here either requires a JSON body (POST /recipes, PUT /recipes/:id: Hono's
// zValidator('json') regex-gates the content-type, so a cross-origin form or
// no-CORS POST sent as text/plain fails validation with 400 before reaching
// db.ts) or is a non-"simple" method (PUT, DELETE), which the fetch spec
// forces through a CORS preflight. With no cors() middleware, nothing answers
// that preflight, so the browser never sends the real request. Do NOT add
// `cors()` (or any Access-Control-Allow-Origin) to this app without
// re-deriving this: it would open a write-CSRF hole against every route
// below, not just widen a read. New write routes must keep to the same rule:
// JSON body via validJson(), or PUT/PATCH/DELETE.
//
// Routes carry the /api prefix rather than the platform stripping it, so a
// request looks identical in `wrangler dev` and in production.
const app = new Hono<AppEnv>().basePath('/api')

// zValidator with this app's 400 body instead of the library default.
const invalid = (c: Context, issues: unknown[]) => {
  const body: ErrorResponse = { error: 'invalid', issues }
  return c.json(body, 400)
}
const validJson = <T extends ZodTypeAny>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) return invalid(c, result.error.issues)
  })
const validQuery = <T extends ZodTypeAny>(schema: T) =>
  zValidator('query', schema, (result, c) => {
    if (!result.success) return invalid(c, result.error.issues)
  })

const notFound = (c: Context) => {
  const body: ErrorResponse = { error: 'not found' }
  return c.json(body, 404)
}

const conflict = (c: Context, existingId: string) => {
  const body: ErrorResponse = { error: 'conflict', existingId }
  return c.json(body, 409)
}

// The naming rules (shared/normalize.ts) run on every recipe write. A title
// that normalises to nothing ("...") is a 400.
const normalizedRecipe = (c: Context<AppEnv>, body: Parameters<typeof normalizeRecipeInput>[0]) => {
  const input = normalizeRecipeInput(body)
  return input.title ? input : invalid(c, [{ path: ['title'], message: 'title is empty after normalisation' }])
}

app.get('/health', (c) => {
  const body: HealthResponse = { status: 'ok', now: new Date().toISOString() }
  return c.json(body)
})

// Applied after /health so that endpoint stays reachable with no session at
// all. Every other route gets a session (possibly null) attached;
// requireSession is what actually rejects the unauthenticated case.
app.use('*', async (c, next) =>
  sessionMiddleware(
    c.env.ENVIRONMENT === 'development'
      ? localSessionProvider
      : makeAccessSessionProvider({
          teamDomain: c.env.TEAM_DOMAIN,
          policyAud: c.env.POLICY_AUD,
          allowedEmails: parseAllowedEmails(c.env.ALLOWED_EMAILS),
          fetchJwks: makeCachingJwksFetcher(c.env.TEAM_DOMAIN),
        }),
  )(c, next),
)

// Upsert the users row on the first authenticated request, so created_by and
// updated_by foreign keys always have a target. Remembered per isolate (and
// per D1 binding, so each test's fresh database starts empty) to avoid a
// write on every request.
const knownUsers = new WeakMap<D1Database, Set<string>>()
app.use('*', async (c, next) => {
  const session = c.var.session
  if (session) {
    let seen = knownUsers.get(c.env.DB)
    if (!seen) knownUsers.set(c.env.DB, (seen = new Set()))
    if (!seen.has(session.userId)) {
      await ensureUser(c.env.DB, session.userId)
      seen.add(session.userId)
    }
  }
  await next()
})

app.get('/me', requireSession, async (c) => c.json(await getMe(c.env.DB, c.var.session!.userId)))

// --- Recipes ---------------------------------------------------------------

app.get('/recipes', requireSession, validQuery(recipeListQuerySchema), async (c) => {
  const body: RecipeListResponse = { recipes: await listRecipes(c.env.DB, c.req.valid('query')) }
  return c.json(body)
})

app.get('/recipes/:id', requireSession, async (c) => {
  const recipe = await getRecipe(c.env.DB, c.req.param('id'))
  return recipe ? c.json(recipe) : notFound(c)
})

// 409 { error: 'conflict', existingId } when another active recipe already
// has the (normalised) title.
app.post('/recipes', requireSession, validJson(recipeInputSchema), async (c) => {
  const input = normalizedRecipe(c, c.req.valid('json'))
  if (input instanceof Response) return input
  const result = await createRecipe(c.env.DB, c.var.session!.userId, input)
  return 'conflict' in result ? conflict(c, result.conflict) : c.json(result, 201)
})

app.put('/recipes/:id', requireSession, validJson(recipeInputSchema), async (c) => {
  const input = normalizedRecipe(c, c.req.valid('json'))
  if (input instanceof Response) return input
  const result = await updateRecipe(c.env.DB, c.req.param('id'), input)
  if (!result) return notFound(c)
  return 'conflict' in result ? conflict(c, result.conflict) : c.json(result)
})

// Soft archive: the row stays (old plans reference it) and drops out of the
// list. 204 whether or not it was already archived.
app.delete('/recipes/:id', requireSession, async (c) => {
  const found = await archiveRecipe(c.env.DB, c.req.param('id'))
  return found ? c.body(null, 204) : notFound(c)
})

app.route('/', notificationRoutes)

// --- Catalog ---------------------------------------------------------------

app.get('/ingredients', requireSession, validQuery(ingredientSearchQuerySchema), async (c) => {
  const { q, limit } = c.req.valid('query')
  const body: IngredientListResponse = { ingredients: await searchIngredients(c.env.DB, q, limit) }
  return c.json(body)
})

app.get('/stores', requireSession, async (c) => {
  const body: StoreListResponse = { stores: await listStores(c.env.DB) }
  return c.json(body)
})

// Anything under /api that matched no route. Without this the static-asset
// fallback would answer with index.html and a 200, which looks like a working
// endpoint returning garbage.
app.notFound((c) => {
  const body: ErrorResponse = { error: `no route for ${c.req.method} ${c.req.path}` }
  return c.json(body, 404)
})

app.onError((err, c) => {
  console.error(err)
  const body: ErrorResponse = { error: 'internal error' }
  return c.json(body, 500)
})

export { app }

export default {
  fetch: app.fetch,

  // Cron Triggers (wrangler.jsonc `triggers.crons`, every 15 minutes): the
  // plan-the-week and daily "what's cooking" notifications.
  async scheduled(controller, env, _ctx) {
    await runNotificationCron(env, controller.scheduledTime)
  },
} satisfies ExportedHandler<Env>
