import { describe, expect, it } from 'vitest'

import {
  eatenRecipeId,
  historyFacts,
  historyStats,
  isEaten,
  resolveEntries,
  resolveEntry,
  type MealLog,
  type PlanSlotLite,
  type RecipeMeta,
} from '../../shared/mealHistory'
import { addDays } from '../../shared/planningApi'

const NOW = { date: '2026-11-24', minutes: 18 * 60 } // 6pm: lunch is over, dinner is not

const slot = (date: string, meal: PlanSlotLite['meal'], kind: PlanSlotLite['kind'], recipeId: string | null = null): PlanSlotLite => ({
  date,
  meal,
  kind,
  recipeId: kind === 'recipe' ? (recipeId ?? 'r1') : null,
})
const log = (date: string, meal: MealLog['meal'], over: Partial<MealLog>): MealLog => ({
  date,
  meal,
  status: 'eaten',
  recipeId: null,
  freeText: null,
  rating: null,
  note: null,
  loggedBy: 'zach',
  ...over,
})

describe('resolveEntry: a past planned meal counts as eaten unless marked otherwise', () => {
  it.each([
    // name, slot, log, expected (null = no entry): status, confirmed, eatenRecipeId, isEaten
    ['yesterday’s planned recipe, nothing logged', slot('2026-11-23', 'dinner', 'recipe'), null, ['eaten', false, 'r1', true]],
    ['today’s dinner before 7pm is still to come', slot('2026-11-24', 'dinner', 'recipe'), null, null],
    ['today’s lunch after 2pm is over', slot('2026-11-24', 'lunch', 'recipe'), null, ['eaten', false, 'r1', true]],
    ['tomorrow is never assumed', slot('2026-11-25', 'breakfast', 'recipe'), null, null],
    ['planned eat out', slot('2026-11-23', 'dinner', 'eat_out'), null, ['ate_out', false, null, false]],
    ['planned skip', slot('2026-11-23', 'lunch', 'skip'), null, ['skipped', false, null, false]],
    ['planned leftovers are eaten, with no recipe', slot('2026-11-23', 'lunch', 'leftovers'), null, ['eaten', false, null, true]],
    ['marked skipped', slot('2026-11-23', 'dinner', 'recipe'), log('2026-11-23', 'dinner', { status: 'skipped' }), ['skipped', true, null, false]],
    ['swapped for another recipe', slot('2026-11-23', 'dinner', 'recipe'), log('2026-11-23', 'dinner', { status: 'swapped', recipeId: 'r2' }), ['swapped', true, 'r2', false]],
    ['swapped for free text', slot('2026-11-23', 'dinner', 'recipe'), log('2026-11-23', 'dinner', { status: 'swapped', freeText: 'Pizza' }), ['swapped', true, null, false]],
    ['confirmed eaten keeps the planned recipe', slot('2026-11-23', 'dinner', 'recipe'), log('2026-11-23', 'dinner', {}), ['eaten', true, 'r1', true]],
    ['logged with nothing planned', null, log('2026-11-23', 'lunch', { status: 'swapped', freeText: 'Soup' }), ['swapped', true, null, false]],
    ['nothing planned, nothing logged', null, null, null],
  ] as const)('%s', (_name, s, l, expected) => {
    const e = resolveEntry(s, l, NOW)
    if (expected === null) return expect(e).toBeNull()
    expect([e!.status, e!.confirmed, eatenRecipeId(e!), isEaten(e!)]).toEqual(expected)
  })

  it('merges plan and log into one entry per meal, newest first', () => {
    const entries = resolveEntries(
      [slot('2026-11-23', 'dinner', 'recipe'), slot('2026-11-24', 'breakfast', 'recipe'), slot('2026-11-24', 'dinner', 'recipe')],
      [log('2026-11-23', 'dinner', { rating: 1 }), log('2026-11-23', 'lunch', { status: 'ate_out' })],
      NOW,
    )
    expect(entries.map((e) => `${e.date} ${e.meal} ${e.status}${e.rating ? ' 👍' : ''}`)).toEqual([
      '2026-11-24 breakfast eaten',
      '2026-11-23 dinner eaten 👍',
      '2026-11-23 lunch ate_out',
    ])
  })
})

// ---------------------------------------------------------------------------

const meta = (title: string, ingredients: string[], tags: string[] = ['dinner'], produce = 1): RecipeMeta => ({
  title,
  icon: null,
  imageUrl: null,
  tags,
  ingredients,
  produce,
})
const META = new Map<string, RecipeMeta>([
  ['curry', meta('Butter Chicken', ['chicken thighs', 'cream'], ['dinner', 'indian'])],
  ['tacos', meta('Chicken Tacos', ['chicken breast', 'tortillas'], ['dinner', 'mexican'])],
  ['salmon', meta('Sheet Pan Salmon', ['salmon', 'broccoli'])],
  ['chili', meta('Bean Chili', ['black beans', 'onion'], ['dinner', 'mexican'])],
])
const TODAY = '2026-11-23'

// 14 dinners back from yesterday: chicken most nights, one ate-out, Butter
// Chicken loved 6 weeks ago.
function dinners() {
  const plan: Array<[number, string | null]> = [
    [1, 'tacos'], [2, 'tacos'], [3, null], [4, 'chili'], [5, 'tacos'], [6, 'tacos'], [7, 'salmon'],
    [8, 'tacos'], [9, 'tacos'], [10, 'chili'], [11, 'tacos'], [12, 'tacos'], [13, 'chili'], [14, 'tacos'],
  ]
  const slots = plan.map(([ago, id]) => slot(addDays(TODAY, -ago), 'dinner', id ? 'recipe' : 'eat_out', id))
  slots.push(slot(addDays(TODAY, -42), 'dinner', 'recipe', 'curry'), slot(addDays(TODAY, -45), 'dinner', 'recipe', 'curry'))
  const logs = [log(addDays(TODAY, -42), 'dinner', { rating: 1 }), log(addDays(TODAY, -45), 'dinner', { rating: 1 })]
  return resolveEntries(slots, logs, { date: TODAY, minutes: 12 * 60 })
}

describe('historyStats', () => {
  it('counts most-made, variety, protein and cuisine mix, eating out and the home streak', () => {
    const s = historyStats(dinners(), META, TODAY)
    expect(s).toMatchObject({
      meals: 16,
      cooked: 15,
      ateOut: 1,
      skipped: 0,
      variety: { last4: 3, prev4: 1 },
      homeDinnerStreak: { current: 2, best: 13 },
    })
    expect(s.mostMade.map((m) => [m.title, m.count, m.up])).toEqual([
      ['Chicken Tacos', 9, 0],
      ['Bean Chili', 3, 0],
      ['Butter Chicken', 2, 2],
      ['Sheet Pan Salmon', 1, 0],
    ])
    expect(s.proteins).toEqual([
      { label: 'Chicken', count: 11 },
      { label: 'Beans & lentils', count: 3 },
      { label: 'Fish', count: 1 },
    ])
    expect(s.cuisines).toEqual([
      { label: 'Mexican', count: 12 },
      { label: 'Indian', count: 2 },
    ])
  })
})

describe('historyFacts', () => {
  it('names the dominant protein and a loved recipe not had in weeks, with actions', () => {
    const facts = historyFacts(dinners(), META, TODAY)
    expect(facts).toContainEqual({
      text: 'Chicken in 9 of the last 14 dinners. Try shrimp & shellfish one night.',
      action: { type: 'idea', query: 'shrimp & shellfish dinner' },
    })
    expect(facts).toContainEqual({
      text: "You rated Butter Chicken 👍 every time but haven't had it in 6 weeks.",
      action: { type: 'recipe', recipeId: 'curry', title: 'Butter Chicken' },
    })
    expect(facts).toContainEqual({ text: 'Chicken Tacos 9 times lately, the most of anything.', action: null })
  })
})
