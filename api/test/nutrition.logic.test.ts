import { describe, expect, it } from 'vitest'

import { gramsFor, recipeNutrition, type IngredientNutrition } from '../../shared/nutrition/recipe'
import { awayPeople, splitPortions, weekNutrition, type WeekSlotIn } from '../../shared/nutrition/week'

const flour: IngredientNutrition = {
  per100g: { kcal: 364, protein: 10, carbs: 76, fat: 1, fiber: 3 },
  unitGrams: { cup: 125 },
  typicalGrams: 250,
  confidence: 'high',
}
const egg: IngredientNutrition = {
  per100g: { kcal: 143, protein: 13, carbs: 1, fat: 10, fiber: 0 },
  unitGrams: { each: 50 },
  typicalGrams: 100,
  confidence: 'high',
}
const salt: IngredientNutrition = { per100g: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }, unitGrams: {}, typicalGrams: 3, confidence: 'high' }

describe('gramsFor', () => {
  it.each([
    [2, 'lb', egg, 907.18, true],
    [8, 'oz', egg, 226.8, true],
    [1, 'kg', egg, 1000, true],
    [1, 'cup', flour, 125, true],
    [2, 'tbsp', flour, 15.62, true], // a cup is 16 tbsp
    [1, 'cup', egg, 236.59, false], // no cup weight: water density
    [3, null, egg, 150, true], // a bare count is "each"
    [2, 'piece', egg, 100, true],
    [1, 'can', egg, 50, false], // no can weight: falls back to each
    [1, 'clove', salt, 3, false], // nothing: the typical portion
  ])('%s %s', (q, unit, n, grams, exact) => {
    const g = gramsFor(q, unit, n)!
    expect(g.grams).toBeCloseTo(grams, 1)
    expect(g.exact).toBe(exact)
  })
})

describe('recipeNutrition', () => {
  it('sums lines per serving and scores confidence', () => {
    const r = recipeNutrition(
      [
        { quantity: 2, unit: 'cup', optional: false, nutrition: flour }, // 250 g
        { quantity: 4, unit: null, optional: false, nutrition: egg }, // 200 g
        { quantity: 1, unit: 'cup', optional: true, nutrition: flour }, // optional: left out
      ],
      2,
    )
    expect(r.perServing.kcal).toBeCloseTo((364 * 2.5 + 143 * 2) / 2, 5)
    expect(r.perServing.protein).toBeCloseTo((10 * 2.5 + 13 * 2) / 2, 5)
    expect(r).toMatchObject({ confidence: 'high', lines: 2, missing: 0, servingsAssumed: false })
  })

  it('uses a typical portion with no amount, counts unknown lines as missing, and assumes 4 servings', () => {
    const r = recipeNutrition(
      [
        { quantity: null, unit: null, optional: false, nutrition: flour }, // typical 250 g, half trust
        { quantity: 1, unit: 'cup', optional: false, nutrition: null },
      ],
      null,
    )
    expect(r.perServing.kcal).toBeCloseTo((364 * 2.5) / 4, 5)
    expect(r).toMatchObject({ servings: 4, servingsAssumed: true, missing: 1, confidence: 'low' })
  })
})

describe('splitPortions', () => {
  const both = { Zach: { kcal: 2600 }, Liz: { kcal: 1800 } }
  it.each([
    [['Zach', 'Liz'], 2, both, { Zach: 1.25, Liz: 0.75 }],
    [['Zach', 'Liz'], 4, both, { Zach: 1.25, Liz: 0.75 }], // the 2 extra are guests
    [['Zach', 'Liz'], 1, both, { Zach: 0.5, Liz: 0.5 }], // fewer servings shrink both
    [['Zach', 'Liz'], 2, { Zach: { kcal: 2600 } }, { Zach: 1, Liz: 1 }], // Liz has no goal: even
    [['Liz'], 2, both, { Liz: 1 }], // Zach away
  ])('%j %s %j', (home, servings, goals, expected) => {
    const g = Object.fromEntries(Object.entries(goals).map(([p, x]) => [p, { protein: null, carbs: null, fat: null, ...x }]))
    expect(splitPortions(home, servings, g)).toEqual(expected)
  })
})

it('awayPeople reads the calendar reason', () => {
  const people = ['Zach', 'Liz']
  expect(awayPeople([{ kind: 'servings', reason: 'Liz away → cook for 1' }], people)).toEqual(['Liz'])
  expect(awayPeople([{ kind: 'eat_out', reason: 'Dinner with Liz → eating out' }], people)).toEqual([])
  expect(awayPeople([{ kind: 'servings', reason: 'Conference away → cook for 1' }], people)).toEqual([])
})

describe('weekNutrition', () => {
  const per = (kcal: number) => ({ kcal, protein: kcal / 20, carbs: 0, fat: 0, fiber: 0 })
  const recipe = (kcal: number) => ({
    title: `R${kcal}`,
    nutrition: { perServing: per(kcal), servings: 4, servingsAssumed: false, confidence: 'high' as const, score: 1, lines: 3, missing: 0 },
  })
  const slot = (date: string, meal: WeekSlotIn['meal'], kind: WeekSlotIn['kind'], recipeId: string | null = null, servings = null) =>
    ({ date, meal, kind, recipeId, servings }) as WeekSlotIn

  it('counts leftovers as the previous dinner, eat-out and empty meals as gaps, and leaves out who is away', () => {
    const r = weekNutrition({
      dates: ['2026-11-22', '2026-11-23'],
      people: ['Zach', 'Liz'],
      goals: {},
      recipes: { a: recipe(600), b: recipe(400) },
      away: { '2026-11-23': ['Liz'] },
      slots: [
        slot('2026-11-22', 'breakfast', 'recipe', 'b'),
        slot('2026-11-22', 'lunch', 'eat_out'),
        slot('2026-11-22', 'dinner', 'recipe', 'a'),
        slot('2026-11-23', 'lunch', 'leftovers'),
        slot('2026-11-23', 'dinner', 'skip'),
      ],
    })
    const [sun, mon] = r.days
    expect(sun!.people.Zach).toMatchObject({ totals: { kcal: 1000 }, known: 2, gaps: 1 })
    expect(sun!.meals.map((m) => m.status)).toEqual(['known', 'gap', 'known'])
    expect(mon!.meals[1]).toMatchObject({ status: 'known', recipeId: 'a', portions: { Zach: 1 } })
    expect(mon!.people.Liz).toMatchObject({ home: false, known: 0, gaps: 0 })
    expect(mon!.people.Zach).toMatchObject({ totals: { kcal: 600 }, known: 1, gaps: 2 }) // empty breakfast, skipped dinner
    expect(r.people.Zach).toMatchObject({ totals: { kcal: 1600 }, perDay: { kcal: 800 }, known: 3, gaps: 3, confidence: 'low' })
    expect(r.people.Liz).toMatchObject({ totals: { kcal: 1000 }, daysHome: 1 })
  })

  it('splits the first 2 servings by goals; more servings are guests', () => {
    const r = weekNutrition({
      dates: ['2026-11-22'],
      people: ['Zach', 'Liz'],
      goals: { Zach: { kcal: 2600, protein: null, carbs: null, fat: null }, Liz: { kcal: 1800, protein: null, carbs: null, fat: null } },
      recipes: { a: recipe(600) },
      away: {},
      slots: [
        slot('2026-11-22', 'lunch', 'recipe', 'a'),
        { ...slot('2026-11-22', 'dinner', 'recipe', 'a'), servings: 3.5 },
      ],
    })
    const [day] = r.days
    expect(day!.meals[1]).toMatchObject({ portions: { Zach: 1.25, Liz: 0.75 }, custom: false })
    expect(day!.meals[2]).toMatchObject({ portions: { Zach: 1.25, Liz: 0.75 }, custom: true, serves: { servings: 3.5 } })
    expect(day!.people.Zach!.totals.kcal).toBe(600 * 2.5)
    expect(day!.people.Liz!.totals.kcal).toBe(600 * 1.5)
  })
})
