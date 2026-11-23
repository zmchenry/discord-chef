import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { HistoryEntryWire, HistoryResponse, InsightsResponse } from '../../shared/mealHistory'
import type { Recipe } from '../../shared/schema'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

// Tuesday 2026-11-24, 9pm in New York: Monday and today's meals are over.
const NOW = new Date('2026-11-25T02:00:00Z')
const WEEK = '2026-11-22'
const MON = '2026-11-23'
const TUE = '2026-11-24'

let testDb: TestDb
let env: Env

beforeEach(async () => {
  testDb = await createTestDb()
  env = { ...devEnv(testDb.db), ANTHROPIC_API_KEY: 'test-key' } as Env
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  // Background Claude calls from other features (nutrition estimates) just fail.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 503 })))
})
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await testDb.dispose()
})

async function json<T>(req: Request, status = 200): Promise<T> {
  const res = await call(env, req)
  expect(res.status, await res.clone().text()).toBe(status)
  return (await res.json()) as T
}

it('assumes planned meals were eaten, logs changes, lists history and writes insights', async () => {
  const curry = await json<Recipe>(devRequest('POST', '/api/recipes', { title: 'Butter Chicken', ingredients: [{ rawText: '1 lb chicken thighs' }] }), 201)
  const tacos = await json<Recipe>(devRequest('POST', '/api/recipes', { title: 'Fish Tacos', ingredients: [{ rawText: '1 lb cod' }] }), 201)
  for (const [date, meal, kind, recipeId] of [
    [MON, 'dinner', 'recipe', curry.id],
    [TUE, 'lunch', 'recipe', curry.id],
    [TUE, 'dinner', 'recipe', tacos.id],
    ['2026-11-25', 'dinner', 'eat_out', null],
  ] as const) {
    await json(devRequest('PUT', `/api/weeks/${WEEK}/slots/${date}/${meal}`, { kind, recipeId }))
  }

  // The Week page's check-in: yesterday's and today's meals, all assumed eaten.
  const pending = await json<{ entries: HistoryEntryWire[] }>(devRequest('GET', '/api/history/pending'))
  expect(pending.entries.map((e) => `${e.date} ${e.meal} ${e.status} ${e.confirmed} ${e.recipe?.title}`)).toEqual([
    `${TUE} dinner eaten false Fish Tacos`,
    `${TUE} lunch eaten false Butter Chicken`,
    `${MON} dinner eaten false Butter Chicken`,
  ])

  // Cooking mode's Done marks today's planned meal; a recipe not on today's plan does nothing.
  expect(await json(devRequest('POST', '/api/history/cooked', { recipeId: tacos.id }))).toEqual({ meal: 'dinner' })
  expect(await json(devRequest('POST', '/api/history/cooked', { recipeId: 'nope' }))).toEqual({ meal: null })

  // Rate Monday, and lunch was something else.
  const rated = await json<HistoryEntryWire>(devRequest('PUT', '/api/history/log', { date: MON, meal: 'dinner', status: 'eaten', rating: 1 }))
  expect(rated).toMatchObject({ status: 'eaten', confirmed: true, rating: 1, recipeId: curry.id, loggedBy: 'zach@example.com' })
  await json(devRequest('PUT', '/api/history/log', { date: TUE, meal: 'lunch', status: 'swapped', freeText: 'Frozen pizza' }))
  await json(devRequest('PUT', '/api/history/log', { date: '2026-11-26', meal: 'lunch', status: 'skipped' }), 400)

  const hist = await json<HistoryResponse>(devRequest('GET', '/api/history?weeks=4'))
  expect(hist.entries.map((e) => `${e.date} ${e.meal} ${e.status} ${e.confirmed}`)).toEqual([
    `${TUE} dinner eaten true`,
    `${TUE} lunch swapped true`,
    `${MON} dinner eaten true`,
  ])
  expect(hist.stats).toMatchObject({ meals: 3, cooked: 3, ateOut: 0, proteins: [{ label: 'Chicken', count: 1 }, { label: 'Fish', count: 1 }] })
  const dinnersOnly = await json<HistoryResponse>(devRequest('GET', `/api/history?meal=dinner&recipeId=${curry.id}`))
  expect(dinnersOnly.entries).toHaveLength(1)

  expect(await json(devRequest('GET', `/api/history/recipes/${curry.id}`))).toEqual({ timesMade: 1, lastMade: MON, up: 1, down: 0 })

  // Insights: Claude is mocked; an action pointing at a recipe outside the box is dropped.
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    if (!String(body.system).includes('meal history')) return new Response('no', { status: 503 })
    expect(body.messages[0].content).toContain(`${MON} dinner: ate Butter Chicken 👍`)
    const insights = [
      { text: 'You rated Butter Chicken 👍. Have it again soon.', action: 'recipe', recipe_id: curry.id, idea_query: null },
      { text: 'Lunch was frozen pizza on Tuesday.', action: 'recipe', recipe_id: 'made-up', idea_query: null },
      { text: 'Try a vegetable lunch.', action: 'idea', recipe_id: null, idea_query: 'vegetable lunch' },
    ]
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ insights }) }] })
  })
  vi.stubGlobal('fetch', fetchMock)
  const insightCalls = () => fetchMock.mock.calls.filter(([, init]) => String(init.body).includes('meal history')).length
  const card = await json<InsightsResponse>(devRequest('GET', '/api/history/insights'))
  expect(card).toMatchObject({ weekId: WEEK, source: 'claude', canRefresh: false })
  expect(card.insights).toEqual([
    { text: 'You rated Butter Chicken 👍. Have it again soon.', action: { type: 'recipe', recipeId: curry.id, title: 'Butter Chicken' } },
    { text: 'Lunch was frozen pizza on Tuesday.', action: null },
    { text: 'Try a vegetable lunch.', action: { type: 'idea', query: 'vegetable lunch' } },
  ])
  // Cached for the week, and a refresh the same day does not call Claude again.
  expect(await json<InsightsResponse>(devRequest('POST', '/api/history/insights/refresh', {}))).toEqual(card)
  expect(insightCalls()).toBe(1)

  // No key: the computed facts stand in (next day, so the refresh runs).
  vi.setSystemTime(new Date('2026-11-26T02:00:00Z'))
  env = devEnv(testDb.db)
  const facts = await json<InsightsResponse>(devRequest('POST', '/api/history/insights/refresh', {}))
  expect(facts.source).toBe('facts')
  expect(insightCalls()).toBe(1)
})
