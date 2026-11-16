import {
  cleanText,
  normalizeIngredientName,
  normalizeRecipeTitle,
  normalizeTags,
  normalizeUnit,
  parseIngredientLine,
  type Unit,
} from './normalize'
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
}

export type NormalizedRecipeInput = Omit<RecipeInputParsed, 'ingredients'> & {
  ingredients: NormalizedIngredientLine[]
}

// Explicit fields on a line win over what parsing rawText finds. An explicit
// unit outside the fixed set is kept, in the note, rather than dropped.
export function normalizeIngredientLine(line: RecipeInputParsed['ingredients'][number]): NormalizedIngredientLine {
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
  }
}

export function normalizeRecipeInput(input: RecipeInputParsed): NormalizedRecipeInput {
  return {
    ...input,
    title: normalizeRecipeTitle(input.title),
    tags: normalizeTags(input.tags),
    ingredients: input.ingredients.map(normalizeIngredientLine).filter((l) => l.rawText !== ''),
  }
}
