import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Recipe } from '../../shared/schema'
import type { PinnedIngredient, ShoppingWeekResponse } from '../../shared/shopping'
import { groupByStore, pinnedTotals, recommendStore, storeTotals } from '../../shared/shopping/store'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

// Store pins: an ingredient always bought at one store.

const price = (storeId: number, ingredientId: number, cents: number) => ({ storeId, ingredientId, cents })

describe('recommendStore with pins', () => {
  // Store 1 is cheaper for bread and milk, store 2 only wins if the pinned
  // turkey (only priced at 2) counted.
  const prices = [price(1, 1, 200), price(1, 2, 300), price(2, 1, 250), price(2, 2, 350), price(2, 3, 900)]
  it.each([
    ['unpinned: turkey makes store 1 fall under 70% priced', [{ ingredientId: 1 }, { ingredientId: 2 }, { ingredientId: 3 }], { storeId: 2, cents: 1500 }],
    ['pinned turkey is left out of the comparison', [{ ingredientId: 1 }, { ingredientId: 2 }, { ingredientId: 3, storeId: 2 }], { storeId: 1, cents: 500 }],
    ['only pinned items: nothing to compare', [{ ingredientId: 3, storeId: 2 }], null],
  ] as const)('%s', (_name, items, expected) => {
    expect(recommendStore(items, prices)).toEqual(expected)
  })

  it('totals count unpinned items, and pinned ones are priced at their store', () => {
    const items = [{ ingredientId: 1 }, { ingredientId: 2 }, { ingredientId: 3, storeId: 2 }]
    expect(storeTotals(items, prices, [1, 2])).toEqual([
      { storeId: 1, cents: 500, priced: 2, total: 2 },
      { storeId: 2, cents: 600, priced: 2, total: 2 },
    ])
    expect(pinnedTotals(items, prices, [1, 2])).toEqual([{ storeId: 2, cents: 900, priced: 1, total: 1 }])
  })
})

describe('groupByStore', () => {
  const item = (name: string, storeId: number | null) => ({ name, storeId })
  const items = [item('bread', null), item('turkey', 2), item('eggs', 3), item('milk', null), item('ham', 2)]
  const names = (xs: Array<{ name: string }>) => xs.map((x) => x.name)
  it.each([
    ['trip at store 1: Publix and Aldi pins listed apart', 1, ['bread', 'milk'], [[2, ['turkey', 'ham']], [3, ['eggs']]]],
    ['trip at the pinned store: those items are normal', 2, ['bread', 'turkey', 'milk', 'ham'], [[3, ['eggs']]]],
  ] as const)('%s', (_name, trip, main, also) => {
    const g = groupByStore(items, trip, [1, 2, 3])
    expect(names(g.main)).toEqual(main)
    expect(g.also.map((a) => [a.storeId, names(a.items)])).toEqual(also)
  })
})

describe('API', () => {
  let testDb: TestDb
  let env: Env
  beforeEach(async () => {
    testDb = await createTestDb()
    env = devEnv(testDb.db)
  })
  afterEach(async () => {
    await testDb.dispose()
  })

  const WEEK = '2026-11-15'
  async function json<T>(req: Request, status = 200): Promise<T> {
    const res = await call(env, req)
    expect(res.status, await res.clone().text()).toBe(status)
    return (await res.json()) as T
  }

  it('pins turkey to Publix: it is listed apart on an Aldi trip and left out of the totals', async () => {
    const r = await json<Recipe>(
      devRequest('POST', '/api/recipes', { title: 'Turkey Club', ingredients: [{ rawText: '1 lb sliced turkey' }, { rawText: 'bread' }] }),
      201,
    )
    const now = Date.now()
    await testDb.db.batch([
      testDb.db.prepare('INSERT INTO weeks (id, created_at, updated_at) VALUES (?1, ?2, ?2)').bind(WEEK, now),
      testDb.db
        .prepare(`INSERT INTO plan_slots (week_id, day, meal, kind, recipe_id, updated_at) VALUES (?1, 1, 'dinner', 'recipe', ?2, ?3)`)
        .bind(WEEK, r.id, now),
    ])
    const turkeyId = r.ingredients[0].ingredientId!
    const breadId = r.ingredients[1].ingredientId!
    let week = await json<ShoppingWeekResponse>(devRequest('POST', `/api/weeks/${WEEK}/shopping/generate`, {}))
    const store = (name: string) => week.stores.find((s) => s.name === name)!.id
    const [publix, aldi] = [store('Publix'), store('Aldi')]

    expect((await call(env, devRequest('PUT', `/api/ingredients/${turkeyId}/store`, { storeId: 999 }))).status).toBe(400)
    const pinned = await json<PinnedIngredient>(devRequest('PUT', `/api/ingredients/${turkeyId}/store`, { storeId: publix }))
    expect(pinned).toMatchObject({ name: 'sliced turkey', storeId: publix })
    expect(await json(devRequest('GET', '/api/store-pins'))).toEqual({ pins: [{ ingredientId: turkeyId, storeId: publix }] })

    for (const [sid, ing, cents] of [[publix, turkeyId, 899], [aldi, turkeyId, 499], [publix, breadId, 300], [aldi, breadId, 200]]) {
      await testDb.db
        .prepare(`INSERT INTO ingredient_prices (ingredient_id, store_id, cents, source, updated_at) VALUES (?1, ?2, ?3, 'manual', 0)`)
        .bind(ing, sid, cents)
        .run()
    }
    week = await json<ShoppingWeekResponse>(devRequest('PUT', `/api/shopping/lists/${week.lists[0].id}`, { storeId: aldi }))
    week = await json<ShoppingWeekResponse>(devRequest('POST', `/api/weeks/${WEEK}/shopping/generate`, { twoTrips: true }))

    // Turkey stays on the weekend trip it would have gone to anyway.
    const list = week.lists[0]
    expect(list).toMatchObject({ trip: 'weekend', storeId: aldi })
    const groups = groupByStore(list.items, list.storeId, week.stores.map((s) => s.id))
    expect(groups.main.map((i) => i.name)).toEqual(['bread'])
    expect(groups.also).toEqual([{ storeId: publix, items: [expect.objectContaining({ name: 'sliced turkey', storeId: publix })] }])
    expect(list.totals.find((t) => t.storeId === aldi)).toEqual({ storeId: aldi, cents: 200, priced: 1, total: 1 })
    expect(list.pinnedTotals).toEqual([{ storeId: publix, cents: 899, priced: 1, total: 1 }])

    // Unpinning puts it back in the comparison.
    await json(devRequest('PUT', `/api/ingredients/${turkeyId}/store`, { storeId: null }))
    week = await json<ShoppingWeekResponse>(devRequest('GET', `/api/weeks/${WEEK}/shopping`))
    expect(week.lists[0].totals.find((t) => t.storeId === aldi)?.cents).toBe(699)
  })
})
