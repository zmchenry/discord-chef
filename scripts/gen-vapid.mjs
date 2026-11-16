#!/usr/bin/env node
// Prints a new VAPID key pair for Web Push, base64url-encoded:
//   VAPID_PUBLIC_KEY   65-byte uncompressed P-256 point
//   VAPID_PRIVATE_KEY  32-byte private scalar
// Paste them into .dev.vars for local use, or `npx wrangler secret put` each.
// Changing the pair invalidates every existing browser subscription.
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
])
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey))
const jwk = await crypto.subtle.exportKey('jwk', privateKey)

console.log(`VAPID_PUBLIC_KEY=${Buffer.from(raw).toString('base64url')}`)
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`)
