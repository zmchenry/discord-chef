import { afterEach, beforeEach, expect, it } from 'vitest'

import { addDays, type CalendarSettings, type WeekView } from '../../shared/planningApi'
import { refreshCalendar } from '../src/planning/calendar'
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

async function json<T>(req: Request): Promise<T> {
  const res = await call(env, req)
  expect(res.status, await res.clone().text()).toBe(200)
  return (await res.json()) as T
}

const WEEK = '2026-11-22'
const TUE = addDays(WEEK, 2)
const FRI = addDays(WEEK, 5)
const compact = (d: string) => d.replaceAll('-', '')

it('lists every event on its day card, and a busy Tuesday evening caps dinner', async () => {
  await json(devRequest('PUT', '/api/settings/calendar', { icalUrl: 'https://calendar.example.com/private-x/basic.ics' }))
  const body = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:soccer',
    'SUMMARY:Soccer',
    `DTSTART;TZID=America/New_York:${compact(TUE)}T153000`,
    `DTEND;TZID=America/New_York:${compact(TUE)}T183000`,
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:dentist',
    'SUMMARY:Dentist',
    `DTSTART;TZID=America/New_York:${compact(TUE)}T100000`,
    `DTEND;TZID=America/New_York:${compact(TUE)}T110000`,
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:trip',
    'SUMMARY:Beach trip',
    `DTSTART;VALUE=DATE:${compact(FRI)}`,
    `DTEND;VALUE=DATE:${compact(addDays(FRI, 2))}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  // A fresh cached copy, so nothing is fetched.
  await env.DB.prepare('INSERT INTO calendar_cache (id, fetched_at, body) VALUES (?1, ?2, ?3)')
    .bind('family', Date.now(), body)
    .run()

  const week = await json<WeekView>(devRequest('GET', `/api/weeks/${WEEK}`))
  const day = (d: string) => week.days.find((x) => x.date === d)!
  expect(day(TUE).events).toEqual([
    { title: 'Dentist', time: '10–11', allDay: false }, // no constraint, still listed
    { title: 'Soccer', time: '3:30–6:30', allDay: false },
  ])
  expect(day(TUE).constraints).toContainEqual(
    expect.objectContaining({ kind: 'max_minutes', minutes: 25, meals: ['dinner'] }),
  )
  expect(day(FRI).events).toEqual([{ title: 'Beach trip', time: 'All day', allDay: true }])
  expect(day(addDays(FRI, 1)).events).toHaveLength(1)
  expect(day(WEEK).events).toEqual([])

  // The settings page reads the same cache: fetched, and no error.
  const status = await json<CalendarSettings>(devRequest('GET', '/api/settings/calendar'))
  expect(status).toMatchObject({ configured: true, host: 'calendar.example.com', error: null })
  expect(status.fetchedAt).not.toBeNull()
  expect(JSON.stringify(status)).not.toContain('private-x')
})

it('says why the feed failed when Google refuses the link', async () => {
  await json(devRequest('PUT', '/api/settings/calendar', { icalUrl: 'https://calendar.example.com/public/basic.ics' }))
  const refused = (async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch
  expect(await refreshCalendar(env.DB, refused)).toEqual({ status: 'error', fetchedAt: null })
  const status = await json<CalendarSettings>(devRequest('GET', '/api/settings/calendar'))
  expect(status.error).toMatch(/Secret address in iCal format/)
})
