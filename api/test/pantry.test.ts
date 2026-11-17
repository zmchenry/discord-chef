import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { haveEnough, type PantryItem, type PantryResponse } from '../../shared/pantry'
import type { Recipe } from '../../shared/schema'
import type { ShoppingItemView, ShoppingWeekResponse } from '../../shared/shopping'
import { splitAlreadyHave } from '../../shared/shopping/pantry'
import { storeTotals } from '../../shared/shopping/store'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

describe('pantry defaults and the Already-have group', () => {
  const on = { onHand: true, low: false }
  const out = { onHand: false, low: false }
  const low = { onHand: true, low: true }
  it.each([
    ['basic with no section: assumed on hand', 'salt', null, null, true],
    ['basic filed under Pantry', 'olive oil', 'Pantry', null, true],
    ['basic filed elsewhere (fresh, not dried)', 'cinnamon', 'Produce', null, false],
    ['basic marked out', 'black pepper', 'Pantry', out, false],
    ['not a basic, no row', 'milk', 'Dairy & Eggs', null, false],
    ['not a basic, marked on hand', 'milk', 'Dairy & Eggs', on, true],
    ['on hand but low still gets bought', 'rice', 'Pantry', low, false],
  ] as const)('%s', (_name, name, section, state, expected) => {
    expect(haveEnough(state, { name, section })).toBe(expected)
  })

  it('groups unchecked on-hand items apart and leaves them out of the totals', () => {
    const item = (ingredientId: number, onHand: boolean, checkedAt: number | null = null) => ({ ingredientId, onHand, checkedAt })
    const items = [item(1, false), item(2, true), item(3, true, 123), item(4, false)]
    const { toBuy, have } = splitAlreadyHave(items)
    expect(have.map((i) => i.ingredientId)).toEqual([2])
    // A checked on-hand item was just bought: it stays on the list.
    expect(toBuy.map((i) => i.ingredientId)).toEqual([1, 3, 4])
    const prices = [1, 2, 3, 4].map((ingredientId) => ({ storeId: 1, ingredientId, cents: 100 * ingredientId }))
    expect(storeTotals(toBuy, prices, [1])).toEqual([{ storeId: 1, cents: 800, priced: 3, total: 3 }])
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
  const items = (w: ShoppingWeekResponse) => Object.fromEntries(w.lists[0].items.map((i) => [i.name, i])) as Record<string, ShoppingItemView>
  const have = (w: ShoppingWeekResponse) => splitAlreadyHave(w.lists[0].items).have.map((i) => i.name).sort()

  it('on-hand items move to Already have, and checking one off puts it in the pantry', async () => {
    const r = await json<Recipe>(
      devRequest('POST', '/api/recipes', {
        title: 'Pasta',
        ingredients: [{ rawText: '1 lb spaghetti' }, { rawText: '2 tbsp olive oil' }, { rawText: 'parmesan' }, { rawText: 'salt' }],
      }),
      201,
    )
    const now = Date.now()
    await testDb.db.batch([
      testDb.db.prepare('INSERT INTO weeks (id, created_at, updated_at) VALUES (?1, ?2, ?2)').bind(WEEK, now),
      testDb.db
        .prepare(`INSERT INTO plan_slots (week_id, day, meal, kind, recipe_id, updated_at) VALUES (?1, 1, 'dinner', 'recipe', ?2, ?3)`)
        .bind(WEEK, r.id, now),
    ])
    const [spaghetti, , parmesan] = r.ingredients.map((i) => i.ingredientId!)

    // Basics start out assumed on hand.
    let week = await json<ShoppingWeekResponse>(devRequest('POST', `/api/weeks/${WEEK}/shopping/generate`, {}))
    expect(have(week)).toEqual(['olive oil', 'salt'])
    const pantry = await json<PantryResponse>(devRequest('GET', '/api/pantry'))
    expect(pantry.items.find((i) => i.name === 'salt')).toMatchObject({ onHand: true, assumed: true })

    // Mark spaghetti on hand, regenerate: it moves.
    expect((await call(env, devRequest('PUT', '/api/pantry/9999', { onHand: true }))).status).toBe(404)
    const set = await json<PantryItem>(devRequest('PUT', `/api/pantry/${spaghetti}`, { onHand: true }))
    expect(set).toMatchObject({ name: 'spaghetti', onHand: true, assumed: false, updatedBy: 'zach@example.com' })
    week = await json<ShoppingWeekResponse>(devRequest('POST', `/api/weeks/${WEEK}/shopping/generate`, {}))
    expect(have(week)).toEqual(['olive oil', 'salt', 'spaghetti'])

    // "Need it after all" on the olive oil: out, back on the list.
    await json(devRequest('PUT', `/api/pantry/${r.ingredients[1].ingredientId}`, { onHand: false }))
    week = await json<ShoppingWeekResponse>(devRequest('GET', `/api/weeks/${WEEK}/shopping`))
    expect(have(week)).toEqual(['salt', 'spaghetti'])

    // Checking off the parmesan puts it in the pantry; it stays checked on this list.
    await json(devRequest('PATCH', `/api/shopping/items/${items(week).parmesan.id}`, { checked: true }))
    const after = await json<PantryResponse>(devRequest('GET', '/api/pantry'))
    expect(after.items.find((i) => i.ingredientId === parmesan)).toMatchObject({ onHand: true, assumed: false })
    week = await json<ShoppingWeekResponse>(devRequest('GET', `/api/weeks/${WEEK}/shopping`))
    expect(items(week).parmesan).toMatchObject({ onHand: true })
    expect(have(week)).toEqual(['salt', 'spaghetti'])
  })
})
