import { z } from 'zod'

import { MEAL_TAGS, TAGS } from './normalize'
import { addDays } from './planning/calendar'
import { isoDateSchema, mealSchema, slotKindSchema, type Meal, type SlotKind } from './schema'

// Meal history: what was actually eaten, per (date, meal). The wire contract
// for /api/history/* (api/src/mealHistory) and the pure logic behind it.
//
// For other features (nutrition reads "what was actually eaten" from here):
//   * resolveEntry / resolveEntries merge the plan with the meal log. A past
//     planned recipe counts as eaten unless someone said otherwise.
//   * isEaten(entry): the planned meal was eaten as planned.
//   * eatenRecipeId(entry): the recipe that was actually eaten, if any
//     (the planned one, or the one swapped in). Null for skipped, ate out,
//     leftovers and free-text swaps.
//   * api/src/mealHistory/db.ts loadHistory(db, from, to) returns entries.

export const mealStatusSchema = z.enum(['eaten', 'skipped', 'ate_out', 'swapped'])
export type MealStatus = z.infer<typeof mealStatusSchema>

// Thumbs up (1) or down (-1).
export const ratingSchema = z.union([z.literal(1), z.literal(-1)])
export type Rating = z.infer<typeof ratingSchema>

/** A meal_log row as the logic sees it. */
export interface MealLog {
  date: string
  meal: Meal
  status: MealStatus
  recipeId: string | null
  freeText: string | null
  rating: Rating | null
  note: string | null
  loggedBy: string | null
}

/** A plan slot, dated. */
export interface PlanSlotLite {
  date: string
  meal: Meal
  kind: SlotKind
  recipeId: string | null
}

/** What happened at one meal, merged from the plan and the log. */
export interface MealEntry {
  date: string
  meal: Meal
  status: MealStatus
  /** False when nobody logged it and the status is assumed from the plan. */
  confirmed: boolean
  plannedKind: SlotKind | null
  plannedRecipeId: string | null
  /** What was eaten: the planned recipe when eaten, the swapped-in one when swapped. */
  recipeId: string | null
  freeText: string | null
  rating: Rating | null
  note: string | null
  loggedBy: string | null
}

// ---------------------------------------------------------------------------
// Time: a meal is "past" once its usual time is over, in household time.

/** Minutes after local midnight by which each meal is assumed over. */
export const MEAL_OVER_AT: Record<Meal, number> = { breakfast: 10 * 60, lunch: 14 * 60, dinner: 19 * 60 }

export interface HistoryNow {
  date: string // YYYY-MM-DD, America/New_York
  minutes: number // minutes since local midnight
}

export function mealIsPast(date: string, meal: Meal, now: HistoryNow): boolean {
  return date < now.date || (date === now.date && now.minutes >= MEAL_OVER_AT[meal])
}

const DEFAULT_STATUS: Record<SlotKind, MealStatus> = {
  recipe: 'eaten',
  leftovers: 'eaten',
  eat_out: 'ate_out',
  skip: 'skipped',
}

/** Null for a meal nobody planned or logged, and for one still to come (unless logged). */
export function resolveEntry(slot: PlanSlotLite | null, log: MealLog | null, now: HistoryNow): MealEntry | null {
  const date = log?.date ?? slot?.date
  const meal = log?.meal ?? slot?.meal
  if (!date || !meal) return null
  const planned = { plannedKind: slot?.kind ?? null, plannedRecipeId: slot?.recipeId ?? null }
  if (log) {
    const recipeId =
      log.status === 'eaten' ? (log.recipeId ?? slot?.recipeId ?? null) : log.status === 'swapped' ? log.recipeId : null
    return { date, meal, status: log.status, confirmed: true, ...planned, recipeId, freeText: log.status === 'swapped' ? log.freeText : null, rating: log.rating, note: log.note, loggedBy: log.loggedBy }
  }
  if (!slot || !mealIsPast(date, meal, now)) return null
  return {
    date,
    meal,
    status: DEFAULT_STATUS[slot.kind],
    confirmed: false,
    ...planned,
    recipeId: slot.kind === 'recipe' ? slot.recipeId : null,
    freeText: null,
    rating: null,
    note: null,
    loggedBy: null,
  }
}

const MEAL_ORDER: Record<Meal, number> = { breakfast: 0, lunch: 1, dinner: 2 }

/** Every entry for the given slots and logs, newest first. */
export function resolveEntries(slots: PlanSlotLite[], logs: MealLog[], now: HistoryNow): MealEntry[] {
  const key = (x: { date: string; meal: Meal }) => `${x.date}|${x.meal}`
  const bySlot = new Map(slots.map((s) => [key(s), s]))
  const byLog = new Map(logs.map((l) => [key(l), l]))
  const out: MealEntry[] = []
  for (const k of new Set([...bySlot.keys(), ...byLog.keys()])) {
    const e = resolveEntry(bySlot.get(k) ?? null, byLog.get(k) ?? null, now)
    if (e) out.push(e)
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || MEAL_ORDER[b.meal] - MEAL_ORDER[a.meal])
}

/** The planned meal was eaten as planned (a recipe, or planned leftovers). */
export const isEaten = (e: Pick<MealEntry, 'status'>): boolean => e.status === 'eaten'

/** The recipe actually eaten, or null (skipped, ate out, leftovers, a free-text swap). */
export const eatenRecipeId = (e: Pick<MealEntry, 'status' | 'recipeId'>): string | null =>
  e.status === 'eaten' || e.status === 'swapped' ? e.recipeId : null

/** Something was cooked or eaten at home: a recipe, leftovers, or a swap. */
const atHome = (e: MealEntry) => e.status === 'eaten' || e.status === 'swapped'

// ---------------------------------------------------------------------------
// Per-recipe summary (the "Last made 12 days ago · made 6 times · 👍 5" line)

export interface RecipeHistorySummary {
  timesMade: number
  lastMade: string | null
  up: number
  down: number
}

export function recipeSummary(entries: MealEntry[], recipeId: string): RecipeHistorySummary {
  const mine = entries.filter((e) => eatenRecipeId(e) === recipeId)
  return {
    timesMade: mine.length,
    lastMade: mine.reduce<string | null>((m, e) => (m === null || e.date > m ? e.date : m), null),
    up: mine.filter((e) => e.rating === 1).length,
    down: mine.filter((e) => e.rating === -1).length,
  }
}

/** Thumbs per recipe, for the planning scorer. */
export function ratingsByRecipe(entries: MealEntry[]): Map<string, { up: number; down: number }> {
  const out = new Map<string, { up: number; down: number }>()
  for (const e of entries) {
    const id = eatenRecipeId(e)
    if (!id || e.rating === null) continue
    const r = out.get(id) ?? { up: 0, down: 0 }
    if (e.rating === 1) r.up++
    else r.down++
    out.set(id, r)
  }
  return out
}

// ---------------------------------------------------------------------------
// Stats

export interface RecipeMeta {
  title: string
  icon: string | null
  imageUrl: string | null
  tags: string[]
  /** Canonical ingredient names. */
  ingredients: string[]
  /** How many ingredients are from Produce. */
  produce: number
}

// The main protein of a recipe, from its ingredient names. First match wins,
// so "chicken and bean chili" counts as chicken.
const PROTEINS: Array<[label: string, words: RegExp]> = [
  ['Chicken', /\bchicken\b/],
  ['Beef', /\b(beef|steak|brisket|sirloin|chuck)\b/],
  ['Pork', /\b(pork|bacon|ham|sausage|chorizo|prosciutto|pancetta)\b/],
  ['Turkey', /\bturkey\b/],
  ['Fish', /\b(fish|salmon|tuna|cod|tilapia|halibut|mahi|trout|haddock)\b/],
  ['Shrimp & shellfish', /\b(shrimp|prawns?|scallops?|crab|lobster|clams?|mussels?)\b/],
  ['Tofu', /\b(tofu|tempeh|seitan)\b/],
  ['Beans & lentils', /\b(beans?|chickpeas?|lentils?)\b/],
  ['Eggs', /\beggs?\b/],
]

export function mainProtein(meta: Pick<RecipeMeta, 'ingredients'>): string | null {
  for (const [label, re] of PROTEINS) if (meta.ingredients.some((n) => re.test(n))) return label
  return null
}

export const PROTEIN_LABELS = PROTEINS.map(([l]) => l)

const VOCAB = new Set<string>([...TAGS.map((t) => t.value), ...MEAL_TAGS, 'makes-leftovers'])
const tagLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, ' ')

/** Cuisine-ish tags: anything outside the controlled vocabulary (mexican, italian, soup). */
export const cuisineTags = (meta: Pick<RecipeMeta, 'tags'>) => meta.tags.filter((t) => !VOCAB.has(t))

export interface Count {
  label: string
  count: number
}

export interface HistoryStats {
  /** Past entries counted. */
  meals: number
  cooked: number // eaten or swapped at home
  ateOut: number
  skipped: number
  mostMade: Array<{ recipeId: string; title: string; icon: string | null; count: number; up: number; down: number }>
  /** Distinct recipes eaten in the last 28 days, and in the 28 before. */
  variety: { last4: number; prev4: number }
  proteins: Count[]
  cuisines: Count[]
  /** Dinners at home in a row, up to the latest past dinner, and the best run in the window. */
  homeDinnerStreak: { current: number; best: number }
}

function counted(xs: string[], top = 6): Count[] {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, top)
}

/** Stats over `entries` (any order). `today` anchors the 4-week variety windows. */
export function historyStats(entries: MealEntry[], meta: Map<string, RecipeMeta>, today: string): HistoryStats {
  const eatenIds = entries.map(eatenRecipeId).filter((id): id is string => !!id)
  const byRecipe = new Map<string, MealEntry[]>()
  for (const e of entries) {
    const id = eatenRecipeId(e)
    if (id) byRecipe.set(id, [...(byRecipe.get(id) ?? []), e])
  }
  const mostMade = [...byRecipe]
    .filter(([id]) => meta.has(id))
    .map(([recipeId, es]) => ({
      recipeId,
      title: meta.get(recipeId)!.title,
      icon: meta.get(recipeId)!.icon,
      count: es.length,
      up: es.filter((e) => e.rating === 1).length,
      down: es.filter((e) => e.rating === -1).length,
    }))
    .sort((a, b) => b.count - a.count || b.up - a.up || a.title.localeCompare(b.title))
    .slice(0, 5)

  const start4 = addDays(today, -27)
  const start8 = addDays(today, -55)
  const distinct = (from: string, to: string) =>
    new Set(entries.filter((e) => e.date >= from && e.date <= to).map(eatenRecipeId).filter(Boolean)).size

  const dinners = entries.filter((e) => e.meal === 'dinner').sort((a, b) => a.date.localeCompare(b.date))
  let run = 0
  let best = 0
  for (const d of dinners) {
    run = atHome(d) ? run + 1 : 0
    best = Math.max(best, run)
  }

  const metas = eatenIds.map((id) => meta.get(id)).filter((m): m is RecipeMeta => !!m)
  return {
    meals: entries.length,
    cooked: entries.filter(atHome).length,
    ateOut: entries.filter((e) => e.status === 'ate_out').length,
    skipped: entries.filter((e) => e.status === 'skipped').length,
    mostMade,
    variety: { last4: distinct(start4, today), prev4: distinct(start8, addDays(start4, -1)) },
    proteins: counted(metas.map(mainProtein).filter((p): p is string => !!p)),
    cuisines: counted(metas.flatMap((m) => cuisineTags(m).map(tagLabel))),
    homeDinnerStreak: { current: run, best },
  }
}

// ---------------------------------------------------------------------------
// Facts: short, true statements about the last few weeks. They ground the
// Claude insights, and they are the insights when there is no API key.

export type InsightAction = { type: 'recipe'; recipeId: string; title: string } | { type: 'idea'; query: string }

export interface Fact {
  text: string
  action: InsightAction | null
}

const MEAL_WORD: Record<Meal, string> = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinners' }
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** Up to 6 facts, strongest first. `entries` should cover the last 4–8 weeks. */
export function historyFacts(entries: MealEntry[], meta: Map<string, RecipeMeta>, today: string): Fact[] {
  const facts: Array<Fact & { w: number }> = []
  const recent = (days: number) => entries.filter((e) => daysBetween(e.date, today) < days)

  // A protein that dominates the last 14 dinners.
  const dinners = entries
    .filter((e) => e.meal === 'dinner')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14)
  const proteins = dinners.map((e) => {
    const id = eatenRecipeId(e)
    const m = id ? meta.get(id) : undefined
    return m ? mainProtein(m) : null
  })
  const top = counted(proteins.filter((p): p is string => !!p), 1)[0]
  if (top && dinners.length >= 6 && top.count / dinners.length >= 0.4) {
    const alt = ['Fish', 'Beans & lentils', 'Shrimp & shellfish', 'Tofu', 'Pork'].find((p) => !proteins.includes(p)) ?? 'Fish'
    facts.push({
      text: `${top.label} in ${top.count} of the last ${dinners.length} dinners. Try ${alt.toLowerCase()} one night.`,
      action: { type: 'idea', query: `${alt.toLowerCase()} dinner` },
      w: 10 + top.count,
    })
  }

  // Loved, but not had in a while.
  const ratings = ratingsByRecipe(entries)
  const last = new Map<string, string>()
  for (const e of entries) {
    const id = eatenRecipeId(e)
    if (id && (!last.has(id) || e.date > last.get(id)!)) last.set(id, e.date)
  }
  const loved = [...ratings]
    .filter(([id, r]) => r.up >= 1 && r.down === 0 && meta.has(id) && daysBetween(last.get(id)!, today) >= 28)
    .sort((a, b) => b[1].up - a[1].up)
  for (const [id, r] of loved.slice(0, 2)) {
    const weeks = Math.floor(daysBetween(last.get(id)!, today) / 7)
    const title = meta.get(id)!.title
    facts.push({
      text: `You rated ${title} 👍${r.up > 1 ? ' every time' : ''} but haven't had it in ${weeks} weeks.`,
      action: { type: 'recipe', recipeId: id, title },
      w: 12 + r.up,
    })
  }

  // Disliked more than once.
  for (const [id, r] of ratings) {
    if (r.down >= 2 && r.down > r.up && meta.has(id)) {
      const title = meta.get(id)!.title
      facts.push({ text: `${title} got 👎 ${r.down} times. Maybe tweak it or let it go.`, action: { type: 'recipe', recipeId: id, title }, w: 8 })
    }
  }

  // Meals with no vegetables.
  for (const meal of ['lunch', 'dinner'] as const) {
    const withRecipe = recent(28).filter((e) => e.meal === meal && eatenRecipeId(e) && meta.has(eatenRecipeId(e)!))
    const noVeg = withRecipe.filter((e) => meta.get(eatenRecipeId(e)!)!.produce === 0).length
    if (withRecipe.length >= 5 && noVeg / withRecipe.length >= 0.6) {
      facts.push({
        text: `No vegetables at ${meal} most days (${noVeg} of ${withRecipe.length}).`,
        action: { type: 'idea', query: `vegetable ${meal}` },
        w: 9,
      })
    }
  }

  // The same recipe over and over.
  const counts = counted(entries.map(eatenRecipeId).filter((id): id is string => !!id && meta.has(id)), 1)[0]
  if (counts && counts.count >= 5) {
    facts.push({ text: `${meta.get(counts.label)!.title} ${counts.count} times lately, the most of anything.`, action: null, w: 5 })
  }

  // Less variety than the month before.
  const variety = historyStats(entries, meta, today).variety
  if (variety.prev4 >= 6 && variety.last4 <= variety.prev4 * 0.75) {
    facts.push({ text: `${variety.last4} different recipes in the last 4 weeks, down from ${variety.prev4}.`, action: null, w: 6 })
  }

  // Eating out and skipping.
  const out4 = recent(28).filter((e) => e.status === 'ate_out').length
  if (out4 >= 4) facts.push({ text: `Ate out ${out4} times in the last 4 weeks.`, action: null, w: 4 + out4 / 2 })
  for (const meal of ['breakfast', 'lunch', 'dinner'] as const) {
    const skipped = recent(14).filter((e) => e.meal === meal && e.status === 'skipped').length
    if (skipped >= 4) facts.push({ text: `Skipped ${MEAL_WORD[meal]} ${skipped} times in 2 weeks.`, action: null, w: 4 })
  }

  return facts
    .sort((a, b) => b.w - a.w)
    .slice(0, 6)
    .map(({ w: _w, ...f }) => f)
}

// ---------------------------------------------------------------------------
// Wire contract

export const insightActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('recipe'), recipeId: z.string(), title: z.string() }),
  z.object({ type: z.literal('idea'), query: z.string() }),
])

const recipeRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  imageUrl: z.string().nullable(),
})
export type HistoryRecipeRef = z.infer<typeof recipeRefSchema>

export const historyEntrySchema = z.object({
  date: isoDateSchema,
  meal: mealSchema,
  status: mealStatusSchema,
  confirmed: z.boolean(),
  plannedKind: slotKindSchema.nullable(),
  plannedRecipeId: z.string().nullable(),
  recipeId: z.string().nullable(),
  freeText: z.string().nullable(),
  rating: ratingSchema.nullable(),
  note: z.string().nullable(),
  loggedBy: z.string().nullable(),
  /** The recipe eaten (or, for a skip or ate-out, the one that was planned). */
  recipe: recipeRefSchema.nullable(),
})
export type HistoryEntryWire = z.infer<typeof historyEntrySchema>

const countSchema = z.object({ label: z.string(), count: z.number().int() })
export const historyStatsSchema = z.object({
  meals: z.number().int(),
  cooked: z.number().int(),
  ateOut: z.number().int(),
  skipped: z.number().int(),
  mostMade: z.array(
    z.object({
      recipeId: z.string(),
      title: z.string(),
      icon: z.string().nullable(),
      count: z.number().int(),
      up: z.number().int(),
      down: z.number().int(),
    }),
  ),
  variety: z.object({ last4: z.number().int(), prev4: z.number().int() }),
  proteins: z.array(countSchema),
  cuisines: z.array(countSchema),
  homeDinnerStreak: z.object({ current: z.number().int(), best: z.number().int() }),
})

// GET /api/history?weeks=8&meal=dinner&recipeId=…  Stats cover the whole
// window; the filters apply to the timeline only.
export const historyQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(26).default(8),
  meal: mealSchema.optional(),
  recipeId: z.string().min(1).max(100).optional(),
})
export const historyResponseSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  entries: z.array(historyEntrySchema),
  stats: historyStatsSchema,
})
export type HistoryResponse = z.infer<typeof historyResponseSchema>

// GET /api/history/pending: yesterday's and today's meals that are over.
export const pendingResponseSchema = z.object({ entries: z.array(historyEntrySchema) })

// PUT /api/history/log. Fields left out keep their logged value. For
// 'swapped', give recipeId or freeText.
export const mealLogInputSchema = z.object({
  date: isoDateSchema,
  meal: mealSchema,
  status: mealStatusSchema,
  recipeId: z.string().min(1).max(100).nullable().optional(),
  freeText: z.string().trim().min(1).max(120).nullable().optional(),
  rating: ratingSchema.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})
export type MealLogInput = z.infer<typeof mealLogInputSchema>

// POST /api/history/cooked: cooking mode's Done. Marks the meal on today's
// plan with this recipe eaten. meal is null when it isn't on today's plan.
export const cookedInputSchema = z.object({ recipeId: z.string().min(1).max(100) })
export const cookedResponseSchema = z.object({ meal: mealSchema.nullable() })

// GET /api/history/recipes/:id
export const recipeHistorySchema = z.object({
  timesMade: z.number().int(),
  lastMade: isoDateSchema.nullable(),
  up: z.number().int(),
  down: z.number().int(),
})

// GET /api/history/insights (made on first view of the week) and
// POST /api/history/insights/refresh (at most once a day).
export const insightSchema = z.object({ text: z.string(), action: insightActionSchema.nullable() })
export type Insight = z.infer<typeof insightSchema>
export const insightsResponseSchema = z.object({
  weekId: isoDateSchema,
  insights: z.array(insightSchema),
  /** 'facts' when written without Claude (no key, or Claude failed). */
  source: z.enum(['claude', 'facts']),
  generatedAt: z.number().int().nullable(),
  /** False when it was already refreshed today. */
  canRefresh: z.boolean(),
})
export type InsightsResponse = z.infer<typeof insightsResponseSchema>
