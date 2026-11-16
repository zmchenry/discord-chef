import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'

import { priceRefreshInputSchema, type PriceRefreshResponse } from '../../../shared/prices'
import type { ErrorResponse } from '../../../shared/schema'
import { defaultShoppingWeek } from '../../../shared/shopping/week'
import { requireSession, type AppEnv } from '../session'
import { estimateWeekPrices } from '../shopping/prices'

// The Shop tab's "Estimate prices" button. Mounted under /api by index.ts.
// JSON body (even just {}) per the CSRF note there. Every field is optional,
// so zValidator alone would accept a cross-site text/plain POST as {}: the
// content-type is checked explicitly.
export const priceRoutes = new Hono<AppEnv>().post(
  '/prices/refresh',
  requireSession,
  async (c, next) => {
    if (!(c.req.header('content-type') ?? '').includes('application/json')) {
      return c.json<ErrorResponse>({ error: 'expected application/json' }, 415)
    }
    await next()
  },
  zValidator('json', priceRefreshInputSchema, (r, c) => {
    if (!r.success) return c.json<ErrorResponse>({ error: 'invalid', issues: r.error.issues }, 400)
  }),
  async (c) => {
    const weekId = c.req.valid('json').weekId ?? defaultShoppingWeek(new Date())
    const written = await estimateWeekPrices(c.env, weekId)
    return c.json<PriceRefreshResponse>({ weekId, estimated: written.length })
  },
)
