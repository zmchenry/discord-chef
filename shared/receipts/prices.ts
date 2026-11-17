// Which price wins, and what one receipt line says an ingredient costs.

export type PriceSource = 'estimate' | 'manual' | 'receipt'

// A receipt price counts as real for this long after the purchase.
export const RECEIPT_FRESH_MS = 90 * 24 * 60 * 60 * 1000

// How a price is labelled: a stale receipt price is shown (and ranked) as an
// estimate. It stays in use until something better comes along.
export type PriceKind = 'manual' | 'receipt' | 'estimate'

export function priceKind(p: { source: PriceSource; updatedAt: number }, now: number): PriceKind {
  if (p.source === 'receipt') return now - p.updatedAt <= RECEIPT_FRESH_MS ? 'receipt' : 'estimate'
  return p.source
}

// manual > receipt newer than 90 days > estimate > older receipt. Between two
// of the same rank the newer one wins, and on a tie the later candidate (so a
// rescan of the same receipt replaces its prices). null for no candidates.
const RANK = (p: { source: PriceSource; updatedAt: number }, now: number) =>
  p.source === 'manual' ? 3 : p.source === 'estimate' ? 1 : priceKind(p, now) === 'receipt' ? 2 : 0.5

export function pickPrice<T extends { source: PriceSource; updatedAt: number }>(candidates: readonly T[], now: number): T | null {
  let best: T | null = null
  for (const p of candidates) {
    if (!best) best = p
    else {
      const d = RANK(p, now) - RANK(best, now)
      if (d > 0 || (d === 0 && p.updatedAt >= best.updatedAt)) best = p
    }
  }
  return best
}

// --- One line's price -------------------------------------------------------

export interface ReceiptLinePrice {
  priceCents: number
  quantity: number
  unitPriceCents: number | null
  weight: string | null
  size: string | null
}

const WEIGHT = /^\s*(\d+(?:\.\d+)?)\s*(lb|lbs|kg|oz)\b/i

// The price to store for the ingredient. Weighed items: per lb (or kg),
// from the printed unit price or the total over the weight. Otherwise one
// item's price: per package when its size is printed ("16 oz"), else "each".
export function linePrice(l: ReceiptLinePrice): { cents: number; unit: string } {
  const w = l.weight?.match(WEIGHT)
  if (w) {
    const amount = Number(w[1])
    const unit = w[2]!.toLowerCase().replace('lbs', 'lb')
    const per = l.unitPriceCents ?? (amount > 0 ? Math.round(l.priceCents / amount) : l.priceCents)
    return { cents: Math.round(per), unit: `1 ${unit}` }
  }
  const qty = l.quantity > 0 ? l.quantity : 1
  const each = l.unitPriceCents ?? Math.round(l.priceCents / qty)
  const size = l.size?.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30)
  return { cents: each, unit: size || 'each' }
}

// --- Store totals -----------------------------------------------------------

// Adds `fromReceipt` to each store total (shared/shopping/store.ts): how many
// of its priced items have a receipt price newer than 90 days, left out when
// none do. Counts the same items storeTotals does (the unpinned ones).
export function withReceiptCounts<T extends { storeId: number }>(
  totals: readonly T[],
  items: ReadonlyArray<{ ingredientId: number | null; storeId?: number | null }>,
  prices: ReadonlyArray<{ ingredientId: number; storeId: number; source: PriceSource; updatedAt: number }>,
  now: number,
): Array<T & { fromReceipt?: number }> {
  const fresh = new Set(prices.filter((p) => priceKind(p, now) === 'receipt').map((p) => `${p.storeId}:${p.ingredientId}`))
  const ids = items.filter((i) => i.storeId == null && i.ingredientId != null).map((i) => i.ingredientId!)
  return totals.map((t) => {
    const fromReceipt = ids.filter((id) => fresh.has(`${t.storeId}:${id}`)).length
    return fromReceipt ? { ...t, fromReceipt } : t
  })
}
