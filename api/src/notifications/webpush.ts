// Web Push with no dependencies: a VAPID JWT (RFC 8292, ES256) and an
// aes128gcm-encrypted payload (RFC 8291 over RFC 8188), both via WebCrypto.
//
// Keys are base64url strings in the format the browser and most tools use:
//   VAPID_PUBLIC_KEY   the 65-byte uncompressed P-256 point
//   VAPID_PRIVATE_KEY  the 32-byte private scalar d
//   VAPID_SUBJECT      a mailto: or https: contact URL the push service sees
// Generate a pair with `node scripts/gen-vapid.mjs`. All three are Worker
// secrets (and, locally, .dev.vars), so they are declared here, optional,
// the same way session.ts declares ENVIRONMENT.
declare global {
  interface Env {
    VAPID_PUBLIC_KEY?: string
    VAPID_PRIVATE_KEY?: string
    VAPID_SUBJECT?: string
  }
}

export interface VapidKeys {
  publicKey: string
  privateKey: string
  subject: string
}

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

export function vapidKeysFrom(env: Env): VapidKeys | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null
}

// --- base64url --------------------------------------------------------------

export function b64urlEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const utf8 = (s: string) => new TextEncoder().encode(s)

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

// --- VAPID ------------------------------------------------------------------

async function importVapidPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlDecode(keys.publicKey)
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: b64urlEncode(pub.slice(1, 33)),
      y: b64urlEncode(pub.slice(33, 65)),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

// WebCrypto's ECDSA signature is already raw r||s, which is what JWS ES256 wants.
export async function vapidJwt(endpoint: string, keys: VapidKeys, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = b64urlEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64urlEncode(
    utf8(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: keys.subject })),
  )
  const input = `${header}.${claims}`
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await importVapidPrivateKey(keys),
    utf8(input),
  )
  return `${input}.${b64urlEncode(new Uint8Array(sig))}`
}

// --- RFC 8291 payload encryption ----------------------------------------------

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

const RECORD_SIZE = 4096

// Returns the whole aes128gcm body: salt(16) | rs(4) | idlen(1) | keyid | ciphertext.
// `salt` and `serverKeys` are injectable for tests only.
export async function encryptPayload(
  plaintext: Uint8Array,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
  serverKeys?: CryptoKeyPair,
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(target.p256dh)
  const authSecret = b64urlDecode(target.auth)

  const as =
    serverKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', as.publicKey)) as ArrayBuffer)
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  // workers-types spells this field $public (a reserved-word quirk). The
  // runtime, like every WebCrypto, reads `public`.
  const ecdhParams = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, as.privateKey, 256))

  const ikm = await hkdf(authSecret, ecdhSecret, concat(utf8('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)

  // One record: the plaintext, then the 0x02 last-record delimiter, no padding.
  if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error('push payload too large')
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(plaintext, new Uint8Array([2]))),
  )

  const header = new Uint8Array(16 + 4 + 1)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = asPublic.length
  return concat(header, asPublic, ciphertext)
}

// --- Sending ------------------------------------------------------------------

export interface PushMessage {
  title: string
  body: string
  url?: string
  tag?: string
}

// Resolves to the push service's HTTP status. 201 is success; 404 and 410
// mean the subscription is gone and should be deleted.
export async function sendPush(target: PushTarget, message: PushMessage, keys: VapidKeys): Promise<number> {
  const body = await encryptPayload(utf8(JSON.stringify(message)), target)
  const jwt = await vapidJwt(target.endpoint, keys)
  const res = await fetch(target.endpoint, {
    method: 'POST',
    headers: {
      authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(12 * 3600),
      urgency: 'normal',
    },
    body,
  })
  if (res.status >= 400) {
    console.warn(JSON.stringify({ event: 'push_failed', status: res.status, body: (await res.text()).slice(0, 200) }))
  }
  return res.status
}
