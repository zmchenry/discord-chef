import { afterEach, beforeEach, expect, it } from 'vitest'

import type { BreakfastLunchSettings, FillBreakfastLunchResponse } from '../../shared/guidedDinners'
import type { Recipe, RecipeInput } from '../../shared/schema'
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

async function json<T>(req: Request, status = 200): Promise<T> {
  const res = await call(env, req)
  expect(res.status, await res.clone().text()).toBe(status)
  return (await res.json()) as T
}
const create = (title: string, tags: string[]) =>
  json<Recipe>(devRequest('POST', '/api/recipes', { title, tags, ingredients: [] } satisfies RecipeInput), 201)

it('fills breakfasts from the rotation and lunches from leftovers or staples', async () => {
  const oats = await create('Overnight Oats', ['breakfast'])
  const eggs = await create('Eggs', ['breakfast'])
  const toast = await create('Toast', ['breakfast'])
  await create('Turkey and Cheese with Veggies', ['lunch'])
  const chili = await create('Chili', ['dinner', 'makes-leftovers'])

  const saved = await json<BreakfastLunchSettings>(
    devRequest('PUT', '/api/settings/breakfast-lunch', { breakfastRotation: [oats.id, eggs.id, toast.id], lunchStaples: [] }),
  )
  expect(saved.breakfastRotation.map((r) => r.title)).toEqual(['Overnight Oats', 'Eggs', 'Toast'])
  expect(saved).toMatchObject({ rotationIsDefault: false, staplesIsDefault: true, lunchStaples: [{ title: 'Turkey and Cheese with Veggies' }] })

  const W1 = '2026-11-22'
  await json(devRequest('PUT', `/api/weeks/${W1}/slots/2026-11-23/dinner`, { kind: 'recipe', recipeId: chili.id }))
  const one = await json<FillBreakfastLunchResponse>(devRequest('POST', `/api/weeks/${W1}/fill-breakfast-lunch`, {}))
  const at = (r: FillBreakfastLunchResponse, date: string, meal: string) => {
    const s = r.week.slots.find((x) => x.date === date && x.meal === meal)!
    return s.kind === 'recipe' ? s.recipe!.title : s.kind
  }
  expect(one.filled).toBe(14)
  expect(at(one, '2026-11-24', 'lunch')).toBe('leftovers') // the day after chili
  expect(one.leftoversFrom).toEqual({ '2026-11-24': 'Chili' })
  expect(at(one, '2026-11-25', 'lunch')).toBe('Turkey and Cheese with Veggies')
  expect(one.week.slots.filter((s) => s.meal !== 'dinner').every((s) => s.source === 'auto')).toBe(true)
  expect(at(one, W1, 'breakfast')).toBe('Overnight Oats')
  expect(at(one, '2026-11-28', 'breakfast')).toBe('Overnight Oats') // 7 days: oats, eggs, toast, oats, eggs, toast, oats

  // Running it again fills nothing new; the next week continues the rotation.
  expect((await json<FillBreakfastLunchResponse>(devRequest('POST', `/api/weeks/${W1}/fill-breakfast-lunch`, {}))).filled).toBe(0)
  const two = await json<FillBreakfastLunchResponse>(devRequest('POST', '/api/weeks/2026-11-29/fill-breakfast-lunch', {}))
  expect(at(two, '2026-11-29', 'breakfast')).toBe('Eggs')

  // A refill of week 1 starts where week 1 started.
  const again = await json<FillBreakfastLunchResponse>(devRequest('POST', `/api/weeks/${W1}/fill-breakfast-lunch`, { refill: true }))
  expect(again.filled).toBe(14)
  expect(at(again, W1, 'breakfast')).toBe('Overnight Oats')
})
