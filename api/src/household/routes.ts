import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'

import { householdMembersSchema, type HouseholdMembers } from '../../../shared/household'
import type { ErrorResponse } from '../../../shared/schema'
import { requireSession, type AppEnv } from '../session'
import { getMembers, saveMembers } from './db'

// Household members: who eats at home, their portion and usual meals.
// Mounted under /api by index.ts.

const household = new Hono<AppEnv>()
household.use('/settings/household-members', requireSession)

household.get('/settings/household-members', async (c) =>
  c.json<HouseholdMembers>({ members: await getMembers(c.env.DB) }),
)

household.put(
  '/settings/household-members',
  zValidator('json', householdMembersSchema, (r, c) => {
    if (!r.success) return c.json({ error: 'invalid', issues: r.error.issues } satisfies ErrorResponse, 400)
  }),
  async (c) => c.json<HouseholdMembers>({ members: await saveMembers(c.env.DB, c.req.valid('json').members) }),
)

export { household as householdRoutes }
