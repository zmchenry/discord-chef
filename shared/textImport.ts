import { z } from 'zod'

import { cleanText } from './normalize'
import { recipeIdSchema, recipeInputSchema } from './schema'

// POST /api/import/text: turn a typed or dictated recipe ("beef chili crisp
// ingredients 1 lb ground beef, chili crisp steps brown the beef...") into an
// unsaved draft, same shape as the link import. With recipeId, the draft is
// that recipe with the spoken ingredients, steps and times merged in.
//
// Errors: 400 for an empty text, 404 for an unknown recipeId.

export const importTextRequestSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  recipeId: recipeIdSchema.optional(),
})
export type ImportTextRequest = z.infer<typeof importTextRequestSchema>

// 'parser': parseRecipeText below. 'claude': cleaned up by a model.
export const textImportSourceSchema = z.enum(['parser', 'claude'])
export type TextImportSource = z.infer<typeof textImportSourceSchema>

export const importTextResponseSchema = z.object({
  draft: recipeInputSchema,
  source: textImportSourceSchema,
  warnings: z.array(z.string()),
})
export type ImportTextResponse = z.infer<typeof importTextResponseSchema>

// ---------------------------------------------------------------------------
// Heuristic parser. Pure and dependency-free so it runs with no API key and
// is table-tested in api/test/textImport.test.ts.

export interface ParsedRecipeText {
  title: string // raw, not yet normalised; '' when none was found
  ingredients: string[]
  steps: string[]
  servings: number | null
  prepMinutes: number | null
  cookMinutes: number | null
  totalMinutes: number | null
  // Meal words spoken as "for dinner" etc: 'breakfast' | 'lunch' | 'dinner' | 'snack'.
  meals: string[]
}

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const FRACTIONS: Record<string, string> = {
  half: '1/2', halves: '1/2', third: '1/3', thirds: '1/3', quarter: '1/4', quarters: '1/4', fourth: '1/4', fourths: '1/4', eighth: '1/8', eighths: '1/8',
}

const ONES_WORD = `(?:${Object.keys(ONES).join('|')})`
// "25", "twenty five", "twenty-five", "seven". A compound needs a tens word.
const CARDINAL = `(?:\\d+|(?:${Object.keys(TENS).join('|')})(?:[ -]${ONES_WORD})?|${ONES_WORD})`
const FRAC_WORD = `(?:${Object.keys(FRACTIONS).join('|')})`

// Words that make "a"/"an" in front of them mean 1 ("a can of beans").
const UNIT_WORDS =
  'teaspoons?|tablespoons?|tsp|tbsp|cups?|ounces?|oz|pounds?|lbs?|grams?|kilos?|kilograms?|liters?|litres?|cloves?|cans?|jars?|packages?|packets?|bunch|bunches|heads?|slices?|pieces?|pinch|pinches|sticks?|handful|dash|splash|bag|bottle|box|stalks?|sprigs?'

function cardinal(s: string): number {
  if (/^\d+$/.test(s)) return Number(s)
  const [a, b] = s.toLowerCase().split(/[ -]/)
  return (TENS[a] ?? ONES[a] ?? 0) + (b ? (ONES[b] ?? 0) : 0)
}

function fraction(count: string, word: string): string {
  const [num, den] = FRACTIONS[word.toLowerCase()].split('/').map(Number)
  const n = /^an?$/i.test(count) ? 1 : cardinal(count)
  // "three quarters" -> 3/4, "two thirds" -> 2/3, "one half" -> 1/2.
  return `${n * num}/${den}`
}

// "two and a half cups" -> "2 1/2 cups", "half a cup" -> "1/2 cup",
// "a quarter teaspoon" -> "1/4 teaspoon", "a dozen eggs" -> "12 eggs",
// "a can of beans" -> "1 can of beans", "twenty five minutes" -> "25 minutes".
export function spokenNumbersToDigits(text: string): string {
  const R = (src: string) => new RegExp(src, 'gi')
  return (
    text
      .replace(R(`\\bhalf an? dozen\\b`), '6')
      .replace(R(`\\b(?:an?|one) dozen\\b`), '12')
      .replace(R(`\\b(${CARDINAL}) dozen\\b`), (_m, n: string) => String(cardinal(n) * 12))
      // whole + fraction: "two and a half", "1 and one quarter", "one and three quarters"
      .replace(
        R(`\\b(${CARDINAL}) and (an?|${CARDINAL}) (${FRAC_WORD})\\b`),
        (_m, whole: string, count: string, word: string) => `${cardinal(whole)} ${fraction(count, word)}`,
      )
      // "half a cup", "half of a cup", "a quarter of a teaspoon"
      .replace(R(`\\b(?:an? )?(half|quarter|third) (?:of )?an? (?=${UNIT_WORDS}|hour)`), (_m, w: string) => `${FRACTIONS[w.toLowerCase()]} `)
      // "a half cup", "three quarters cup", "one third of a cup"
      .replace(R(`\\b(an?|${CARDINAL}) (${FRAC_WORD})(?: of an?)?\\b`), (_m, count: string, word: string) => fraction(count, word))
      .replace(R(`\\bhalf (?=${UNIT_WORDS})`), '1/2 ')
      .replace(R(`\\b${CARDINAL}\\b`), (m) => String(cardinal(m)))
      // "a cup of", "an ounce"
      .replace(R(`\\ban? (?=(?:${UNIT_WORDS})\\b)`), '1 ')
  )
}

// --- markers -----------------------------------------------------------------

// "the ingredients" / "dry ingredients" inside a step is not the marker.
const INGREDIENTS_MARKER =
  /(?<!\b(?:the|all|other|remaining|dry|wet|your|of)\s)\b(?:ingredients? list|ingredients|you(?:'ll| will) need|what you need)\b\s*[:,.-]?/i
const STEPS_MARKER = /\b(?:steps|directions|instructions|method)\b\s*[:,.-]?/i
// With no steps marker, the method starts at "step one", "first", or a
// cooking verb followed by an article ("brown the beef", "heat a pan").
const VERB_PHRASE =
  String.raw`\b(?:preheat|heat|brown|cook|mix|combine|add|stir|bake|boil|put|place|season|whisk|chop|saute|sauté|fry|grill|roast|melt|pour|bring|cut|dice|slice|marinate|toss|blend|simmer|drain|serve|spread|layer|cover|toast)\s+(?:the|a|an|your|it|them|in|everything|all|together|up|over|on|some)\b`
const IMPLICIT_STEPS = new RegExp(String.raw`\b(?:step (?:one|1)|first(?:ly)?|start by|to make it)\b|${VERB_PHRASE}`, 'i')

const MEALS: [RegExp, string][] = [
  [/\b(?:for|as an?|as) (?:breakfast|brunch)\b/i, 'breakfast'],
  [/\b(?:for|as an?|as) lunch\b/i, 'lunch'],
  [/\b(?:for|as an?|as) (?:dinner|supper)\b/i, 'dinner'],
  [/\b(?:for|as an?|as) (?:a )?snack\b/i, 'snack'],
]
const MEAL_PHRASE = /\b(?:for|as an?|as) (?:a )?(?:breakfast|brunch|lunch|dinner|supper|snack)\b/gi

// --- times and servings ------------------------------------------------------

const DURATION = String.raw`(\d+(?:\s+\d+/\d+)?|\d+/\d+|an?)\s*(hours?|hrs?|minutes?|mins?)(?:\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?))?`

function minutesOf(n: string, unit: string, extra?: string): number {
  const parts = n.trim().split(/\s+/)
  let v = 0
  for (const p of parts) {
    if (/^an?$/i.test(p)) v += 1
    else if (p.includes('/')) {
      const [a, b] = p.split('/').map(Number)
      v += b ? a / b : 0
    } else v += Number(p)
  }
  const m = /^h/i.test(unit) ? v * 60 : v
  return Math.round(m + (extra ? Number(extra) : 0))
}

const TIME_PATTERNS: [keyof Pick<ParsedRecipeText, 'prepMinutes' | 'cookMinutes' | 'totalMinutes'>, RegExp][] = [
  ['prepMinutes', new RegExp(String.raw`\bprep(?:aration)?(?: time)?(?: is| of)?\s*:?\s*(?:about |around )?${DURATION}`, 'i')],
  ['cookMinutes', new RegExp(String.raw`\bcook(?:ing)? time(?: is| of)?\s*:?\s*(?:about |around )?${DURATION}`, 'i')],
  [
    'totalMinutes',
    new RegExp(String.raw`\b(?:total time(?: is| of)?|total|takes(?: about| around)?|ready in(?: about| around)?|done in(?: about| around)?)\s*:?\s*${DURATION}`, 'i'),
  ],
]
const SERVINGS = /\b(?:serves|feeds|makes|servings?:?|yields?)\s*(?:about |around )?(\d+)(?:\s*(?:servings|people|portions))?\b|\b(\d+)\s+servings\b/i

// --- splitting helpers -------------------------------------------------------

const STARTS_WITH_QTY = /^(?:\d|[½⅓⅔¼¾⅛])/
const PREP_TAIL =
  /^(?:(?:finely|roughly|thinly|freshly|lightly)\s+)?(?:beaten|chopped|diced|minced|sliced|grated|shredded|melted|softened|divided|drained|rinsed|peeled|crushed|cubed|cooked|optional|to taste|at room temperature|room temperature|or more|plus more.*|for serving|for garnish)$/i
const UNIT_ONLY = new RegExp(`^(?:of|${UNIT_WORDS}|tsps?|tbsps?|c|g|kg|ml|l|fl|lbs?)$`, 'i')

const tidy = (s: string) =>
  cleanText(s)
    .replace(/^(?:and|plus|also|then|some|um+|uh+|okay|ok)\b[\s,]*/i, '')
    .replace(/[\s,;]+(?:and|plus)$/i, '')
    .replace(/^[\s,.;:-]+|[\s,;:-]+$/g, '')
    .trim()

// "1 lb ground beef 2 cups rice" -> two items: a number starts a new item once
// the current one has a real word in it (so "1 can 15 oz beans" stays whole).
function splitOnQuantities(piece: string): string[] {
  const out: string[] = []
  let cur: string[] = []
  let depth = 0
  let hasWord = false
  for (const tok of piece.split(/\s+/).filter(Boolean)) {
    const prev = cur[cur.length - 1] ?? ''
    if (depth === 0 && cur.length && hasWord && STARTS_WITH_QTY.test(tok) && !/^(?:to|-|or|x|about)$/i.test(prev)) {
      out.push(cur.join(' '))
      cur = []
      hasWord = false
    }
    cur.push(tok)
    depth += (tok.match(/\(/g)?.length ?? 0) - (tok.match(/\)/g)?.length ?? 0)
    const word = tok.replace(/[^A-Za-z]/g, '')
    if (word && !UNIT_ONLY.test(word) && !STARTS_WITH_QTY.test(tok)) hasWord = true
  }
  if (cur.length) out.push(cur.join(' '))
  return out
}

// "1 lb beef and 2 cups rice" -> two items, "salt and pepper" stays one.
function splitOnAnd(piece: string): string[] {
  const parts = piece.split(/\s+and\s+/i)
  const out: string[] = [parts[0]]
  for (const p of parts.slice(1)) {
    const last = out[out.length - 1]
    if (STARTS_WITH_QTY.test(last.trim()) && STARTS_WITH_QTY.test(p.trim())) out.push(p)
    else out[out.length - 1] = `${last} and ${p}`
  }
  return out
}

export function splitIngredients(section: string): string[] {
  const out: string[] = []
  // Sentence ends split too, but not "1 lb. beef".
  for (const raw of section.split(/\n|[,;]|(?<!\b(?:lbs?|oz|tsp|tbsp|c|g|pkg|approx))\.(?=\s|$)/i)) {
    const piece = tidy(raw)
    if (!piece) continue
    // ", beaten" / ", chopped" belong to the item before them.
    if (out.length && PREP_TAIL.test(piece)) {
      out[out.length - 1] += `, ${piece.toLowerCase()}`
      continue
    }
    for (const a of splitOnAnd(piece)) for (const q of splitOnQuantities(a)) {
      const item = tidy(q)
      if (item) out.push(item)
    }
  }
  return out
}

const ORDINALS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+'
const STEP_BREAK = new RegExp(
  String.raw`\n|(?<=[.!?])\s+|\bstep (?:${ORDINALS})\b[:.,]?|\b(?:and )?(?:then|next|after that|afterwards|finally|lastly|first(?:ly)?|second(?:ly)?|third(?:ly)?)\b,?`,
  'gi',
)

export function splitSteps(section: string): string[] {
  // Unpunctuated dictation ("boil the pasta melt the butter"): also start a
  // step at each cooking verb.
  const text = /[.!?\n]/.test(section.trim().slice(0, -1)) ? section : section.replace(new RegExp(VERB_PHRASE, 'gi'), '\n$&')
  return text
    .split(STEP_BREAK)
    .map((s) => tidy(s ?? '').replace(/^step\b/i, '').trim())
    .filter((s) => /[a-z]{2,}/i.test(s))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.'))
}

const TITLE_FILLER =
  /^(?:(?:okay|ok|so|um+|uh+|alright|all right|right|hey|this is|here is|here's|the recipe is|a recipe for|recipe for|recipe|title|name|called|my|our|let's make|lets make|how to make)\b[\s,:.-]*)+/i

export function cleanTitle(s: string): string {
  return cleanText(s.split('\n').find((l) => l.trim()) ?? '')
    .replace(MEAL_PHRASE, ' ')
    .replace(TITLE_FILLER, '')
    .replace(/\s+recipe$/i, '')
    .replace(/[\s,.:;-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// --- the parser --------------------------------------------------------------

// The original text's first `n` whitespace-separated words, as written. The
// title comes from the input before numbers were converted, so "one pot
// pasta" keeps its words.
function firstWords(text: string, n: number): string {
  if (n <= 0) return ''
  return text.match(new RegExp(String.raw`^\s*(?:\S+\s+){${n - 1}}\S+`))?.[0] ?? text
}
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length

// `hasTitle: false` (filling an existing recipe): with no "ingredients"
// marker, everything before the steps is ingredients.
export function parseRecipeText(input: string, { hasTitle = true } = {}): ParsedRecipeText {
  const text = input.replace(/\r\n?/g, '\n').trim()
  const meals = MEALS.filter(([re]) => re.test(text)).map(([, m]) => m)

  // Everything but the title works on the text with spoken numbers as digits.
  const digits = spokenNumbersToDigits(text)
  const times: Pick<ParsedRecipeText, 'prepMinutes' | 'cookMinutes' | 'totalMinutes'> = {
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
  }
  for (const [key, re] of TIME_PATTERNS) {
    const m = digits.match(re)
    if (m) times[key] = minutesOf(m[1], m[2], m[3])
  }
  const sm = digits.match(SERVINGS)
  const servings = sm ? Number(sm[1] ?? sm[2]) : null
  // Times and servings said among the ingredients are not ingredients.
  const stripMeta = (s: string) => {
    let out = s
    for (const [, re] of TIME_PATTERNS) out = out.replace(re, ' ')
    return out.replace(SERVINGS, ' ').replace(MEAL_PHRASE, ' ')
  }

  // Head (title) | ingredients | steps.
  let head: string
  let body: string
  const ing = digits.match(INGREDIENTS_MARKER)
  if (ing?.index !== undefined) {
    head = digits.slice(0, ing.index)
    body = digits.slice(ing.index + ing[0].length)
  } else if (!hasTitle) {
    head = ''
    body = digits
  } else {
    // No marker: the first line if it has no numbers, else everything
    // before the first number.
    const nl = digits.indexOf('\n')
    const firstQty = digits.search(/\d/)
    const cut = nl > 0 && (firstQty < 0 || firstQty > nl) ? nl : Math.max(firstQty, 0)
    head = digits.slice(0, cut)
    body = digits.slice(cut)
  }

  let ingredients = body
  let steps = ''
  const marker = body.match(STEPS_MARKER)
  const st = marker ?? body.match(IMPLICIT_STEPS)
  if (st?.index !== undefined) {
    steps = body.slice(st.index + (marker ? st[0].length : 0))
    ingredients = body.slice(0, st.index)
  }

  // The title ends at the first time or servings phrase ("chili serves 4").
  const metaAt = Math.min(
    head.length,
    ...[...TIME_PATTERNS.map(([, re]) => re), SERVINGS].map((re) => {
      const i = head.search(re)
      return i < 0 ? head.length : i
    }),
  )
  const title = cleanTitle(firstWords(text, wordCount(head.slice(0, metaAt))))

  return {
    title,
    ingredients: splitIngredients(stripMeta(ingredients)),
    steps: splitSteps(steps),
    servings: servings !== null && servings >= 1 && servings <= 100 ? servings : null,
    ...times,
    meals,
  }
}
