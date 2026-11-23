import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { GoalsSettings, NutritionTrendsWire, RecipeNutritionWire } from '../../shared/nutrition'
import type { Recipe } from '../../shared/schema'
import { runNutritionBackfill } from '../src/nutrition/backfill'
import { resetAsked } from '../src/nutrition/estimate'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

let testDb: TestDb
let env: Env

beforeEach(async () => {
  testDb = await createTestDb()
  env = devEnv(testDb.db)
  resetAsked()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await testDb.dispose()
})

async function json<T>(req: Request, status = 200): Promise<T> {
  const res = await call(env, req)
  expect(res.status, await res.clone().text()).toBe(status)
  return (await res.json()) as T
}

it('goals: reads the old shape (no fiber), saves and returns every macro', async () => {
  // As the first version stored them: no fiber, one person without carbs/fat.
  await testDb.db
    .prepare(`INSERT INTO household_settings (key, value, updated_at) VALUES ('goals', ?1, 0)`)
    .bind(JSON.stringify({ Zach: { kcal: 2600, protein: 160, carbs: null, fat: null }, Liz: { kcal: 1800, protein: 110 } }))
    .run()
  let goals = await json<GoalsSettings>(devRequest('GET', '/api/settings/goals'))
  expect(goals.goals).toEqual([
    { person: 'Zach', kcal: 2600, protein: 160, carbs: null, fat: null, fiber: null },
    { person: 'Liz', kcal: 1800, protein: 110, carbs: null, fat: null, fiber: null },
  ])

  // An old client's PUT (no fiber) still works; the new shape round-trips.
  goals = await json<GoalsSettings>(
    devRequest('PUT', '/api/settings/goals', {
      goals: [
        { person: 'Zach', kcal: 2600, protein: 195, carbs: 260, fat: 87, fiber: 38 },
        { person: 'Liz', kcal: 1800, protein: 110, carbs: null, fat: null },
      ],
    }),
  )
  expect(goals.goals[0]).toEqual({ person: 'Zach', kcal: 2600, protein: 195, carbs: 260, fat: 87, fiber: 38 })
  expect(goals.goals[1]!.fiber).toBeNull()
  expect((await json<GoalsSettings>(devRequest('GET', '/api/settings/goals'))).goals).toEqual(goals.goals)

  // Trends answer with a gap (null), not zeros, for weeks with nothing planned.
  const trends = await json<NutritionTrendsWire>(devRequest('GET', '/api/nutrition/trends?end=2026-11-22'))
  expect(trends.weeks).toHaveLength(8)
  expect(trends.weeks[7]).toMatchObject({ weekId: '2026-11-22', people: { Zach: { perDay: null, days: 0 } } })
})

it('fills only empty amounts from the cron, leaves raw text alone, and marks them', async () => {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    if (!String(body.system).includes('ingredient amounts')) {
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items: [] }) }] })
    }
    // Answers for every line, including ones that already have an amount.
    const lines = [
      { position: 0, quantity: 1.5, unit: 'lb' }, // chicken thighs: filled
      { position: 1, quantity: 5, unit: 'cup' }, // "2 cups rice": already has one, ignored
      { position: 2, quantity: 1, unit: 'tsp' }, // "pinch of salt": keeps its unit
      { position: 3, quantity: null, unit: null }, // pepper: unmeasured
    ]
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ lines }) }] })
  })
  vi.stubGlobal('fetch', fetchMock)

  const recipe = await json<Recipe>(
    devRequest('POST', '/api/recipes', {
      title: 'Chicken Rice',
      servings: null,
      ingredients: [{ rawText: 'chicken thighs' }, { rawText: '2 cups rice' }, { rawText: 'pinch of salt' }, { rawText: 'black pepper' }],
    }),
    201,
  )
  const before = await lines(recipe.id)
  expect(before.map((l) => [l.quantity, l.unit])).toEqual([[null, null], [2, 'cup'], [null, 'pinch'], [null, null]])

  await runNutritionBackfill({ ...env, ANTHROPIC_API_KEY: 'test-key' } as Env)
  const after = await lines(recipe.id)
  expect(after.map((l) => [l.quantity, l.unit])).toEqual([[1.5, 'lb'], [2, 'cup'], [1, 'pinch'], [null, null]])
  expect(after.map((l) => l.raw_text)).toEqual(before.map((l) => l.raw_text))

  const n = await json<RecipeNutritionWire>(devRequest('GET', `/api/nutrition/recipes/${recipe.id}`))
  expect(n.estimatedAmounts).toEqual([0, 2])

  // Looked at once: the next run asks nothing more about it.
  const amountCalls = () => fetchMock.mock.calls.filter(([, init]) => String(init.body).includes('ingredient amounts')).length
  expect(amountCalls()).toBe(1)
  await runNutritionBackfill({ ...env, ANTHROPIC_API_KEY: 'test-key' } as Env)
  expect(amountCalls()).toBe(1)
})

async function lines(recipeId: string) {
  const { results } = await testDb.db
    .prepare('SELECT raw_text, quantity, unit FROM recipe_ingredients WHERE recipe_id = ?1 ORDER BY position')
    .bind(recipeId)
    .all<{ raw_text: string; quantity: number | null; unit: string | null }>()
  return results
}
