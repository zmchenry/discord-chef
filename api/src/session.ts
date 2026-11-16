import { createMiddleware } from 'hono/factory'
import { parse as parseCookie } from 'hono/utils/cookie'
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'

import type { ErrorResponse } from '../../shared/schema'

// Ported from fire-calculator's api/src/session.ts.
//
// Neither of these is in wrangler.jsonc's `vars`, so `wrangler types` never
// adds them to Env. They are declared by name here, optional, so code has to
// handle their absence, and absence fails closed:
//   ENVIRONMENT     only 'development' (set in the gitignored .dev.vars)
//                   selects the trusting dev provider.
//   ALLOWED_EMAILS  a Worker secret (`wrangler secret put ALLOWED_EMAILS`),
//                   comma-separated. Kept out of the repo because it is
//                   public. Unset or empty allows nobody.
declare global {
  interface Env {
    ENVIRONMENT?: string
    ALLOWED_EMAILS?: string
  }
}

export interface Session {
  // The Access-verified email, lowercased. Doubles as users.id.
  userId: string
}

export interface SessionProvider {
  authenticate(request: Request): Promise<Session | null>
}

export type AppEnv = {
  Bindings: Env
  Variables: { session: Session | null }
}

// Trusts a client-supplied header outright, which would be a critical hole in
// production. index.ts selects this provider only when
// c.env.ENVIRONMENT === 'development'. Every other value, including an
// absent or unrecognised one, gets the Access provider instead.
//
// With no header it signs in as DEV_USER_ID, so the web app (dev server or a
// production build under `wrangler dev`) needs no auth code of its own.
// Tests send the header to act as different users.
export const DEV_USER_ID = 'dev@example.com'

export const localSessionProvider: SessionProvider = {
  async authenticate(request) {
    const userId = request.headers.get('x-dev-user-id')?.trim().toLowerCase()
    return { userId: userId || DEV_USER_ID }
  },
}

// Authenticates nobody, unconditionally. Kept for tests and as the obvious
// thing to swap in if Access is ever misconfigured.
export const denySessionProvider: SessionProvider = {
  async authenticate() {
    return null
  },
}

export const sessionMiddleware = (provider: SessionProvider) =>
  createMiddleware<AppEnv>(async (c, next) => {
    c.set('session', await provider.authenticate(c.req.raw))
    await next()
  })

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.session) {
    const body: ErrorResponse = { error: 'unauthenticated' }
    return c.json(body, 401)
  }
  await next()
})

// "a@example.com, B@example.org" -> ['a@example.com', 'b@example.org']. An empty or missing value
// yields an empty list, which allows nobody.
export function parseAllowedEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export interface AccessConfig {
  teamDomain: string
  policyAud: string
  // Defence in depth behind the Access policy. A token that verifies but
  // carries an email outside this list is rejected. Empty allows nobody.
  allowedEmails: readonly string[]
  // Injected so tests run without network. Production passes the caching fetch.
  fetchJwks: () => Promise<JSONWebKeySet>
}

// Access protects the whole host here, so it injects Cf-Access-Jwt-Assertion
// on every request it proxies. It also sets a CF_Authorization cookie carrying
// the same JWT. The cookie is not a lesser-trusted fallback: it is the same
// token arriving a different way, so both sources feed the identical
// verification below.
const ACCESS_COOKIE_NAME = 'CF_Authorization'

function readAccessToken(request: Request): string | null {
  const header = request.headers.get('Cf-Access-Jwt-Assertion')
  if (header) return header
  const cookieHeader = request.headers.get('Cookie')
  if (!cookieHeader) return null
  return parseCookie(cookieHeader, ACCESS_COOKIE_NAME)[ACCESS_COOKIE_NAME] ?? null
}

// Access rotates signing keys every six weeks, so the key set cannot be
// pinned. Match on the token's kid against the full set rather than trusting
// a single current cert, which can be stale.
export function makeAccessSessionProvider(config: AccessConfig): SessionProvider {
  const allowed = new Set(config.allowedEmails.map((e) => e.toLowerCase()))
  return {
    async authenticate(request) {
      const token = readAccessToken(request)
      if (!token) return null
      try {
        const jwks = createLocalJWKSet(await config.fetchJwks())
        const { payload } = await jwtVerify(token, jwks, {
          issuer: config.teamDomain,
          audience: config.policyAud,
          algorithms: ['RS256'],
          requiredClaims: ['exp'],
        })
        const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
        if (!email || !allowed.has(email)) return null
        return { userId: email }
      } catch {
        return null
      }
    },
  }
}

// createRemoteJWKSet caches per isolate, and Workers evicts isolates far more
// often than a Node process restarts, so the six-week rotation interval is not
// the fetch interval. cf.cacheEverything puts the response in Cloudflare's
// cache so it is shared across isolates in a colo.
export function makeCachingJwksFetcher(
  teamDomain: string,
  fetchImpl: typeof fetch = fetch,
): () => Promise<JSONWebKeySet> {
  const url = `${teamDomain}/cdn-cgi/access/certs`
  return async () => {
    const res = await fetchImpl(url, {
      cf: { cacheTtl: 3600, cacheEverything: true },
    } as RequestInit)
    if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`)
    return (await res.json()) as JSONWebKeySet
  }
}
