import { MEAL_TAGS, TAGS } from '../normalize'
import type { Meal, SlotKind } from '../schema'
import { weekdayOf, type Constraint, type ISODate } from './calendar'

// The planning scorer: auto-fill, recommendations and the week summary.
// Pure and deterministic given `seed`; today's date never enters into it.

export interface Theme {
  weekday: number /* 0=Sun..6=Sat */
  label: string
  tags: string[]
  meals: Meal[]
}

export interface Candidate {
  recipeId: string
  title: string
  tags: string[] // normalized: breakfast/lunch/dinner + attributes
  ingredientIds: string[]
  perishableIngredientIds: string[]
  totalMinutes: number | null // prep + cook
  lastPlanned: ISODate | null // most recent plan date, for recency
  estCostCents: number | null // null until prices exist
  /** Optional id → display name, so reasons can say "Uses cilantro from Mon". */
  ingredientNames?: Record<string, string>
}

export interface DayContext {
  date: ISODate
  theme: Theme | null
  constraints: Constraint[]
}

export interface PlannedSlot {
  date: ISODate
  meal: Meal
  kind: SlotKind // recipe | leftovers | eat_out | skip
  recipeId: string | null
  locked: boolean
  source: 'manual' | 'auto' | 'suggested'
}

export interface ScoredCandidate {
  recipeId: string
  score: number
  reasons: string[] // ≤ 3, user-facing, e.g. "Taco Tuesday", "20 min, fits Soccer"
}

export interface Recommendation {
  date: ISODate
  meal: Meal
  recipeId: string
  replaces: string | null // recipeId currently there, or null for an empty slot
  reason: string // "Reuses peppers and tortillas from Tue"
  savesCents: number | null
}

const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner']
const VOCAB = new Set(TAGS.map((t) => t.value))
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Score weights. Theme is strong but a slow recipe on a busy night or a
// repeat within the week sinks below everything else.
const W = {
  theme: 50,
  fitsTime: 10,
  tooSlow: -60,
  unknownTime: -15,
  grabAndGo: 15,
  slowBreakfast: -30,
  neverPlanned: 6,
  notRecent: 8, // plus one per week, capped
  recent: -20, // planned within the last week
  fairlyRecent: -8, // within 3 weeks
  inWeek: -100,
  shared: 3,
  sharedPerishable: 6,
  sameMainTagAdjacent: -12,
}

// ---------------------------------------------------------------------------
// Helpers

/** FNV-1a then a mulberry32 step: a stable number in [0, 1) per string. */
function seeded(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  let t = (h + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const isFilled = (s: PlannedSlot) => s.kind !== 'recipe' || s.recipeId !== null
const sameSlot = (s: PlannedSlot, date: ISODate, meal: Meal) => s.date === date && s.meal === meal
const mainTags = (c: Candidate) => c.tags.filter((t) => !VOCAB.has(t))

function dayName(date: ISODate): string {
  return DAY_NAMES[weekdayOf(date)]!
}

function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

function constraintsFor(day: DayContext, meal: Meal): Constraint[] {
  return day.constraints.filter((c) => c.meals.includes(meal))
}

/** "Soccer 5:30–7 → 25 min or less" → "Soccer". */
function eventLabel(reason: string): string | null {
  const head = reason.split('→')[0]?.trim() ?? ''
  const label = head.replace(/\s+\d{1,2}(:\d{2})?(\s*[–-]\s*\d{1,2}(:\d{2})?)?$/, '').trim()
  return label || null
}

function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

interface Overlap {
  points: number
  perishables: number
  reason: string | null
}

// Ingredient overlap between `cand` and the recipes already in the week
// (other than the slot being scored), with a reason naming the best match.
function overlapWith(cand: Candidate, others: Array<{ slot: PlannedSlot; recipe: Candidate }>, verb: string): Overlap {
  const mine = new Set(cand.ingredientIds)
  const perishable = new Set(cand.perishableIngredientIds)
  const seen = new Set<string>()
  let points = 0
  let best: { slot: PlannedSlot; recipe: Candidate; ids: string[]; perishables: number } | null = null
  for (const o of others) {
    if (o.recipe.recipeId === cand.recipeId) continue
    const ids = o.recipe.ingredientIds.filter((id) => mine.has(id))
    const p = ids.filter((id) => perishable.has(id)).length
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      points += perishable.has(id) ? W.sharedPerishable : W.shared
    }
    if (ids.length && (!best || p > best.perishables || (p === best.perishables && ids.length > best.ids.length))) {
      best = { ...o, ids, perishables: p }
    }
  }
  const perishables = [...seen].filter((id) => perishable.has(id)).length
  if (!best) return { points, perishables, reason: null }
  const names = cand.ingredientNames ?? best.recipe.ingredientNames ?? {}
  const preferred = [...best.ids].sort((a, b) => Number(perishable.has(b)) - Number(perishable.has(a)))
  const named = preferred.map((id) => names[id]).filter((n): n is string => !!n).slice(0, 2)
  const day = dayName(best.slot.date)
  const reason = named.length
    ? `${verb} ${listNames(named)} from ${day}`
    : best.perishables > 0
      ? `${verb} fresh ingredients from ${day}'s ${best.recipe.title}`
      : `Shares ${best.ids.length} ingredient${best.ids.length === 1 ? '' : 's'} with ${day}'s ${best.recipe.title}`
  return { points, perishables, reason }
}

function weekRecipes(week: PlannedSlot[], byId: Map<string, Candidate>, except?: { date: ISODate; meal: Meal }) {
  const out: Array<{ slot: PlannedSlot; recipe: Candidate }> = []
  for (const slot of week) {
    if (slot.kind !== 'recipe' || !slot.recipeId) continue
    if (except && sameSlot(slot, except.date, except.meal)) continue
    const recipe = byId.get(slot.recipeId)
    if (recipe) out.push({ slot, recipe })
  }
  return out
}

// ---------------------------------------------------------------------------
// Scoring

/** Rank candidates for one slot. Terms: meal-type tag fit (hard requirement: a recipe
 *  needs the slot's meal tag, unless it has no meal tags at all), theme (strong boost,
 *  never a filter), constraints (max_minutes penalises slow recipes heavily;
 *  eat_out/skip slots return []), recency (not planned in the last 3 weeks gets a boost;
 *  already in this week, a big penalty), ingredient overlap with recipes already in the
 *  week (perishables count double), and variety (penalise the same main tag on adjacent
 *  days). The seed only breaks ties. */
export function scoreCandidates(args: {
  date: ISODate
  meal: Meal
  day: DayContext
  week: PlannedSlot[]
  candidates: Candidate[]
  seed: string
}): ScoredCandidate[] {
  const { date, meal, day, week, candidates, seed } = args
  const current = week.find((s) => sameSlot(s, date, meal))
  if (current && (current.kind === 'eat_out' || current.kind === 'skip')) return []
  const cons = constraintsFor(day, meal)
  if (cons.some((c) => c.kind === 'eat_out')) return []

  const byId = new Map(candidates.map((c) => [c.recipeId, c]))
  const others = weekRecipes(week, byId, { date, meal })
  const inWeek = new Map<string, number>()
  for (const o of others) inWeek.set(o.recipe.recipeId, (inWeek.get(o.recipe.recipeId) ?? 0) + 1)
  const neighbours = others.filter(
    (o) => o.slot.meal === meal && Math.abs(daysBetween(o.slot.date, date)) === 1,
  )
  const theme = day.theme && (day.theme.meals.length === 0 || day.theme.meals.includes(meal)) ? day.theme : null

  const scored: Array<ScoredCandidate & { tie: number }> = []
  for (const c of candidates) {
    const mealTags = c.tags.filter((t) => MEAL_TAGS.includes(t))
    if (mealTags.length && !mealTags.includes(meal)) continue

    let score = 0
    const reasons: Array<{ w: number; text: string }> = []
    const term = (w: number, text?: string) => {
      score += w
      if (text && w > 0) reasons.push({ w, text })
    }

    if (theme && c.tags.some((t) => theme.tags.includes(t))) term(W.theme, theme.label)

    for (const k of cons) {
      if (k.kind === 'max_minutes') {
        const fast = c.tags.includes('fast')
        const label = eventLabel(k.reason)
        if (c.totalMinutes !== null && c.totalMinutes <= k.minutes) {
          term(W.fitsTime, `${c.totalMinutes} min, fits ${label ?? 'a busy night'}`)
        } else if (c.totalMinutes === null && fast) {
          term(W.fitsTime, `Quick, fits ${label ?? 'a busy night'}`)
        } else term(c.totalMinutes === null ? W.unknownTime : W.tooSlow)
      } else if (k.kind === 'grab_and_go') {
        const quick = c.tags.includes('fast') || (c.totalMinutes !== null && c.totalMinutes <= 10)
        if (quick) term(W.grabAndGo, 'Quick grab-and-go')
        else if (c.totalMinutes === null || c.totalMinutes > 20) term(W.slowBreakfast)
      }
    }

    // Scales with repeats, so a recipe only fills a third or fourth slot when nothing else fits.
    if (inWeek.has(c.recipeId)) term(W.inWeek * inWeek.get(c.recipeId)!)
    else if (c.lastPlanned === null) term(W.neverPlanned, 'New to the rotation')
    else {
      const weeks = Math.floor(daysBetween(c.lastPlanned, date) / 7)
      if (weeks >= 3) term(W.notRecent + Math.min(weeks, 10), `Not made in ${weeks} weeks`)
      else if (daysBetween(c.lastPlanned, date) < 7) term(W.recent)
      else term(W.fairlyRecent)
    }

    const ov = overlapWith(c, others, 'Uses')
    if (ov.points) term(ov.points, ov.reason ?? undefined)

    const mine = mainTags(c)
    if (mine.length && neighbours.some((n) => mainTags(n.recipe).some((t) => mine.includes(t)))) {
      term(W.sameMainTagAdjacent)
    }

    reasons.sort((a, b) => b.w - a.w)
    scored.push({
      recipeId: c.recipeId,
      score,
      reasons: reasons.slice(0, 3).map((r) => r.text),
      tie: seeded(`${seed}|${date}|${meal}|${c.recipeId}`),
    })
  }
  scored.sort((a, b) => b.score - a.score || a.tie - b.tie)
  return scored.map(({ tie: _tie, ...s }) => s)
}

// ---------------------------------------------------------------------------
// Auto-fill

function emptySlots(days: DayContext[], week: PlannedSlot[]): Array<{ day: DayContext; meal: Meal }> {
  const out: Array<{ day: DayContext; meal: Meal }> = []
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const meal of MEALS) {
      const s = week.find((x) => sameSlot(x, day.date, meal))
      if (!s || (!s.locked && !isFilled(s))) out.push({ day, meal })
    }
  }
  return out
}

/** Fill every slot that is empty (no recipe, kind 'recipe') and not locked, in date
 *  order, greedily via scoreCandidates, updating the week as it goes. Applies
 *  constraints: eat_out → kind 'eat_out'. Returns only the slots it filled, all
 *  with source 'auto'. Never touches locked or already-filled slots; a slot with
 *  no eligible candidate stays empty and is not returned. */
export function autoFill(args: {
  days: DayContext[]
  week: PlannedSlot[]
  candidates: Candidate[]
  seed: string
}): PlannedSlot[] {
  const { days, candidates, seed } = args
  const week = [...args.week]
  const filled: PlannedSlot[] = []
  for (const { day, meal } of emptySlots(days, week)) {
    let slot: PlannedSlot | null = null
    if (constraintsFor(day, meal).some((c) => c.kind === 'eat_out')) {
      slot = { date: day.date, meal, kind: 'eat_out', recipeId: null, locked: false, source: 'auto' }
    } else {
      const top = scoreCandidates({ date: day.date, meal, day, week, candidates, seed })[0]
      if (top) slot = { date: day.date, meal, kind: 'recipe', recipeId: top.recipeId, locked: false, source: 'auto' }
    }
    if (!slot) continue
    const i = week.findIndex((x) => sameSlot(x, day.date, meal))
    if (i >= 0) week[i] = slot
    else week.push(slot)
    filled.push(slot)
  }
  return filled
}

// ---------------------------------------------------------------------------
// Recommendations

/** Up to 3 suggestions for the whole week: fill empty slots, or swap an unlocked
 *  auto/suggested slot when another candidate shares notably more perishables. */
export function weekRecommendations(args: {
  days: DayContext[]
  week: PlannedSlot[]
  candidates: Candidate[]
  seed: string
}): Recommendation[] {
  const { days, week, candidates, seed } = args
  const byId = new Map(candidates.map((c) => [c.recipeId, c]))
  const options: Array<Recommendation & { priority: number }> = []

  // Empty slots: the top candidate, ranked by how well it builds on the week.
  for (const { day, meal } of emptySlots(days, week)) {
    const top = scoreCandidates({ date: day.date, meal, day, week, candidates, seed })[0]
    const cand = top && byId.get(top.recipeId)
    if (!top || !cand) continue
    const ov = overlapWith(cand, weekRecipes(week, byId, { date: day.date, meal }), 'Reuses')
    options.push({
      date: day.date,
      meal,
      recipeId: top.recipeId,
      replaces: null,
      reason: ov.reason ?? top.reasons[0] ?? 'A good fit for this day',
      savesCents: null,
      priority: top.score + ov.points,
    })
  }

  // Swaps: an unlocked auto/suggested recipe that a candidate beats on perishables.
  const dayByDate = new Map(days.map((d) => [d.date, d]))
  for (const slot of week) {
    if (slot.locked || slot.source === 'manual' || slot.kind !== 'recipe' || !slot.recipeId) continue
    const day = dayByDate.get(slot.date)
    const currentRecipe = byId.get(slot.recipeId)
    if (!day || !currentRecipe) continue
    const others = weekRecipes(week, byId, slot)
    const currentOv = overlapWith(currentRecipe, others, 'Reuses')
    const ranked = scoreCandidates({ date: slot.date, meal: slot.meal, day, week, candidates, seed })
    for (const r of ranked.slice(0, 5)) {
      if (r.recipeId === slot.recipeId) continue
      const alt = byId.get(r.recipeId)!
      const ov = overlapWith(alt, others, 'Reuses')
      if (ov.perishables < currentOv.perishables + 2) continue
      const saves =
        alt.estCostCents !== null && currentRecipe.estCostCents !== null && currentRecipe.estCostCents > alt.estCostCents
          ? currentRecipe.estCostCents - alt.estCostCents
          : null
      options.push({
        date: slot.date,
        meal: slot.meal,
        recipeId: r.recipeId,
        replaces: slot.recipeId,
        reason: ov.reason ?? r.reasons[0] ?? 'Shares more with this week',
        savesCents: saves,
        priority: (ov.perishables - currentOv.perishables) * W.sharedPerishable + 20,
      })
      break
    }
  }

  options.sort((a, b) => b.priority - a.priority || a.date.localeCompare(b.date))
  const usedRecipes = new Set<string>()
  const usedSlots = new Set<string>()
  const out: Recommendation[] = []
  for (const { priority: _p, ...o } of options) {
    const key = `${o.date}|${o.meal}`
    if (usedRecipes.has(o.recipeId) || usedSlots.has(key)) continue
    usedRecipes.add(o.recipeId)
    usedSlots.add(key)
    out.push(o)
    if (out.length === 3) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Summary

/** Summary for the sticky bar: estimated cost (sum of known estCostCents; null if none
 *  are known) and sharing, i.e. ingredients used by 2 or more planned recipes, with the
 *  count of each. `filled` counts non-empty slots (eat out, skip and leftovers
 *  included); `total` is the 21 slots of a week. */
export function weekSummary(args: { week: PlannedSlot[]; candidates: Candidate[] }): {
  estCostCents: number | null
  shared: Array<{ ingredientId: string; uses: number }>
  filled: number
  total: number
} {
  const byId = new Map(args.candidates.map((c) => [c.recipeId, c]))
  let cost: number | null = null
  const recipes = new Set<string>()
  for (const s of args.week) {
    if (s.kind !== 'recipe' || !s.recipeId) continue
    recipes.add(s.recipeId)
    const c = byId.get(s.recipeId)?.estCostCents
    if (c != null) cost = (cost ?? 0) + c
  }
  const uses = new Map<string, number>()
  for (const id of recipes) {
    for (const ing of new Set(byId.get(id)?.ingredientIds ?? [])) uses.set(ing, (uses.get(ing) ?? 0) + 1)
  }
  const shared = [...uses]
    .filter(([, n]) => n >= 2)
    .map(([ingredientId, n]) => ({ ingredientId, uses: n }))
    .sort((a, b) => b.uses - a.uses || a.ingredientId.localeCompare(b.ingredientId))
  return {
    estCostCents: cost,
    shared,
    filled: args.week.filter(isFilled).length,
    total: 7 * MEALS.length,
  }
}
