import { describe, expect, it } from 'vitest'

import {
  clampServings,
  cookStartServings,
  formatServings,
  overPlanned,
  planServings,
  roundUpAmount,
  type ServingSlotIn,
} from '../../shared/household/servings'
import type { Meal, SlotKind } from '../../shared/schema'

const SUN = '2026-11-22'
const MON = '2026-11-23'
const slot = (date: string, meal: Meal, kind: SlotKind, recipeId: string | null = null, servings: number | null = null): ServingSlotIn => ({
  date,
  meal,
  kind,
  recipeId,
  servings,
})

describe('planServings', () => {
  it.each([
    // [what, slots, servings per recipe, meal looked at, expected]
    ['bagel "makes 1" for the default 2: 2 bagels', [slot(SUN, 'breakfast', 'recipe', 'bagel')], { bagel: 1 }, 'breakfast',
      { servings: 2, custom: false, factor: 2 }],
    ['a 4-serving dinner for 2 is half the recipe', [slot(SUN, 'dinner', 'recipe', 'd')], { d: 4 }, 'dinner',
      { servings: 2, factor: 0.5 }],
    ['2½ servings set while planning', [slot(SUN, 'dinner', 'recipe', 'd', 2.5)], { d: 4 }, 'dinner',
      { servings: 2.5, custom: true, factor: 0.625 }],
    ['dinner feeding a leftovers lunch; unknown servings assume 4', [slot(SUN, 'dinner', 'recipe', 'd'), slot(MON, 'lunch', 'leftovers', null, 1.5)], { d: null }, 'dinner',
      { servings: 2, leftovers: 1.5, factor: 0.875 }],
  ] as const)('%s', (_what, slots, recipeServings, meal, expected) => {
    const r = planServings({ dates: [SUN, MON], slots, recipeServings })
    expect(r.find((m) => m.date === SUN && m.meal === meal)).toMatchObject(expected)
  })

  it('steps in halves and warns only when cooking more than planned', () => {
    expect([clampServings(2.3), clampServings(0), clampServings(40)]).toEqual([2.5, 0.5, 12])
    expect(formatServings(2.5)).toBe('2½')
    expect([overPlanned(2.5, 3), overPlanned(2.5, 2.5), overPlanned(2.5, 2), overPlanned(null, 6)]).toEqual([true, false, false, false])
    expect([cookStartServings(4, null), cookStartServings(null, null), cookStartServings(1, null), cookStartServings(4, 3.5)]).toEqual([2, 2, 1, 3.5])
  })
})

describe('roundUpAmount', () => {
  it.each([
    [2, null, 2], // the bagel case: 1 bagel x 2
    [2.5, null, 3], // 4 bagels x 0.625
    [2.999, null, 3],
    [0.75 * 3, 'can', 3],
    [0.3, 'cup', 1 / 3],
    [1.5, 'cup', 1.5],
    [0.6, 'lb', 2 / 3],
    [2.3, 'tbsp', 2.333],
    [150.2, 'g', 151],
    [0.1, 'tsp', 0.25],
  ] as const)('%s %s -> %s', (q, unit, expected) => {
    expect(roundUpAmount(q, unit)).toBeCloseTo(expected, 3)
  })
})
