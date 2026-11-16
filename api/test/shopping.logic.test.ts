import { describe, expect, it } from 'vitest'

import { aggregate, formatAmount, type AggregateSlot, type SlotIngredient } from '../../shared/shopping/aggregate'
import { learnedRanks, sortItems, type SortableItem } from '../../shared/shopping/sort'
import { recommendStore } from '../../shared/shopping/store'
import { splitTrips } from '../../shared/shopping/trips'
import { defaultShoppingWeek, formatWeekRange, weekIdFor } from '../../shared/shopping/week'

const ing = (ingredientId: number | null, name: string, quantity: number | null = null, unit: string | null = null, perishable = false): SlotIngredient => ({
  ingredientId,
  name,
  quantity,
  unit,
  section: null,
  perishable,
})
const slot = (day: number, recipeId: string, ingredients: SlotIngredient[], scale?: number): AggregateSlot => ({ day, recipeId, ingredients, scale })

describe('aggregate', () => {
  const cases: Array<[string, AggregateSlot[], Array<[string, string | null, string[]]>]> = [
    ['sums matching units', [slot(0, 'a', [ing(1, 'flour', 1, 'cup')]), slot(1, 'b', [ing(1, 'flour', 0.5, 'cup')])], [['flour', '1½ cups', ['a', 'b']]]],
    ['keeps different units side by side', [slot(0, 'a', [ing(1, 'butter', 1, 'cup')]), slot(1, 'b', [ing(1, 'butter', 2, 'tbsp')])], [['butter', '1 cup + 2 tbsp', ['a', 'b']]]],
    ['sums plain counts', [slot(0, 'a', [ing(2, 'bell pepper', 3)]), slot(2, 'b', [ing(2, 'bell pepper', 1)])], [['bell pepper', '4', ['a', 'b']]]],
    ['lists items with no quantity', [slot(0, 'a', [ing(3, 'salt')]), slot(1, 'a', [ing(3, 'salt')])], [['salt', null, ['a']]]],
    ['quantity wins over a missing one', [slot(0, 'a', [ing(4, 'milk')]), slot(1, 'b', [ing(4, 'milk', 2, 'cup')])], [['milk', '2 cups', ['a', 'b']]]],
    ['groups unmatched lines by name', [slot(0, 'a', [ing(null, 'Saffron', 1, 'pinch')]), slot(1, 'b', [ing(null, 'saffron', 1, 'pinch')])], [['Saffron', '2 pinches', ['a', 'b']]]],
    ['scales by planned servings', [slot(0, 'a', [ing(5, 'chicken thighs', 1, 'lb')], 2)], [['chicken thighs', '2 lb', ['a']]]],
  ]
  it.each(cases)('%s', (_name, slots, expected) => {
    expect(aggregate(slots).map((i) => [i.name, formatAmount(i.parts), i.recipeIds])).toEqual(expected)
  })
})

describe('splitTrips', () => {
  const slots = [
    { day: 1, recipeId: 'mon' },
    { day: 4, recipeId: 'thu' },
    { day: 6, recipeId: 'sat' },
    { day: 2, recipeId: 'tueAndFri' },
    { day: 5, recipeId: 'tueAndFri' },
  ]
  const cases: Array<[string, { perishable: boolean; recipeIds: string[] }, 'weekend' | 'midweek']> = [
    ['perishable, only Thu-Sat recipes', { perishable: true, recipeIds: ['thu', 'sat'] }, 'midweek'],
    ['perishable, one recipe early in the week', { perishable: true, recipeIds: ['thu', 'mon'] }, 'weekend'],
    ['perishable, a recipe planned Tue and Fri', { perishable: true, recipeIds: ['tueAndFri'] }, 'weekend'],
    ['pantry item for a Saturday recipe', { perishable: false, recipeIds: ['sat'] }, 'weekend'],
    ['no recipes', { perishable: true, recipeIds: [] }, 'weekend'],
  ]
  it.each(cases)('%s', (_name, item, trip) => {
    const split = splitTrips([item], slots)
    expect(split[trip]).toEqual([item])
  })
})

describe('sortItems', () => {
  const item = (name: string, section: string | null, extra: Partial<SortableItem> = {}): SortableItem => ({
    ingredientId: null,
    name,
    section,
    manualRank: null,
    checked: false,
    ...extra,
  })
  const items = [
    item('milk', 'Dairy & Eggs', { ingredientId: 1, manualRank: 0 }),
    item('apples', 'Produce', { ingredientId: 2, manualRank: 2, checked: true }),
    item('bananas', 'Produce', { ingredientId: 3, manualRank: 1 }),
    item('cards', null, { manualRank: 3 }),
    item('carrots', 'Produce', { ingredientId: 4, manualRank: 4 }),
  ]
  const store = { sectionOrder: ['Produce', 'Dairy & Eggs'] }
  const learned = { sections: { 'Dairy & Eggs': 0.1 }, ingredients: { '4': 0.2, '3': 0.9 } }
  const flat = (mode: Parameters<typeof sortItems>[1]) =>
    sortItems(items, mode, store, learned).map((g) => `${g.section ?? '-'}: ${g.items.map((i) => i.name).join(' ')}`)

  it.each([
    ['aisle', ['Produce: bananas carrots apples', 'Dairy & Eggs: milk', '-: cards']],
    ['alpha', ['-: bananas cards carrots milk apples']],
    ['manual', ['-: milk bananas cards carrots apples']],
    ['smart', ['Dairy & Eggs: milk', 'Produce: carrots bananas apples', '-: cards']],
  ] as const)('%s', (mode, expected) => {
    expect(flat(mode)).toEqual(expected)
  })
})

describe('learnedRanks', () => {
  const trip = (listId: number, ids: number[]) =>
    ids.map((ingredientId, i) => ({ listId, ingredientId, section: ingredientId < 10 ? 'Produce' : 'Dairy & Eggs', checkedAt: i }))
  it('averages relative positions across trips, and needs two trips', () => {
    expect(learnedRanks(trip(1, [1, 2, 11]))).toEqual({ sections: {}, ingredients: {} })
    const r = learnedRanks([...trip(1, [1, 2, 11]), ...trip(2, [11, 1, 2])])
    expect(r.ingredients).toEqual({ '1': 0.25, '2': 0.75, '11': 0.5 })
    expect(r.sections).toEqual({ Produce: 0.5, 'Dairy & Eggs': 0.5 })
  })
})

describe('recommendStore', () => {
  const items = [{ ingredientId: 1 }, { ingredientId: 2 }, { ingredientId: 3 }, { ingredientId: null }]
  const price = (storeId: number, ingredientId: number, cents: number) => ({ storeId, ingredientId, cents })
  it.each([
    ['cheapest store with enough prices', [price(1, 1, 300), price(1, 2, 300), price(1, 3, 300), price(2, 1, 200), price(2, 2, 200), price(2, 3, 200)], { storeId: 2, cents: 600 }],
    ['a cheap store with too few prices is skipped', [price(1, 1, 300), price(1, 2, 300), price(1, 3, 300), price(2, 1, 50)], { storeId: 1, cents: 900 }],
    ['nothing qualifies', [price(1, 1, 100), price(1, 2, 100)], null],
  ] as const)('%s', (_name, prices, expected) => {
    expect(recommendStore(items, prices)).toEqual(expected)
  })
})

describe('weeks', () => {
  it('uses the New York Sunday, and next week on Saturdays', () => {
    // 2026-11-16 02:00 UTC is still Sunday Nov 15 in New York.
    expect(weekIdFor(new Date('2026-11-16T02:00:00Z'))).toBe('2026-11-15')
    expect(weekIdFor(new Date('2026-11-19T15:00:00Z'))).toBe('2026-11-15')
    expect(defaultShoppingWeek(new Date('2026-11-21T15:00:00Z'))).toBe('2026-11-22')
    expect(formatWeekRange('2026-11-29')).toBe('Nov 29 – Dec 5')
  })
})
