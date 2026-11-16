import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { ZodTypeAny } from 'zod'

import {
  notificationPrefsInputSchema,
  pushSubscribeInputSchema,
  pushTestInputSchema,
  pushUnsubscribeInputSchema,
  type NotificationPrefsResponse,
  type PushPublicKeyResponse,
} from '../../../shared/notifications'
import type { ErrorResponse } from '../../../shared/schema'
import { requireSession, type AppEnv } from '../session'
import { deleteSubscription, getPrefs, putPrefs, saveSubscription, sendToUsers } from './store'
import { vapidKeysFrom } from './webpush'

// Mounted at '/' under the app's /api base path. Every write takes a JSON
// body or is a DELETE, per the CSRF note in api/src/index.ts.

const validJson = <T extends ZodTypeAny>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) return c.json({ error: 'invalid', issues: result.error.issues } satisfies ErrorResponse, 400)
  })

const notConfigured: ErrorResponse = { error: 'push is not configured (VAPID secrets unset)' }

export const notificationRoutes = new Hono<AppEnv>()
  .get('/push/public-key', requireSession, (c) => {
    const keys = vapidKeysFrom(c.env)
    if (!keys) return c.json(notConfigured, 503)
    return c.json({ publicKey: keys.publicKey } satisfies PushPublicKeyResponse)
  })

  .post('/push/subscribe', requireSession, validJson(pushSubscribeInputSchema), async (c) => {
    const { endpoint, keys } = c.req.valid('json')
    await saveSubscription(c.env.DB, c.var.session!.userId, { endpoint, ...keys })
    return c.body(null, 204)
  })

  .delete('/push/subscribe', requireSession, validJson(pushUnsubscribeInputSchema), async (c) => {
    await deleteSubscription(c.env.DB, c.var.session!.userId, c.req.valid('json').endpoint)
    return c.body(null, 204)
  })

  .post('/push/test', requireSession, validJson(pushTestInputSchema), async (c) => {
    if (!vapidKeysFrom(c.env)) return c.json(notConfigured, 503)
    const result = await sendToUsers(c.env, [c.var.session!.userId], {
      title: 'Chef test',
      body: 'Notifications are working on this device.',
      url: '/more/notifications',
      tag: 'test',
    })
    return c.json(result)
  })

  .get('/notifications/prefs', requireSession, async (c) =>
    c.json({ prefs: await getPrefs(c.env.DB, c.var.session!.userId) } satisfies NotificationPrefsResponse),
  )

  .put('/notifications/prefs', requireSession, validJson(notificationPrefsInputSchema), async (c) => {
    const userId = c.var.session!.userId
    await putPrefs(c.env.DB, userId, c.req.valid('json').prefs)
    return c.json({ prefs: await getPrefs(c.env.DB, userId) } satisfies NotificationPrefsResponse)
  })
