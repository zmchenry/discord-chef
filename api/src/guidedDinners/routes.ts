import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { ZodTypeAny } from 'zod'

import {
  breakfastLunchInputSchema,
  fillBreakfastLunchInputSchema,
  type BreakfastLunchSettings,
  type FillBreakfastLunchResponse,
  type RecipeRef,
} from '../../../shared/guidedDinners'
import {
  defaultRotation,
  defaultStaples,
  dinnerBefore,
  fillBreakfastLunch,
  type BLRecipe,
} from '../../../shared/planning/breakfastLunch'
import { addDays, weekDates, weekIdSchema } from '../../../shared/planningApi'
import type { ErrorResponse } from '../../../shared/schema'
import { getSetting, setSetting, totalMinutes, upsertSlotStatement } from '../planning/db'
import { loadWeek, weekView } from '../planning/routes'
import { requireSession, type AppEnv } from '../session'

// The guided week: breakfast and lunch rules (dinners are picked by hand
// through the planning routes) and their settings. Mounted under /api.

const guided = new Hono<AppEnv>()
guided.use('/weeks/*', requireSession)
guided.use('/settings/*', requireSession)

const bad = (c: Context, issues: unknown[]) => c.json({ error: 'invalid', issues } satisfies ErrorResponse, 400)
const validJson = <T extends ZodTypeAny>(schema: T) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) return bad(c, r.error.issues)
  })

const ROTATION = 'breakfast_rotation'
const STAPLES = 'lunch_staples'
const CURSOR = 'breakfast_cursor'

function parseJson<T>(s: string | null): T | null {
  try {
    return s ? (JSON.parse(s) as T) : null
  } catch {
    return null
  }
}
const parseIds = (s: string | null): string[] => {
  const v = parseJson<unknown>(s)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

type Row = BLRecipe & { icon: string | null }

// Every active recipe with what the rules need: tags, time, servings, and how
// often it has been planned.
async function listRecipes(db: D1Database): Promise<Row[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.title, r.icon, r.servings, r.prep_minutes, r.cook_minutes,
         (SELECT json_group_array(t.tag) FROM recipe_tags t WHERE t.recipe_id = r.id) AS tags,
         (SELECT count(*) FROM plan_slots ps WHERE ps.recipe_id = r.id) AS times
       FROM recipes r WHERE r.archived_at IS NULL ORDER BY r.title`,
    )
    .all<{
      id: string
      title: string
      icon: string | null
      servings: number | null
      prep_minutes: number | null
      cook_minutes: number | null
      tags: string
      times: number
    }>()
  return results.map((r) => ({
    id: r.id,
    title: r.title,
    icon: r.icon,
    servings: r.servings,
    totalMinutes: totalMinutes(r.prep_minutes, r.cook_minutes),
    tags: parseIds(r.tags),
    timesPlanned: r.times,
  }))
}

// The saved lists, or the defaults when none are saved (or none survive).
async function effective(db: D1Database, recipes: Row[]) {
  const ids = new Set(recipes.map((r) => r.id))
  const rotation = parseIds(await getSetting(db, ROTATION)).filter((id) => ids.has(id))
  const staples = parseIds(await getSetting(db, STAPLES)).filter((id) => ids.has(id))
  return {
    rotation: rotation.length ? rotation : defaultRotation(recipes),
    staples: staples.length ? staples : defaultStaples(recipes),
    rotationIsDefault: rotation.length === 0,
    staplesIsDefault: staples.length === 0,
  }
}

async function settings(db: D1Database): Promise<BreakfastLunchSettings> {
  const recipes = await listRecipes(db)
  const byId = new Map(recipes.map((r) => [r.id, r]))
  const ref = (id: string): RecipeRef => ({ id, title: byId.get(id)!.title, icon: byId.get(id)!.icon })
  const e = await effective(db, recipes)
  return {
    breakfastRotation: e.rotation.map(ref),
    lunchStaples: e.staples.map(ref),
    rotationIsDefault: e.rotationIsDefault,
    staplesIsDefault: e.staplesIsDefault,
  }
}

guided.get('/settings/breakfast-lunch', async (c) => c.json(await settings(c.env.DB)))

guided.put('/settings/breakfast-lunch', validJson(breakfastLunchInputSchema), async (c) => {
  const body = c.req.valid('json')
  const save = (ids: string[]) => (ids.length ? JSON.stringify([...new Set(ids)]) : null)
  await setSetting(c.env.DB, ROTATION, save(body.breakfastRotation))
  await setSetting(c.env.DB, STAPLES, save(body.lunchStaples))
  return c.json(await settings(c.env.DB))
})

// The rotation cursor: where `week` started, and where the week after starts.
interface Cursor {
  week: string
  start: number
  next: number
}

// Fills the week's empty, unlocked breakfasts and lunches (source 'auto').
// The body is JSON (CSRF rule): {} or {refill: true}, which first clears the
// unlocked auto-filled breakfasts and lunches.
guided.post('/weeks/:start/fill-breakfast-lunch', validJson(fillBreakfastLunchInputSchema), async (c) => {
  const parsed = weekIdSchema.safeParse(c.req.param('start'))
  if (!parsed.success) return c.json({ error: 'not found' } satisfies ErrorResponse, 404)
  const weekId = parsed.data
  const db = c.env.DB

  if (c.req.valid('json').refill) {
    await db
      .prepare("DELETE FROM plan_slots WHERE week_id = ?1 AND locked = 0 AND source = 'auto' AND meal IN ('breakfast', 'lunch')")
      .bind(weekId)
      .run()
  }

  const [w, recipes, savedCursor, prev] = await Promise.all([
    loadWeek(c.env, weekId),
    listRecipes(db),
    getSetting(db, CURSOR),
    db
      .prepare("SELECT recipe_id FROM plan_slots WHERE week_id = ?1 AND day = 6 AND meal = 'dinner' AND kind = 'recipe'")
      .bind(addDays(weekId, -7))
      .first<{ recipe_id: string }>(),
  ])
  const prevDinnerId = prev?.recipe_id ?? null
  const e = await effective(db, recipes)
  const cursor = parseJson<Cursor>(savedCursor)
  // A later week continues from where the last filled week ended; that week
  // again (a refill) starts where it started; an earlier week counts back.
  const weeksBack = cursor ? Math.round((Date.parse(cursor.week) - Date.parse(weekId)) / (7 * 86_400_000)) : 0
  const start = !cursor ? 0 : weeksBack < 0 ? cursor.next : cursor.start - 7 * weeksBack
  const dates = weekDates(weekId)
  const { filled, nextCursor } = fillBreakfastLunch({
    dates,
    slots: w.planned,
    constraints: Object.fromEntries(w.days.map((d) => [d.date, d.constraints])),
    recipes,
    rotation: e.rotation,
    cursor: start,
    staples: e.staples,
    prevDinnerId,
  })
  const userId = c.var.session!.userId
  if (filled.length) await db.batch(filled.map((s) => upsertSlotStatement(db, weekId, userId, s)))
  // An earlier week never moves the cursor back.
  if (e.rotation.length && (!cursor || weekId >= cursor.week)) {
    await setSetting(db, CURSOR, JSON.stringify({ week: weekId, start, next: nextCursor } satisfies Cursor))
  }

  const week = await weekView(c.env, weekId)
  const titles = new Map(recipes.map((r) => [r.id, r.title]))
  const leftoversFrom: Record<string, string> = {}
  dates.forEach((date, i) => {
    const lunch = week.slots.find((s) => s.date === date && s.meal === 'lunch')
    const title = lunch?.kind === 'leftovers' && titles.get(dinnerBefore(dates, i, week.slots, prevDinnerId) ?? '')
    if (title) leftoversFrom[date] = title
  })
  return c.json({
    week,
    filled: filled.length,
    leftoversFrom,
    rotationIsDefault: e.rotationIsDefault,
  } satisfies FillBreakfastLunchResponse)
})

export { guided as guidedDinnersRoutes }
