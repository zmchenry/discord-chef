import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z, type ZodTypeAny } from 'zod'

import {
  cookedInputSchema,
  historyQuerySchema,
  historyStats,
  mealLogInputSchema,
  recipeSummary,
  type HistoryResponse,
  type MealLog,
} from '../../../shared/mealHistory'
import { addDays } from '../../../shared/planningApi'
import type { ErrorResponse, Meal } from '../../../shared/schema'
import { requireSession, type AppEnv } from '../session'
import { getLog, historyNow, loadHistory, loadSlots, metaFor, plannedSlot, saveLog, toWire } from './db'
import { weekInsights } from './insights'

// Meal history, mounted under /api by index.ts. Contract in
// shared/mealHistory.ts. Writes are PUT, or POST with a JSON body (see the
// CSRF note in index.ts).

const bad = (c: Context, issues: unknown[]) => c.json<ErrorResponse>({ error: 'invalid', issues }, 400)
const validJson = <T extends ZodTypeAny>(schema: T) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) return bad(c, r.error.issues)
  })
const validQuery = <T extends ZodTypeAny>(schema: T) =>
  zValidator('query', schema, (r, c) => {
    if (!r.success) return bad(c, r.error.issues)
  })

// Per-recipe lines look back this far.
const RECIPE_LOOKBACK_DAYS = 730

const history = new Hono<AppEnv>()
history.use('/history', requireSession)
history.use('/history/*', requireSession)

history.get('/history', validQuery(historyQuerySchema), async (c) => {
  const { weeks, meal, recipeId } = c.req.valid('query')
  const now = historyNow()
  const from = addDays(now.date, -(weeks * 7 - 1))
  const entries = await loadHistory(c.env.DB, from, now.date, now)
  const meta = await metaFor(c.env.DB, entries)
  const shown = entries.filter((e) => (!meal || e.meal === meal) && (!recipeId || e.recipeId === recipeId || e.plannedRecipeId === recipeId))
  return c.json<HistoryResponse>({
    from,
    to: now.date,
    entries: shown.map((e) => toWire(e, meta)),
    stats: historyStats(entries, meta, now.date),
  })
})

history.get('/history/pending', async (c) => {
  const now = historyNow()
  const entries = await loadHistory(c.env.DB, addDays(now.date, -1), now.date, now)
  const meta = await metaFor(c.env.DB, entries)
  return c.json({ entries: entries.map((e) => toWire(e, meta)) })
})

history.put('/history/log', validJson(mealLogInputSchema), async (c) => {
  const input = c.req.valid('json')
  const now = historyNow()
  if (input.date > now.date) return bad(c, [{ path: ['date'], message: 'that meal has not happened yet' }])
  const [existing, slot] = await Promise.all([getLog(c.env.DB, input.date, input.meal), plannedSlot(c.env.DB, input.date, input.meal)])
  const pick = <K extends 'recipeId' | 'freeText' | 'rating' | 'note'>(k: K): MealLog[K] =>
    input[k] !== undefined ? (input[k] as MealLog[K]) : (existing?.[k] ?? null)
  const swapped = input.status === 'swapped'
  if (swapped && input.recipeId) {
    const found = await c.env.DB.prepare('SELECT 1 FROM recipes WHERE id = ?1').bind(input.recipeId).first()
    if (!found) return bad(c, [{ path: ['recipeId'], message: 'no such recipe' }])
  }
  const log: MealLog = {
    date: input.date,
    meal: input.meal,
    status: input.status,
    recipeId: swapped ? pick('recipeId') : input.status === 'eaten' ? (slot?.kind === 'recipe' ? slot.recipeId : null) : null,
    freeText: swapped ? pick('freeText') : null,
    // A rating is about food that was eaten.
    rating: input.status === 'eaten' || swapped ? pick('rating') : null,
    note: pick('note'),
    loggedBy: c.var.session!.userId,
  }
  if (swapped && !log.recipeId && !log.freeText) return bad(c, [{ path: ['freeText'], message: 'say what you ate instead' }])
  await saveLog(c.env.DB, log)
  const [entry] = await loadHistory(c.env.DB, input.date, input.date, now).then((es) => es.filter((e) => e.meal === input.meal))
  return c.json(toWire(entry!, await metaFor(c.env.DB, [entry!])))
})

// Cooking mode's Done: the meal on today's plan with this recipe is eaten.
history.post('/history/cooked', validJson(cookedInputSchema), async (c) => {
  const { recipeId } = c.req.valid('json')
  const now = historyNow()
  const order: Meal[] = ['dinner', 'lunch', 'breakfast']
  const slots = (await loadSlots(c.env.DB, now.date, now.date)).filter((s) => s.kind === 'recipe' && s.recipeId === recipeId)
  const slot = slots.sort((a, b) => order.indexOf(a.meal) - order.indexOf(b.meal))[0]
  if (!slot) return c.json({ meal: null })
  const existing = await getLog(c.env.DB, now.date, slot.meal)
  await saveLog(c.env.DB, {
    date: now.date,
    meal: slot.meal,
    status: 'eaten',
    recipeId,
    freeText: null,
    rating: existing?.status === 'eaten' ? existing.rating : null,
    note: existing?.note ?? null,
    loggedBy: c.var.session!.userId,
  })
  return c.json({ meal: slot.meal })
})

history.get('/history/recipes/:id', async (c) => {
  const now = historyNow()
  const entries = await loadHistory(c.env.DB, addDays(now.date, -RECIPE_LOOKBACK_DAYS), now.date, now)
  return c.json(recipeSummary(entries, c.req.param('id')))
})

history.get('/history/insights', async (c) => c.json(await weekInsights(c.env, false)))

history.post('/history/insights/refresh', validJson(z.object({}).strict()), async (c) =>
  c.json(await weekInsights(c.env, true)),
)

export { history as mealHistoryRoutes }
