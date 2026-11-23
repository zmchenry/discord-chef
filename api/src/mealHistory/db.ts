import {
  ratingsByRecipe,
  resolveEntries,
  type HistoryEntryWire,
  type HistoryNow,
  type MealEntry,
  type MealLog,
  type PlanSlotLite,
  type RecipeMeta,
} from '../../../shared/mealHistory'
import type { Candidate } from '../../../shared/planning/engine'
import type { Meal } from '../../../shared/schema'
import { localNow } from '../notifications/cron'

// D1 access for meal history. loadHistory is the one to read "what was
// actually eaten" from (nutrition uses it too).

export const historyNow = (at = new Date()): HistoryNow => {
  const n = localNow(at)
  return { date: n.date, minutes: n.minutes }
}

interface LogRow {
  date: string
  meal: Meal
  status: MealLog['status']
  recipe_id: string | null
  free_text: string | null
  rating: 1 | -1 | null
  note: string | null
  logged_by: string | null
}

const toLog = (r: LogRow): MealLog => ({
  date: r.date,
  meal: r.meal,
  status: r.status,
  recipeId: r.recipe_id,
  freeText: r.free_text,
  rating: r.rating,
  note: r.note,
  loggedBy: r.logged_by,
})

export async function loadSlots(db: D1Database, from: string, to: string): Promise<PlanSlotLite[]> {
  const { results } = await db
    .prepare(
      `SELECT date(week_id, '+' || day || ' days') AS date, meal, kind, recipe_id FROM plan_slots
       WHERE week_id BETWEEN date(?1, '-6 days') AND ?2 AND date(week_id, '+' || day || ' days') BETWEEN ?1 AND ?2`,
    )
    .bind(from, to)
    .all<{ date: string; meal: Meal; kind: PlanSlotLite['kind']; recipe_id: string | null }>()
  return results.map((r) => ({ date: r.date, meal: r.meal, kind: r.kind, recipeId: r.recipe_id }))
}

export async function loadLogs(db: D1Database, from: string, to: string): Promise<MealLog[]> {
  const { results } = await db
    .prepare('SELECT * FROM meal_log WHERE date BETWEEN ?1 AND ?2')
    .bind(from, to)
    .all<LogRow>()
  return results.map(toLog)
}

export async function getLog(db: D1Database, date: string, meal: Meal): Promise<MealLog | null> {
  const row = await db.prepare('SELECT * FROM meal_log WHERE date = ?1 AND meal = ?2').bind(date, meal).first<LogRow>()
  return row ? toLog(row) : null
}

/** Every past (or logged) meal between from and to, newest first. */
export async function loadHistory(db: D1Database, from: string, to: string, now = historyNow()): Promise<MealEntry[]> {
  const [slots, logs] = await Promise.all([loadSlots(db, from, to), loadLogs(db, from, to)])
  return resolveEntries(slots, logs, now)
}

export async function saveLog(db: D1Database, log: MealLog): Promise<void> {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO meal_log (date, meal, status, recipe_id, free_text, rating, note, logged_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT (date, meal) DO UPDATE SET status = excluded.status, recipe_id = excluded.recipe_id,
         free_text = excluded.free_text, rating = excluded.rating, note = excluded.note,
         logged_by = excluded.logged_by, updated_at = excluded.updated_at`,
    )
    .bind(log.date, log.meal, log.status, log.recipeId, log.freeText, log.rating, log.note, log.loggedBy, now)
    .run()
}

export async function plannedSlot(db: D1Database, date: string, meal: Meal): Promise<PlanSlotLite | null> {
  return (await loadSlots(db, date, date)).find((s) => s.meal === meal) ?? null
}

// ---------------------------------------------------------------------------
// Recipes

const parse = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback
  } catch {
    return fallback
  }
}

/** Title, icon, tags and ingredients for the given recipes (archived ones too). */
export async function recipeMeta(db: D1Database, ids?: string[]): Promise<Map<string, RecipeMeta>> {
  const where = ids ? `WHERE r.id IN (SELECT value FROM json_each(?1))` : 'WHERE r.archived_at IS NULL'
  const stmt = db.prepare(
    `SELECT r.id, r.title, r.icon, r.image_url,
       (SELECT json_group_array(t.tag) FROM recipe_tags t WHERE t.recipe_id = r.id) AS tags,
       (SELECT json_group_array(i.name) FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
          WHERE ri.recipe_id = r.id) AS ingredients,
       (SELECT count(*) FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
          WHERE ri.recipe_id = r.id AND i.section = 'Produce') AS produce
     FROM recipes r ${where}`,
  )
  const { results } = await (ids ? stmt.bind(JSON.stringify(ids)) : stmt).all<{
    id: string
    title: string
    icon: string | null
    image_url: string | null
    tags: string
    ingredients: string
    produce: number
  }>()
  return new Map(
    results.map((r) => [
      r.id,
      {
        title: r.title,
        icon: r.icon,
        imageUrl: r.image_url,
        tags: parse<string[]>(r.tags, []),
        ingredients: parse<string[]>(r.ingredients, []),
        produce: r.produce,
      },
    ]),
  )
}

export async function metaFor(db: D1Database, entries: MealEntry[]): Promise<Map<string, RecipeMeta>> {
  const ids = new Set<string>()
  for (const e of entries) {
    if (e.recipeId) ids.add(e.recipeId)
    if (e.plannedRecipeId) ids.add(e.plannedRecipeId)
  }
  return ids.size ? recipeMeta(db, [...ids]) : new Map()
}

export function toWire(e: MealEntry, meta: Map<string, RecipeMeta>): HistoryEntryWire {
  const id = e.recipeId ?? (e.status === 'swapped' ? null : e.plannedRecipeId)
  const m = id ? meta.get(id) : undefined
  return { ...e, recipe: id && m ? { id, title: m.title, icon: m.icon, imageUrl: m.imageUrl } : null }
}

// ---------------------------------------------------------------------------
// Planning: thumbs on each candidate (shared/planning engine terms).

const RATINGS_WINDOW_DAYS = 365

export async function withRatings<T extends Candidate>(db: D1Database, candidates: T[]): Promise<T[]> {
  const now = historyNow()
  const from = new Date(Date.parse(`${now.date}T00:00:00Z`) - RATINGS_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  const { results } = await db
    .prepare('SELECT * FROM meal_log WHERE date >= ?1 AND rating IS NOT NULL')
    .bind(from)
    .all<LogRow>()
  if (!results.length) return candidates
  // Eaten logs without a recipe id take the planned one.
  const slots = await loadSlots(db, from, now.date)
  const ratings = ratingsByRecipe(resolveEntries(slots, results.map(toLog), now).filter((e) => e.confirmed))
  return candidates.map((c) => (ratings.has(c.recipeId) ? { ...c, rating: ratings.get(c.recipeId)! } : c))
}
