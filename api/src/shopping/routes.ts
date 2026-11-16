import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { ZodTypeAny } from 'zod'

import type { ErrorResponse } from '../../../shared/schema'
import {
  addShoppingItemSchema,
  generateShoppingInputSchema,
  ingredientPricesInputSchema,
  ingredientStoreInputSchema,
  shoppingItemPatchSchema,
  shoppingListUpdateSchema,
  storeSectionsSchema,
} from '../../../shared/shopping'
import { requireSession, type AppEnv } from '../session'
import { buildListForWeek } from './build'
import {
  addItem,
  deleteItem,
  getList,
  getSections,
  getShoppingWeek,
  listStaples,
  listStorePins,
  patchItem,
  putSections,
  setIngredientStore,
  updateList,
} from './db'
import { estimateWeekPrices, setManualPrices, waitUntilFor } from './prices'

// Shopping routes, mounted at the app root (index.ts adds the /api prefix).
// Every write takes a JSON body or is PUT/PATCH/DELETE, per the CSRF note
// in index.ts.

const shopping = new Hono<AppEnv>()

const invalid = (c: Context, issues: unknown[]) => c.json<ErrorResponse>({ error: 'invalid', issues }, 400)
const notFound = (c: Context) => c.json<ErrorResponse>({ error: 'not found' }, 404)
const validJson = <T extends ZodTypeAny>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) return invalid(c, result.error.issues)
  })

const WEEK = /^\d{4}-\d{2}-\d{2}$/
const validWeek = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`)
  return WEEK.test(s) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
const intParam = (s: string) => (/^\d+$/.test(s) ? Number(s) : null)

shopping.post('/weeks/:start/shopping/generate', requireSession, validJson(generateShoppingInputSchema), async (c) => {
  const weekId = c.req.param('start')
  if (!validWeek(weekId)) return invalid(c, [{ path: ['start'], message: 'expected YYYY-MM-DD' }])
  await buildListForWeek(c.env, weekId, { ...c.req.valid('json'), waitUntil: waitUntilFor(c) })
  return c.json(await getShoppingWeek(c.env.DB, weekId))
})

shopping.get('/weeks/:start/shopping', requireSession, async (c) => {
  const weekId = c.req.param('start')
  if (!validWeek(weekId)) return invalid(c, [{ path: ['start'], message: 'expected YYYY-MM-DD' }])
  return c.json(await getShoppingWeek(c.env.DB, weekId))
})

shopping.patch('/shopping/items/:id', requireSession, validJson(shoppingItemPatchSchema), async (c) => {
  const id = intParam(c.req.param('id'))
  const item = id == null ? null : await patchItem(c.env.DB, id, c.req.valid('json'), c.var.session!.userId)
  return item ? c.json(item) : notFound(c)
})

shopping.delete('/shopping/items/:id', requireSession, async (c) => {
  const id = intParam(c.req.param('id'))
  const weekId = id == null ? null : await deleteItem(c.env.DB, id)
  return weekId ? c.json(await getShoppingWeek(c.env.DB, weekId)) : notFound(c)
})

shopping.post('/shopping/lists/:id/items', requireSession, validJson(addShoppingItemSchema), async (c) => {
  const id = intParam(c.req.param('id'))
  const list = id == null ? null : await getList(c.env.DB, id)
  if (!list) return notFound(c)
  const added = await addItem(c.env.DB, list.id, c.req.valid('json'))
  if (!added) return invalid(c, [{ path: ['ingredientId'], message: 'unknown ingredient' }])
  waitUntilFor(c)(estimateWeekPrices(c.env, list.week_id))
  return c.json(await getShoppingWeek(c.env.DB, list.week_id), 201)
})

shopping.put('/shopping/lists/:id', requireSession, validJson(shoppingListUpdateSchema), async (c) => {
  const id = intParam(c.req.param('id'))
  const list = id == null ? null : await getList(c.env.DB, id)
  if (!list) return notFound(c)
  const result = await updateList(c.env.DB, list.id, c.req.valid('json'))
  if (result === 'no-store') return invalid(c, [{ path: ['storeId'], message: 'unknown store' }])
  return c.json(await getShoppingWeek(c.env.DB, list.week_id))
})

shopping.get('/stores/:id/sections', requireSession, async (c) => {
  const id = intParam(c.req.param('id'))
  const sections = id == null ? null : await getSections(c.env.DB, id)
  return sections ? c.json({ sections }) : notFound(c)
})

shopping.put('/stores/:id/sections', requireSession, validJson(storeSectionsSchema), async (c) => {
  const id = intParam(c.req.param('id'))
  const result = id == null ? null : await putSections(c.env.DB, id, c.req.valid('json').sections)
  if (!result) return notFound(c)
  if ('unknown' in result) return invalid(c, [{ path: ['sections'], message: `unknown sections: ${result.unknown.join(', ')}` }])
  return c.json(result)
})

shopping.get('/staples', requireSession, async (c) => c.json({ staples: await listStaples(c.env.DB) }))

shopping.put('/ingredients/:id/prices', requireSession, validJson(ingredientPricesInputSchema), async (c) => {
  const id = intParam(c.req.param('id'))
  const prices = id == null ? null : await setManualPrices(c.env.DB, id, c.req.valid('json').prices)
  return prices ? c.json({ prices }) : notFound(c)
})

// Store pins: always buy this ingredient at one store (null = any store).
shopping.put('/ingredients/:id/store', requireSession, validJson(ingredientStoreInputSchema), async (c) => {
  const id = intParam(c.req.param('id'))
  const result = id == null ? null : await setIngredientStore(c.env.DB, id, c.req.valid('json').storeId)
  if (result === 'no-store') return invalid(c, [{ path: ['storeId'], message: 'unknown store' }])
  return result ? c.json(result) : notFound(c)
})

shopping.get('/store-pins', requireSession, async (c) => c.json({ pins: await listStorePins(c.env.DB) }))

export { shopping as shoppingRoutes }
