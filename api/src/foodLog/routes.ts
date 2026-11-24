import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z, type ZodTypeAny } from 'zod'

import {
  meInputSchema,
  parseInputSchema,
  saveInputSchema,
  updateInputSchema,
  type FoodItemFields,
  type FoodLogList,
  type FoodLogMe,
} from '../../../shared/foodLog'
import type { TuneResponse } from '../../../shared/foodLog/insights'
import { todayIn } from '../../../shared/planningApi'
import { isoDateSchema, type ErrorResponse } from '../../../shared/schema'
import { getHousehold } from '../planning/db'
import { requireSession, type AppEnv } from '../session'
import { deleteItem, getItem, insertItems, loadFoodLog, personFor, setPerson, updateItem } from './db'
import { tuneView } from './insights'
import { parseFood } from './parse'

// The personal food log, mounted under /api by index.ts. Contract in
// shared/foodLog.ts. Writes are PUT/DELETE, or POST with a JSON body (see
// the CSRF note in index.ts).

const bad = (c: Context, issues: unknown[]) => c.json<ErrorResponse>({ error: 'invalid', issues }, 400)
const notFound = (c: Context) => c.json<ErrorResponse>({ error: 'not found' }, 404)
const validJson = <T extends ZodTypeAny>(schema: T) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) return bad(c, r.error.issues)
  })
const validQuery = <T extends ZodTypeAny>(schema: T) =>
  zValidator('query', schema, (r, c) => {
    if (!r.success) return bad(c, r.error.issues)
  })

const MAX_RANGE_DAYS = 400

const food = new Hono<AppEnv>()
food.use('/food-log', requireSession)
food.use('/food-log/*', requireSession)

food.get('/food-log/me', async (c) => {
  const { people } = await getHousehold(c.env.DB)
  return c.json<FoodLogMe>({ person: await personFor(c.env.DB, c.var.session!.userId, people), people })
})

food.put('/food-log/me', validJson(meInputSchema), async (c) => {
  const { people } = await getHousehold(c.env.DB)
  const person = people.find((p) => p.toLowerCase() === c.req.valid('json').person.toLowerCase())
  if (!person) return bad(c, [{ path: ['person'], message: 'not in the household' }])
  await setPerson(c.env.DB, c.var.session!.userId, person)
  return c.json<FoodLogMe>({ person, people })
})

food.post('/food-log/parse', validJson(parseInputSchema), async (c) => {
  const { text, meal } = c.req.valid('json')
  return c.json(await parseFood(c.env, text, meal))
})

// Items that point at a recipe we no longer have lose the link.
async function checkedRecipes(db: D1Database, items: FoodItemFields[]): Promise<FoodItemFields[]> {
  const ids = [...new Set(items.flatMap((i) => (i.recipeId ? [i.recipeId] : [])))]
  if (!ids.length) return items
  const { results } = await db
    .prepare('SELECT id FROM recipes WHERE id IN (SELECT value FROM json_each(?1))')
    .bind(JSON.stringify(ids))
    .all<{ id: string }>()
  const known = new Set(results.map((r) => r.id))
  return items.map((i) =>
    i.recipeId && !known.has(i.recipeId) ? { ...i, recipeId: null, servings: null, source: i.source === 'recipe' ? 'manual' : i.source } : i,
  )
}

food.post('/food-log', validJson(saveInputSchema), async (c) => {
  const input = c.req.valid('json')
  if (input.date > todayIn()) return bad(c, [{ path: ['date'], message: 'that day has not happened yet' }])
  const { people } = await getHousehold(c.env.DB)
  const who = [...new Set(input.people.map((p) => people.find((h) => h.toLowerCase() === p.toLowerCase())))]
  if (who.some((p) => !p)) return bad(c, [{ path: ['people'], message: 'not in the household' }])
  const items = await checkedRecipes(c.env.DB, input.items)
  const ids = await insertItems(
    c.env.DB,
    who.flatMap((person) => items.map((fields) => ({ person: person!, date: input.date, fields }))),
    c.var.session!.userId,
  )
  const saved = await loadFoodLog(c.env.DB, input.date, input.date)
  return c.json<FoodLogList>({ items: saved.filter((i) => ids.includes(i.id)) })
})

const rangeSchema = z.object({ from: isoDateSchema, to: isoDateSchema })

food.get('/food-log', validQuery(rangeSchema), async (c) => {
  const { from, to } = c.req.valid('query')
  if (to < from || Date.parse(to) - Date.parse(from) > MAX_RANGE_DAYS * 86_400_000) return bad(c, [{ path: ['to'], message: 'bad range' }])
  return c.json<FoodLogList>({ items: await loadFoodLog(c.env.DB, from, to) })
})

food.put('/food-log/items/:id', validJson(updateInputSchema), async (c) => {
  const id = c.req.param('id')
  if (!(await getItem(c.env.DB, id))) return notFound(c)
  const [fields] = await checkedRecipes(c.env.DB, [c.req.valid('json')])
  await updateItem(c.env.DB, id, fields!)
  return c.json((await getItem(c.env.DB, id))!)
})

food.delete('/food-log/items/:id', async (c) => {
  if (!(await deleteItem(c.env.DB, c.req.param('id')))) return notFound(c)
  return c.json({ ok: true })
})

// The "Tune" list under What we're eating: adjustments backed by the log.
food.get('/food-log/tune', async (c) => c.json<TuneResponse>(await tuneView(c.env)))

export { food as foodLogRoutes }
