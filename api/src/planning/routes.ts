import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { ZodTypeAny } from 'zod'

import { normalizePersonName, normalizeTags } from '../../../shared/normalize'
import { autoFill, scoreCandidates, weekRecommendations, weekSummary, type DayContext } from '../../../shared/planning/engine'
import {
  calendarSettingsInputSchema,
  householdSettingsSchema,
  slotSetInputSchema,
  suggestionsQuerySchema,
  themesSettingsSchema,
  weekDates,
  weekdayOf,
  weekIdSchema,
  type RecommendationWire,
  type Suggestion,
  type WeekView,
} from '../../../shared/planningApi'
import { mealSchema, type ErrorResponse } from '../../../shared/schema'
import { requireSession, type AppEnv } from '../session'
import { waitUntilFor } from '../shopping/prices'
import { openClashes } from '../calendarRefresh/clashes'
import { calendarStatus, setCalendarUrl, weekConstraints } from './calendar'
import { clearForReplan, type ReplanKeep,
  deleteSlot,
  ensureWeek,
  getHousehold,
  listCandidates,
  listSlots,
  listThemes,
  replaceThemes,
  setSetting,
  setWeekStatus,
  toPlannedSlots,
  upsertSlotStatement,
} from './db'
import { onWeekPlanned } from './hooks'

// Weekly planning. Mounted under /api by index.ts. Every route requires a
// session, and every write is PUT/POST-with-JSON/DELETE (see the CSRF note in
// index.ts). POST /autofill and /finish take no body, so they require a JSON
// content-type explicitly.

const planning = new Hono<AppEnv>()
planning.use('/weeks/*', requireSession)
planning.use('/settings/*', requireSession)

const bad = (c: Context, issues: unknown[]) => c.json({ error: 'invalid', issues } satisfies ErrorResponse, 400)
const validJson = <T extends ZodTypeAny>(schema: T) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) return bad(c, r.error.issues)
  })
const validQuery = <T extends ZodTypeAny>(schema: T) =>
  zValidator('query', schema, (r, c) => {
    if (!r.success) return bad(c, r.error.issues)
  })

// Rejects a cross-site "simple" POST: only same-origin fetch with a JSON
// content-type gets through (a preflight is needed otherwise).
const jsonPost = async (c: Context, next: () => Promise<void>) => {
  if (!(c.req.header('content-type') ?? '').includes('application/json')) {
    return c.json({ error: 'expected application/json' } satisfies ErrorResponse, 415)
  }
  await next()
}

function weekParam(c: Context): string | null {
  const parsed = weekIdSchema.safeParse(c.req.param('start'))
  return parsed.success ? parsed.data : null
}

// Everything the engine needs for one week. Also used by the calendar cron.
export async function loadWeek(env: Env, weekId: string) {
  const db = env.DB
  const [status, slots, themes, household, candidates] = await Promise.all([
    ensureWeek(db, weekId),
    listSlots(db, weekId),
    listThemes(db),
    getHousehold(db),
    listCandidates(db, weekId),
  ])
  const dates = weekDates(weekId)
  const calendar = await weekConstraints(db, dates, household)
  const days: DayContext[] = dates.map((date) => ({
    date,
    theme: themes.find((t) => t.weekday === weekdayOf(date)) ?? null,
    constraints: calendar.byDay[date] ?? [],
  }))
  return {
    status,
    slots,
    days,
    candidates,
    calendarStatus: calendar.status,
    calendarFetchedAt: calendar.fetchedAt,
    eventsByDay: calendar.eventsByDay,
    planned: toPlannedSlots(weekId, slots),
  }
}

async function weekView(env: Env, weekId: string): Promise<WeekView> {
  const w = await loadWeek(env, weekId)
  const summary = weekSummary({ week: w.planned, candidates: w.candidates })
  const names = new Map(w.candidates.flatMap((x) => Object.entries(x.ingredientNames ?? {})))
  return {
    id: weekId,
    status: w.status,
    days: w.days.map((d) => ({
      date: d.date,
      weekday: weekdayOf(d.date),
      theme: d.theme,
      constraints: d.constraints,
      events: w.eventsByDay[d.date] ?? [],
    })),
    slots: w.slots,
    summary: {
      filled: summary.filled,
      total: summary.total,
      estCostCents: summary.estCostCents,
      shared: summary.shared
        .map((s) => ({ ...s, name: names.get(s.ingredientId) ?? 'ingredient' }))
        .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)),
    },
    calendar: w.calendarStatus,
    calendarFetchedAt: w.calendarFetchedAt,
    clashes: await openClashes(env.DB, weekId, w),
  }
}

const notFound = (c: Context) => c.json({ error: 'not found' } satisfies ErrorResponse, 404)

// --- Weeks -----------------------------------------------------------------

planning.get('/weeks/:start', async (c) => {
  const weekId = weekParam(c)
  if (!weekId) return notFound(c)
  return c.json(await weekView(c.env, weekId))
})

planning.put('/weeks/:start/slots/:date/:meal', validJson(slotSetInputSchema), async (c) => {
  const weekId = weekParam(c)
  const meal = mealSchema.safeParse(c.req.param('meal'))
  const date = c.req.param('date')
  if (!weekId || !meal.success || !weekDates(weekId).includes(date)) return notFound(c)
  const input = c.req.valid('json')
  await ensureWeek(c.env.DB, weekId)
  const existing = (await listSlots(c.env.DB, weekId)).find((s) => s.date === date && s.meal === meal.data)
  // Toggling the lock on an unchanged slot keeps who picked it (auto stays auto).
  const unchanged = existing && existing.kind === input.kind && existing.recipeId === input.recipeId
  await upsertSlotStatement(c.env.DB, weekId, c.var.session!.userId, {
    date,
    meal: meal.data,
    kind: input.kind,
    recipeId: input.recipeId,
    source: unchanged ? existing.source : input.source,
    locked: input.locked ?? existing?.locked ?? false,
  }).run()
  return c.json(await weekView(c.env, weekId))
})

planning.delete('/weeks/:start/slots/:date/:meal', async (c) => {
  const weekId = weekParam(c)
  const meal = mealSchema.safeParse(c.req.param('meal'))
  const date = c.req.param('date')
  if (!weekId || !meal.success || !weekDates(weekId).includes(date)) return notFound(c)
  await deleteSlot(c.env.DB, weekId, date, meal.data)
  return c.json(await weekView(c.env, weekId))
})

// Fill every empty, unlocked slot with the engine's picks (source 'auto').
async function autofillWeek(env: Env, weekId: string, userId: string): Promise<void> {
  const w = await loadWeek(env, weekId)
  const filled = autoFill({ days: w.days, week: w.planned, candidates: w.candidates, seed: weekId })
  // Only write into slots that are still empty, whatever the engine returns.
  const isEmpty = (date: string, meal: string) => !w.slots.some((s) => s.date === date && s.meal === meal)
  const writes = filled
    .filter((s) => s.source === 'auto' && isEmpty(s.date, s.meal))
    .filter((s) => s.kind !== 'recipe' || s.recipeId)
    .map((s) =>
      upsertSlotStatement(env.DB, weekId, userId, {
        date: s.date,
        meal: s.meal,
        kind: s.kind,
        recipeId: s.kind === 'recipe' ? s.recipeId : null,
        source: 'auto',
        locked: false,
      }),
    )
  if (writes.length) await env.DB.batch(writes)
}

planning.post('/weeks/:start/autofill', jsonPost, async (c) => {
  const weekId = weekParam(c)
  if (!weekId) return notFound(c)
  await autofillWeek(c.env, weekId, c.var.session!.userId)
  return c.json(await weekView(c.env, weekId))
})

planning.post('/weeks/:start/replan', jsonPost, async (c) => {
  const weekId = weekParam(c)
  if (!weekId) return notFound(c)
  // Body {keep: 'mine' | 'locked'}; anything else means 'mine'.
  const body = (await c.req.json().catch(() => ({}))) as { keep?: unknown }
  const keep: ReplanKeep = body?.keep === 'locked' ? 'locked' : 'mine'
  await ensureWeek(c.env.DB, weekId)
  await clearForReplan(c.env.DB, weekId, keep)
  await autofillWeek(c.env, weekId, c.var.session!.userId)
  return c.json(await weekView(c.env, weekId))
})

planning.get('/weeks/:start/suggestions', validQuery(suggestionsQuerySchema), async (c) => {
  const weekId = weekParam(c)
  const { date, meal, q, limit } = c.req.valid('query')
  if (!weekId || !weekDates(weekId).includes(date)) return notFound(c)
  const w = await loadWeek(c.env, weekId)
  const needle = q?.toLowerCase()
  const pool = needle ? w.candidates.filter((x) => x.title.toLowerCase().includes(needle)) : w.candidates
  const scored = scoreCandidates({
    date,
    meal,
    day: w.days.find((d) => d.date === date)!,
    // The slot being picked for does not count as "already this week".
    week: w.planned.filter((s) => !(s.date === date && s.meal === meal)),
    candidates: pool,
    seed: weekId,
  })
  const byId = new Map(pool.map((x) => [x.recipeId, x]))
  const toSuggestion = (id: string, s?: Pick<Suggestion, 'score' | 'reasons' | 'why' | 'theme'>): Suggestion => {
    const r = byId.get(id)!
    return {
      recipeId: id,
      title: r.title,
      icon: r.icon,
      totalMinutes: r.totalMinutes,
      ...(s ?? { score: 0, reasons: [], why: [], theme: false }),
    }
  }
  const suggestions = scored.filter((s) => byId.has(s.recipeId)).map((s) => toSuggestion(s.recipeId, s))
  // A search always finds a title, even one the scorer ruled out for this meal.
  if (needle) {
    const seen = new Set(suggestions.map((s) => s.recipeId))
    for (const x of pool) if (!seen.has(x.recipeId)) suggestions.push(toSuggestion(x.recipeId))
  }
  return c.json({ suggestions: suggestions.slice(0, limit ?? 20) })
})

planning.get('/weeks/:start/recommendations', async (c) => {
  const weekId = weekParam(c)
  if (!weekId) return notFound(c)
  const w = await loadWeek(c.env, weekId)
  const titles = new Map(w.candidates.map((x) => [x.recipeId, x.title]))
  const recommendations: RecommendationWire[] = weekRecommendations({
    days: w.days,
    week: w.planned,
    candidates: w.candidates,
    seed: weekId,
  })
    .filter((r) => titles.has(r.recipeId))
    .map((r) => ({
      ...r,
      title: titles.get(r.recipeId)!,
      replacesTitle: r.replaces ? (titles.get(r.replaces) ?? null) : null,
    }))
  return c.json({ recommendations })
})

planning.post('/weeks/:start/finish', jsonPost, async (c) => {
  const weekId = weekParam(c)
  if (!weekId) return notFound(c)
  await ensureWeek(c.env.DB, weekId)
  await setWeekStatus(c.env.DB, weekId, 'planned')
  await onWeekPlanned(c.env, weekId, waitUntilFor(c))
  return c.json(await weekView(c.env, weekId))
})

// --- Settings --------------------------------------------------------------

planning.get('/settings/themes', async (c) => c.json({ themes: await listThemes(c.env.DB) }))

planning.put('/settings/themes', validJson(themesSettingsSchema), async (c) => {
  const byDay = new Map(
    c.req.valid('json').themes.map((t) => [t.weekday, { ...t, tags: normalizeTags(t.tags), meals: [...new Set(t.meals)] }]),
  )
  await replaceThemes(c.env.DB, [...byDay.values()])
  return c.json({ themes: await listThemes(c.env.DB) })
})

planning.get('/settings/calendar', async (c) => c.json(await calendarStatus(c.env.DB)))

planning.put('/settings/calendar', validJson(calendarSettingsInputSchema), async (c) => {
  await setCalendarUrl(c.env.DB, c.req.valid('json').icalUrl)
  return c.json(await calendarStatus(c.env.DB))
})

planning.get('/settings/household', async (c) => c.json(await getHousehold(c.env.DB)))

planning.put('/settings/household', validJson(householdSettingsSchema), async (c) => {
  const people = [...new Set(c.req.valid('json').people.map(normalizePersonName).filter(Boolean))]
  if (people.length === 0) return bad(c, [{ message: 'at least one person' }])
  await setSetting(c.env.DB, 'household', JSON.stringify({ people }))
  return c.json(await getHousehold(c.env.DB))
})

export { planning as planningRoutes }
