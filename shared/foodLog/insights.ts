// What the food log says about how we really eat. Pure: no I/O.
//
//   foodLogFacts  facts for the "What we're eating" card: outside items and
//                 chains that keep coming up, breakfast habits. Each can
//                 open the Ideas flow for a home version.
//   tuneItems     the card's "Tune" list: adjustments backed by the data,
//                 with a one-tap action only where a setting already
//                 exists (breakfast rotation), else a link or advice.

import { z } from 'zod'

import type { FoodLogItem } from '../foodLog'
import type { Fact, MealEntry } from '../mealHistory'
import { weekdayOf } from '../planningApi'
import type { Meal } from '../schema'

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// "Crisp & Green" + "Southwest Salad" -> "Crisp & Green Southwest Salad", once.
export const itemName = (i: Pick<FoodLogItem, 'label' | 'brand'>) =>
  i.brand && !key(i.label).includes(key(i.brand)) ? `${i.brand} ${i.label}` : i.label

// From outside the house: a brand or chain, not one of our recipes.
const outside = (i: FoodLogItem) => !!i.brand && !i.recipeId

interface Group {
  name: string
  dates: Set<string>
}

// Items grouped by name, counted once per date (logging for both of us is one time).
function groups(items: FoodLogItem[], by: (i: FoodLogItem) => string | null): Group[] {
  const out = new Map<string, Group>()
  for (const i of items) {
    const name = by(i)
    if (!name) continue
    const g = out.get(key(name)) ?? { name, dates: new Set<string>() }
    g.dates.add(i.date)
    out.set(key(name), g)
  }
  return [...out.values()].sort((a, b) => b.dates.size - a.dates.size || a.name.localeCompare(b.name))
}

const homeVersion = (name: string) => ({ type: 'idea' as const, query: `like: ${name}`.slice(0, 80), label: 'Make a home version' })

/** Up to 3 facts from the last 4 weeks of the log, strongest first. */
export function foodLogFacts(items: FoodLogItem[], today: string): Fact[] {
  const recent = items.filter((i) => daysBetween(i.date, today) < 28 && i.date <= today)
  const facts: Array<Fact & { w: number }> = []

  // Breakfast habit: the same brand most weekdays in the last 2 weeks.
  const weekdays = recent.filter((i) => i.meal === 'breakfast' && daysBetween(i.date, today) < 14 && weekdayOf(i.date) % 6 !== 0)
  const habit = groups(weekdays, (i) => i.brand)[0]
  if (habit && habit.dates.size >= 3) {
    const top = groups(weekdays.filter((i) => i.brand && key(i.brand) === key(habit.name)), itemName)[0]
    facts.push({
      text: `${habit.name} for breakfast ${habit.dates.size} of the last 10 weekdays.`,
      action: { type: 'idea', query: `quick weekday breakfast like ${top?.name ?? habit.name}`.slice(0, 80), label: 'Find a quick home breakfast' },
      w: 10 + habit.dates.size,
    })
  }

  // The same outside item again and again.
  for (const g of groups(recent.filter(outside), itemName).slice(0, 2)) {
    if (g.dates.size < 3) break
    if (habit && key(g.name).startsWith(key(habit.name))) continue
    facts.push({ text: `${g.name} ${g.dates.size}x this month.`, action: homeVersion(g.name), w: 8 + g.dates.size })
  }

  // How often food came from outside at all.
  const meals = new Set(recent.filter(outside).map((i) => `${i.date}|${i.meal}`))
  if (meals.size >= 6) {
    const top = groups(recent.filter(outside), (i) => i.brand)[0]
    facts.push({
      text: `${meals.size} meals or snacks from restaurants and brands in 4 weeks${top ? `, ${top.name} most (${top.dates.size})` : ''}.`,
      action: null,
      w: 4 + meals.size / 3,
    })
  }

  return facts
    .sort((a, b) => b.w - a.w)
    .slice(0, 3)
    .map(({ w: _w, ...f }) => f)
}

// --- Tune --------------------------------------------------------------------

export const tuneActionSchema = z.discriminatedUnion('type', [
  // PUT /api/settings/breakfast-lunch with this recipe added to the rotation.
  z.object({ type: z.literal('rotation_add'), recipeId: z.string(), title: z.string() }),
  // A settings page to change by hand.
  z.object({ type: z.literal('link'), to: z.string(), label: z.string() }),
])
export type TuneAction = z.infer<typeof tuneActionSchema>
export const tuneItemSchema = z.object({ text: z.string(), action: tuneActionSchema.nullable() })
export type TuneItem = z.infer<typeof tuneItemSchema>
export const tuneResponseSchema = z.object({ items: z.array(tuneItemSchema) })
export type TuneResponse = z.infer<typeof tuneResponseSchema>

export interface TuneInput {
  today: string
  people: readonly string[]
  // The last 8 weeks of the food log and of meal history.
  items: FoodLogItem[]
  history: MealEntry[]
  // Recipe ids in the breakfast rotation now, and every recipe's title.
  rotation: readonly string[]
  titles: ReadonlyMap<string, string>
  themes: ReadonlyArray<{ weekday: number; label: string; meals: readonly Meal[] }>
}

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MEAL_WORD: Record<Meal, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }

/** Up to 4 adjustments, most useful first. */
export function tuneItems(input: TuneInput): TuneItem[] {
  const { today, people, items, history } = input
  const out: TuneItem[] = []
  const recent = (days: number) => items.filter((i) => daysBetween(i.date, today) < days && i.date <= today)
  const loggedFor = new Map<string, Set<string>>()
  for (const i of items) {
    const k = `${i.date}|${i.meal}`
    loggedFor.set(k, (loggedFor.get(k) ?? new Set()).add(i.person))
  }

  // Breakfast rotation from what is actually eaten: our recipes logged for
  // breakfast at least twice in 4 weeks that the rotation lacks.
  const breakfasts = groups(
    recent(28).filter((i) => i.meal === 'breakfast' && i.recipeId && input.titles.has(i.recipeId) && !input.rotation.includes(i.recipeId)),
    (i) => i.recipeId,
  )
  for (const g of breakfasts.slice(0, 2)) {
    if (g.dates.size < 2) break
    const title = input.titles.get(g.name)!
    out.push({
      text: `You made ${title} for breakfast ${g.dates.size} times in 4 weeks, but it isn't in the breakfast rotation.`,
      action: { type: 'rotation_add', recipeId: g.name, title },
    })
  }

  // A planned meal someone keeps replacing with their own food.
  for (const meal of ['breakfast', 'lunch'] as const) {
    const planned = history.filter((e) => e.meal === meal && daysBetween(e.date, today) < 14 && (e.plannedKind === 'recipe' || e.plannedKind === 'leftovers'))
    if (planned.length < 5) continue
    const replaced = (p: string) => planned.filter((e) => loggedFor.get(`${e.date}|${meal}`)?.has(p)).length
    const who = people.filter((p) => replaced(p) / planned.length >= 0.7)
    if (!who.length) continue
    const n = Math.min(...who.map(replaced))
    out.push({
      text:
        who.length === people.length
          ? `${MEAL_WORD[meal]} was planned ${planned.length} times in 2 weeks and you both ate something else ${n} times. Plan fewer ${meal}s, or plan what you actually eat.`
          : `${who.join(' and ')} ate something else at ${meal} ${n} of ${planned.length} planned times. Cook ${meal} for ${people.length - who.length} (set servings on the Week page).`,
      action: { type: 'link', to: '/more/breakfast-lunch', label: 'Breakfast & lunch settings' },
    })
  }

  // A day theme whose dinners keep getting swapped, eaten out or replaced.
  for (const t of input.themes) {
    if (!t.meals.includes('dinner')) continue
    const nights = history.filter((e) => e.meal === 'dinner' && weekdayOf(e.date) === t.weekday && daysBetween(e.date, today) < 56)
    if (nights.length < 4) continue
    const off = nights.filter(
      (e) => e.status === 'swapped' || e.status === 'ate_out' || (loggedFor.get(`${e.date}|dinner`)?.size ?? 0) >= people.length,
    ).length
    if (off / nights.length >= 0.5) {
      out.push({
        text: `${t.label} (${DAY[t.weekday]}) dinners went another way ${off} of the last ${nights.length} times. Change or drop the theme.`,
        action: { type: 'link', to: '/more/themes', label: 'Day themes' },
      })
    }
  }

  return out.slice(0, 4)
}
