import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { ZodTypeAny } from 'zod'

import {
  generateIdeasInputSchema,
  ideaStatusInputSchema,
  type GenerateIdeasResponse,
  type IdeaListResponse,
} from '../../../shared/discovery'
import type { ErrorResponse } from '../../../shared/schema'
import { ClaudeError } from '../linkImport/claude'
import { requireSession, type AppEnv } from '../session'
import { findIdeasWithClaude } from './claude'
import { SYSTEM, buildPrompt, cacheKey, cachedIdeas, groupLabel, listIdeas, loadContext, setIdeaStatus, storeIdeas } from './ideas'

// Recipe discovery: the Ideas inbox and the web search that fills it.
// Mounted under /api. Writes take a JSON body or use PATCH (CSRF rule in
// index.ts).

export const NO_KEY = 'Finding ideas needs the Claude API key, and it is not set up yet.'

const discovery = new Hono<AppEnv>()
discovery.use('/ideas', requireSession)
discovery.use('/ideas/*', requireSession)

const fail = (c: Context, status: 400 | 404 | 502 | 503, error: string, issues?: unknown[]) =>
  c.json({ error, ...(issues ? { issues } : {}) } satisfies ErrorResponse, status)
const validJson = <T extends ZodTypeAny>(schema: T) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) return fail(c, 400, 'invalid', r.error.issues)
  })

discovery.get('/ideas', async (c) => c.json({ ideas: await listIdeas(c.env.DB) } satisfies IdeaListResponse))

discovery.post('/ideas/generate', validJson(generateIdeasInputSchema), async (c) => {
  const input = c.req.valid('json')
  const db = c.env.DB
  const now = Date.now()
  const key = cacheKey(input)

  const cached = await cachedIdeas(db, key, now)
  if (cached) return c.json({ ideas: cached, cached: true } satisfies GenerateIdeasResponse)

  const apiKey = c.env.ANTHROPIC_API_KEY
  if (!apiKey) return fail(c, 503, NO_KEY)

  const ctx = await loadContext(db, input)
  if (!ctx) return fail(c, 404, 'not found')

  let found
  try {
    found = await findIdeasWithClaude({ system: SYSTEM, prompt: buildPrompt(ctx, input.count ?? 6), apiKey })
  } catch (err) {
    if (err instanceof ClaudeError) return fail(c, 502, err.message)
    throw err
  }
  if (!found.length) return fail(c, 502, "Couldn't find any recipe pages this time. Try again.")

  const ideas = await storeIdeas(db, key, groupLabel(ctx), found.slice(0, 8), now)
  return c.json({ ideas, cached: false } satisfies GenerateIdeasResponse)
})

discovery.patch('/ideas/:id', validJson(ideaStatusInputSchema), async (c) => {
  const idea = await setIdeaStatus(c.env.DB, c.req.param('id'), c.req.valid('json').status)
  return idea ? c.json(idea) : fail(c, 404, 'not found')
})

export { discovery as discoveryRoutes }
