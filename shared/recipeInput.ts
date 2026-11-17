import {
  cleanText,
  normalizeIngredientName,
  normalizeRecipeTitle,
  normalizeTags,
  normalizeUnit,
  parseIngredientLine,
  type Unit,
} from './normalize'
import type { StepInput, StructuredRecipeInputParsed } from './recipePresentation'
import type { RecipeInputParsed } from './schema'

// Applies the naming rules in ./normalize to a validated recipe body. The
// Worker runs this on every create and update, and the Notion import script
// should run it too (or simply POST to the API, which does).

export interface NormalizedIngredientLine {
  rawText: string
  // Canonical catalog key. '' when the line names nothing ("2 cups"): such a
  // line is stored with no catalog ingredient.
  name: string
  quantity: number | null
  unit: Unit | null
  note: string | null
  optional: boolean
  // The ingredient group ("egg base"), null when ungrouped.
  group: string | null
}

// A stored step: a plain string, or a titled step with ingredient refs.
export type NormalizedStep = string | { title: string | null; text: string; ingredientRefs: number[] }

export type NormalizedRecipeInput = Omit<RecipeInputParsed, 'ingredients' | 'instructions'> & {
  instructions: NormalizedStep[]
  ingredients: NormalizedIngredientLine[]
}

// A validated body from either recipeInputSchema (plain strings, no groups)
// or structuredRecipeInputSchema (shared/recipePresentation.ts).
type IngredientLineInput = RecipeInputParsed['ingredients'][number] & { group?: string | null }
export type RecipeInputLike = Omit<StructuredRecipeInputParsed, 'ingredients' | 'instructions'> & {
  instructions: Array<string | Exclude<StepInput, string>>
  ingredients: IngredientLineInput[]
}

// Explicit fields on a line win over what parsing rawText finds. An explicit
// unit outside the fixed set is kept, in the note, rather than dropped.
export function normalizeIngredientLine(line: IngredientLineInput): NormalizedIngredientLine {
  const parsed = parseIngredientLine(line.rawText)
  let unit = parsed.unit
  let note = line.note !== null ? cleanText(line.note) || null : parsed.note
  if (line.unit !== null) {
    unit = normalizeUnit(line.unit)
    if (!unit) note = [cleanText(line.unit).toLowerCase(), note].filter(Boolean).join(', ') || null
  }
  return {
    rawText: cleanText(line.rawText),
    name: line.name !== undefined ? normalizeIngredientName(line.name) : parsed.name,
    quantity: line.quantity ?? parsed.quantity,
    unit,
    note,
    optional: line.optional,
    group: line.group ? cleanText(line.group).toLowerCase() || null : null,
  }
}

// Step objects keep their title only when it says something, and their
// ingredient refs only when they point at a line that exists. A step with
// neither title nor refs is stored as a plain string.
function normalizeStep(step: RecipeInputLike['instructions'][number], lineCount: number): NormalizedStep | null {
  if (typeof step === 'string') return step.trim() || null
  const text = step.text.trim()
  if (!text) return null
  const title = step.title ? cleanText(step.title) || null : null
  const refs = [...new Set(step.ingredientRefs ?? [])].filter((n) => n < lineCount)
  return title || refs.length ? { title, text, ingredientRefs: refs } : text
}

export function normalizeRecipeInput(input: RecipeInputLike): NormalizedRecipeInput {
  const ingredients = input.ingredients.map(normalizeIngredientLine).filter((l) => l.rawText !== '')
  return {
    ...input,
    title: normalizeRecipeTitle(input.title),
    tags: normalizeTags(input.tags),
    ingredients,
    instructions: input.instructions
      .map((s) => normalizeStep(s, ingredients.length))
      .filter((s): s is NormalizedStep => s !== null),
  }
}
