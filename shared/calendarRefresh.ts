import { z } from 'zod'

import { isoDateSchema, mealSchema } from './schema'

// Contract for /api/calendar/* and the clash list in the week view
// (api/src/calendarRefresh). The detection itself is shared/planning/clashes.ts.

export const clashSchema = z.object({
  date: isoDateSchema,
  meal: mealSchema,
  kind: z.enum(['max_minutes', 'eat_out', 'grab_and_go']),
  reason: z.string(),
  recipeId: z.string(),
  recipeTitle: z.string(),
  locked: z.boolean(),
  fingerprint: z.string(),
  fix: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('swap'), recipeId: z.string(), title: z.string() }),
      z.object({ kind: z.literal('eat_out') }),
    ])
    .nullable(),
})
export type ClashWire = z.infer<typeof clashSchema>

// POST /api/calendar/refresh takes {} (a JSON body keeps it CSRF-safe).
export const calendarRefreshInputSchema = z.object({})
export const calendarRefreshResponseSchema = z.object({
  // 'none' when no calendar is configured, 'error' when the fetch failed
  // (fetchedAt is then the last good copy, if any).
  status: z.enum(['none', 'ok', 'error']),
  fetchedAt: z.number().nullable(),
})
export type CalendarRefreshResponse = z.infer<typeof calendarRefreshResponseSchema>

// POST /api/calendar/clashes/dismiss: "Keep it".
export const dismissClashInputSchema = z.object({ fingerprint: z.string().min(1).max(500) })
export const dismissClashResponseSchema = z.object({ dismissed: z.array(z.string()) })
