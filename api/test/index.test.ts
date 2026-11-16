import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import worker from '../src/index'
import { call, devEnv, devRequest, prodEnv } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

let testDb: TestDb

beforeEach(async () => {
  testDb = await createTestDb()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await testDb.dispose()
})

describe('GET /api/health', () => {
  it('is public, even in production with no session', async () => {
    const res = await call(prodEnv(testDb.db), new Request('https://chef.zmchenry.com/api/health'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; now: string }
    expect(body.status).toBe('ok')
    expect(Number.isNaN(Date.parse(body.now))).toBe(false)
  })
})

describe('session gate', () => {
  it('401s an authenticated route in production with no Access token', async () => {
    const res = await call(prodEnv(testDb.db), new Request('https://chef.zmchenry.com/api/me'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })

  it('ignores x-dev-user-id outside development', async () => {
    const res = await call(prodEnv(testDb.db), devRequest('GET', '/api/me'))
    expect(res.status).toBe(401)
  })

  it('signs in as the fixed dev user in development when the header is missing', async () => {
    const res = await call(devEnv(testDb.db), devRequest('GET', '/api/me', undefined, null))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'dev@example.com', displayName: null })
  })

  describe('with a real Access JWT in production', () => {
    async function signer() {
      const { publicKey, privateKey } = await generateKeyPair('RS256')
      const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [jwk] })))
      return (email: string) =>
        new SignJWT({ email })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer('https://example.cloudflareaccess.com')
          .setAudience('aud')
          .setExpirationTime('1h')
          .sign(privateKey)
    }
    const meWith = (token: string) =>
      new Request('https://chef.zmchenry.com/api/me', { headers: { 'Cf-Access-Jwt-Assertion': token } })

    it('accepts an allowed email', async () => {
      const sign = await signer()
      const res = await call(prodEnv(testDb.db), meWith(await sign('zach@example.com')))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ email: 'zach@example.com', displayName: null })
    })

    it('fails closed when the ALLOWED_EMAILS secret is unset', async () => {
      const sign = await signer()
      const env = { ...prodEnv(testDb.db), ALLOWED_EMAILS: undefined } as unknown as Env
      const res = await call(env, meWith(await sign('zach@example.com')))
      expect(res.status).toBe(401)
    })

    it('rejects a verified token whose email is not in ALLOWED_EMAILS', async () => {
      const sign = await signer()
      const res = await call(prodEnv(testDb.db), meWith(await sign('stranger@example.com')))
      expect(res.status).toBe(401)
    })
  })
})

describe('GET /api/me', () => {
  it('returns the session email and upserts the user row once', async () => {
    const env = devEnv(testDb.db)
    for (let i = 0; i < 2; i++) {
      const res = await call(env, devRequest('GET', '/api/me', undefined, 'Liz@Example.com'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ email: 'liz@example.com', displayName: null })
    }
    const { results } = await testDb.db.prepare('SELECT id FROM users').all()
    expect(results).toEqual([{ id: 'liz@example.com' }])
  })
})

describe('GET /api/stores', () => {
  it('returns the three seeded stores, default first, with section order', async () => {
    const res = await call(devEnv(testDb.db), devRequest('GET', '/api/stores'))
    expect(res.status).toBe(200)
    const { stores } = (await res.json()) as { stores: Array<{ name: string; isDefault: boolean; sectionOrder: string[] }> }
    expect(stores.map((s) => [s.name, s.isDefault])).toEqual([
      ['Walmart', true],
      ['Aldi', false],
      ['Publix', false],
    ])
    expect(stores[0].sectionOrder).toEqual([
      'Produce', 'Bakery', 'Deli', 'Meat & Seafood', 'Dairy & Eggs', 'Frozen',
      'Pantry', 'Snacks', 'Beverages', 'Household', 'Health',
    ])
  })
})

describe('unknown /api routes', () => {
  it('answer JSON 404, not the SPA', async () => {
    const res = await call(devEnv(testDb.db), devRequest('GET', '/api/nope'))
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

describe('scheduled()', () => {
  it('is a logging no-op for now', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await worker.scheduled(
      { cron: '0 * * * *', scheduledTime: Date.UTC(2026, 10, 15), noRetry() {} } as ScheduledController,
      prodEnv(testDb.db),
      {} as ExecutionContext,
    )
    expect(log).toHaveBeenCalledOnce()
    expect(log.mock.calls[0][0]).toContain('"cron":"0 * * * *"')
    log.mockRestore()
  })
})
