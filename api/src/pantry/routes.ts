import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'

import type { ErrorResponse } from '../../../shared/schema'
import { pantryUpdateSchema } from '../../../shared/pantry'
import { requireSession, type AppEnv } from '../session'
import { listPantry, setPantry } from './db'

// Pantry routes, mounted at the app root (index.ts adds the /api prefix).
// The write is a PUT with a JSON body, per the CSRF note in index.ts.

const pantry = new Hono<AppEnv>()

pantry.get('/pantry', requireSession, async (c) => c.json({ items: await listPantry(c.env.DB) }))

pantry.put(
  '/pantry/:ingredientId',
  requireSession,
  zValidator('json', pantryUpdateSchema, (result, c) => {
    if (!result.success) return c.json<ErrorResponse>({ error: 'invalid', issues: result.error.issues }, 400)
  }),
  async (c) => {
    const raw = c.req.param('ingredientId')
    const item = /^\d+$/.test(raw) ? await setPantry(c.env.DB, Number(raw), c.req.valid('json'), c.var.session!.userId) : null
    return item ? c.json(item) : c.json<ErrorResponse>({ error: 'not found' }, 404)
  },
)

export { pantry as pantryRoutes }
