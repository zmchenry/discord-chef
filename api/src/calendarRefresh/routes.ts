import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { ZodTypeAny } from 'zod'

import {
  calendarRefreshInputSchema,
  dismissClashInputSchema,
  type CalendarRefreshResponse,
} from '../../../shared/calendarRefresh'
import type { ErrorResponse } from '../../../shared/schema'
import { refreshCalendar } from '../planning/calendar'
import { requireSession, type AppEnv } from '../session'
import { dismissClash } from './clashes'

// POST /api/calendar/refresh and POST /api/calendar/clashes/dismiss. Both take
// a JSON body, which keeps them CSRF-safe (see index.ts).

const calendar = new Hono<AppEnv>()
calendar.use('/calendar/*', requireSession)

const validJson = <T extends ZodTypeAny>(schema: T) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) return c.json({ error: 'invalid', issues: r.error.issues } satisfies ErrorResponse, 400)
  })

calendar.post('/calendar/refresh', validJson(calendarRefreshInputSchema), async (c) => {
  const body: CalendarRefreshResponse = await refreshCalendar(c.env.DB)
  return c.json(body)
})

calendar.post('/calendar/clashes/dismiss', validJson(dismissClashInputSchema), async (c) =>
  c.json({ dismissed: await dismissClash(c.env.DB, c.req.valid('json').fingerprint) }),
)

export { calendar as calendarRefreshRoutes }
