// Estimated totals per store and the cheapest-store recommendation for one
// trip. A trip is always bought at one store: this never splits items.
//
// The exception is a store pin (ingredients.store_id): turkey that only
// ever comes from Publix. Pinned items cost the same whichever store the
// trip goes to, so stores are compared on unpinned items only, and items
// pinned to another store are listed apart ("Also at Publix").

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

export interface PricedItem {
  ingredientId: number | null
  // The pinned store, null (or absent) for any store.
  storeId?: number | null
}

const unpinned = <T extends PricedItem>(items: readonly T[]) => items.filter((i) => i.storeId == null)

function priceTable(prices: readonly PriceRow[]) {
  const byStore = new Map<number, Map<number, number>>()
  for (const p of prices) {
    if (!byStore.has(p.storeId)) byStore.set(p.storeId, new Map())
    byStore.get(p.storeId)!.set(p.ingredientId, p.cents)
  }
  return byStore
}

// Totals of the unpinned items at each store.
export function storeTotals(
  allItems: readonly PricedItem[],
  prices: readonly PriceRow[],
  storeIds: readonly number[],
): StoreTotal[] {
  const items = unpinned(allItems)
  const byStore = priceTable(prices)
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
  allItems: readonly PricedItem[],
  prices: readonly PriceRow[],
): { storeId: number; cents: number } | null {
  const items = unpinned(allItems)
  if (items.length === 0) return null
  const storeIds = [...new Set(prices.map((p) => p.storeId))].sort((a, b) => a - b)
  let best: { storeId: number; cents: number } | null = null
  for (const t of storeTotals(items, prices, storeIds)) {
    if (t.priced / t.total < MIN_PRICED_SHARE) continue
    if (!best || t.cents < best.cents) best = { storeId: t.storeId, cents: t.cents }
  }
  return best
}

// What the pinned items cost, each at its own store: one total per pinned
// store, in storeIds order.
export function pinnedTotals(
  items: readonly PricedItem[],
  prices: readonly PriceRow[],
  storeIds: readonly number[],
): StoreTotal[] {
  const byStore = priceTable(prices)
  return storeIds.flatMap((storeId) => {
    const mine = items.filter((i) => i.storeId === storeId)
    if (!mine.length) return []
    let cents = 0
    let priced = 0
    for (const item of mine) {
      const c = item.ingredientId != null ? byStore.get(storeId)?.get(item.ingredientId) : undefined
      if (c !== undefined) {
        cents += c
        priced++
      }
    }
    return [{ storeId, cents, priced, total: mine.length }]
  })
}

// A trip's list split for display: what is bought at the trip's store
// (unpinned items and items pinned to it), then one "Also at" group per
// other pinned store, in storeIds order.
export function groupByStore<T extends { storeId?: number | null }>(
  items: readonly T[],
  tripStoreId: number,
  storeIds: readonly number[],
): { main: T[]; also: Array<{ storeId: number; items: T[] }> } {
  const main: T[] = []
  const elsewhere = new Map<number, T[]>()
  for (const item of items) {
    const pin = item.storeId ?? null
    if (pin === null || pin === tripStoreId) main.push(item)
    else elsewhere.set(pin, [...(elsewhere.get(pin) ?? []), item])
  }
  const rank = (id: number) => {
    const i = storeIds.indexOf(id)
    return i < 0 ? storeIds.length + id : i
  }
  const also = [...elsewhere.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([storeId, its]) => ({ storeId, items: its }))
  return { main, also }
}
