import { afterEach, beforeEach, expect, it } from 'vitest'

import { call, devEnv } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

let testDb: TestDb
beforeEach(async () => {
  testDb = await createTestDb()
})
afterEach(async () => {
  await testDb.dispose()
})

const post = (site: string | null) =>
  new Request('https://chef.zmchenry.com/api/weeks/2026-11-22/shopping/generate', {
    method: 'POST',
    headers: { 'x-dev-user-id': 'zach@example.com', 'content-type': 'text/plain', ...(site ? { 'Sec-Fetch-Site': site } : {}) },
    body: '{}',
  })

it('refuses writes from other sites, allows the app itself', async () => {
  const env = devEnv(testDb.db)
  expect((await call(env, post('cross-site'))).status).toBe(403)
  expect((await call(env, post('same-site'))).status).toBe(403)
  expect((await call(env, post('same-origin'))).status).not.toBe(403)
})
