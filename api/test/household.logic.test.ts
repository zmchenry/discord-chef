import { describe, expect, it } from 'vitest'

import type { HomeMeal, Member } from '../../shared/household'
import {
  defaultPortions,
  householdMembers,
  planServings,
  roundUpAmount,
  servesText,
  type ServingSlotIn,
} from '../../shared/household/servings'
import type { Meal, SlotKind } from '../../shared/schema'

const ALL: HomeMeal[] = ['breakfast', 'lunch', 'dinner', 'snack']
const adult = (name: string, meals = ALL): Member => ({ name, kind: 'adult', portion: 1, meals })
const kid = (name: string, portion = 0.5, meals = ALL): Member => ({ name, kind: 'kid', portion, meals })
const family = [adult('Zach'), adult('Liz'), kid('Kid 1'), kid('Kid 2')]
const SUN = '2026-11-22'
const MON = '2026-11-23'
const slot = (date: string, meal: Meal, kind: SlotKind, recipeId: string | null = null): ServingSlotIn => ({
  date,
  meal,
  kind,
  recipeId,
  portions: null,
})
const goals = { Zach: { kcal: 2600, protein: null, carbs: null, fat: null }, Liz: { kcal: 1800, protein: null, carbs: null, fat: null } }

describe('planServings', () => {
  it.each([
    // [what, members, slots, servings per recipe, away, meal looked at, expected]
    ['bagel: 2 adults + 2 half kids, 1-bagel serving', family, [slot(SUN, 'breakfast', 'recipe', 'bagel')], { bagel: 1 }, {}, 'breakfast',
      { total: 3, adults: 2, kids: 2, factor: 3 }],
    ['4-serving dinner for 2 adults + 2 kids', family, [slot(SUN, 'dinner', 'recipe', 'd')], { d: 4 }, {}, 'dinner',
      { total: 3, factor: 0.75 }],
    ['dinner feeding a leftovers lunch', family, [slot(SUN, 'dinner', 'recipe', 'd'), slot(MON, 'lunch', 'leftovers')], { d: 4 }, {}, 'dinner',
      { total: 3, leftovers: 3, factor: 1.5 }],
    ['unknown servings assume 4; an away adult is left out', family, [slot(SUN, 'dinner', 'recipe', 'd')], { d: null }, { [SUN]: ['Liz'] }, 'dinner',
      { total: 2, adults: 1, kids: 2, factor: 0.5 }],
    ['kids at school miss lunch', [adult('Zach'), kid('Kid 1', 0.5, ['breakfast', 'dinner'])], [slot(SUN, 'lunch', 'recipe', 'l')], { l: 2 }, {}, 'lunch',
      { total: 1, adults: 1, kids: 0, factor: 0.5 }],
    ['a stored split overrides', family, [{ ...slot(SUN, 'dinner', 'recipe', 'd'), portions: { Zach: 2, 'Kid 1': 0 } }], { d: 4 }, {}, 'dinner',
      { total: 3.5, kids: 1, custom: true, factor: 0.875 }],
  ] as const)('%s', (_what, members, slots, recipeServings, away, meal, expected) => {
    const r = planServings({ dates: [SUN, MON], members, goals: {}, slots, away, recipeServings })
    expect(r.find((m) => m.date === SUN && m.meal === meal)).toMatchObject(expected)
  })

  it('splits adults by goals and gives kids their portion', () => {
    expect(defaultPortions(family, goals)).toEqual({ Zach: 1.25, Liz: 0.75, 'Kid 1': 0.5, 'Kid 2': 0.5 })
    expect(servesText({ adults: 2, kids: 2, total: 3 })).toBe('Serves 3 (2 adults, 2 kids)')
    expect(servesText({ adults: 1, kids: 1, total: 1.5 })).toBe('Serves 1½ (1 adult, 1 kid)')
  })

  it('names kids and keeps adults in household order', () => {
    const m = householdMembers(['Zach', 'Liz'], [kid(''), adult('Liz', ['dinner']), kid('zach'), adult('Ghost')])
    expect(m.map((x) => [x.name, x.meals.length])).toEqual([['Zach', 4], ['Liz', 1], ['Kid 1', 4], ['zach 1', 4]])
  })
})

describe('roundUpAmount', () => {
  it.each([
    [3, null, 3], // the bagel case: 1 bagel x 3
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
