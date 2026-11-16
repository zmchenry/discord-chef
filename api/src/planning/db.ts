import type { Meal, SlotKind, SlotSource } from '../../../shared/schema'
import { MEALS } from '../../../shared/schema'
import {
  addDays,
  weekDates,
  type HouseholdSettings,
  type ThemeWire,
  type WeekSlot,
} from '../../../shared/planningApi'
import type { Candidate, PlannedSlot } from '../../../shared/planning/engine'

// D1 access for planning. snake_case rows in, wire/engine shapes out.

const parseJson = <T>(s: string | null, fallback: T): T => {
  if (s === null) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Settings

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM household_settings WHERE key = ?1').bind(key).first<{ value: string }>()
  return row?.value ?? null
}

export async function setSetting(db: D1Database, key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.prepare('DELETE FROM household_settings WHERE key = ?1').bind(key).run()
    return
  }
  await db
    .prepare(
      `INSERT INTO household_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, Date.now())
    .run()
}

export const DEFAULT_HOUSEHOLD: HouseholdSettings = { people: ['Zach', 'Liz'] }

export async function getHousehold(db: D1Database): Promise<HouseholdSettings> {
  return parseJson(await getSetting(db, 'household'), DEFAULT_HOUSEHOLD)
}

export async function listThemes(db: D1Database): Promise<ThemeWire[]> {
  const { results } = await db
    .prepare('SELECT weekday, label, tags, meals FROM day_themes ORDER BY weekday')
    .all<{ weekday: number; label: string; tags: string; meals: string }>()
  return results.map((r) => ({
    weekday: r.weekday,
    label: r.label,
    tags: parseJson<string[]>(r.tags, []),
    meals: parseJson<Meal[]>(r.meals, ['dinner']),
  }))
}

export async function replaceThemes(db: D1Database, themes: ThemeWire[]): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM day_themes'),
    ...themes.map((t) =>
      db
        .prepare('INSERT INTO day_themes (weekday, label, tags, meals) VALUES (?1, ?2, ?3, ?4)')
        .bind(t.weekday, t.label, JSON.stringify(t.tags), JSON.stringify(t.meals)),
    ),
  ])
}

// ---------------------------------------------------------------------------
// Weeks and slots

export async function ensureWeek(db: D1Database, weekId: string): Promise<'draft' | 'planned'> {
  const now = Date.now()
  await db
    .prepare('INSERT INTO weeks (id, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?3) ON CONFLICT(id) DO NOTHING')
    .bind(weekId, 'draft', now)
    .run()
  const row = await db.prepare('SELECT status FROM weeks WHERE id = ?1').bind(weekId).first<{ status: 'draft' | 'planned' }>()
  return row!.status
}

export async function setWeekStatus(db: D1Database, weekId: string, status: 'draft' | 'planned'): Promise<void> {
  await db.prepare('UPDATE weeks SET status = ?2, updated_at = ?3 WHERE id = ?1').bind(weekId, status, Date.now()).run()
}

interface SlotRow {
  day: number
  meal: Meal
  kind: SlotKind
  recipe_id: string | null
  source: SlotSource
  locked: number
  title: string | null
  icon: string | null
  prep_minutes: number | null
  cook_minutes: number | null
}

export const totalMinutes = (prep: number | null, cook: number | null): number | null =>
  prep === null && cook === null ? null : (prep ?? 0) + (cook ?? 0)

export async function listSlots(db: D1Database, weekId: string): Promise<WeekSlot[]> {
  const { results } = await db
    .prepare(
      `SELECT ps.day, ps.meal, ps.kind, ps.recipe_id, ps.source, ps.locked,
              r.title, r.icon, r.prep_minutes, r.cook_minutes
       FROM plan_slots ps LEFT JOIN recipes r ON r.id = ps.recipe_id
       WHERE ps.week_id = ?1 ORDER BY ps.day`,
    )
    .bind(weekId)
    .all<SlotRow>()
  return results.map((r) => ({
    date: addDays(weekId, r.day),
    meal: r.meal,
    kind: r.kind,
    recipeId: r.recipe_id,
    recipe:
      r.recipe_id && r.title !== null
        ? { id: r.recipe_id, title: r.title, icon: r.icon, totalMinutes: totalMinutes(r.prep_minutes, r.cook_minutes) }
        : null,
    source: r.source,
    locked: r.locked === 1,
  }))
}

export function upsertSlotStatement(
  db: D1Database,
  weekId: string,
  userId: string | null,
  slot: { date: string; meal: Meal; kind: SlotKind; recipeId: string | null; source: SlotSource; locked: boolean },
): D1PreparedStatement {
  const day = weekDates(weekId).indexOf(slot.date)
  if (day < 0) throw new Error(`${slot.date} is not in week ${weekId}`)
  return db
    .prepare(
      `INSERT INTO plan_slots (week_id, day, meal, kind, recipe_id, source, locked, updated_by, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(week_id, day, meal) DO UPDATE SET
         kind = excluded.kind, recipe_id = excluded.recipe_id, source = excluded.source,
         locked = excluded.locked, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .bind(weekId, day, slot.meal, slot.kind, slot.recipeId, slot.source, slot.locked ? 1 : 0, userId, Date.now())
}

export async function deleteSlot(db: D1Database, weekId: string, date: string, meal: Meal): Promise<void> {
  const day = weekDates(weekId).indexOf(date)
  await db.prepare('DELETE FROM plan_slots WHERE week_id = ?1 AND day = ?2 AND meal = ?3').bind(weekId, day, meal).run()
}

// The engine's view of a week: all 21 slots, empty ones as kind 'recipe'
// with no recipe.
export function toPlannedSlots(weekId: string, slots: WeekSlot[]): PlannedSlot[] {
  const out: PlannedSlot[] = []
  for (const date of weekDates(weekId)) {
    for (const meal of MEALS) {
      const s = slots.find((x) => x.date === date && x.meal === meal)
      out.push(
        s
          ? { date, meal, kind: s.kind, recipeId: s.recipeId, locked: s.locked, source: s.source }
          : { date, meal, kind: 'recipe', recipeId: null, locked: false, source: 'manual' },
      )
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Candidates

export interface CandidateWithMeta extends Candidate {
  icon: string | null
}

// Every active recipe, with its tags, ingredients, perishables, and the last
// date it was planned in an earlier week.
export async function listCandidates(db: D1Database, weekId: string): Promise<CandidateWithMeta[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.title, r.icon, r.prep_minutes, r.cook_minutes,
         (SELECT json_group_array(t.tag) FROM recipe_tags t WHERE t.recipe_id = r.id) AS tags,
         (SELECT json_group_object(i.id, i.name) FROM (
            SELECT DISTINCT i.id, i.name FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
            WHERE ri.recipe_id = r.id) i) AS ingredient_names,
         (SELECT json_group_array(DISTINCT ri.ingredient_id) FROM recipe_ingredients ri
            JOIN ingredients i ON i.id = ri.ingredient_id
            WHERE ri.recipe_id = r.id AND i.perishable = 1) AS perishable_ids,
         (SELECT max(date(ps.week_id, '+' || ps.day || ' days')) FROM plan_slots ps
            WHERE ps.recipe_id = r.id AND ps.week_id < ?1) AS last_planned
       FROM recipes r WHERE r.archived_at IS NULL ORDER BY r.title`,
    )
    .bind(weekId)
    .all<{
      id: string
      title: string
      icon: string | null
      prep_minutes: number | null
      cook_minutes: number | null
      tags: string
      ingredient_names: string
      perishable_ids: string
      last_planned: string | null
    }>()
  const names = (r: { ingredient_names: string }) => parseJson<Record<string, string>>(r.ingredient_names, {})
  return results.map((r) => ({
    recipeId: r.id,
    title: r.title,
    icon: r.icon,
    tags: parseJson<string[]>(r.tags, []),
    ingredientIds: Object.keys(names(r)),
    ingredientNames: names(r),
    perishableIngredientIds: parseJson<number[]>(r.perishable_ids, []).map(String),
    totalMinutes: totalMinutes(r.prep_minutes, r.cook_minutes),
    lastPlanned: r.last_planned,
    estCostCents: null,
  }))
}
