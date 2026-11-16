import { cleanText } from '../../../shared/normalize'
import type { ScrapedRecipe } from './draft'

// schema.org Recipe extraction from <script type="application/ld+json">.
// A regex scan rather than HTMLRewriter so it runs (and is tested) as a plain
// function over a string.

type Json = unknown
type Node = Record<string, Json>

const SCRIPT_RE = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json\b[^>]*>([\s\S]*?)<\/script\s*>/gi

const isNode = (v: Json): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v)
const asArray = (v: Json): Json[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v])

function hasType(node: Node, type: string): boolean {
  return asArray(node['@type']).some((t) => typeof t === 'string' && t.replace(/^.*[/:]/, '') === type)
}

function parseBlocks(html: string): Json[] {
  const out: Json[] = []
  for (const m of html.matchAll(SCRIPT_RE)) {
    const body = m[1]
      .replace(/^\s*<!--/, '')
      .replace(/-->\s*$/, '')
      .replace(/^\s*\/\/\s*<!\[CDATA\[/, '')
      .replace(/\/\/\s*\]\]>\s*$/, '')
      .trim()
    try {
      out.push(JSON.parse(body))
    } catch {
      // Malformed block: skip it, others on the page may be fine.
    }
  }
  return out
}

// Depth-first through arrays, @graph and mainEntity (the usual wrappers).
function findRecipeNode(v: Json, depth = 0): Node | null {
  if (depth > 6) return null
  for (const item of asArray(v)) {
    if (!isNode(item)) continue
    if (hasType(item, 'Recipe')) return item
    for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage']) {
      const found = findRecipeNode(item[key], depth + 1)
      if (found) return found
    }
  }
  return null
}

const text = (v: Json): string => (typeof v === 'string' ? cleanText(v) : typeof v === 'number' ? String(v) : '')

const strings = (v: Json): string[] => asArray(v).map(text).filter(Boolean)

// "PT1H30M" -> 90, "P0DT45M" -> 45, "PT20M30S" -> 21. Some sites put a bare
// number of minutes in; that is accepted too.
export function parseIsoDuration(v: Json): number | null {
  if (typeof v === 'number') return v >= 0 ? Math.round(v) : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (/^\d+$/.test(s)) return Number(s)
  const m = s.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i)
  if (!m || !(m[1] || m[2] || m[3] || m[4])) return null
  const [d, h, min, sec] = m.slice(1).map((x) => (x ? Number(x) : 0))
  return Math.round(d * 1440 + h * 60 + min + sec / 60)
}

// "4", 4, "Serves 4-6", ["4", "4 servings"] -> 4
export function parseYield(v: Json): number | null {
  for (const item of asArray(v)) {
    const n = typeof item === 'number' ? item : Number(text(item).match(/\d+/)?.[0] ?? NaN)
    if (Number.isInteger(n) && n >= 1 && n <= 100) return n
  }
  return null
}

function imageUrl(v: Json): string | null {
  for (const item of asArray(v)) {
    if (typeof item === 'string' && item.trim()) return item.trim()
    if (isNode(item)) {
      const url = item.url ?? item.contentUrl
      if (typeof url === 'string' && url.trim()) return url.trim()
    }
  }
  return null
}

// A string (maybe with <br>/<p>/newlines), an array of strings, HowToStep
// {text}, HowToSection {itemListElement: [...]}, or an ItemList, nested.
function steps(v: Json, depth = 0): string[] {
  if (depth > 4) return []
  if (typeof v === 'string') {
    return v
      .split(/\r?\n|<br\s*\/?>|<\/p>|<\/li>/i)
      .map(cleanText)
      .filter(Boolean)
  }
  if (Array.isArray(v)) return v.flatMap((item) => steps(item, depth + 1))
  if (!isNode(v)) return []
  if (v.itemListElement !== undefined) return steps(v.itemListElement, depth + 1)
  const t = text(v.text) || text(v.name)
  return t ? [t] : []
}

// The first Recipe in the page's JSON-LD, or null when there is none with at
// least a name and some ingredients or steps.
export function extractJsonLdRecipe(html: string): ScrapedRecipe | null {
  for (const block of parseBlocks(html)) {
    const node = findRecipeNode(block)
    if (!node) continue
    const title = text(node.name) || text(node.headline)
    const ingredients = strings(node.recipeIngredient ?? node.ingredients)
    const instructions = steps(node.recipeInstructions)
    if (!title || (!ingredients.length && !instructions.length)) continue
    return {
      title,
      description: text(node.description) || null,
      imageUrl: imageUrl(node.image),
      servings: parseYield(node.recipeYield),
      prepMinutes: parseIsoDuration(node.prepTime),
      cookMinutes: parseIsoDuration(node.cookTime),
      totalMinutes: parseIsoDuration(node.totalTime),
      ingredients,
      instructions,
      categories: [
        ...strings(node.recipeCategory),
        ...asArray(node.keywords).flatMap((k) => text(k).split(',')).map((s) => s.trim()).filter(Boolean),
      ],
    }
  }
  return null
}
