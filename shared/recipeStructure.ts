import { formatPart } from './shopping/aggregate'

// How a recipe's method and ingredient list are structured for display:
// titled steps, ingredient groups, flavor roles, technique words and amount
// conversions. Pure functions only; the cooking mode and nutrition features
// code against this file too.

// ---------------------------------------------------------------------------
// Steps

// recipes.instructions is a JSON array. Each element is a legacy string or a
// structured step object; everything reads it through parseSteps.
export interface RecipeStep {
  title: string | null // "Brown the sausage" (shown as "Step 1: Brown the sausage")
  text: string // paragraphs separated by "\n\n"
  ingredientRefs: number[] // 0-based positions into the recipe's ingredient list used in this step
}

export function parseSteps(instructions: unknown[]): RecipeStep[] {
  const steps: RecipeStep[] = []
  for (const s of instructions ?? []) {
    if (typeof s === 'string') {
      if (s.trim()) steps.push({ title: null, text: s.trim(), ingredientRefs: [] })
      continue
    }
    if (!s || typeof s !== 'object') continue
    const o = s as Record<string, unknown>
    const text = typeof o.text === 'string' ? o.text.trim() : ''
    const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : null
    if (!text && !title) continue
    const refs = Array.isArray(o.ingredientRefs)
      ? o.ingredientRefs.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0)
      : []
    steps.push({ title, text, ingredientRefs: [...new Set(refs)] })
  }
  return steps
}

export function stepLabel(step: RecipeStep, index: number): string {
  return step.title ? `Step ${index + 1}: ${step.title}` : `Step ${index + 1}`
}

// The step's text split into its paragraphs.
export function stepParagraphs(step: RecipeStep): string[] {
  return step.text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Ingredient groups

// Keeps first-appearance order. Ungrouped items form one group with group
// null, shown with no header.
export function groupIngredients<T extends { group: string | null }>(items: T[]): { group: string | null; items: T[] }[] {
  const groups: { group: string | null; items: T[] }[] = []
  const byName = new Map<string | null, { group: string | null; items: T[] }>()
  for (const item of items) {
    const key = item.group?.trim() || null
    let g = byName.get(key)
    if (!g) {
      g = { group: key, items: [] }
      byName.set(key, g)
      groups.push(g)
    }
    g.items.push(item)
  }
  return groups
}

// ---------------------------------------------------------------------------
// Flavor roles (catalog-level, Claude-estimated, cached per ingredient)

export const FLAVORS = ['salty', 'sweet', 'sour', 'bitter', 'umami', 'spicy', 'pungent', 'fat', 'creamy', 'fresh', 'crunchy'] as const
export type Flavor = (typeof FLAVORS)[number]

const FLAVOR_SET = new Set<string>(FLAVORS)

// A stored flavors value (JSON text, an array or junk) -> at most two known
// flavors.
export function parseFlavors(v: unknown): Flavor[] {
  let arr = v
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v)
    } catch {
      return []
    }
  }
  if (!Array.isArray(arr)) return []
  const out: Flavor[] = []
  for (const f of arr) {
    const k = typeof f === 'string' ? f.trim().toLowerCase() : ''
    if (FLAVOR_SET.has(k) && !out.includes(k as Flavor)) out.push(k as Flavor)
  }
  return out.slice(0, 2)
}

// ---------------------------------------------------------------------------
// Techniques

export interface TechniqueSpan {
  start: number
  end: number
  term: string // the text as written
  key: string // a TECHNIQUES key
}

export const TECHNIQUES: Record<string, { label: string; definition: string }> = {
  saute: { label: 'Sauté', definition: 'Cook quickly in a little fat over medium-high heat, stirring often.' },
  sear: { label: 'Sear', definition: 'Brown the surface over high heat without moving it, for color and flavor.' },
  bake: { label: 'Bake', definition: 'Cook with dry, surrounding heat in the oven.' },
  roast: { label: 'Roast', definition: 'Cook in a hot oven until browned outside and tender inside.' },
  simmer: { label: 'Simmer', definition: 'Cook in liquid just below a boil, with small bubbles breaking gently.' },
  boil: { label: 'Boil', definition: 'Cook in liquid at a full, rolling bubble.' },
  whisk: { label: 'Whisk', definition: 'Beat quickly to blend smooth and work in air.' },
  fold: { label: 'Fold', definition: 'Gently lift and turn a mixture over itself so it keeps its air.' },
  braise: { label: 'Braise', definition: 'Brown first, then cook slowly, covered, in a little liquid.' },
  broil: { label: 'Broil', definition: 'Cook close under the oven’s top heat to brown fast.' },
  deglaze: { label: 'Deglaze', definition: 'Add liquid to a hot pan and scrape up the browned bits.' },
  toast: { label: 'Toast', definition: 'Heat dry until golden and fragrant.' },
  caramelize: { label: 'Caramelize', definition: 'Cook slowly until the natural sugars turn deep golden brown.' },
  blanch: { label: 'Blanch', definition: 'Boil briefly, then cool fast in ice water to stop the cooking.' },
  mince: { label: 'Mince', definition: 'Chop into very small, even pieces.' },
  dice: { label: 'Dice', definition: 'Cut into small, even cubes.' },
  julienne: { label: 'Julienne', definition: 'Cut into thin matchsticks.' },
  marinate: { label: 'Marinate', definition: 'Soak in a seasoned liquid to add flavor before cooking.' },
  reduce: { label: 'Reduce', definition: 'Simmer uncovered so liquid evaporates and the flavor thickens.' },
  rest: { label: 'Rest', definition: 'Let it sit off the heat so juices settle before cutting or serving.' },
  temper: { label: 'Temper', definition: 'Warm something delicate slowly with a little hot liquid so it doesn’t curdle.' },
  poach: { label: 'Poach', definition: 'Cook gently in liquid well below a simmer.' },
  steam: { label: 'Steam', definition: 'Cook over boiling water in the rising steam.' },
  grill: { label: 'Grill', definition: 'Cook over direct high heat on grates.' },
  'stir-fry': { label: 'Stir-fry', definition: 'Cook small pieces fast over very high heat, tossing constantly.' },
}

// One regex source per key. Order matters only for overlaps: stir-fry is
// tried as a whole before anything inside it.
const FORMS: Array<[string, string]> = [
  ['stir-fry', String.raw`stir[- ]?fr(?:y|ies|ied|ying)`],
  ['saute', String.raw`saut[ée](?:e?d|ing|s)?`],
  ['sear', String.raw`sear(?:s|ed|ing)?`],
  ['bake', String.raw`bak(?:e|es|ed|ing)`],
  ['roast', String.raw`roast(?:s|ed|ing)?`],
  ['simmer', String.raw`simmer(?:s|ed|ing)?`],
  ['boil', String.raw`boil(?:s|ed|ing)?`],
  ['whisk', String.raw`whisk(?:s|ed|ing)?`],
  ['fold', String.raw`fold(?:s|ed|ing)?`],
  ['braise', String.raw`brais(?:e|es|ed|ing)`],
  ['broil', String.raw`broil(?:s|ed|ing)?`],
  ['deglaze', String.raw`deglaz(?:e|es|ed|ing)`],
  ['toast', String.raw`toast(?:s|ed|ing)?`],
  ['caramelize', String.raw`carameli[sz](?:e|es|ed|ing)`],
  ['blanch', String.raw`blanch(?:es|ed|ing)?`],
  ['mince', String.raw`minc(?:e|es|ed|ing)`],
  ['dice', String.raw`dic(?:e|es|ed|ing)`],
  ['julienne', String.raw`julienn(?:e|es|ed|ing)`],
  ['marinate', String.raw`marinat(?:e|es|ed|ing)`],
  // "reduce the heat" and "reduced-sodium" are not the technique.
  ['reduce', String.raw`reduc(?:e|es|ed|ing)(?!\s+(?:the\s+)?heat|-)`],
  // "the rest of", "rest of the cheese" are not the technique.
  ['rest', String.raw`(?<!\bthe\s)rest(?:s|ed|ing)?(?!\s+of\b)`],
  ['temper', String.raw`temper(?:s|ed|ing)?`],
  ['poach', String.raw`poach(?:es|ed|ing)?`],
  ['steam', String.raw`steam(?:s|ed|ing)?`],
  ['grill', String.raw`grill(?:s|ed|ing)?`],
]

// A word used as a noun for equipment or an ingredient ("baking soda",
// "roasting pan") is not a technique.
const NOT_BEFORE = String.raw`(?!\s+(?:soda|powder|sheet|sheets|dish|pan|pans|tray|paper|mat|rack|basket|oil)\b)`

const TECHNIQUE_RE = new RegExp(
  FORMS.map(([key, src]) => `(?<${key.replace('-', '_')}>(?<![\\p{L}])${src}(?![\\p{L}])${NOT_BEFORE})`).join('|'),
  'giu',
)

export function findTechniques(text: string): TechniqueSpan[] {
  const spans: TechniqueSpan[] = []
  for (const m of text.matchAll(TECHNIQUE_RE)) {
    const groups = m.groups ?? {}
    const name = Object.keys(groups).find((k) => groups[k] !== undefined)
    if (!name || m.index === undefined) continue
    spans.push({ start: m.index, end: m.index + m[0].length, term: m[0], key: name.replace('_', '-') })
  }
  return spans
}

// ---------------------------------------------------------------------------
// Amounts

const G_PER: Record<string, number> = { lb: 453.592, oz: 28.3495, kg: 1000 }

function roundGrams(g: number): string {
  if (g >= 1000) return `${Math.round(g / 100) / 10} kg`
  if (g >= 100) return `${Math.round(g / 25) * 25} g`
  return `${Math.max(5, Math.round(g / 5) * 5)} g`
}

function gramsToImperial(g: number): string {
  if (g >= 440) return formatPart({ quantity: Math.round((g / G_PER.lb) * 4) / 4, unit: 'lb' })
  const oz = g / G_PER.oz
  return formatPart({ quantity: oz < 4 ? Math.max(0.5, Math.round(oz * 2) / 2) : Math.round(oz), unit: 'oz' })
}

// primary: the amount as written ("1 lb", "2 cloves", "1½ cups").
// secondary: a conversion when useful (lb, oz, kg -> g; g -> oz or lb; cups
// and spoons stay as they are), else null. With no quantity and no unit the
// primary is '', or "to taste" when the note says so.
export function formatAmount(
  quantity: number | null,
  unit: string | null,
  note?: string | null,
): { primary: string; secondary: string | null } {
  if (quantity === null || !(quantity > 0)) {
    if (unit) return { primary: unit === 'pinch' ? 'a pinch' : unit, secondary: null }
    return { primary: note && /\bto taste\b/i.test(note) ? 'to taste' : '', secondary: null }
  }
  const primary = formatPart({ quantity, unit })
  let secondary: string | null = null
  if (unit === 'lb' || unit === 'oz' || unit === 'kg') {
    secondary = unit === 'kg' ? gramsToImperial(quantity * 1000) : roundGrams(quantity * G_PER[unit])
  } else if (unit === 'g') {
    secondary = quantity >= 10 ? gramsToImperial(quantity) : null
  }
  return { primary, secondary }
}
