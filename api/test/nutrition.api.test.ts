import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { GoalsSettings, NutritionRefreshResponse, RecipeNutritionWire, WeekNutritionWire } from '../../shared/nutrition'
import type { Recipe } from '../../shared/schema'
import { resetAsked } from '../src/nutrition/estimate'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

// Claude is mocked: every ingredient is 200 kcal and 10 g protein per 100 g,
// 50 g each, 100 g a cup, typical portion 100 g.

let testDb: TestDb
let env: Env

beforeEach(async () => {
  testDb = await createTestDb()
  env = { ...devEnv(testDb.db), ANTHROPIC_API_KEY: 'test-key' } as Env
  resetAsked()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await testDb.dispose()
})

const WEEK = '2026-11-22'
const MON = '2026-11-23'

function mockClaude() {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    const ids = [...(body.messages[0].content as string).matchAll(/^(\d+): /gm)].map((m) => Number(m[1]))
    const none = { grams_slice: null, grams_clove: null, grams_can: null, grams_jar: null, grams_package: null, grams_bunch: null, grams_head: null, grams_stick: null }
    const items = ids.map((id) => ({
      ingredient_id: id, kcal: 200, protein: 10, carbs: 20, fat: 8, fiber: 1,
      grams_each: 50, grams_cup: 100, ...none, typical_grams: 100, confidence: 'high',
    }))
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items }) }] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function json<T>(req: Request, status = 200): Promise<T> {
  const res = await call(env, req)
  expect(res.status, await res.clone().text()).toBe(status)
  return (await res.json()) as T
}

it('estimates, computes recipe and week nutrition, splits portions and keeps goals', async () => {
  const fetchMock = mockClaude()
  const recipe = await json<Recipe>(
    devRequest('POST', '/api/recipes', {
      title: 'Chicken Rice',
      servings: 2,
      ingredients: [{ rawText: '1 lb chicken breast' }, { rawText: '2 cups rice' }],
    }),
    201,
  )
  // Background fill after the save; refresh waits, and finds nothing left.
  await vi.waitFor(async () => {
    const n = await testDb.db.prepare('SELECT count(*) AS n FROM ingredient_nutrition').first<number>('n')
    expect(n).toBe(2)
  })
  expect(await json<NutritionRefreshResponse>(devRequest('POST', '/api/nutrition/refresh', {}))).toEqual({ estimated: 0, missing: 0 })
  expect(fetchMock).toHaveBeenCalledTimes(1)

  // (453.6 g + 200 g) at 2 kcal/g over 2 servings.
  const rn = await json<RecipeNutritionWire>(devRequest('GET', `/api/nutrition/recipes/${recipe.id}`))
  expect(rn).toMatchObject({ perServing: { kcal: 654, protein: 33 }, confidence: 'high', filling: false })

  await json(
    devRequest('PUT', '/api/settings/goals', {
      goals: [
        { person: 'Zach', kcal: 2600, protein: 160, carbs: null, fat: null },
        { person: 'Liz', kcal: 1800, protein: 110, carbs: null, fat: null },
        { person: 'Nobody', kcal: 1, protein: null, carbs: null, fat: null },
      ],
    }),
  )
  const goals = await json<GoalsSettings>(devRequest('GET', '/api/settings/goals'))
  expect(goals.goals.map((g) => [g.person, g.kcal])).toEqual([['Zach', 2600], ['Liz', 1800]])

  await json(devRequest('PUT', `/api/weeks/${WEEK}/slots/${WEEK}/dinner`, { kind: 'recipe', recipeId: recipe.id }))
  await json(devRequest('PUT', `/api/weeks/${WEEK}/slots/${MON}/lunch`, { kind: 'leftovers' }))
  await json(devRequest('PUT', `/api/weeks/${WEEK}/slots/${MON}/dinner`, { kind: 'eat_out' }))

  let week = await json<WeekNutritionWire>(devRequest('GET', `/api/nutrition/weeks/${WEEK}`))
  const sunDinner = week.days[0]!.meals[2]!
  expect(sunDinner).toMatchObject({ status: 'known', portions: { Zach: 1.25, Liz: 0.75 }, custom: false })
  expect(week.days[1]!.meals.map((m) => m.status)).toEqual(['empty', 'known', 'gap'])
  expect(week.week.Zach!.known).toBe(2)

  week = await json<WeekNutritionWire>(
    devRequest('PUT', `/api/nutrition/weeks/${WEEK}/portions/${WEEK}/dinner`, { portions: { Zach: 1.5, Liz: 1.1, Ghost: 3 } }),
  )
  expect(week.days[0]!.meals[2]).toMatchObject({ portions: { Zach: 1.5, Liz: 1 }, custom: true })
  expect(week.days[0]!.people.Zach!.totals.kcal).toBe(Math.round(653.6 * 1.5))

  // A split bigger than the recipe (2.5 > 2 servings) scales the shopping list up.
  await json(devRequest('POST', `/api/weeks/${WEEK}/finish`, {}))
  const rice = await testDb.db
    .prepare(`SELECT quantity, unit FROM shopping_items WHERE name = 'rice'`)
    .first<{ quantity: number; unit: string }>()
  expect(rice).toEqual({ quantity: 2.5, unit: 'cup' })

  // Changing the slot's recipe drops the split.
  await json(devRequest('PUT', `/api/weeks/${WEEK}/slots/${WEEK}/dinner`, { kind: 'eat_out' }))
  week = await json<WeekNutritionWire>(devRequest('GET', `/api/nutrition/weeks/${WEEK}`))
  expect(week.days[0]!.meals[2]).toMatchObject({ status: 'gap', custom: false })
})
