import app from '../src/index'

// No vitest-pool-workers: app.fetch is a plain function over a Request and Env
// is just an object, so a fake Env exercises the real Hono app, including the
// ENVIRONMENT gate in index.ts.

export function prodEnv(db: D1Database, extra: Partial<Record<string, string>> = {}): Env {
  return {
    TEAM_DOMAIN: 'https://example.cloudflareaccess.com',
    POLICY_AUD: 'aud',
    ALLOWED_EMAILS: 'zach@example.com',
    DB: db,
    ...extra,
  } as unknown as Env
}

export function devEnv(db: D1Database): Env {
  return { ...prodEnv(db), ENVIRONMENT: 'development' } as unknown as Env
}

// Goes through localSessionProvider, which trusts x-dev-user-id outright.
export function devRequest(
  method: string,
  path: string,
  body?: unknown,
  userId: string | null = 'zach@example.com',
): Request {
  const headers: Record<string, string> = {}
  if (userId) headers['x-dev-user-id'] = userId
  if (body !== undefined) headers['content-type'] = 'application/json'
  return new Request(`https://chef.zmchenry.com${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export async function call(env: Env, req: Request): Promise<Response> {
  return app.fetch(req, env, {} as ExecutionContext)
}
