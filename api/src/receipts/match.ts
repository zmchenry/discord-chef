// Matching receipt lines ("GV SHRD MOZZ 8OZ") to catalog ingredients
// ("shredded mozzarella cheese") by name. Receipts abbreviate, so a
// receipt word matches a catalog word when it is the same word (plurals
// folded), a prefix of it ("mozz") or its consonant shorthand ("shrd", "bnls"). Lines this cannot
// place go to Claude in one batch (claude.ts).

// Store brands and filler that never name the food.
const NOISE = new Set([
  'gv', 'great', 'value', 'publix', 'px', 'pub', 'ps', 'wm', 'walmart', 'aldi', 'mm', 'marketside', 'freshness', 'guaranteed',
  'simply', 'nature', 'happy', 'farms', 'friendly', 'specially', 'selected', 'millville', 'clancys', 'priano', 'carlini',
  'kirkwood', 'appleton', 'fit', 'active', 'baker', 'bakers', 'corner', 'chef', 'cupboard', 'season', 'choice', 'brand',
  'org', 'organic', 'natural', 'fresh', 'frsh', 'pk', 'pack', 'ct', 'cnt', 'count', 'ea', 'each', 'lb', 'lbs',
  'oz', 'fl', 'gal', 'qt', 'pt', 'kg', 'g', 'ml', 'l', 'the', 'and', 'with', 'w', 'of', 'a', 'bag', 'btl', 'can', 'jar',
  'box', 'pkg', 'family', 'size', 'lg', 'sm', 'reg', 'regular', 'store', 'bulk',
])

// Common receipt shorthand. A value with a space expands to several words.
const EXPAND: Record<string, string> = {
  mozz: 'mozzarella cheese',
  mozzarella: 'mozzarella cheese',
  ched: 'cheddar cheese',
  chdr: 'cheddar cheese',
  cheddar: 'cheddar cheese',
  parm: 'parmesan cheese',
  chs: 'cheese',
  shrd: 'shredded',
  shred: 'shredded',
  bnls: 'boneless',
  sknls: 'skinless',
  chkn: 'chicken',
  chk: 'chicken',
  ckn: 'chicken',
  brst: 'breast',
  bst: 'breast',
  thgh: 'thigh',
  grnd: 'ground',
  bf: 'beef',
  trky: 'turkey',
  tky: 'turkey',
  tom: 'tomato',
  toms: 'tomato',
  pot: 'potato',
  pots: 'potato',
  onn: 'onion',
  yel: 'yellow',
  ylw: 'yellow',
  grn: 'green',
  crm: 'cream',
  sr: 'sour',
  bttr: 'butter',
  btr: 'butter',
  mlk: 'milk',
  whl: 'whole',
  hvy: 'heavy',
  whp: 'whipping',
  wht: 'white',
  brd: 'bread',
  tort: 'tortilla',
  torts: 'tortilla',
  flr: 'flour',
  bnna: 'banana',
  bnns: 'banana',
  avo: 'avocado',
  avoc: 'avocado',
  cil: 'cilantro',
  grlc: 'garlic',
  ltc: 'lettuce',
  rom: 'romaine',
  spin: 'spinach',
  brocc: 'broccoli',
  broc: 'broccoli',
  pep: 'pepper',
  pepr: 'pepper',
  bel: 'bell',
  jal: 'jalapeno',
  lmn: 'lemon',
  lme: 'lime',
  yog: 'yogurt',
  ygrt: 'yogurt',
  pb: 'peanut butter',
  ev: 'extra virgin',
  evoo: 'extra virgin olive oil',
  oo: 'olive oil',
  sce: 'sauce',
  sauc: 'sauce',
  pst: 'pasta',
  spag: 'spaghetti',
  bns: 'beans',
  blk: 'black',
  stk: 'stock',
  brth: 'broth',
  veg: 'vegetable',
}

const VOWELS = /[aeiou]/g

// "tomatoes" -> "tomato", "berries" -> "berry", "beans" -> "bean".
function singular(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (w.length > 4 && w.endsWith('oes')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/'/g, '')
    .split(/[^a-z]+/)
    .filter(Boolean)

// A receipt line's words: no brands, sizes or numbers, shorthand expanded.
export function receiptWords(text: string): string[] {
  const out: string[] = []
  for (const w of words(text)) {
    if (NOISE.has(w) || w.length < 2) continue
    for (const e of (EXPAND[w] ?? w).split(' ')) out.push(singular(e))
  }
  return [...new Set(out)]
}

export const catalogWords = (name: string): string[] => [...new Set(words(name).map(singular))]

// `abbr` as an in-order subsequence of `word` with the same first letter:
// "shrd" in "shredded", "bnls" in "boneless".
function isShorthand(abbr: string, word: string): boolean {
  if (abbr[0] !== word[0]) return false
  let i = 0
  for (const ch of word) if (ch === abbr[i]) i++
  return i === abbr.length
}

export function wordMatches(r: string, c: string): boolean {
  if (r === c) return true
  if (r.length >= 3 && c.startsWith(r)) return true
  // Consonant shorthand only: "shrd" yes, "sore" (vowels) no.
  return r.length >= 3 && r.replace(VOWELS, '').length >= r.length - 1 && isShorthand(r, c)
}

// 0..1: how much of the catalog name the line covers (weighted more) and
// how much of the line the name explains.
export function matchScore(receipt: readonly string[], catalog: readonly string[]): number {
  if (!receipt.length || !catalog.length) return 0
  const cHit = catalog.filter((c) => receipt.some((r) => wordMatches(r, c))).length
  const rHit = receipt.filter((r) => catalog.some((c) => wordMatches(r, c))).length
  const cShare = cHit / catalog.length
  if (cShare < 0.5) return 0
  return 0.6 * cShare + 0.4 * (rHit / receipt.length)
}

export const MATCH_THRESHOLD = 0.6

export interface CatalogEntry {
  id: number
  name: string
}

// The best catalog ingredient for a receipt line, or null under the
// threshold. Ties go to the shorter (more general) name.
export function matchLine(text: string, catalog: readonly CatalogEntry[]): CatalogEntry | null {
  const r = receiptWords(text)
  let best: { entry: CatalogEntry; score: number } | null = null
  for (const entry of catalog) {
    const score = matchScore(r, catalogWords(entry.name))
    if (score < MATCH_THRESHOLD) continue
    if (!best || score > best.score || (score === best.score && entry.name.length < best.entry.name.length)) best = { entry, score }
  }
  return best?.entry ?? null
}
