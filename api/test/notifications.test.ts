import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_PREFS, type NotificationPref, type NotificationPrefsResponse } from '../../shared/notifications'
import {
  dailyCookingMessage,
  dueNotifications,
  localNow,
  runNotificationCron,
  sentKey,
  weekIdOf,
} from '../src/notifications/cron'
import { b64urlDecode, b64urlEncode, encryptPayload, vapidJwt, type VapidKeys } from '../src/notifications/webpush'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb } from './setup/testDb'

const subtle = crypto.subtle
const utf8 = (s: string) => new TextEncoder().encode(s)

async function makeVapidKeys(): Promise<VapidKeys> {
  const pair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const raw = new Uint8Array((await subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  const jwk = (await subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
  return { publicKey: b64urlEncode(raw), privateKey: jwk.d!, subject: 'mailto:test@example.com' }
}

describe('cron window and dedupe', () => {
  const prefs = (overrides: Partial<Record<string, Partial<NotificationPref>>> = {}): NotificationPref[] =>
    Object.values(DEFAULT_PREFS).map((p) => ({ ...p, ...overrides[p.kind] }))
  const users = new Map([['zach@example.com', prefs()]])

  // [label, UTC instant, expected local date, expected kinds due, prefs, already sent]
  const cases: [string, string, string, string[], NotificationPref[]?, string[]?][] = [
    ['Sat 09:00 EST: plan_week', '2026-11-21T14:00:00Z', '2026-11-21', ['plan_week']],
    ['Sat 09:14 still in window', '2026-11-21T14:14:00Z', '2026-11-21', ['plan_week']],
    ['Sat 09:15 next window', '2026-11-21T14:15:00Z', '2026-11-21', []],
    ['Sat 08:45 window before', '2026-11-21T13:45:00Z', '2026-11-21', []],
    ['Fri 09:00: plan_week is Saturday only', '2026-11-20T14:00:00Z', '2026-11-20', []],
    ['Mon 07:30 EST: daily', '2026-11-16T12:30:00Z', '2026-11-16', ['daily_cooking']],
    ['Sat 07:30 EDT before DST starts', '2026-03-07T12:30:00Z', '2026-03-07', ['daily_cooking']],
    ['Sun 07:30 EDT after DST starts (UTC hour moves)', '2026-03-08T11:30:00Z', '2026-03-08', ['daily_cooking']],
    ['Sun 12:30Z on DST start day is 08:30 EDT', '2026-03-08T12:30:00Z', '2026-03-08', []],
    ['UTC is already tomorrow, NY is not', '2026-11-17T03:30:00Z', '2026-11-16', []],
    ['disabled kind', '2026-11-16T12:30:00Z', '2026-11-16', [], prefs({ daily_cooking: { enabled: false } })],
    ['custom time 18:05', '2026-11-16T23:00:00Z', '2026-11-16', ['daily_cooking'], prefs({ daily_cooking: { localTime: '18:05' } })],
    // DST ends 2026-11-01: 01:30 happens twice. The first run sends, the second is deduped.
    ['01:30 EDT, first pass', '2026-11-01T05:30:00Z', '2026-11-01', ['daily_cooking'], prefs({ daily_cooking: { localTime: '01:30' } })],
    [
      '01:30 EST, repeated hour',
      '2026-11-01T06:30:00Z',
      '2026-11-01',
      [],
      prefs({ daily_cooking: { localTime: '01:30' } }),
      [sentKey('zach@example.com', 'daily_cooking', '2026-11-01')],
    ],
    ['sent yesterday does not block today', '2026-11-16T12:30:00Z', '2026-11-16', ['daily_cooking'], undefined, [sentKey('zach@example.com', 'daily_cooking', '2026-11-15')]],
  ]

  it.each(cases)('%s', (_label, at, date, kinds, p, sent = []) => {
    const now = localNow(new Date(at))
    expect(now.date).toBe(date)
    const due = dueNotifications(now, p ? new Map([['zach@example.com', p]]) : users, new Set(sent))
    expect(due.map((d) => d.kind)).toEqual(kinds)
  })

  it('uses Sunday-start week ids', () => {
    expect(weekIdOf(localNow(new Date('2026-11-21T14:00:00Z')))).toBe('2026-11-15') // Saturday
    expect(weekIdOf(localNow(new Date('2026-11-15T14:00:00Z')))).toBe('2026-11-15') // Sunday
  })

  it('formats the daily message with a thaw line, and skips an empty day', () => {
    const msg = dailyCookingMessage(
      [
        { meal: 'dinner', kind: 'recipe', title: 'Chicken Tikka' },
        { meal: 'breakfast', kind: 'recipe', title: 'Pancakes' },
        { meal: 'lunch', kind: 'leftovers', title: null },
      ],
      ['chicken thighs'],
    )
    expect(msg?.title).toBe('Tonight: Chicken Tikka')
    expect(msg?.body).toBe(
      'Breakfast: Pancakes\nLunch: Leftovers\nDinner: Chicken Tikka\nThaw the chicken thighs tonight for tomorrow.',
    )
    expect(dailyCookingMessage([{ meal: 'dinner', kind: 'skip', title: null }], [])).toBeNull()
  })
})

// A browser's side of Web Push: a P-256 key pair and a 16-byte auth secret,
// plus RFC 8291 decryption written independently of webpush.ts.
async function makeBrowser() {
  const ua = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const uaPublic = new Uint8Array((await subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer)
  const auth = crypto.getRandomValues(new Uint8Array(16))
  const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(
      await subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt, info },
        await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']),
        n * 8,
      ),
    )

  async function decrypt(body: Uint8Array): Promise<string> {
    // The aes128gcm header (RFC 8188 section 2.1): salt, rs, idlen, keyid.
    const salt = body.slice(0, 16)
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096)
    const idlen = body[20]
    expect(idlen).toBe(65)
    const asPublic = body.slice(21, 21 + idlen)
    const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const ecdhParams = { name: 'ECDH', public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm
    const ecdh = new Uint8Array(await subtle.deriveBits(ecdhParams, ua.privateKey, 256))
    const ikm = await hkdf(auth, ecdh, new Uint8Array([...utf8('WebPush: info\0'), ...uaPublic, ...asPublic]), 32)
    const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
    const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)
    const plain = new Uint8Array(
      await subtle.decrypt(
        { name: 'AES-GCM', iv: nonce },
        await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']),
        body.slice(21 + idlen),
      ),
    )
    expect(plain.at(-1)).toBe(2) // last-record delimiter
    return new TextDecoder().decode(plain.slice(0, -1))
  }

  return { p256dh: b64urlEncode(uaPublic), auth: b64urlEncode(auth), decrypt }
}

describe('web push crypto', () => {
  it('encrypts a payload that decrypts per RFC 8291', async () => {
    const browser = await makeBrowser()
    const body = await encryptPayload(utf8('{"title":"hi"}'), browser)
    expect(await browser.decrypt(body)).toBe('{"title":"hi"}')
  })

  it('matches the RFC 8291 appendix A example byte for byte', async () => {
    const asPublic = b64urlDecode('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8')
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
      x: b64urlEncode(asPublic.slice(1, 33)),
      y: b64urlEncode(asPublic.slice(33)),
    }
    const serverKeys = {
      privateKey: await subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
      publicKey: await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
    }
    const body = await encryptPayload(
      utf8('When I grow up, I want to be a watermelon'),
      {
        p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      b64urlDecode('DGv6ra1nlYgDCS1FRnbzlw'),
      serverKeys,
    )
    expect(b64urlEncode(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    )
  })

  it('signs a VAPID JWT that verifies with the public key', async () => {
    const keys = await makeVapidKeys()
    const jwt = await vapidJwt('https://fcm.googleapis.com/fcm/send/abc', keys, 1_000_000)
    const [h, c, s] = jwt.split('.')
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(c)))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1_000_000 + 12 * 3600,
      sub: 'mailto:test@example.com',
    })
    const pub = await subtle.importKey('raw', b64urlDecode(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'verify',
    ])
    expect(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(s), utf8(`${h}.${c}`))).toBe(true)
  })
})

describe('notification routes', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('saves prefs, subscribes, sends a test and drops a gone subscription', async () => {
    const testDb = await createTestDb()
    try {
      const keys = await makeVapidKeys()
      const env: Env = {
        ...devEnv(testDb.db),
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        VAPID_SUBJECT: keys.subject,
      }

      let res = await call(env, devRequest('GET', '/api/notifications/prefs'))
      expect(((await res.json()) as NotificationPrefsResponse).prefs).toEqual(Object.values(DEFAULT_PREFS))

      res = await call(
        env,
        devRequest('PUT', '/api/notifications/prefs', {
          prefs: [{ kind: 'daily_cooking', enabled: false, localTime: '06:45' }],
        }),
      )
      expect(res.status).toBe(200)
      const saved = ((await res.json()) as NotificationPrefsResponse).prefs
      expect(saved.find((p) => p.kind === 'daily_cooking')).toEqual({ kind: 'daily_cooking', enabled: false, localTime: '06:45' })
      expect(saved.find((p) => p.kind === 'plan_week')).toEqual(DEFAULT_PREFS.plan_week)

      res = await call(env, devRequest('GET', '/api/push/public-key'))
      expect(await res.json()).toEqual({ publicKey: env.VAPID_PUBLIC_KEY })

      const { p256dh, auth } = await makeBrowser()
      for (const endpoint of ['https://push.example.com/live', 'https://push.example.com/gone']) {
        res = await call(env, devRequest('POST', '/api/push/subscribe', { endpoint, keys: { p256dh, auth } }))
        expect(res.status).toBe(204)
      }

      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        expect((init.headers as Record<string, string>)['content-encoding']).toBe('aes128gcm')
        return new Response(null, { status: url.endsWith('/gone') ? 410 : 201 })
      })
      vi.stubGlobal('fetch', fetchMock)

      res = await call(env, devRequest('POST', '/api/push/test', {}))
      expect(await res.json()).toEqual({ sent: 1, removed: 1, failed: 0 })
      const { results } = await testDb.db.prepare('SELECT endpoint FROM push_subscriptions').all()
      expect(results).toEqual([{ endpoint: 'https://push.example.com/live' }])

      res = await call(env, devRequest('DELETE', '/api/push/subscribe', { endpoint: 'https://push.example.com/live' }))
      expect(res.status).toBe(204)
      expect((await testDb.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first())?.n).toBe(0)
    } finally {
      await testDb.dispose()
    }
  })
})

describe('notification cron', () => {
  afterEach(() => vi.restoreAllMocks())

  it("sends today's meals with a thaw line once, and nags about next week", async () => {
    const testDb = await createTestDb()
    try {
      const db = testDb.db
      const keys = await makeVapidKeys()
      const env: Env = {
        ...devEnv(db),
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        VAPID_SUBJECT: keys.subject,
      }
      const browser = await makeBrowser()
      await db.batch([
        db.prepare("INSERT INTO users (id, created_at) VALUES ('zach@example.com', 0)"),
        db
          .prepare(
            "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES ('zach@example.com', 'https://push.example.com/a', ?, ?, 0)",
          )
          .bind(browser.p256dh, browser.auth),
        db.prepare(
          "INSERT INTO recipes (id, title, created_at, updated_at) VALUES ('r1', 'Pancakes', 0, 0), ('r2', 'Chicken Tikka', 0, 0), ('r3', 'Shrimp Tacos', 0, 0)",
        ),
        db.prepare(
          "INSERT INTO ingredients (id, name, section, created_at) VALUES (1, 'shrimp', 'Frozen', 0), (2, 'tortillas', 'Bakery', 0)",
        ),
        db.prepare(
          "INSERT INTO recipe_ingredients (recipe_id, position, raw_text, ingredient_id) VALUES ('r3', 0, '1 lb shrimp', 1), ('r3', 1, 'tortillas', 2)",
        ),
        // Saturday is day 6 of the week of Sun 11-15. Its tomorrow is day 0 of the week of 11-22.
        db.prepare("INSERT INTO weeks (id, created_at, updated_at) VALUES ('2026-11-15', 0, 0), ('2026-11-22', 0, 0)"),
        db.prepare(
          "INSERT INTO plan_slots (week_id, day, meal, kind, recipe_id, updated_at) VALUES ('2026-11-15', 6, 'breakfast', 'recipe', 'r1', 0), ('2026-11-15', 6, 'dinner', 'recipe', 'r2', 0), ('2026-11-22', 0, 'dinner', 'recipe', 'r3', 0)",
        ),
      ])

      const sent: unknown[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: RequestInit) => {
          sent.push(JSON.parse(await browser.decrypt(init.body as Uint8Array)))
          return new Response(null, { status: 201 })
        }),
      )
      vi.spyOn(console, 'log').mockImplementation(() => {})

      // Sat 2026-11-21 at 07:30 EST, at 09:00, then 07:30 again (a repeated run).
      for (const at of ['2026-11-21T12:30:00Z', '2026-11-21T14:00:00Z', '2026-11-21T12:30:00Z']) {
        await runNotificationCron(env, Date.parse(at))
      }
      expect(sent).toEqual([
        {
          title: 'Tonight: Chicken Tikka',
          body: 'Breakfast: Pancakes\nDinner: Chicken Tikka\nThaw the shrimp tonight for tomorrow.',
          url: '/week',
          tag: 'daily_cooking',
        },
        {
          title: "Next week isn't planned yet",
          body: '1 of 7 dinners picked for the week of Nov 22. Tap to plan.',
          url: '/week?start=2026-11-22',
          tag: 'plan_week',
        },
      ])
    } finally {
      vi.unstubAllGlobals()
      await testDb.dispose()
    }
  })
})
