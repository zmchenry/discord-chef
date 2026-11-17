import { afterEach, beforeEach, expect, it } from 'vitest'

import type { Recipe, RecipeInput } from '../../shared/schema'
import type { ShoppingItemView, ShoppingWeekResponse } from '../../shared/shopping'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

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

async function recipe(input: RecipeInput): Promise<Recipe> {
  return json<Recipe>(devRequest('POST', '/api/recipes', input), 201)
}

// Planning owns plan_slots' routes; the test writes slots directly.
async function plan(day: number, recipeId: string) {
  const now = Date.now()
  await testDb.db.batch([
    testDb.db.prepare('INSERT OR IGNORE INTO weeks (id, created_at, updated_at) VALUES (?1, ?2, ?2)').bind(WEEK, now),
    testDb.db
      .prepare(`INSERT INTO plan_slots (week_id, day, meal, kind, recipe_id, updated_at) VALUES (?1, ?2, 'dinner', 'recipe', ?3, ?4)`)
      .bind(WEEK, day, recipeId, now),
  ])
}

const generate = (body: object = {}) => json<ShoppingWeekResponse>(devRequest('POST', `/api/weeks/${WEEK}/shopping/generate`, body))
const byName = (w: ShoppingWeekResponse) =>
  Object.fromEntries(w.lists.flatMap((l) => l.items.map((i) => [i.name, { ...i, trip: l.trip }])))

it('generates, checks, and keeps checks, manual items and order across regeneration', async () => {
  // Serves 2: the household of two eats it all, so amounts are as written.
  const tacos = await recipe({
    title: 'Tacos',
    servings: 2,
    ingredients: [{ rawText: '1 lb ground beef' }, { rawText: '1 cup shredded cheese' }, { rawText: 'cilantro' }],
  })
  const quesadillas = await recipe({
    title: 'Quesadillas',
    servings: 2,
    ingredients: [{ rawText: '2 tbsp shredded cheese' }, { rawText: '8 tortillas' }],
  })
  await testDb.db.prepare(`UPDATE ingredients SET perishable = 1, section = 'Produce' WHERE name = 'cilantro'`).run()
  await plan(1, tacos.id)
  await plan(5, quesadillas.id)

  let week = await generate()
  expect(week.twoTrips).toBe(false)
  expect(week.lists).toHaveLength(1)
  let items = byName(week)
  expect(items['shredded cheese'].amount).toBe('1 cup + 2 tbsp')
  expect(items['shredded cheese'].recipeIds.map((id) => week.recipes[id])).toEqual(['Tacos', 'Quesadillas'])
  expect(items['ground beef'].amount).toBe('1 lb')
  expect(items.cilantro.section).toBe('Produce')
  expect(items.cilantro.manualRank).toBe(0) // aisle order: Produce first

  // Check one item: writes a check event.
  const checked = await json<ShoppingItemView>(devRequest('PATCH', `/api/shopping/items/${items.tortillas.id}`, { checked: true }))
  expect(checked.checkedBy).toBe('zach@example.com')
  const events = await testDb.db.prepare('SELECT count(*) AS n FROM check_events').first<number>('n')
  expect(events).toBe(1)

  // A manual item with an amount, and a manual order change.
  const listId = week.lists[0].id
  await json(devRequest('POST', `/api/shopping/lists/${listId}/items`, { name: '2 Paper Towels' }), 201)
  await json(devRequest('PATCH', `/api/shopping/items/${items['ground beef'].id}`, { manualRank: -5 }))

  // The plan drops the quesadillas.
  await testDb.db.prepare('DELETE FROM plan_slots WHERE recipe_id = ?1').bind(quesadillas.id).run()
  week = await generate()
  items = byName(week)
  expect(items.tortillas).toBeUndefined()
  expect(items['shredded cheese'].amount).toBe('1 cup')
  expect(items['paper towels']).toMatchObject({ source: 'manual', amount: '2' })
  expect(items['ground beef'].manualRank).toBe(-5)

  // Bring the quesadillas back: tortillas return unchecked (new item), cheese
  // keeps its id.
  const cheeseId = items['shredded cheese'].id
  await plan(5, quesadillas.id)
  await json(devRequest('PATCH', `/api/shopping/items/${cheeseId}`, { checked: true }))
  week = await generate()
  items = byName(week)
  expect(items['shredded cheese']).toMatchObject({ id: cheeseId, amount: '1 cup + 2 tbsp' })
  expect(items['shredded cheese'].checkedAt).not.toBeNull()

  // Two trips: the perishable cilantro for Monday stays weekend; nothing is
  // perishable for Friday only, so midweek is empty. Checks and manual items
  // carry over.
  week = await generate({ twoTrips: true })
  expect(week.lists.map((l) => l.trip)).toEqual(['weekend', 'midweek'])
  expect(week.lists[0].id).toBe(listId)
  items = byName(week)
  expect(items['shredded cheese'].checkedAt).not.toBeNull()
  expect(items['paper towels'].trip).toBe('weekend')

  await testDb.db.prepare(`UPDATE ingredients SET perishable = 1 WHERE name = 'tortillas'`).run()
  week = await generate()
  expect(byName(week).tortillas.trip).toBe('midweek')

  // Back to one list.
  week = await generate({ twoTrips: false })
  expect(week.lists).toHaveLength(1)
  expect(Object.keys(byName(week)).sort()).toEqual(['cilantro', 'ground beef', 'paper towels', 'shredded cheese', 'tortillas'])
})
