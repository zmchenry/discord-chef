// Splitting a week into a weekend trip and a midweek trip. Only used when
// "two trips" is on.

export const MIDWEEK_DAYS = [4, 5, 6] // Thu, Fri, Sat (day 0 is Sunday)

export interface TripItem {
  perishable: boolean
  recipeIds: readonly string[]
}

// An item goes on the midweek trip when it is perishable and every recipe
// that needs it is planned only on Thu-Sat, so it is bought fresh. Everything
// else (pantry items, anything needed earlier in the week, items with no
// recipe) goes on the weekend trip.
export function splitTrips<T extends TripItem>(
  items: readonly T[],
  slots: ReadonlyArray<{ day: number; recipeId: string }>,
): { weekend: T[]; midweek: T[] } {
  const days = new Map<string, number[]>()
  for (const s of slots) days.set(s.recipeId, [...(days.get(s.recipeId) ?? []), s.day])
  const weekend: T[] = []
  const midweek: T[] = []
  for (const item of items) {
    const late =
      item.perishable &&
      item.recipeIds.length > 0 &&
      item.recipeIds.every((r) => {
        const d = days.get(r) ?? []
        return d.length > 0 && d.every((day) => MIDWEEK_DAYS.includes(day))
      })
    ;(late ? midweek : weekend).push(item)
  }
  return { weekend, midweek }
}
