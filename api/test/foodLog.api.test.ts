import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { FoodLogList, FoodLogMe, ParseResponse } from '../../shared/foodLog'
import type { WeekNutritionWire } from '../../shared/nutrition'
import { sundayOf, todayIn } from '../../shared/planningApi'
import type { Recipe } from '../../shared/schema'
import { resetAsked } from '../src/nutrition/estimate'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

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

async function json<T>(req: Request, status = 200): Promise<T> {
  const res = await call(env, req)
  expect(res.status, await res.clone().text()).toBe(status)
  return (await res.json()) as T
}

const TEXT = `Dunkin almond shaken espresso
Jelly donut
Bacon egg and cheese wake up wrap
1/2 Crisp and Green Southwest Salad
Air fried popcorn shrimp
Elavi Protein cookie`

const ITEM = (label: string, meal: string | null, kcal: number, extra: Record<string, unknown> = {}) => ({
  label, quantity: null, meal, brand: null, kcal, protein: 10, carbs: 20, fat: 5, fiber: 1, confidence: 'high', recipe_id: null, servings: null, ...extra,
})

// Claude: the food reader answers for the note; ingredient estimates are
// 200 kcal / 100 g for the recipe.
function mockClaude() {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    if (String(body.system).includes('meal-tracking')) {
      const items = [
        ITEM('Almond shaken espresso', null, 130, { brand: 'Dunkin' }),
        ITEM('Jelly donut', null, 270, { brand: 'Dunkin' }),
        ITEM('Bacon egg and cheese wake-up wrap', null, 210, { brand: 'Dunkin' }),
        ITEM('Southwest Salad', 'lunch', 330, { brand: 'Crisp & Green', quantity: '1/2' }),
        ITEM('Air fried popcorn shrimp', 'dinner', 280),
        ITEM('Protein cookie', 'snack', 190, { brand: 'Elavi' }),
      ]
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items }) }] })
    }
    const content = typeof body.messages[0].content === 'string' ? body.messages[0].content : ''
    const ids = [...content.matchAll(/^(\d+): /gm)].map((m) => Number(m[1]))
    const none = { grams_slice: null, grams_clove: null, grams_can: null, grams_jar: null, grams_package: null, grams_bunch: null, grams_head: null, grams_stick: null }
    const items = ids.map((id) => ({
      ingredient_id: id, kcal: 200, protein: 10, carbs: 20, fat: 8, fiber: 1, grams_each: 50, grams_cup: 100, ...none, typical_grams: 100, confidence: 'high',
    }))
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items }) }] })
  })
  vi.stubGlobal('fetch', fetchMock)
}

it('parses, saves, and counts: a logged dinner replaces the planned one for that person only', async () => {
  mockClaude()
  const today = todayIn()
  const week = sundayOf(today)

  // zach@example.com reads as Zach.
  expect(await json<FoodLogMe>(devRequest('GET', '/api/food-log/me'))).toEqual({ person: 'Zach', people: ['Zach', 'Liz'] })

  const recipe = await json<Recipe>(
    devRequest('POST', '/api/recipes', { title: 'Chicken Rice', servings: 2, ingredients: [{ rawText: '1 lb chicken breast' }, { rawText: '2 cups rice' }] }),
    201,
  )
  await vi.waitFor(async () => {
    expect(await testDb.db.prepare('SELECT count(*) AS n FROM ingredient_nutrition').first<number>('n')).toBe(2)
  })
  await json(devRequest('PUT', `/api/weeks/${week}/slots/${today}/dinner`, { kind: 'recipe', recipeId: recipe.id }))

  const parsed = await json<ParseResponse>(devRequest('POST', '/api/food-log/parse', { text: TEXT, meal: 'breakfast' }))
  expect(parsed.source).toBe('claude')
  expect(parsed.items.map((i) => [i.meal, i.kcal])).toEqual([
    ['breakfast', 130],
    ['breakfast', 270],
    ['breakfast', 210],
    ['lunch', 330],
    ['dinner', 280],
    ['snack', 190],
  ])
  expect(parsed.items[3]).toMatchObject({ quantity: '1/2', brand: 'Crisp & Green', source: 'estimate' })

  const saved = await json<FoodLogList>(devRequest('POST', '/api/food-log', { date: today, people: ['Zach'], items: parsed.items }))
  expect(saved.items).toHaveLength(6)

  const n = await json<WeekNutritionWire>(devRequest('GET', `/api/nutrition/weeks/${week}`))
  const day = n.days.find((d) => d.date === today)!
  expect(day.food).toHaveLength(6)
  expect(day.meals[2]).toMatchObject({ recipeId: recipe.id, replacedFor: ['Zach'] })
  // Zach: only what he logged. Liz: her half of the planned dinner, (453.6 + 200) g x 2 kcal/g / 2.
  expect(day.people.Zach!.totals.kcal).toBe(130 + 270 + 210 + 330 + 280 + 190)
  expect(day.people.Liz!.totals.kcal).toBe(654)
  expect(day.people.Zach!.plan.kcal).toBe(654)
  expect(day.people.Zach!.adherence).toMatchObject({ logged: 1, extras: 5 }) // breakfast and lunch were not planned

  // Edit, then delete one; it stops counting.
  const shrimp = saved.items.find((i) => i.meal === 'dinner')!
  await json(devRequest('PUT', `/api/food-log/items/${shrimp.id}`, { ...shrimp, kcal: 300 }))
  await json(devRequest('DELETE', `/api/food-log/items/${shrimp.id}`))
  const after = await json<WeekNutritionWire>(devRequest('GET', `/api/nutrition/weeks/${week}`))
  expect(after.days.find((d) => d.date === today)!.people.Zach!.totals.kcal).toBe(130 + 270 + 210 + 330 + 190 + 654)

  // No key: each line comes back as typed, with no numbers.
  env = devEnv(testDb.db)
  const bare = await json<ParseResponse>(devRequest('POST', '/api/food-log/parse', { text: TEXT, meal: 'lunch' }))
  expect(bare).toMatchObject({ source: 'none' })
  expect(bare.items).toHaveLength(6)
  expect(bare.items[3]).toMatchObject({ label: '1/2 Crisp and Green Southwest Salad', meal: 'lunch', kcal: null })
})
