import { describe, expect, it } from 'vitest'

import {
  averageDays,
  gramsFromSplit,
  kcalFromGrams,
  normalizeGoals,
  splitFromGrams,
  versusGoal,
} from '../../shared/nutrition/goals'

describe('gramsFromSplit', () => {
  it.each([
    // kcal, P/C/F %, grams
    [2400, [30, 40, 30], { protein: 180, carbs: 240, fat: 80 }],
    [1800, [25, 50, 25], { protein: 113, carbs: 225, fat: 50 }],
    [2000, [40, 30, 30], { protein: 200, carbs: 150, fat: 67 }],
    [0, [30, 40, 30], { protein: 0, carbs: 0, fat: 0 }],
  ])('%i kcal at %j', (kcal, [protein, carbs, fat], grams) => {
    expect(gramsFromSplit(kcal, { protein: protein!, carbs: carbs!, fat: fat! })).toEqual(grams)
  })

  it('round-trips through splitFromGrams and adds back up to the calories', () => {
    const g = gramsFromSplit(2400, { protein: 30, carbs: 40, fat: 30 })
    expect(splitFromGrams({ kcal: 2400, ...g })).toEqual({ protein: 30, carbs: 40, fat: 30 })
    expect(kcalFromGrams(g)).toBe(2400)
    expect(splitFromGrams({ kcal: 2400, protein: 180, carbs: null, fat: 80 })).toBeNull()
  })
})

describe('versusGoal', () => {
  it.each([
    [1800, 2400, { ratio: 0.75, left: 600, over: 0 }],
    [2600, 2400, { ratio: 2600 / 2400, left: 0, over: 200 }],
    [500, null, { ratio: null, left: null, over: null }],
    [500, 0, { ratio: null, left: null, over: null }],
  ])('%i vs %s', (value, goal, out) => {
    expect(versusGoal(value, goal)).toEqual(out)
  })
})

describe('averageDays', () => {
  const n = (kcal: number) => ({ kcal, protein: kcal / 10, carbs: 0, fat: 0, fiber: 0 })
  const day = (kcal: number, known: number, gaps: number, home = true) => ({ home, totals: n(kcal), known, gaps })

  it.each([
    ['all known', [day(2000, 3, 0), day(2200, 3, 0)], { kcal: 2100, days: 2, partial: 0, unknown: 0 }],
    // An unknown day is left out, not counted as zero.
    ['an unknown day', [day(2000, 3, 0), day(0, 0, 3)], { kcal: 2000, days: 1, partial: 0, unknown: 1 }],
    ['a partial day', [day(2000, 3, 0), day(1000, 2, 1)], { kcal: 1500, days: 2, partial: 1, unknown: 0 }],
    ['away days', [day(2000, 3, 0), day(0, 0, 0, false)], { kcal: 2000, days: 1, partial: 0, unknown: 0 }],
    ['nothing known', [day(0, 0, 3), day(0, 0, 3)], { kcal: null, days: 0, partial: 0, unknown: 2 }],
  ])('%s', (_name, days, out) => {
    const a = averageDays(days)
    expect({ kcal: a.perDay?.kcal ?? null, days: a.days, partial: a.partial, unknown: a.unknown }).toEqual(out)
  })
})

describe('normalizeGoals', () => {
  it.each([
    ['current shape', { Zach: { kcal: 2400, protein: 180, carbs: 240, fat: 80, fiber: 35 } }, { kcal: 2400, protein: 180, carbs: 240, fat: 80, fiber: 35 }],
    ['first version (no fiber)', { Zach: { kcal: 2400, protein: 150, carbs: null, fat: null } }, { kcal: 2400, protein: 150, carbs: null, fat: null, fiber: null }],
    ['row list, odd values', [{ person: 'Zach', kcal: '2400', protein: -5, fat: 80.4 }], { kcal: 2400, protein: null, carbs: null, fat: 80, fiber: null }],
  ])('%s', (_name, raw, zach) => {
    expect(normalizeGoals(raw).Zach).toEqual(zach)
  })

  it('reads junk as no goals', () => {
    expect(normalizeGoals('nope')).toEqual({})
    expect(normalizeGoals(null)).toEqual({})
  })
})
