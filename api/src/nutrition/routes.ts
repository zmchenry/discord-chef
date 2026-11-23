import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { ZodTypeAny } from 'zod'

import {
  goalsSettingsSchema,
  nutritionRefreshInputSchema,
  servingsInputSchema,
  TREND_WEEKS,
  type GoalsSettings,
  type NutritionRefreshResponse,
  type NutritionTrendsWire,
  type RecipeNutritionWire,
  type WeekNutritionWire,
} from '../../../shared/nutrition'
import { roundNutrients } from '../../../shared/nutrition/recipe'
import { clampServings } from '../../../shared/household/servings'
import { awayPeople, weekNutrition } from '../../../shared/nutrition/week'
import { averageDays } from '../../../shared/nutrition/goals'
import { addDays, sundayOf, todayIn, weekDates, weekIdSchema } from '../../../shared/planningApi'
import { mealSchema, type ErrorResponse } from '../../../shared/schema'
import { weekConstraints } from '../planning/calendar'
import { getHousehold } from '../planning/db'
import { requireSession, type AppEnv } from '../session'
import { waitUntilFor } from '../shopping/prices'
import { getGoals, goalRows, ingredientIdsFor, loadRecipes, recipeExists, saveGoals, setServings, weekSlots } from './db'
import { estimatedPositions } from './amounts'
import { fillNutrition, missingNutrition, wouldAsk } from './estimate'

// Nutrition estimates, goals and planned servings. Mounted under /api by index.ts.
// Writes are PUT, or POST with a JSON content-type (see the CSRF note in
// index.ts).

const nutrition = new Hono<AppEnv>()
nutrition.use('/nutrition/*', requireSession)
nutrition.use('/settings/goals', requireSession)

const bad = (c: Context, issues: unknown[]) => c.json({ error: 'invalid', issues } satisfies ErrorResponse, 400)
const notFound = (c: Context) => c.json({ error: 'not found' } satisfies ErrorResponse, 404)
const validJson = <T extends ZodTypeAny>(schema: T) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) return bad(c, r.error.issues)
  })
const jsonOnly = async (c: Context, next: () => Promise<void>) => {
  if (!(c.req.header('content-type') ?? '').includes('application/json')) {
    return c.json({ error: 'expected application/json' } satisfies ErrorResponse, 415)
  }
  await next()
}

type Defer = (p: Promise<unknown>) => void

// --- Recipes -----------------------------------------------------------------

// Missing ingredient estimates are filled after the response; `filling`
// tells the page to ask again shortly.
nutrition.get('/nutrition/recipes/:id', async (c) => {
  const id = c.req.param('id')
  if (!(await recipeExists(c.env.DB, id))) return notFound(c)
  const [loaded, estimatedAmounts] = await Promise.all([loadRecipes(c.env.DB, [id]), estimatedPositions(c.env.DB, id)])
  const r = loaded.get(id)
  const filling = !!r && r.missingIds.length > 0 && wouldAsk(c.env, r.missingIds)
  if (filling) waitUntilFor(c)(fillNutrition(c.env, r.missingIds))
  const n = r?.nutrition
  return c.json<RecipeNutritionWire>({
    recipeId: id,
    perServing: roundNutrients(n?.perServing ?? { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }),
    servings: n?.servings ?? 0,
    servingsAssumed: n?.servingsAssumed ?? false,
    confidence: n?.confidence ?? 'low',
    lines: n?.lines ?? 0,
    missing: n?.missing ?? 0,
    filling,
    estimatedAmounts,
  })
})

// --- Weeks -----------------------------------------------------------------

// Nutrition for whole weeks: household, goals and the calendar once, then
// each week's plan through the shared math.
async function weeksNutrition(env: Env, weekIds: readonly string[], defer: Defer) {
  const db = env.DB
  const allDates = weekIds.flatMap(weekDates)
  const [household, goals, slotsByWeek] = await Promise.all([
    getHousehold(db),
    getGoals(db),
    Promise.all(weekIds.map((w) => weekSlots(db, w))),
  ])
  const people = household.people
  const calendar = await weekConstraints(db, allDates, household)
  const loaded = await loadRecipes(db, slotsByWeek.flat().flatMap((s) => (s.recipeId ? [s.recipeId] : [])))
  const missing = [...new Set([...loaded.values()].flatMap((r) => r.missingIds))]
  const filling = missing.length > 0 && wouldAsk(env, missing)
  if (filling) defer(fillNutrition(env, missing))

  // A recipe with no usable line is unknown, not zero.
  const recipes = Object.fromEntries([...loaded].filter(([, r]) => r.nutrition.missing < r.nutrition.lines))
  const recipeServings = Object.fromEntries([...loaded].map(([id, r]) => [id, r.nutrition.servings]))
  const results = weekIds.map((weekId, i) => {
    const dates = weekDates(weekId)
    return weekNutrition({
      dates,
      people,
      goals,
      slots: slotsByWeek[i]!,
      recipes,
      away: Object.fromEntries(dates.map((d) => [d, awayPeople(calendar.byDay[d] ?? [], people)])),
      recipeServings,
    })
  })
  return { people, goals: goalRows(people, goals), results, filling }
}

export async function weekNutritionView(env: Env, weekId: string, defer: Defer): Promise<WeekNutritionWire> {
  const { people, goals, results, filling } = await weeksNutrition(env, [weekId], defer)
  return { weekId, people, goals, days: results[0]!.days, week: results[0]!.people, filling }
}

// The last `weeks` weeks ending with `end`, each person's average per day.
// Days after today don't count yet.
export async function trendsView(env: Env, end: string, weeks: number, defer: Defer): Promise<NutritionTrendsWire> {
  const through = todayIn()
  const weekIds = Array.from({ length: weeks }, (_, i) => addDays(end, (i - weeks + 1) * 7))
  const { people, goals, results } = await weeksNutrition(env, weekIds, defer)
  return {
    people,
    goals,
    through,
    weeks: weekIds.map((weekId, i) => ({
      weekId,
      people: Object.fromEntries(
        people.map((p) => [p, averageDays(results[i]!.days.filter((d) => d.date <= through).map((d) => d.people[p]!))]),
      ),
    })),
  }
}

function weekParam(c: Context): string | null {
  const parsed = weekIdSchema.safeParse(c.req.param('start'))
  return parsed.success ? parsed.data : null
}

nutrition.get('/nutrition/trends', async (c) => {
  const end = weekIdSchema.safeParse(c.req.query('end') ?? sundayOf(todayIn()))
  const weeks = Math.min(26, Math.max(1, Number(c.req.query('weeks') ?? TREND_WEEKS) || TREND_WEEKS))
  if (!end.success) return notFound(c)
  return c.json(await trendsView(c.env, end.data, weeks, waitUntilFor(c)))
})

nutrition.get('/nutrition/weeks/:start', async (c) => {
  const weekId = weekParam(c)
  if (!weekId) return notFound(c)
  return c.json(await weekNutritionView(c.env, weekId, waitUntilFor(c)))
})

// How many servings one planned meal makes, in halves; {servings: null}
// goes back to the default (2).
nutrition.put('/nutrition/weeks/:start/servings/:date/:meal', validJson(servingsInputSchema), async (c) => {
  const weekId = weekParam(c)
  const meal = mealSchema.safeParse(c.req.param('meal'))
  const date = c.req.param('date')
  if (!weekId || !meal.success || !weekDates(weekId).includes(date)) return notFound(c)
  const slot = (await weekSlots(c.env.DB, weekId)).find((s) => s.date === date && s.meal === meal.data)
  if (!slot) return notFound(c)
  const servings = c.req.valid('json').servings
  await setServings(c.env.DB, slot, servings === null ? null : clampServings(servings), c.var.session!.userId)
  return c.json(await weekNutritionView(c.env, weekId, waitUntilFor(c)))
})

// --- Refresh -------------------------------------------------------------------

// Waits for the estimates. `missing` is what still has none afterwards.
nutrition.post('/nutrition/refresh', jsonOnly, validJson(nutritionRefreshInputSchema), async (c) => {
  const scope = c.req.valid('json')
  const ids = await ingredientIdsFor(c.env.DB, scope)
  const estimated = await fillNutrition(c.env, ids, { force: true })
  const missing = (await missingNutrition(c.env.DB, ids)).length
  return c.json<NutritionRefreshResponse>({ estimated, missing })
})

// --- Goals ---------------------------------------------------------------------

nutrition.get('/settings/goals', async (c) => {
  const [{ people }, goals] = await Promise.all([getHousehold(c.env.DB), getGoals(c.env.DB)])
  return c.json<GoalsSettings>({ goals: goalRows(people, goals) })
})

nutrition.put('/settings/goals', validJson(goalsSettingsSchema), async (c) => {
  const { people } = await getHousehold(c.env.DB)
  await saveGoals(
    c.env.DB,
    c.req.valid('json').goals.filter((g) => people.includes(g.person)),
  )
  return c.json<GoalsSettings>({ goals: goalRows(people, await getGoals(c.env.DB)) })
})

// --- Background fill ---------------------------------------------------------

// Mounted in index.ts before the recipe and week routes: once a recipe is
// saved or a week is finished, estimate any ingredients still missing after
// the response. Never changes the response.
export const nutritionAfterWrites: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  if (!c.env.ANTHROPIC_API_KEY || c.res.status >= 300) return
  const { method, path } = c.req
  let scope: { recipeId?: string; weekId?: string } | null = null
  if (method === 'POST' && path === '/api/recipes') {
    const body = (await c.res.clone().json().catch(() => null)) as { id?: string } | null
    if (body?.id) scope = { recipeId: body.id }
  } else if (method === 'PUT' && /^\/api\/recipes\/[^/]+$/.test(path)) {
    scope = { recipeId: decodeURIComponent(path.split('/').pop()!) }
  } else if (method === 'POST' && /^\/api\/weeks\/[^/]+\/finish$/.test(path)) {
    scope = { weekId: path.split('/')[3] }
  }
  if (!scope) return
  const env = c.env
  const s = scope
  waitUntilFor(c)(ingredientIdsFor(env.DB, s).then((ids) => fillNutrition(env, ids)).catch(() => 0))
}

export { nutrition as nutritionRoutes }
