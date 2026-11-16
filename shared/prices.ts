import { z } from 'zod'

import { isoDateSchema } from './schema'

// POST /api/prices/refresh: estimate prices for every ingredient on a week's
// shopping list(s) that has none yet. weekId defaults to the default
// shopping week. Waits for the estimates; `estimated` is how many prices
// were written (0 with no API key or when nothing was missing).
export const priceRefreshInputSchema = z.object({
  weekId: isoDateSchema.optional(),
})
export type PriceRefreshInput = z.infer<typeof priceRefreshInputSchema>

export const priceRefreshResponseSchema = z.object({
  weekId: isoDateSchema,
  estimated: z.number().int().nonnegative(),
})
export type PriceRefreshResponse = z.infer<typeof priceRefreshResponseSchema>
