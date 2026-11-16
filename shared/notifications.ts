import { z } from 'zod'

import { notificationKindSchema, type NotificationKind } from './schema'

// Contract for /api/push/* and /api/notifications/*.

export const NOTIFICATION_KINDS = notificationKindSchema.options

// HH:MM, 24-hour, in the household timezone (America/New_York).
export const localTimeSchema = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'expected HH:MM')

export const notificationPrefSchema = z.object({
  kind: notificationKindSchema,
  enabled: z.boolean(),
  // null for list_ready, which is sent when the list is generated, not at a time.
  localTime: localTimeSchema.nullable(),
})
export type NotificationPref = z.infer<typeof notificationPrefSchema>

// Always all three kinds, defaults filled in for any the user never saved.
export const notificationPrefsResponseSchema = z.object({ prefs: z.array(notificationPrefSchema) })
export type NotificationPrefsResponse = z.infer<typeof notificationPrefsResponseSchema>

// PUT replaces the given kinds; kinds left out keep their current value.
export const notificationPrefsInputSchema = z.object({ prefs: z.array(notificationPrefSchema).max(3) })
export type NotificationPrefsInput = z.infer<typeof notificationPrefsInputSchema>

export const DEFAULT_PREFS: Record<NotificationKind, NotificationPref> = {
  plan_week: { kind: 'plan_week', enabled: true, localTime: '09:00' },
  daily_cooking: { kind: 'daily_cooking', enabled: true, localTime: '07:30' },
  list_ready: { kind: 'list_ready', enabled: true, localTime: null },
}

// The shape of PushSubscription.toJSON() in the browser.
export const pushSubscribeInputSchema = z.object({
  endpoint: z.string().url().startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
})
export type PushSubscribeInput = z.infer<typeof pushSubscribeInputSchema>

export const pushUnsubscribeInputSchema = z.object({ endpoint: z.string().url() })
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeInputSchema>

export const pushPublicKeyResponseSchema = z.object({ publicKey: z.string() })
export type PushPublicKeyResponse = z.infer<typeof pushPublicKeyResponseSchema>

// POST /api/push/test takes an empty JSON object (a JSON body keeps it
// CSRF-safe, see api/src/index.ts) and reports per-device results.
export const pushTestInputSchema = z.object({}).strict()
export const pushSendResultSchema = z.object({
  sent: z.number().int(),
  removed: z.number().int(),
  failed: z.number().int(),
})
export type PushSendResult = z.infer<typeof pushSendResultSchema>
