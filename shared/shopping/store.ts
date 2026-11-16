// Estimated totals per store and the cheapest-store recommendation for one
// trip. A trip is always bought at one store: this never splits items.

export interface PriceRow {
  ingredientId: number
  storeId: number
  cents: number
}

export interface StoreTotal {
  storeId: number
  // Sum of the known prices.
  cents: number
  // Items with a price at this store, out of `total` items on the list.
  priced: number
  total: number
}

// A store's total only counts as comparable when at least this share of
// the list has a price there.
export const MIN_PRICED_SHARE = 0.7

export function storeTotals(
  items: ReadonlyArray<{ ingredientId: number | null }>,
  prices: readonly PriceRow[],
  storeIds: readonly number[],
): StoreTotal[] {
  const byStore = new Map<number, Map<number, number>>()
  for (const p of prices) {
    if (!byStore.has(p.storeId)) byStore.set(p.storeId, new Map())
    byStore.get(p.storeId)!.set(p.ingredientId, p.cents)
  }
  return storeIds.map((storeId) => {
    const table = byStore.get(storeId)
    let cents = 0
    let priced = 0
    for (const item of items) {
      const c = item.ingredientId != null ? table?.get(item.ingredientId) : undefined
      if (c !== undefined) {
        cents += c
        priced++
      }
    }
    return { storeId, cents, priced, total: items.length }
  })
}

// The cheapest store among those with prices for at least 70% of the
// items, or null when no store qualifies (or the list is empty).
export function recommendStore(
  items: ReadonlyArray<{ ingredientId: number | null }>,
  prices: readonly PriceRow[],
): { storeId: number; cents: number } | null {
  if (items.length === 0) return null
  const storeIds = [...new Set(prices.map((p) => p.storeId))].sort((a, b) => a - b)
  let best: { storeId: number; cents: number } | null = null
  for (const t of storeTotals(items, prices, storeIds)) {
    if (t.priced / t.total < MIN_PRICED_SHARE) continue
    if (!best || t.cents < best.cents) best = { storeId: t.storeId, cents: t.cents }
  }
  return best
}
