// The "Already have" step: items whose ingredient is in the pantry stay on
// the list but sit in a collapsed group at the bottom, out of the counts
// and the store totals. A checked item stays where it is (it is in the cart).

export interface HaveItem {
  // Set by the server from the pantry (shared/pantry.ts haveEnough).
  onHand?: boolean
  checkedAt: number | null
}

export const isAlreadyHave = (item: HaveItem): boolean => !!item.onHand && item.checkedAt === null

export function splitAlreadyHave<T extends HaveItem>(items: readonly T[]): { toBuy: T[]; have: T[] } {
  const toBuy: T[] = []
  const have: T[] = []
  for (const item of items) (isAlreadyHave(item) ? have : toBuy).push(item)
  return { toBuy, have }
}
