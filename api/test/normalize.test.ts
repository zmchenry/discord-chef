import { describe, expect, it } from 'vitest'

import {
  normalizeIngredientName,
  normalizeRecipeTitle,
  normalizeSectionName,
  normalizeStoreName,
  normalizeTag,
  parseIngredientLine,
} from '../../shared/normalize'

// A compact table of the messy real-world cases the naming rules exist for.
describe('naming rules', () => {
  it.each([
    [normalizeRecipeTitle, '  bacon &amp; lettuce sandwiches ', 'Bacon and Lettuce Sandwiches'],
    [normalizeRecipeTitle, 'chili oil dressed noodles with beef', 'Chili Oil Dressed Noodles with Beef'],
    [normalizeRecipeTitle, 'beef stir-fry', 'Beef Stir-Fry'],
    [normalizeRecipeTitle, 'BLT wraps', 'BLT Wraps'],
    [normalizeRecipeTitle, "reese's peanut butter pie.", "Reese's Peanut Butter Pie"],
    [normalizeIngredientName, '1/2 cup Sour Cream', 'sour cream'],
    [normalizeIngredientName, '1 (10oz) can cream of chicken soup', 'cream of chicken soup'],
    [normalizeIngredientName, '2 lbs chicken thighs', 'chicken thighs'],
    [normalizeTag, '  Order Out ', 'order-out'],
    [normalizeStoreName, "  trader   joe's ", "Trader Joe's"],
    [normalizeSectionName, 'Fruit/Veg', 'Produce'],
    [normalizeSectionName, 'Non-Parishable/Bread', 'Pantry'],
  ] as Array<[(s: string) => string, string, string]>)('%o(%j) = %j', (fn, input, expected) => {
    expect(fn(input)).toBe(expected)
    expect(fn(expected)).toBe(expected) // idempotent
  })

  it.each([
    ['1 1/2 cups flour, sifted', { quantity: 1.5, unit: 'cup', name: 'flour', note: 'sifted' }],
    ['½ tsp salt', { quantity: 0.5, unit: 'tsp', name: 'salt', note: null }],
    ['2-3 Tbsp. honey', { quantity: 2, unit: 'tbsp', name: 'honey', note: null }],
    ['1 (10oz) can soup', { quantity: 1, unit: 'can', name: 'soup', note: '10oz' }],
    ['pinch of salt', { quantity: null, unit: 'pinch', name: 'salt', note: null }],
  ])('parseIngredientLine(%j)', (input, expected) => {
    expect(parseIngredientLine(input)).toEqual(expected)
  })

  it('rejects an unknown store section', () => {
    expect(() => normalizeSectionName('Garden Center')).toThrow(/unknown store section/)
  })
})
