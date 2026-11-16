import { afterEach, beforeEach, expect, it } from 'vitest'

import type { Recipe } from '../../shared/schema'
import { addDays, sundayOf, todayIn, type WeekView } from '../../shared/planningApi'
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

// Next week, so the clash is never on a day already past.
const WEEK = addDays(sundayOf(todayIn()), 7)
const TUE = addDays(WEEK, 2)
const ics = (date: string) =>
  [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:soccer',
    'SUMMARY:Soccer',
    `DTSTART;TZID=America/New_York:${date.replaceAll('-', '')}T173000`,
    `DTEND;TZID=America/New_York:${date.replaceAll('-', '')}T190000`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

it('flags a long dinner on a busy evening, offers a swap, and forgets it on "Keep it"', async () => {
  expect(await json(devRequest('POST', '/api/calendar/refresh', {}))).toEqual({ status: 'none', fetchedAt: null })

  const lasagna = await json<Recipe>(
    devRequest('POST', '/api/recipes', { title: 'Lasagna', tags: ['dinner'], prepMinutes: 30, cookMinutes: 60, ingredients: [] }),
    201,
  )
  await json<Recipe>(
    devRequest('POST', '/api/recipes', { title: 'Tacos', tags: ['dinner'], prepMinutes: 10, cookMinutes: 10, ingredients: [] }),
    201,
  )
  await json(devRequest('PUT', '/api/settings/calendar', { icalUrl: 'https://calendar.example.com/secret/basic.ics' }))
  // A fresh cached copy, so nothing is fetched.
  const fetchedAt = Date.now()
  await env.DB.prepare('INSERT INTO calendar_cache (id, fetched_at, body) VALUES (?1, ?2, ?3)')
    .bind('family', fetchedAt, ics(TUE))
    .run()

  const week = await json<WeekView>(
    devRequest('PUT', `/api/weeks/${WEEK}/slots/${TUE}/dinner`, { kind: 'recipe', recipeId: lasagna.id }),
  )
  expect(week.calendarFetchedAt).toBe(fetchedAt)
  expect(week.clashes).toEqual([
    expect.objectContaining({
      date: TUE,
      meal: 'dinner',
      kind: 'max_minutes',
      reason: 'Soccer 5:30–7 → 25 min or less',
      recipeTitle: 'Lasagna',
      fix: expect.objectContaining({ kind: 'swap', title: 'Tacos' }),
    }),
  ])

  await json(devRequest('POST', '/api/calendar/clashes/dismiss', { fingerprint: week.clashes[0]!.fingerprint }))
  expect((await json<WeekView>(devRequest('GET', `/api/weeks/${WEEK}`))).clashes).toEqual([])
})
