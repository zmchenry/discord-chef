import { afterEach, beforeEach, expect, it } from 'vitest'

import type { Recipe, RecipeInput } from '../../shared/schema'
import type { CalendarSettings, Suggestion, WeekView } from '../../shared/planningApi'
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

const recipe = (title: string, tags: string[], ingredients: string[]): RecipeInput => ({
  title,
  tags,
  ingredients: ingredients.map((rawText) => ({ rawText })),
})

const WEEK = '2026-11-22' // a Sunday

it('plans a week: get, set a slot, auto-fill, suggestions, finish', async () => {
  const tacos = await json<Recipe>(devRequest('POST', '/api/recipes', recipe('Tacos', ['dinner'], ['tortillas', 'peppers'])), 201)
  await json<Recipe>(devRequest('POST', '/api/recipes', recipe('Fajitas', ['dinner'], ['tortillas', 'peppers'])), 201)
  await json<Recipe>(devRequest('POST', '/api/recipes', recipe('Oatmeal', ['breakfast'], ['oats'])), 201)
  await json<Recipe>(devRequest('POST', '/api/recipes', recipe('Turkey Sandwich', ['lunch'], ['bread'])), 201)

  // A week that is not a Sunday does not exist.
  expect((await call(env, devRequest('GET', '/api/weeks/2026-11-23'))).status).toBe(404)

  const empty = await json<WeekView>(devRequest('GET', `/api/weeks/${WEEK}`))
  expect(empty).toMatchObject({ id: WEEK, status: 'draft', slots: [], calendar: 'none' })
  expect(empty.days.map((d) => d.date)).toEqual([
    '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28',
  ])
  expect(empty.summary).toMatchObject({ filled: 0, total: 21 })

  const set = await json<WeekView>(
    devRequest('PUT', `/api/weeks/${WEEK}/slots/2026-11-24/dinner`, { kind: 'recipe', recipeId: tacos.id, locked: true }),
  )
  expect(set.slots).toEqual([
    expect.objectContaining({ date: '2026-11-24', meal: 'dinner', kind: 'recipe', source: 'manual', locked: true, recipe: expect.objectContaining({ title: 'Tacos' }) }),
  ])

  const filled = await json<WeekView>(new Request(`https://chef.zmchenry.com/api/weeks/${WEEK}/autofill`, {
    method: 'POST',
    headers: { 'x-dev-user-id': 'zach@example.com', 'content-type': 'application/json' },
  }))
  // Empty slots get filled as 'auto'; the locked Tuesday dinner is untouched.
  expect(filled.summary.filled).toBeGreaterThan(3)
  expect(filled.slots.find((s) => s.date === '2026-11-24' && s.meal === 'dinner')).toMatchObject({ recipeId: tacos.id, source: 'manual' })
  expect(filled.slots.filter((s) => s.source === 'auto')).toHaveLength(filled.summary.filled - 1)
  for (const s of filled.summary.shared) expect(s.name).not.toBe('ingredient')

  const { suggestions } = await json<{ suggestions: Suggestion[] }>(
    devRequest('GET', `/api/weeks/${WEEK}/suggestions?date=2026-11-25&meal=dinner`),
  )
  expect(suggestions.map((s) => s.title).sort()).toEqual(['Fajitas', 'Tacos'])
  const searched = await json<{ suggestions: Suggestion[] }>(
    devRequest('GET', `/api/weeks/${WEEK}/suggestions?date=2026-11-25&meal=dinner&q=oat`),
  )
  expect(searched.suggestions.map((s) => s.title)).toEqual(['Oatmeal'])

  const cleared = await json<WeekView>(devRequest('DELETE', `/api/weeks/${WEEK}/slots/2026-11-24/dinner`))
  expect(cleared.summary.filled).toBe(filled.summary.filled - 1)

  const done = await json<WeekView>(new Request(`https://chef.zmchenry.com/api/weeks/${WEEK}/finish`, {
    method: 'POST',
    headers: { 'x-dev-user-id': 'zach@example.com', 'content-type': 'application/json' },
  }))
  expect(done.status).toBe('planned')
})

it('replans a week: keeps your picks by default, or only locked ones', async () => {
  const tacos = await json<Recipe>(devRequest('POST', '/api/recipes', recipe('Tacos', ['dinner'], ['tortillas'])), 201)
  await json<Recipe>(devRequest('POST', '/api/recipes', recipe('Fajitas', ['dinner'], ['tortillas'])), 201)
  await json<WeekView>(devRequest('PUT', `/api/weeks/${WEEK}/slots/2026-11-24/dinner`, { kind: 'recipe', recipeId: tacos.id, locked: true }))
  const post = (path: string) =>
    new Request(`https://chef.zmchenry.com/api/weeks/${WEEK}/${path}`, {
      method: 'POST',
      headers: { 'x-dev-user-id': 'zach@example.com', 'content-type': 'application/json' },
    })
  const filled = await json<WeekView>(post('autofill'))
  expect(filled.summary.filled).toBeGreaterThan(1)

  // A manual, unlocked pick: kept by a default replan, cleared by 'locked'.
  await json<WeekView>(devRequest('PUT', `/api/weeks/${WEEK}/slots/2026-11-25/dinner`, { kind: 'eat_out' }))
  const postBody = (path: string, body: unknown) =>
    new Request(`https://chef.zmchenry.com/api/weeks/${WEEK}/${path}`, {
      method: 'POST',
      headers: { 'x-dev-user-id': 'zach@example.com', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const mine = await json<WeekView>(postBody('replan', { keep: 'mine' }))
  expect(mine.slots.find((s) => s.date === '2026-11-25' && s.meal === 'dinner')).toMatchObject({ kind: 'eat_out', source: 'manual' })
  expect(mine.slots.find((s) => s.date === '2026-11-24' && s.meal === 'dinner')).toMatchObject({ recipeId: tacos.id, locked: true })
  expect(mine.summary.filled).toBe(filled.summary.filled) // auto picks redone, not dropped

  // Clear an auto pick by hand, then replan keeping only locked: the manual eat-out goes too.
  const lockedOnly = await json<WeekView>(postBody('replan', { keep: 'locked' }))
  expect(lockedOnly.slots.find((s) => s.date === '2026-11-25' && s.meal === 'dinner')?.source).not.toBe('manual')
  expect(lockedOnly.slots.find((s) => s.date === '2026-11-24' && s.meal === 'dinner')).toMatchObject({ recipeId: tacos.id, locked: true })
})

it('never returns the calendar address', async () => {
  const saved = await json<CalendarSettings>(
    devRequest('PUT', '/api/settings/calendar', { icalUrl: 'webcal://calendar.example.com/secret/basic.ics' }),
  )
  expect(saved).toEqual({ configured: true, host: 'calendar.example.com', fetchedAt: null, eventCount: null, error: null })
  expect(await json(devRequest('GET', '/api/settings/household'))).toEqual({ people: ['Zach', 'Liz'] })
})
