import { afterEach, beforeEach, expect, it } from 'vitest'

import type { HouseholdMembers } from '../../shared/household'
import type { WeekNutritionWire } from '../../shared/nutrition'
import type { Recipe } from '../../shared/schema'
import type { ShoppingWeekResponse } from '../../shared/shopping'
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

const WEEK = '2026-11-22'
const MON = '2026-11-23'

async function json<T>(req: Request, status = 200): Promise<T> {
  const res = await call(env, req)
  expect(res.status, await res.clone().text()).toBe(status)
  return (await res.json()) as T
}

it('saves kids, shows who each meal feeds, and scales the shopping list', async () => {
  const defaults = await json<HouseholdMembers>(devRequest('GET', '/api/settings/household-members'))
  expect(defaults.members.map((m) => [m.name, m.kind, m.portion])).toEqual([['Zach', 'adult', 1], ['Liz', 'adult', 1]])

  const all = ['breakfast', 'lunch', 'dinner', 'snack'] as const
  const saved = await json<HouseholdMembers>(
    devRequest('PUT', '/api/settings/household-members', {
      members: [
        ...defaults.members,
        { name: '', kind: 'kid', portion: 0.5, meals: all },
        { name: '', kind: 'kid', portion: 0.5, meals: ['breakfast', 'dinner'] },
      ],
    }),
  )
  expect(saved.members.map((m) => m.name)).toEqual(['Zach', 'Liz', 'Kid 1', 'Kid 2'])

  const bagels = await json<Recipe>(
    devRequest('POST', '/api/recipes', { title: 'Bagels', servings: 1, ingredients: [{ rawText: '1 bagel' }] }),
    201,
  )
  const chili = await json<Recipe>(
    devRequest('POST', '/api/recipes', { title: 'Chili', servings: 4, ingredients: [{ rawText: '2 lb ground beef' }] }),
    201,
  )
  await json(devRequest('PUT', `/api/weeks/${WEEK}/slots/${WEEK}/breakfast`, { kind: 'recipe', recipeId: bagels.id }))
  await json(devRequest('PUT', `/api/weeks/${WEEK}/slots/${WEEK}/dinner`, { kind: 'recipe', recipeId: chili.id }))
  await json(devRequest('PUT', `/api/weeks/${WEEK}/slots/${MON}/lunch`, { kind: 'leftovers' }))

  const week = await json<WeekNutritionWire>(devRequest('GET', `/api/nutrition/weeks/${WEEK}`))
  expect(week.members.map((m) => m.kind)).toEqual(['adult', 'adult', 'kid', 'kid'])
  const [breakfast, , dinner] = week.days[0]!.meals
  expect(breakfast!.serves).toMatchObject({ adults: 2, kids: 2, total: 3, factor: 3 })
  // Kid 2 isn't home for lunch: the leftovers lunch eats 2.5 of the chili.
  expect(dinner!.serves).toMatchObject({ total: 3, leftovers: 2.5, factor: 1.375 })

  // A kid's portion can be changed per meal like anyone's.
  const custom = await json<WeekNutritionWire>(
    devRequest('PUT', `/api/nutrition/weeks/${WEEK}/portions/${WEEK}/breakfast`, {
      portions: { Zach: 1, Liz: 1, 'Kid 1': 1, 'Kid 2': 0.5 },
    }),
  )
  expect(custom.days[0]!.meals[0]!.serves).toMatchObject({ total: 3.5 })

  const list = await json<ShoppingWeekResponse>(devRequest('POST', `/api/weeks/${WEEK}/shopping/generate`, {}))
  const items = Object.fromEntries(list.lists.flatMap((l) => l.items.map((i) => [i.name, i.amount])))
  expect(items).toMatchObject({ bagel: '4', 'ground beef': '2¾ lb' })
})
