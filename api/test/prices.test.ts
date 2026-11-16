import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { WeekView } from '../../shared/planningApi'
import type { PriceRefreshResponse } from '../../shared/prices'
import type { Recipe } from '../../shared/schema'
import type { ShoppingWeekResponse } from '../../shared/shopping'
import { estimatePrices } from '../src/shopping/prices'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

// Claude is mocked: fetch answers every Messages call with a price for
// each ingredient id in the prompt at each store, 100 + 10 * store index
// cents per package (Walmart cheapest).

let testDb: TestDb
let env: Env
let keyed: Env

beforeEach(async () => {
  testDb = await createTestDb()
  env = devEnv(testDb.db)
  keyed = { ...env, ANTHROPIC_API_KEY: 'test-key' } as Env
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await testDb.dispose()
})

const WEEK = '2026-11-22'
const STORES = ['Walmart', 'Publix', 'Aldi']

function mockClaude(status = 200) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    if (status !== 200) return new Response('overloaded', { status })
    const body = JSON.parse(init.body as string)
    const ids = [...(body.messages[0].content as string).matchAll(/^(\d+): /gm)].map((m) => Number(m[1]))
    const prices = ids.flatMap((id) => STORES.map((store, i) => ({ ingredient_id: id, store, cents: 100 + 10 * i, unit: '1 lb' })))
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ prices }) }] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function json<T>(e: Env, req: Request, status = 200): Promise<T> {
  const res = await call(e, req)
  expect(res.status, await res.clone().text()).toBe(status)
  return (await res.json()) as T
}

async function ingredientIds(): Promise<Record<string, number>> {
  const { results } = await testDb.db.prepare('SELECT id, name FROM ingredients').all<{ id: number; name: string }>()
  return Object.fromEntries(results.map((r) => [r.name, r.id]))
}

const priceRows = () =>
  testDb.db
    .prepare('SELECT ingredient_id, store_id, cents, source FROM ingredient_prices ORDER BY ingredient_id, store_id')
    .all<{ ingredient_id: number; store_id: number; cents: number; source: string }>()
    .then((r) => r.results)

it('inserts estimates, leaves manual prices alone, and is a no-op with no key or a failed call', async () => {
  await json(env, devRequest('POST', '/api/recipes', { title: 'Tacos', ingredients: [{ rawText: '1 lb ground beef' }, { rawText: 'tortillas' }] }), 201)
  const ids = await ingredientIds()
  const walmart = (await testDb.db.prepare(`SELECT id FROM stores WHERE name = 'Walmart'`).first<number>('id'))!
  await json(env, devRequest('PUT', `/api/ingredients/${ids['ground beef']}/prices`, { prices: [{ storeId: walmart, cents: 499, unit: '1 lb' }] }))

  // No key: nothing is asked or written.
  const noKey = mockClaude()
  expect(await estimatePrices(env, Object.values(ids))).toEqual([])
  expect(noKey).not.toHaveBeenCalled()

  // The API fails: nothing written, no throw.
  mockClaude(529)
  expect(await estimatePrices(keyed, Object.values(ids))).toEqual([])
  expect(await priceRows()).toHaveLength(1)

  const fetchMock = mockClaude()
  const written = await estimatePrices(keyed, Object.values(ids))
  expect(written).toHaveLength(5) // 2 ingredients x 3 stores, minus the manual one
  expect(written.every((p) => p.source === 'estimate')).toBe(true)
  const rows = await priceRows()
  expect(rows).toHaveLength(6)
  expect(rows.find((r) => r.ingredient_id === ids['ground beef'] && r.store_id === walmart)).toMatchObject({ cents: 499, source: 'manual' })

  // One structured-output request at low effort, no forced tool.
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const req = JSON.parse(fetchMock.mock.calls[0][1].body as string)
  expect(req.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } })
  expect(req.tool_choice).toBeUndefined()

  // Everything priced now: no second request.
  expect(await estimatePrices(keyed, Object.values(ids))).toEqual([])
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('refreshes a week’s prices, which feed the store totals and the planner cost', async () => {
  const tacos = await json<Recipe>(
    env,
    devRequest('POST', '/api/recipes', { title: 'Tacos', ingredients: [{ rawText: '1 lb ground beef' }, { rawText: 'tortillas' }] }),
    201,
  )
  await testDb.db.batch([
    testDb.db.prepare('INSERT INTO weeks (id, created_at, updated_at) VALUES (?1, 0, 0)').bind(WEEK),
    testDb.db
      .prepare(`INSERT INTO plan_slots (week_id, day, meal, kind, recipe_id, updated_at) VALUES (?1, 1, 'dinner', 'recipe', ?2, 0)`)
      .bind(WEEK, tacos.id),
  ])
  const before = await json<ShoppingWeekResponse>(env, devRequest('POST', `/api/weeks/${WEEK}/shopping/generate`, {}))
  expect(before.lists[0].totals).toEqual([])

  const plain = new Request('https://chef.zmchenry.com/api/prices/refresh', { method: 'POST', body: '{}' })
  expect((await call(keyed, plain)).status).toBe(415)

  mockClaude()
  const refreshed = await json<PriceRefreshResponse>(keyed, devRequest('POST', '/api/prices/refresh', { weekId: WEEK }))
  expect(refreshed).toEqual({ weekId: WEEK, estimated: 6 })

  const after = await json<ShoppingWeekResponse>(env, devRequest('GET', `/api/weeks/${WEEK}/shopping`))
  expect(after.lists[0].totals.map((t) => t.cents).sort()).toEqual([200, 220, 240])

  // Cheapest store per ingredient, each once: 100 + 100.
  const week = await json<WeekView>(env, devRequest('GET', `/api/weeks/${WEEK}`))
  expect(week.summary.estCostCents).toBe(200)
})
