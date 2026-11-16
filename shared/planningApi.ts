import { z } from 'zod'

import { clashSchema } from './calendarRefresh'
import { addDays, HOME_TZ, weekdayOf } from './planning/calendar'
import { isoDateSchema, mealSchema, slotKindSchema, slotSourceSchema, weekStatusSchema } from './schema'

// The wire contract for the weekly planning endpoints (api/src/planning).
// The planning engine's own types live in shared/planning/.

// ---------------------------------------------------------------------------
// Dates. Weeks run Sunday to Saturday; a week's id is its Sunday. "Today" is
// in the household timezone.

export { addDays, weekdayOf }

export function todayIn(tz = HOME_TZ, now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export const sundayOf = (iso: string): string => addDays(iso, -weekdayOf(iso))

export const weekDates = (start: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(start, i))

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export const weekIdSchema = isoDateSchema.refine((s) => !Number.isNaN(Date.parse(s)) && weekdayOf(s) === 0, {
  message: 'a week starts on a Sunday',
})

// ---------------------------------------------------------------------------
// Themes and calendar constraints

export const themeSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  label: z.string().trim().min(1).max(40),
  tags: z.array(z.string().trim().min(1).max(40)).max(10),
  meals: z.array(mealSchema).min(1),
})
export type ThemeWire = z.infer<typeof themeSchema>

export const themesSettingsSchema = z.object({ themes: z.array(themeSchema).max(7) })
export type ThemesSettings = z.infer<typeof themesSettingsSchema>

export const constraintSchema = z.object({
  kind: z.enum(['max_minutes', 'servings', 'eat_out', 'grab_and_go']),
  meals: z.array(mealSchema),
  reason: z.string(),
  minutes: z.number().optional(),
  count: z.number().optional(),
})
export type ConstraintWire = z.infer<typeof constraintSchema>

// ---------------------------------------------------------------------------
// Week

export const slotRecipeSchema = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  totalMinutes: z.number().nullable(),
})
export type SlotRecipe = z.infer<typeof slotRecipeSchema>

// Only filled slots are sent. An absent (date, meal) is empty.
export const weekSlotSchema = z.object({
  date: isoDateSchema,
  meal: mealSchema,
  kind: slotKindSchema,
  recipeId: z.string().nullable(),
  recipe: slotRecipeSchema.nullable(),
  source: slotSourceSchema,
  locked: z.boolean(),
})
export type WeekSlot = z.infer<typeof weekSlotSchema>

// One calendar event as a day card lists it: '3:30–6:30 Soccer', 'All day · Trip'.
export const dayEventSchema = z.object({
  title: z.string(),
  time: z.string(),
  allDay: z.boolean(),
})
export type DayEventWire = z.infer<typeof dayEventSchema>

export const weekDaySchema = z.object({
  date: isoDateSchema,
  weekday: z.number().int().min(0).max(6),
  theme: themeSchema.nullable(),
  constraints: z.array(constraintSchema),
  // Every event on the family calendar that day, not only those that became constraints.
  events: z.array(dayEventSchema),
})
export type WeekDay = z.infer<typeof weekDaySchema>

export const weekSummaryWireSchema = z.object({
  filled: z.number().int(),
  total: z.number().int(),
  estCostCents: z.number().nullable(),
  shared: z.array(z.object({ ingredientId: z.string(), name: z.string(), uses: z.number().int() })),
})
export type WeekSummaryWire = z.infer<typeof weekSummaryWireSchema>

// GET /api/weeks/:start
export const weekViewSchema = z.object({
  id: isoDateSchema,
  status: weekStatusSchema,
  days: z.array(weekDaySchema),
  slots: z.array(weekSlotSchema),
  summary: weekSummaryWireSchema,
  // 'none' when no calendar is configured, 'error' when it could not be read.
  calendar: z.enum(['none', 'ok', 'error']),
  // When the cached calendar was last fetched (ms), null if never.
  calendarFetchedAt: z.number().nullable(),
  // Planned meals that clash with the calendar, minus the dismissed ones.
  clashes: z.array(clashSchema),
})
export type WeekView = z.infer<typeof weekViewSchema>

// PUT /api/weeks/:start/slots/:date/:meal
export const slotSetInputSchema = z
  .object({
    kind: slotKindSchema,
    recipeId: z.string().nullable().default(null),
    locked: z.boolean().optional(),
    // 'suggested' when accepting a recommendation. Defaults to manual.
    source: z.enum(['manual', 'suggested']).default('manual'),
  })
  .refine((s) => (s.kind === 'recipe') === (s.recipeId !== null), {
    message: 'recipeId is required exactly when kind is "recipe"',
    path: ['recipeId'],
  })
export type SlotSetInput = z.input<typeof slotSetInputSchema>

// GET /api/weeks/:start/suggestions?date=&meal=&q=
export const suggestionsQuerySchema = z.object({
  date: isoDateSchema,
  meal: mealSchema,
  q: z.string().trim().max(100).optional(),
})

export const suggestionSchema = z.object({
  recipeId: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  totalMinutes: z.number().nullable(),
  score: z.number(),
  reasons: z.array(z.string()),
})
export type Suggestion = z.infer<typeof suggestionSchema>
export const suggestionsResponseSchema = z.object({ suggestions: z.array(suggestionSchema) })

// GET /api/weeks/:start/recommendations
export const recommendationSchema = z.object({
  date: isoDateSchema,
  meal: mealSchema,
  recipeId: z.string(),
  title: z.string(),
  replaces: z.string().nullable(),
  replacesTitle: z.string().nullable(),
  reason: z.string(),
  savesCents: z.number().nullable(),
})
export type RecommendationWire = z.infer<typeof recommendationSchema>
export const recommendationsResponseSchema = z.object({ recommendations: z.array(recommendationSchema) })

// ---------------------------------------------------------------------------
// Settings

// GET/PUT /api/settings/calendar. The secret iCal address is write-only: it
// is never sent back, only whether one is set, its host, and how the last
// fetch went (read from the cache; these routes never fetch).
export const calendarSettingsSchema = z.object({
  configured: z.boolean(),
  host: z.string().nullable(),
  // When the cached copy was fetched (ms), null if never.
  fetchedAt: z.number().nullable(),
  // Events in the cached copy over the next four weeks.
  eventCount: z.number().int().nullable(),
  // Why the last fetch failed, in plain words; null when it worked.
  error: z.string().nullable(),
})
export type CalendarSettings = z.infer<typeof calendarSettingsSchema>
export const calendarSettingsInputSchema = z.object({
  icalUrl: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => s.replace(/^webcal:\/\//i, 'https://'))
    .pipe(z.string().url().startsWith('https://'))
    .nullable(),
})

// GET/PUT /api/settings/household
export const householdSettingsSchema = z.object({
  people: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
})
export type HouseholdSettings = z.infer<typeof householdSettingsSchema>
