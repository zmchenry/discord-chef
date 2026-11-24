import { describe, expect, it } from 'vitest'

import { defaultMealAt, type FoodLogItem, type FoodMeal } from '../../shared/foodLog'
import { foodLogFacts } from '../../shared/foodLog/insights'
import type { MealStatus } from '../../shared/mealHistory'
import { weekNutrition, type LoggedFoodIn, type WeekSlotIn } from '../../shared/nutrition/week'
import type { Meal } from '../../shared/schema'

it.each([
  [0, 'breakfast'],
  [10 * 60 + 29, 'breakfast'],
  [10 * 60 + 30, 'lunch'],
  [14 * 60 + 29, 'lunch'],
  [14 * 60 + 30, 'snack'],
  [16 * 60 + 59, 'snack'],
  [17 * 60, 'dinner'],
  [23 * 60, 'dinner'],
] as const)('defaultMealAt(%i) is %s', (minutes, meal) => {
  expect(defaultMealAt(minutes)).toBe(meal)
})

describe('food log counting and adherence', () => {
  const DATE = '2026-11-20'
  const per = (kcal: number) => ({ kcal, protein: 0, carbs: 0, fat: 0, fiber: 0 })
  const recipe = (kcal: number) => ({
    title: `R${kcal}`,
    nutrition: { perServing: per(kcal), servings: 2, servingsAssumed: false, confidence: 'high' as const, score: 1, lines: 2, missing: 0 },
  })
  // Planned: breakfast b (400), lunch eat out, dinner a (600). 1 serving each.
  const slots: WeekSlotIn[] = [
    { date: DATE, meal: 'breakfast', kind: 'recipe', recipeId: 'b', servings: null },
    { date: DATE, meal: 'lunch', kind: 'eat_out', recipeId: null, servings: null },
    { date: DATE, meal: 'dinner', kind: 'recipe', recipeId: 'a', servings: null },
  ]
  const history = (dinner: MealStatus = 'eaten') => [
    { date: DATE, meal: 'breakfast' as Meal, status: 'eaten' as MealStatus, recipeId: 'b' },
    { date: DATE, meal: 'lunch' as Meal, status: 'ate_out' as MealStatus, recipeId: null },
    { date: DATE, meal: 'dinner' as Meal, status: dinner, recipeId: dinner === 'eaten' ? 'a' : null },
  ]
  const log = (person: string, meal: FoodMeal, kcal: number | null, recipeId: string | null = null): LoggedFoodIn => ({
    date: DATE,
    meal,
    person,
    recipeId,
    nutrients: kcal === null ? null : per(kcal),
    confidence: 'medium',
  })

  // [case, food log, dinner history, away, Zach kcal, Zach gaps, Liz kcal, Zach adherence]
  it.each([
    ['nothing logged: the plan', [], 'eaten', [], 1000, 1, 1000, { followed: 3, logged: 0, extras: 0 }],
    ['Zach logs dinner: replaces it for Zach only', [log('Zach', 'dinner', 800)], 'eaten', [], 1200, 1, 1000, { followed: 2, logged: 1 }],
    ['a snack always adds', [log('Zach', 'snack', 200)], 'eaten', [], 1200, 1, 1000, { followed: 3, extras: 1 }],
    [
      'both log the planned eat-out lunch: no gap, still followed',
      [log('Zach', 'lunch', 700), log('Liz', 'lunch', 700)],
      'eaten',
      [],
      1700,
      0,
      1700,
      { followed: 3, logged: 0 },
    ],
    ['an unknown logged dinner is a gap, not zero', [log('Zach', 'dinner', null)], 'eaten', [], 400, 2, 1000, { logged: 1 }],
    ['skipped dinner, Zach logs one', [log('Zach', 'dinner', 500)], 'skipped', [], 900, 1, 400, { followed: 2, logged: 1, skipped: 0 }],
    ['logging the planned recipe is following it', [log('Zach', 'dinner', 600, 'a')], 'eaten', [], 1000, 1, 1000, { followed: 3 }],
    ['away but logged: counts for her', [log('Liz', 'breakfast', 300)], 'eaten', ['Liz'], 1000, 1, 300, { followed: 3 }],
  ] as const)('%s', (_name, food, dinner, away, zach, zachGaps, liz, adherence) => {
    const r = weekNutrition({
      dates: [DATE],
      people: ['Zach', 'Liz'],
      goals: {},
      slots,
      recipes: { a: recipe(600), b: recipe(400) },
      away: { [DATE]: away },
      history: history(dinner),
      foodLog: food,
    })
    const day = r.days[0]!
    expect(day.people.Zach).toMatchObject({ totals: { kcal: zach }, gaps: zachGaps, plan: { kcal: 1000 }, adherence })
    expect(day.people.Liz!.totals.kcal).toBe(liz)
    expect(r.people.Liz!.daysKnown).toBe(1)
  })

  it('summarises the week: rate followed, and the plan next to what was eaten', () => {
    const r = weekNutrition({
      dates: [DATE],
      people: ['Zach', 'Liz'],
      goals: {},
      slots,
      recipes: { a: recipe(600), b: recipe(400) },
      away: {},
      history: history(),
      foodLog: [log('Zach', 'dinner', 900), log('Zach', 'snack', 150)],
    })
    expect(r.people.Zach).toMatchObject({
      perDay: { kcal: 1450 },
      planPerDay: { kcal: 1000 },
      adherence: { planned: 3, followed: 2, logged: 1, extras: 1, rate: 0.67 },
    })
    expect(r.days[0]!.meals[2]!.replacedFor).toEqual(['Zach'])
  })
})

it('foodLogFacts: a repeated chain item and a weekday breakfast habit', () => {
  const item = (date: string, meal: FoodMeal, label: string, brand: string | null): FoodLogItem => ({
    id: `${date}${label}`,
    person: 'Zach',
    date,
    meal,
    label,
    quantity: null,
    kcal: 300,
    protein: 10,
    carbs: 30,
    fat: 10,
    fiber: 2,
    source: 'estimate',
    recipeId: null,
    recipeTitle: null,
    servings: null,
    confidence: 'high',
    brand,
    createdBy: null,
    createdAt: 0,
  })
  const items = [
    ...['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'].map((d) => item(d, 'breakfast', 'Almond shaken espresso', 'Dunkin')),
    ...['2026-11-03', '2026-11-12', '2026-11-20'].map((d) => item(d, 'lunch', 'Southwest Salad', 'Crisp & Green')),
  ]
  const facts = foodLogFacts(items, '2026-11-24')
  expect(facts[0]).toMatchObject({ text: 'Dunkin for breakfast 4 of the last 10 weekdays.', action: { type: 'idea' } })
  expect(facts[1]).toEqual({
    text: 'Crisp & Green Southwest Salad 3x this month.',
    action: { type: 'idea', query: 'like: Crisp & Green Southwest Salad', label: 'Make a home version' },
  })
})
