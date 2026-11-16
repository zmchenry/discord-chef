// Naming rules: the single source of truth for how every name in Chef is
// cleaned before it is stored. Pure functions, no dependencies, shared by the
// Worker (which applies them on every write), the web app (previews) and the
// Notion import script.
//
// Every normaliser is idempotent: normalizeX(normalizeX(s)) === normalizeX(s).
// api/test/normalize.test.ts pins that for each one.

// ---------------------------------------------------------------------------
// Text cleaning

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: '-',
  mdash: '-',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  deg: '°',
  eacute: 'é',
  ntilde: 'ñ',
}

// Removes tags and decodes entities (named ones above, and numeric). Runs the
// decode once, so "&amp;amp;" becomes "&amp;", as a browser would show it.
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, ent: string) => {
      if (ent[0] === '#') {
        const code = ent[1].toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
      }
      return NAMED_ENTITIES[ent.toLowerCase()] ?? m
    })
}

// Strip HTML, NFC, straight quotes, dashes to "-", one space between words,
// trimmed. Case is untouched. The base of every rule below.
export function cleanText(s: string): string {
  return stripHtml(s)
    .normalize('NFC')
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[\s\u00A0\u200B\uFEFF]+/g, ' ')
    .trim()
}

// Trailing punctuation that never belongs at the end of a name.
const TRAILING_PUNCT = new Set('.,;:?!\'"-*/\\|~^_+='.split(''))

// Drops trailing whitespace and punctuation, except characters in `keep`.
function stripTrailingPunctuation(s: string, keep = ''): string {
  let end = s.length
  while (end > 0) {
    const c = s[end - 1]
    if (c === ' ' || (TRAILING_PUNCT.has(c) && !keep.includes(c))) end--
    else break
  }
  return s.slice(0, end)
}

// ---------------------------------------------------------------------------
// Title Case

const MINOR_WORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
  'at', 'by', 'in', 'of', 'on', 'to', 'up', 'as', 'via', 'with', 'from',
])

// Acronyms kept upper case even when the whole input is shouted. In mixed
// case input, any 2-4 letter all-caps token is kept as is.
const KNOWN_ACRONYMS = new Set(['BLT', 'BBQ', 'PBJ', 'KFC', 'DIY', 'NY', 'NYC', 'OJ', 'GF', 'DF', 'IPA', 'USA', 'TV'])

// Upper-cases the first letter of a fragment, skipping leading punctuation.
// A fragment that starts with a digit ("1st", "3") is left alone.
function capitalizeFirst(s: string): string {
  return s.replace(/^([^\p{L}\p{N}]*)(\p{L})/u, (_m, pre: string, c: string) => pre + c.toUpperCase())
}

// "reese's" -> "Reese's", "o'neil" -> "O'Neil", "don't" -> "Don't". After an
// apostrophe, capitalise only when a single letter precedes it and at least
// two follow (the Irish/Italian prefix pattern).
function capitalizeWordPart(part: string): string {
  const pieces = part.split("'")
  return pieces
    .map((p, i) => {
      if (i === 0) return capitalizeFirst(p)
      const before = pieces[i - 1].replace(/[^\p{L}]/gu, '')
      return before.length === 1 && i === 1 && p.replace(/[^\p{L}]/gu, '').length >= 2 ? capitalizeFirst(p) : p
    })
    .join("'")
}

const letters = (w: string) => w.replace(/[^\p{L}]/gu, '')

interface TitleCaseOptions {
  // Lower-case MINOR_WORDS that are not first or last (titles, stores).
  // Person names capitalise every word.
  minorWords: boolean
}

function titleCase(s: string, { minorWords }: TitleCaseOptions): string {
  const shouting = !/\p{Ll}/u.test(s)
  const words = s.split(' ').filter(Boolean)
  return words
    .map((word, i) => {
      const core = letters(word)
      const isFirst = i === 0 || /[:.!?]$/.test(words[i - 1])
      const isLast = i === words.length - 1
      const lower = word.toLowerCase()
      if (minorWords && !isFirst && !isLast && MINOR_WORDS.has(letters(lower))) return lower
      if (/^\p{Lu}{2,4}$/u.test(core) && (!shouting || KNOWN_ACRONYMS.has(core))) return word
      // Mixed-case brand-like words (McDonald's, DiGiorno) keep their inner capitals.
      if (!shouting && /^\p{Lu}\p{Ll}+\p{Lu}/u.test(core)) return word
      return lower.split('-').map(capitalizeWordPart).join('-')
    })
    .join(' ')
}

// ---------------------------------------------------------------------------
// Recipe titles

// "  bacon &amp; lettuce sandwiches " -> "Bacon and Lettuce Sandwiches"
// "beef stir-fry" -> "Beef Stir-Fry", "BLT wraps" -> "BLT Wraps"
export function normalizeRecipeTitle(s: string): string {
  const cleaned = stripTrailingPunctuation(cleanText(s), '!)')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/ +/g, ' ')
    .trim()
  return titleCase(cleaned, { minorWords: true })
}

// ---------------------------------------------------------------------------
// Ingredients

export const UNITS = [
  'tsp', 'tbsp', 'cup', 'oz', 'fl oz', 'lb', 'g', 'kg', 'ml', 'l',
  'clove', 'can', 'jar', 'package', 'bunch', 'head', 'slice', 'piece', 'pinch', 'stick',
] as const
export type Unit = (typeof UNITS)[number]

// Case-sensitive spellings first ("T" is a tablespoon, "t" a teaspoon).
const UNIT_CASE_SENSITIVE: Record<string, Unit> = { T: 'tbsp', t: 'tsp', Tb: 'tbsp', TB: 'tbsp', C: 'cup' }

const UNIT_ALIASES: Record<string, Unit> = {}
const addAliases = (unit: Unit, ...aliases: string[]) => {
  for (const a of [unit, ...aliases]) UNIT_ALIASES[a] = unit
}
addAliases('tsp', 'tsps', 'tspn', 'teaspoon', 'teaspoons')
addAliases('tbsp', 'tbsps', 'tbs', 'tbl', 'tbls', 'tablespoon', 'tablespoons')
addAliases('cup', 'c', 'cups')
addAliases('oz', 'ozs', 'ounce', 'ounces')
addAliases('fl oz', 'floz', 'fl. oz', 'fluid ounce', 'fluid ounces', 'fl ounce', 'fl ounces')
addAliases('lb', 'lbs', 'pound', 'pounds')
addAliases('g', 'gr', 'gram', 'grams', 'gs')
addAliases('kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos')
addAliases('ml', 'mls', 'milliliter', 'milliliters', 'millilitre', 'millilitres')
addAliases('l', 'liter', 'liters', 'litre', 'litres')
addAliases('clove', 'cloves')
addAliases('can', 'cans', 'tin', 'tins')
addAliases('jar', 'jars')
addAliases('package', 'packages', 'pkg', 'pkgs', 'packet', 'packets', 'pack', 'packs')
addAliases('bunch', 'bunches')
addAliases('head', 'heads')
addAliases('slice', 'slices')
addAliases('piece', 'pieces', 'pc', 'pcs')
addAliases('pinch', 'pinches')
addAliases('stick', 'sticks')

// A unit spelling (any alias, any case, trailing "." allowed) -> its
// canonical form, or null if it is not one of UNITS.
export function normalizeUnit(s: string): Unit | null {
  const raw = cleanText(s).replace(/\.$/, '')
  if (UNIT_CASE_SENSITIVE[raw]) return UNIT_CASE_SENSITIVE[raw]
  return UNIT_ALIASES[raw.toLowerCase().replace(/\s+/g, ' ')] ?? null
}

const UNICODE_FRACTIONS: Record<string, string> = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅖': '2/5',
  '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
}

// One number: "1 1/2", "1/2", "1.5", ".5" or "2".
const NUM = String.raw`(?:\d+\s+\d+/\d+|\d+/\d+|\d*\.\d+|\d+)`
// A quantity at the start: a number, optionally a range ("2-3", "2 to 3").
const LEADING_QTY = new RegExp(String.raw`^(${NUM})(?:\s*(?:-|to)\s*${NUM})?(?![\d/.])`)
const SIZE_WORDS = /^(extra[- ]large|small|medium|large|jumbo)\b\s*/i

function parseNumber(s: string): number | null {
  const t = s.trim()
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) return Number(mixed[3]) ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) : null
  const frac = t.match(/^(\d+)\/(\d+)$/)
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const round = (n: number) => Math.round(n * 1000) / 1000

// Matches a unit at the start of `s` (one or two words, any alias). Returns
// the unit and the rest of the string after it.
function takeUnit(s: string): { unit: Unit; rest: string } | null {
  const m = s.match(/^([A-Za-z]+\.?)(?:\s+([A-Za-z]+\.?))?/)
  if (!m) return null
  if (m[2]) {
    const two = normalizeUnit(`${m[1]} ${m[2]}`)
    if (two) return { unit: two, rest: s.slice(m[0].length) }
  }
  const one = normalizeUnit(m[1])
  return one ? { unit: one, rest: s.slice(m[1].length) } : null
}

export interface ParsedIngredientLine {
  quantity: number | null
  unit: Unit | null
  // The canonical catalog name (see normalizeIngredientName). Can be '' for
  // a line with no name in it, e.g. "2 cups".
  name: string
  // Parenthetical package sizes and prep notes after a comma, lower case.
  note: string | null
}

// "1 1/2 cups flour, sifted" -> { quantity: 1.5, unit: 'cup', name: 'flour', note: 'sifted' }
// "1 (10oz) can cream of chicken soup" -> { 1, 'can', 'cream of chicken soup', note '10oz' }
// "½ tsp salt" -> { 0.5, 'tsp', 'salt' }, "2-3 cloves garlic" -> { 2, 'clove', 'garlic' }
// "pinch of salt" -> { null, 'pinch', 'salt' }. A unit with no number in front
// is only recognised when followed by "of", so "can opener" stays a name.
export function parseIngredientLine(raw: string): ParsedIngredientLine {
  let s = cleanText(raw)
    .replace(/⁄/g, '/')
    .replace(/(\d)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (_m, d: string, f: string) => `${d} ${UNICODE_FRACTIONS[f]}`)
    .replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (f) => UNICODE_FRACTIONS[f])

  const notes: string[] = []
  s = s.replace(/\(([^()]*)\)/g, (_m, inner: string) => {
    const t = inner.trim()
    if (t) notes.push(t)
    return ' '
  })
  s = s.replace(/ +/g, ' ').trim()

  const comma = s.indexOf(',')
  if (comma >= 0) {
    const after = s.slice(comma + 1).trim()
    if (after) notes.push(after)
    s = s.slice(0, comma).trim()
  }

  let quantity: number | null = null
  let unit: Unit | null = null
  const q = s.match(LEADING_QTY)
  if (q) {
    const n = parseNumber(q[1])
    quantity = n !== null && n > 0 ? round(n) : null
    s = s.slice(q[0].length).trim()
    s = s.replace(/^x\s+/i, '')
    const u = takeUnit(s)
    if (u) {
      unit = u.unit
      s = u.rest.trim()
    }
    const size = s.match(SIZE_WORDS)
    if (size) {
      notes.unshift(size[1].toLowerCase())
      s = s.slice(size[0].length)
    }
  } else {
    const u = takeUnit(s)
    if (u && /^\s*of\s/i.test(u.rest)) {
      unit = u.unit
      s = u.rest.trim()
    }
  }
  s = s.replace(/^of\s+/i, '')

  const note = notes
    .map((n) => stripTrailingPunctuation(n.toLowerCase(), ')'))
    .filter(Boolean)
    .join(', ')
  return { quantity, unit, name: canonicalName(s), note: note || null }
}

function canonicalName(s: string): string {
  return stripTrailingPunctuation(cleanText(s).toLowerCase())
}

// The canonical storage key for an ingredient: lower case, cleaned, with any
// leading quantity/unit, parentheticals and ", prep note" removed.
// "1/2 cup Sour Cream" -> "sour cream". Ingredients are unique by this key.
export function normalizeIngredientName(s: string): string {
  return parseIngredientLine(s).name
}

// Staples are ingredients with is_staple = 1, so they follow the same rule.
export const normalizeStapleName = normalizeIngredientName

// For display: "sour cream" -> "Sour cream".
export function displayIngredientName(canonical: string): string {
  return capitalizeFirst(canonical)
}

// ---------------------------------------------------------------------------
// Tags

export interface TagDef {
  value: string
  label: string
  kind: 'meal' | 'attribute'
}

// The controlled vocabulary. Other tags are allowed, normalised the same way.
export const TAGS: readonly TagDef[] = [
  { value: 'breakfast', label: 'Breakfast', kind: 'meal' },
  { value: 'lunch', label: 'Lunch', kind: 'meal' },
  { value: 'dinner', label: 'Dinner', kind: 'meal' },
  { value: 'snack', label: 'Snack', kind: 'meal' },
  { value: 'healthy', label: 'Healthy', kind: 'attribute' },
  { value: 'protein', label: 'Protein', kind: 'attribute' },
  { value: 'fast', label: 'Fast', kind: 'attribute' },
  { value: 'heavy', label: 'Heavy', kind: 'attribute' },
  { value: 'weekend', label: 'Weekend', kind: 'attribute' },
  { value: 'treat', label: 'Treat', kind: 'attribute' },
  { value: 'leftovers-friendly', label: 'Leftovers-friendly', kind: 'attribute' },
  { value: 'kid-friendly', label: 'Kid-friendly', kind: 'attribute' },
]
export const MEAL_TAGS = TAGS.filter((t) => t.kind === 'meal').map((t) => t.value)

// "Order Out" -> "order-out", "Kid Friendly!" -> "kid-friendly",
// "Crème Brûlée" -> "creme-brulee". Only [a-z0-9-], no leading, trailing or
// doubled hyphens. Can be '' (caller drops it).
export function normalizeTag(s: string): string {
  return cleanText(s)
    .replace(/&/g, ' and ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// Normalise, drop empties and duplicates, keep first-seen order.
export function normalizeTags(raw: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const t of raw) {
    const n = normalizeTag(t)
    if (n) seen.add(n)
  }
  return [...seen]
}

// "leftovers-friendly" -> "Leftovers-friendly", "order-out" -> "Order out".
export function tagLabel(tag: string): string {
  const known = TAGS.find((t) => t.value === tag)
  return known ? known.label : capitalizeFirst(tag.replace(/-/g, ' '))
}

// ---------------------------------------------------------------------------
// Stores, people, sections

// "  whole   foods market " -> "Whole Foods Market", "trader joe's" -> "Trader Joe's"
export function normalizeStoreName(s: string): string {
  return titleCase(stripTrailingPunctuation(cleanText(s), '!)'), { minorWords: true })
}

// "liz  mchenry" -> "Liz Mchenry", "mary-jane o'neil" -> "Mary-Jane O'Neil".
// Every word is capitalised (no minor-word rule). Mixed-case input such as
// "McHenry" keeps its inner capitals.
export function normalizePersonName(s: string): string {
  return titleCase(stripTrailingPunctuation(cleanText(s), ')'), { minorWords: false })
}

export const SECTIONS = [
  'Produce',
  'Bakery',
  'Deli',
  'Meat & Seafood',
  'Dairy & Eggs',
  'Frozen',
  'Pantry',
  'Snacks',
  'Beverages',
  'Household',
  'Health',
] as const
export type Section = (typeof SECTIONS)[number]

// Keyed by the section name squashed to [a-z] ("Fruit/Veg" -> "fruitveg").
const SECTION_SYNONYMS: Record<string, Section> = {}
const addSection = (section: Section, ...synonyms: string[]) => {
  for (const s of [section, ...synonyms]) SECTION_SYNONYMS[sectionKey(s)] = section
}
function sectionKey(s: string): string {
  return cleanText(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '')
}
addSection('Produce', 'Fruit/Veg', 'Fruit & Veg', 'Fruits & Vegetables', 'Fruit', 'Fruits', 'Vegetables', 'Veg', 'Veggies')
addSection('Bakery', 'Bread', 'Breads')
addSection('Deli', 'Deli/Bakery')
addSection('Meat & Seafood', 'Meat', 'Meats', 'Seafood', 'Fish', 'Meat/Seafood', 'Butcher')
addSection('Dairy & Eggs', 'Dairy', 'Eggs', 'Dairy/Eggs')
addSection('Frozen', 'Freezer', 'Frozen Foods')
addSection(
  'Pantry',
  'Non-Perishable', 'Non-Parishable', 'Non-Perishable/Bread', 'Non-Parishable/Bread', 'Nonperishable',
  'Dry Goods', 'Canned Goods', 'Canned', 'Baking', 'Spices',
)
addSection('Snacks', 'Snack', 'Chips', 'Candy')
addSection('Beverages', 'Beverage', 'Drinks', 'Drink')
addSection('Household', 'Home', 'Cleaning', 'Paper Goods', 'Household Items')
addSection('Health', 'Medicine', 'Pharmacy', 'Health & Beauty', 'Personal Care', 'Toiletries')

export class UnknownSectionError extends Error {
  constructor(readonly input: string) {
    super(`unknown store section "${input}": expected one of ${SECTIONS.join(', ')}`)
    this.name = 'UnknownSectionError'
  }
}

// A section name or synonym -> one of SECTIONS, or null if unknown.
export function tryNormalizeSectionName(s: string): Section | null {
  return SECTION_SYNONYMS[sectionKey(s)] ?? null
}

// Like tryNormalizeSectionName, but throws UnknownSectionError.
export function normalizeSectionName(s: string): Section {
  const section = tryNormalizeSectionName(s)
  if (!section) throw new UnknownSectionError(s)
  return section
}
