// Turns a week's planned recipes into one shopping item per ingredient.
// Pure: no I/O. Used by the Worker when it (re)builds a list.

export interface SlotIngredient {
  ingredientId: number | null
  // Canonical (lowercase) name. Used as the key when ingredientId is null.
  name: string
  quantity: number | null
  unit: string | null
  section: string | null
  perishable: boolean
}

export interface AggregateSlot {
  // 0 = the week's Sunday ... 6 = Saturday.
  day: number
  recipeId: string
  // Planned servings / recipe servings. 1 when either is unknown.
  scale?: number
  ingredients: SlotIngredient[]
}

export interface AmountPart {
  quantity: number
  unit: string | null
}

export interface AggregatedItem {
  key: string
  ingredientId: number | null
  name: string
  section: string | null
  perishable: boolean
  // One part per distinct unit, in first-seen order. Empty when no recipe
  // gave a quantity: the item is just listed.
  parts: AmountPart[]
  // Recipes that need this item, first-seen order, no duplicates.
  recipeIds: string[]
}

// The identity of an item across regenerations.
export function itemKey(ingredientId: number | null, name: string): string {
  return ingredientId != null ? `i:${ingredientId}` : `n:${name.trim().toLowerCase()}`
}

const round = (n: number) => Math.round(n * 1000) / 1000

export function aggregate(slots: readonly AggregateSlot[]): AggregatedItem[] {
  const byKey = new Map<string, AggregatedItem>()
  for (const slot of slots) {
    const scale = slot.scale && slot.scale > 0 ? slot.scale : 1
    for (const ing of slot.ingredients) {
      if (!ing.name && ing.ingredientId == null) continue
      const key = itemKey(ing.ingredientId, ing.name)
      let item = byKey.get(key)
      if (!item) {
        item = {
          key,
          ingredientId: ing.ingredientId,
          name: ing.name,
          section: ing.section,
          perishable: ing.perishable,
          parts: [],
          recipeIds: [],
        }
        byKey.set(key, item)
      }
      if (!item.recipeIds.includes(slot.recipeId)) item.recipeIds.push(slot.recipeId)
      if (ing.quantity != null && ing.quantity > 0) {
        const unit = ing.unit || null
        const part = item.parts.find((p) => p.unit === unit)
        if (part) part.quantity = round(part.quantity + ing.quantity * scale)
        else item.parts.push({ quantity: round(ing.quantity * scale), unit })
      }
    }
  }
  return [...byKey.values()]
}

const FRACTIONS: Array<[number, string]> = [
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
]

// 2 -> "2", 1.5 -> "1½", 0.25 -> "¼", 1.1 -> "1.1"
export function formatQuantity(n: number): string {
  const whole = Math.floor(n)
  const frac = n - whole
  if (frac < 0.02) return String(whole)
  if (frac > 0.98) return String(whole + 1)
  const glyph = FRACTIONS.find(([v]) => Math.abs(v - frac) < 0.02)?.[1]
  if (glyph) return whole ? `${whole}${glyph}` : glyph
  return String(Math.round(n * 100) / 100)
}

// Units that read wrong in the singular after a number above one.
const PLURAL: Record<string, string> = {
  cup: 'cups',
  clove: 'cloves',
  can: 'cans',
  jar: 'jars',
  package: 'packages',
  bunch: 'bunches',
  head: 'heads',
  slice: 'slices',
  piece: 'pieces',
  pinch: 'pinches',
  stick: 'sticks',
}

export function formatPart({ quantity, unit }: AmountPart): string {
  const q = formatQuantity(quantity)
  if (!unit) return q
  return `${q} ${quantity > 1 ? (PLURAL[unit] ?? unit) : unit}`
}

// [{1,'cup'},{2,'tbsp'}] -> "1 cup + 2 tbsp". null when there is no amount.
export function formatAmount(parts: readonly AmountPart[]): string | null {
  return parts.length ? parts.map(formatPart).join(' + ') : null
}
