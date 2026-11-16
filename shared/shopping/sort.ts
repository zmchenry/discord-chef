import type { ShoppingSort } from '../schema'

// Ordering a list for the four sorts. Pure, shared by the Worker (initial
// manual order) and the app (what is on screen).

export interface SortableItem {
  ingredientId: number | null
  name: string
  section: string | null
  manualRank: number | null
  checked: boolean
}

// Relative positions in 0..1 (0 = first thing picked up on a trip), averaged
// over past trips at one store. Keys are section names and ingredient ids.
export interface LearnedRanks {
  sections: Record<string, number>
  ingredients: Record<string, number>
}

export const NO_RANKS: LearnedRanks = { sections: {}, ingredients: {} }

// section is null for the single group of the A-Z and My order sorts, and
// for the "Other" group (items with no known section) in the aisle sorts.
export interface ItemGroup<T> {
  section: string | null
  items: T[]
}

const byName = (a: SortableItem, b: SortableItem) => a.name.localeCompare(b.name)

// Checked items sink to the bottom of their group, keeping their order.
function sinkChecked<T extends SortableItem>(items: T[], cmp: (a: T, b: T) => number): T[] {
  return [...items].sort((a, b) => Number(a.checked) - Number(b.checked) || cmp(a, b))
}

export function sortItems<T extends SortableItem>(
  items: readonly T[],
  mode: ShoppingSort,
  store: { sectionOrder: readonly string[] } | null,
  learned: LearnedRanks = NO_RANKS,
): ItemGroup<T>[] {
  if (mode === 'alpha') return [{ section: null, items: sinkChecked([...items], byName) }]
  if (mode === 'manual') {
    const rank = (i: SortableItem) => i.manualRank ?? Number.POSITIVE_INFINITY
    return [{ section: null, items: sinkChecked([...items], (a, b) => rank(a) - rank(b) || byName(a, b)) }]
  }

  const order = store?.sectionOrder ?? []
  // Store order mapped onto the same 0..1 scale as learned ranks, so a
  // learned section and an unlearned one can be compared. Unknown last.
  const storePos = (s: string | null) => {
    const i = s ? order.indexOf(s) : -1
    return i < 0 ? 2 : (i + 0.5) / order.length
  }
  const sectionPos = (s: string | null) =>
    mode === 'smart' && s && learned.sections[s] !== undefined ? learned.sections[s] : storePos(s)

  const groups = new Map<string | null, T[]>()
  for (const item of items) {
    const s = item.section ?? null
    groups.set(s, [...(groups.get(s) ?? []), item])
  }

  const itemPos = (i: SortableItem) =>
    mode === 'smart' && i.ingredientId != null ? (learned.ingredients[String(i.ingredientId)] ?? 2) : 2

  return [...groups.entries()]
    .sort(([a], [b]) => sectionPos(a) - sectionPos(b) || (a ?? '').localeCompare(b ?? ''))
    .map(([section, its]) => ({ section, items: sinkChecked(its, (a, b) => itemPos(a) - itemPos(b) || byName(a, b)) }))
}

export interface CheckEvent {
  listId: number | null
  ingredientId: number | null
  section: string | null
  checkedAt: number
}

// Learns walking order from past check-offs at one store. Each list (trip)
// with at least 3 check-offs gives every event a relative position (first
// = 0, last = 1); positions are averaged per section and per ingredient.
// Nothing is learned until `minTrips` trips have been recorded.
export function learnedRanks(events: readonly CheckEvent[], minTrips = 2): LearnedRanks {
  const trips = new Map<number, CheckEvent[]>()
  for (const e of events) {
    if (e.listId == null) continue
    trips.set(e.listId, [...(trips.get(e.listId) ?? []), e])
  }
  const usable = [...trips.values()].filter((t) => t.length >= 3)
  if (usable.length < minTrips) return { sections: {}, ingredients: {} }

  const sums = { sections: new Map<string, number[]>(), ingredients: new Map<string, number[]>() }
  const add = (m: Map<string, number[]>, k: string, v: number) => m.set(k, [...(m.get(k) ?? []), v])
  for (const trip of usable) {
    const sorted = [...trip].sort((a, b) => a.checkedAt - b.checkedAt)
    sorted.forEach((e, i) => {
      const pos = i / (sorted.length - 1)
      if (e.section) add(sums.sections, e.section, pos)
      if (e.ingredientId != null) add(sums.ingredients, String(e.ingredientId), pos)
    })
  }
  const avg = (m: Map<string, number[]>) =>
    Object.fromEntries([...m].map(([k, v]) => [k, Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000]))
  return { sections: avg(sums.sections), ingredients: avg(sums.ingredients) }
}
