import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { describe, expect, it, vi } from 'vitest'

import { makeAccessSessionProvider, makeCachingJwksFetcher, parseAllowedEmails } from '../src/session'

const TEAM = 'https://example.cloudflareaccess.com'
const AUD = 'test-aud-tag'
const ALLOWED = ['zach@example.com', 'liz@example.com']

async function setup(allowedEmails: string[] = ALLOWED) {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }
  const provider = makeAccessSessionProvider({
    teamDomain: TEAM,
    policyAud: AUD,
    allowedEmails,
    fetchJwks: async () => ({ keys: [jwk] }),
  })
  const sign = (claims: Record<string, unknown>, opts: { aud?: string; iss?: string; exp?: string | number } = {}) =>
    new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(opts.iss ?? TEAM)
      .setAudience(opts.aud ?? AUD)
      .setExpirationTime(opts.exp ?? '1h')
      .sign(privateKey)
  return { provider, sign }
}

const req = (opts: { header?: string; cookie?: string } = {}) => {
  const headers: Record<string, string> = {}
  if (opts.header) headers['Cf-Access-Jwt-Assertion'] = opts.header
  if (opts.cookie) headers['Cookie'] = opts.cookie
  return new Request('https://chef.zmchenry.com/api/me', { headers })
}

describe('accessSessionProvider', () => {
  it('returns the email claim as userId for a valid token', async () => {
    const { provider, sign } = await setup()
    const token = await sign({ email: 'zach@example.com', sub: 'abc' })
    expect(await provider.authenticate(req({ header: token }))).toEqual({ userId: 'zach@example.com' })
  })

  it('accepts the token from the CF_Authorization cookie', async () => {
    const { provider, sign } = await setup()
    const token = await sign({ email: 'liz@example.com' })
    expect(await provider.authenticate(req({ cookie: `a=b; CF_Authorization=${token}` }))).toEqual({
      userId: 'liz@example.com',
    })
  })

  it('lowercases the email before the allowlist check', async () => {
    const { provider, sign } = await setup()
    const token = await sign({ email: 'Zach@Example.com' })
    expect(await provider.authenticate(req({ header: token }))).toEqual({ userId: 'zach@example.com' })
  })

  it('returns null with no token', async () => {
    const { provider } = await setup()
    expect(await provider.authenticate(req())).toBeNull()
  })

  it('returns null when aud does not match the policy', async () => {
    const { provider, sign } = await setup()
    const token = await sign({ email: 'zach@example.com' }, { aud: 'other-aud' })
    expect(await provider.authenticate(req({ header: token }))).toBeNull()
  })

  it('returns null when iss is not the team domain', async () => {
    const { provider, sign } = await setup()
    const token = await sign({ email: 'zach@example.com' }, { iss: 'https://evil.cloudflareaccess.com' })
    expect(await provider.authenticate(req({ header: token }))).toBeNull()
  })

  it('returns null when the signature does not verify', async () => {
    const { provider, sign } = await setup()
    const token = await sign({ email: 'zach@example.com' })
    expect(await provider.authenticate(req({ header: token.slice(0, -2) + 'xx' }))).toBeNull()
  })

  it('returns null for a token signed by a different key with the same kid', async () => {
    const { provider } = await setup()
    const other = await setup()
    const token = await other.sign({ email: 'zach@example.com' })
    expect(await provider.authenticate(req({ header: token }))).toBeNull()
  })

  it('returns null for an expired token', async () => {
    const { provider, sign } = await setup()
    const token = await sign({ email: 'zach@example.com' }, { exp: Math.floor(Date.now() / 1000) - 60 })
    expect(await provider.authenticate(req({ header: token }))).toBeNull()
  })

  it('returns null when the token carries no email claim', async () => {
    const { provider, sign } = await setup()
    const token = await sign({ sub: 'abc' })
    expect(await provider.authenticate(req({ header: token }))).toBeNull()
  })

  it('returns null for a valid token whose email is not allowed', async () => {
    const { provider, sign } = await setup()
    const token = await sign({ email: 'stranger@example.com' })
    expect(await provider.authenticate(req({ header: token }))).toBeNull()
  })

  it('allows nobody when the allowlist is empty', async () => {
    const { provider, sign } = await setup([])
    const token = await sign({ email: 'zach@example.com' })
    expect(await provider.authenticate(req({ header: token }))).toBeNull()
  })

  it('returns null rather than throwing when the JWKS fetch fails', async () => {
    const provider = makeAccessSessionProvider({
      teamDomain: TEAM,
      policyAud: AUD,
      allowedEmails: ALLOWED,
      fetchJwks: async () => {
        throw new Error('down')
      },
    })
    const { sign } = await setup()
    expect(await provider.authenticate(req({ header: await sign({ email: 'zach@example.com' }) }))).toBeNull()
  })
})

describe('parseAllowedEmails', () => {
  it('splits, trims, lowercases and drops empties', () => {
    expect(parseAllowedEmails(' A@example.com, b@Example.org ,,')).toEqual(['a@example.com', 'b@example.org'])
  })
  it('treats a missing value as nobody', () => {
    expect(parseAllowedEmails(undefined)).toEqual([])
  })
})

describe('makeCachingJwksFetcher', () => {
  it('fetches the team certs URL with edge caching and returns the key set', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ keys: [] }))
    const jwks = await makeCachingJwksFetcher(TEAM, fetchImpl as unknown as typeof fetch)()
    expect(jwks).toEqual({ keys: [] })
    expect(fetchImpl).toHaveBeenCalledWith(`${TEAM}/cdn-cgi/access/certs`, {
      cf: { cacheTtl: 3600, cacheEverything: true },
    })
  })

  it('throws on a non-2xx response', async () => {
    const fetchImpl = async () => new Response('nope', { status: 503 })
    await expect(makeCachingJwksFetcher(TEAM, fetchImpl as unknown as typeof fetch)()).rejects.toThrow('503')
  })
})
