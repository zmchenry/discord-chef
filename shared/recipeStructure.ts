// STUB (drop at merge): a stand-in for the recipe-presentation feature's
// shared/recipeStructure.ts, written against its contract so cooking mode
// builds and runs until the real file lands.

export interface RecipeStep {
  title: string | null
  text: string
  ingredientRefs: number[]
}

export function parseSteps(instructions: unknown[]): RecipeStep[] {
  return instructions.flatMap((s): RecipeStep[] => {
    if (typeof s === 'string') return s.trim() ? [{ title: null, text: s, ingredientRefs: [] }] : []
    if (s && typeof s === 'object' && typeof (s as RecipeStep).text === 'string') {
      const o = s as Partial<RecipeStep>
      return [{ title: o.title ?? null, text: o.text ?? '', ingredientRefs: Array.isArray(o.ingredientRefs) ? o.ingredientRefs : [] }]
    }
    return []
  })
}

export function stepLabel(step: RecipeStep, index: number): string {
  return step.title ? `Step ${index + 1}: ${step.title}` : `Step ${index + 1}`
}

export function groupIngredients<T extends { group: string | null }>(items: T[]): { group: string | null; items: T[] }[] {
  const out: { group: string | null; items: T[] }[] = []
  for (const item of items) {
    const g = out.find((x) => x.group === item.group)
    if (g) g.items.push(item)
    else out.push({ group: item.group, items: [item] })
  }
  return out
}

export const FLAVORS = ['salty', 'sweet', 'sour', 'bitter', 'umami', 'spicy', 'pungent', 'fat', 'creamy', 'fresh', 'crunchy'] as const
export type Flavor = (typeof FLAVORS)[number]

export interface TechniqueSpan {
  start: number
  end: number
  term: string
  key: string
}

export const TECHNIQUES: Record<string, { label: string; definition: string }> = {
  saute: { label: 'Sauté', definition: 'Cook quickly in a little hot fat, stirring often.' },
  sear: { label: 'Sear', definition: 'Brown the surface over high heat.' },
  bake: { label: 'Bake', definition: 'Cook with dry heat in the oven.' },
  roast: { label: 'Roast', definition: 'Cook in a hot oven until browned.' },
  simmer: { label: 'Simmer', definition: 'Cook just below a boil, with small bubbles.' },
  boil: { label: 'Boil', definition: 'Cook in liquid at a rolling boil.' },
  whisk: { label: 'Whisk', definition: 'Beat quickly to blend in air.' },
  fold: { label: 'Fold', definition: 'Mix gently so the air stays in.' },
  braise: { label: 'Braise', definition: 'Brown, then cook slowly in a little liquid.' },
}

const TECHNIQUE_RE = /\b(saut[eé](?:ing|ed)?|sear(?:ing|ed)?|bak(?:e|ing|ed)|roast(?:ing|ed)?|simmer(?:ing)?|boil(?:ing)?|whisk(?:ing)?|fold(?:ing)?|brais(?:e|ing|ed))(?![\wé])/gi

export function findTechniques(text: string): TechniqueSpan[] {
  const out: TechniqueSpan[] = []
  for (const m of text.matchAll(TECHNIQUE_RE)) {
    const term = m[0]
    const lower = term.toLowerCase().replace('é', 'e')
    const key = Object.keys(TECHNIQUES).find((k) => lower.startsWith(k.slice(0, 4))) ?? lower
    out.push({ start: m.index ?? 0, end: (m.index ?? 0) + term.length, term, key })
  }
  return out
}

const fmt = (n: number) => String(Math.round(n * 100) / 100)

export function formatAmount(quantity: number | null, unit: string | null): { primary: string; secondary: string | null } {
  if (quantity === null) return { primary: unit ?? '', secondary: null }
  const primary = unit ? `${fmt(quantity)} ${unit}` : fmt(quantity)
  const grams = unit === 'lb' ? quantity * 450 : unit === 'oz' ? quantity * 28 : null
  return { primary, secondary: grams ? `${Math.round(grams / 5) * 5} g` : null }
}
