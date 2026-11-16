import { cleanText, normalizeRecipeTitle, parseIngredientLine } from '../../../shared/normalize'
import type { RecipeIngredientInput, RecipeInput } from '../../../shared/schema'

// The common middle shape both extractors (JSON-LD and Claude) produce. It is
// loose on purpose: plain strings and minutes, nothing normalised yet.
export interface ScrapedRecipe {
  title: string
  description: string | null
  imageUrl: string | null
  servings: number | null
  prepMinutes: number | null
  cookMinutes: number | null
  totalMinutes: number | null
  ingredients: string[]
  instructions: string[]
  // recipeCategory and keywords, used only to guess tags.
  categories: string[]
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max).trimEnd() : s)

const minutes = (n: number | null) =>
  n !== null && Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 24 * 60) : null

function httpUrl(raw: string | null, base: string): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw, base)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.href.length <= 2000 ? u.href : null
  } catch {
    return null
  }
}

const MEAL_WORDS: [RegExp, string][] = [
  [/\b(breakfast|brunch)\b/, 'breakfast'],
  [/\blunch\b/, 'lunch'],
  [/\b(dinner|supper|main course|main dish|mains?|entree|entrée)\b/, 'dinner'],
]

// Meal tags from recipeCategory/keywords, plus "fast" for 30 minutes or less.
export function guessTags(categories: readonly string[], totalMinutes: number | null): string[] {
  const text = categories.join(' | ').toLowerCase()
  const tags = MEAL_WORDS.filter(([re]) => re.test(text)).map(([, tag]) => tag)
  if (totalMinutes !== null && totalMinutes > 0 && totalMinutes <= 30) tags.push('fast')
  return tags
}

function ingredientRow(line: string): RecipeIngredientInput {
  const rawText = clip(line, 300)
  const p = parseIngredientLine(rawText)
  return {
    rawText,
    ...(p.name ? { name: clip(p.name, 100) } : {}),
    quantity: p.quantity,
    unit: p.unit,
    note: p.note ? clip(p.note, 200) : null,
  }
}

// ScrapedRecipe -> a RecipeInput that passes recipeInputSchema, plus notes
// for the user about anything missing.
export function toDraft(r: ScrapedRecipe, pageUrl: string): { draft: RecipeInput; warnings: string[] } {
  const warnings: string[] = []
  let prep = minutes(r.prepMinutes)
  let cook = minutes(r.cookMinutes)
  const total = minutes(r.totalMinutes) ?? (prep !== null || cook !== null ? (prep ?? 0) + (cook ?? 0) : null)
  if (total !== null && prep === null && cook === null) {
    cook = total
    warnings.push('Only a total time was listed, so it is under Cook min.')
  } else if (total !== null && cook === null && prep !== null && total > prep) {
    cook = total - prep
  } else if (total !== null && prep === null && cook !== null && total > cook) {
    prep = total - cook
  }

  const ingredients = r.ingredients.map(cleanText).filter(Boolean).slice(0, 100).map(ingredientRow)
  const instructions = r.instructions
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 100)
    .map((s) => clip(s, 2000))
  if (!ingredients.length) warnings.push('No ingredients were found.')
  if (!instructions.length) warnings.push('No steps were found.')

  const servings = r.servings !== null && Number.isInteger(r.servings) && r.servings >= 1 && r.servings <= 100 ? r.servings : null
  const description = r.description ? clip(cleanText(r.description), 2000) || null : null

  return {
    draft: {
      title: clip(normalizeRecipeTitle(r.title), 200),
      description,
      sourceUrl: httpUrl(pageUrl, pageUrl),
      imageUrl: httpUrl(r.imageUrl, pageUrl),
      servings,
      prepMinutes: prep,
      cookMinutes: cook,
      instructions,
      tags: guessTags(r.categories, total),
      ingredients,
    },
    warnings,
  }
}
