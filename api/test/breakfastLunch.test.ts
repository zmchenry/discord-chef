import { describe, expect, it } from 'vitest'

import { defaultRotation, defaultStaples, fillBreakfastLunch, type BLRecipe } from '../../shared/planning/breakfastLunch'
import type { Constraint } from '../../shared/planning/calendar'
import type { PlannedSlot } from '../../shared/planning/engine'

const DATES = ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28']
const r = (id: string, tags: string[], over: Partial<BLRecipe> = {}): BLRecipe => ({
  id,
  title: id,
  tags,
  totalMinutes: 15,
  servings: 4,
  ...over,
})
const RECIPES = [
  r('oats', ['breakfast'], { totalMinutes: 5 }),
  r('eggs', ['breakfast']),
  r('pancakes', ['breakfast'], { totalMinutes: 30 }),
  r('turkey', ['lunch']),
  r('soup', ['lunch']),
  r('chili', ['dinner', 'makes-leftovers']),
  r('lasagna', ['dinner'], { servings: 8 }),
  r('steak', ['dinner'], { servings: 2 }),
]
const dinner = (date: string, recipeId: string): PlannedSlot => ({ date, meal: 'dinner', kind: 'recipe', recipeId, locked: false, source: 'manual' })
const grab: Constraint = { kind: 'grab_and_go', meals: ['breakfast'], reason: 'Dentist 7:15 → grab-and-go breakfast' }

const fill = (over: Partial<Parameters<typeof fillBreakfastLunch>[0]> = {}) => {
  const out = fillBreakfastLunch({
    dates: DATES,
    slots: [],
    constraints: {},
    recipes: RECIPES,
    rotation: ['oats', 'eggs', 'pancakes'],
    cursor: 0,
    staples: ['turkey', 'soup'],
    prevDinnerId: null,
    ...over,
  })
  const at = (meal: string) => DATES.map((d) => {
    const s = out.filled.find((x) => x.date === d && x.meal === meal)
    return s ? (s.recipeId ?? s.kind) : '-'
  })
  return { breakfast: at('breakfast'), lunch: at('lunch'), next: out.nextCursor, filled: out.filled }
}

describe('fillBreakfastLunch', () => {
  it.each([
    ['cycles the rotation from the cursor and returns where next week starts', { cursor: 2 },
      ['pancakes', 'oats', 'eggs', 'pancakes', 'oats', 'eggs', 'pancakes'], 0],
    ['a grab-and-go morning swaps a slow pick for the next quick one', { constraints: { '2026-11-24': [grab] } },
      ['oats', 'eggs', 'oats', 'oats', 'eggs', 'pancakes', 'oats'], 1],
    ['an empty rotation leaves breakfasts empty', { rotation: [] }, ['-', '-', '-', '-', '-', '-', '-'], 0],
  ] as const)('breakfast: %s', (_n, over, breakfast, next) => {
    const out = fill(over as never)
    expect(out.breakfast).toEqual(breakfast)
    expect(out.next).toBe(next)
  })

  it.each([
    ['staples cycle when no dinner makes leftovers', {}, ['turkey', 'soup', 'turkey', 'soup', 'turkey', 'soup', 'turkey']],
    ['leftovers the day after a makes-leftovers or 6+ serving dinner (and last Saturday\'s)',
      { slots: [dinner('2026-11-22', 'chili'), dinner('2026-11-23', 'steak'), dinner('2026-11-24', 'lasagna')], prevDinnerId: 'chili' },
      ['leftovers', 'leftovers', 'turkey', 'leftovers', 'soup', 'turkey', 'soup']],
    ['eat-out lunch from the calendar', { constraints: { '2026-11-23': [{ kind: 'eat_out', meals: ['lunch'], reason: 'Lunch out' }] } },
      ['turkey', 'eat_out', 'soup', 'turkey', 'soup', 'turkey', 'soup']],
  ] as const)('lunch: %s', (_n, over, lunch) => {
    expect(fill(over as never).lunch).toEqual(lunch)
  })

  it('never touches filled or locked slots', () => {
    const slots: PlannedSlot[] = [
      { date: '2026-11-22', meal: 'breakfast', kind: 'skip', recipeId: null, locked: false, source: 'manual' },
      { date: '2026-11-23', meal: 'lunch', kind: 'recipe', recipeId: null, locked: true, source: 'manual' },
      { date: '2026-11-24', meal: 'lunch', kind: 'recipe', recipeId: 'soup', locked: false, source: 'auto' },
    ]
    const out = fill({ slots })
    expect(out.breakfast[0]).toBe('-')
    expect(out.lunch.slice(0, 3)).toEqual(['turkey', '-', '-'])
    expect(out.filled.every((s) => s.source === 'auto' && !s.locked)).toBe(true)
  })

  it('defaults: most-planned breakfasts, then the turkey staple or any lunch', () => {
    const counted = RECIPES.map((x, i) => ({ ...x, timesPlanned: i }))
    expect(defaultRotation(counted)).toEqual(['pancakes', 'eggs', 'oats'])
    expect(defaultStaples(counted)).toEqual(['soup'])
    expect(defaultStaples([...counted, r('t', ['lunch'], { title: 'Turkey and Cheese with Veggies' })])).toEqual(['t'])
  })
})
