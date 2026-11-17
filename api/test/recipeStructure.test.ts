import { describe, expect, it } from 'vitest'

import { findTechniques, formatAmount, groupIngredients, parseSteps, stepLabel } from '../../shared/recipeStructure'

describe('parseSteps', () => {
  it.each([
    ['legacy strings', ['Brown the beef.', '  ', 'Simmer.'], [
      { title: null, text: 'Brown the beef.', ingredientRefs: [] },
      { title: null, text: 'Simmer.', ingredientRefs: [] },
    ]],
    ['structured steps', [{ title: 'Brown the sausage', text: 'A.\n\nB.', ingredientRefs: [0, 2, 2] }], [
      { title: 'Brown the sausage', text: 'A.\n\nB.', ingredientRefs: [0, 2] },
    ]],
    ['mixed, with junk', ['Mix.', { text: 'Bake.', title: '' }, null, 3, { ingredientRefs: [1] }, { text: 'Rest.', ingredientRefs: [-1, 1.5, 'x', 4] }], [
      { title: null, text: 'Mix.', ingredientRefs: [] },
      { title: null, text: 'Bake.', ingredientRefs: [] },
      { title: null, text: 'Rest.', ingredientRefs: [4] },
    ]],
  ])('%s', (_name, input, expected) => {
    expect(parseSteps(input as unknown[])).toEqual(expected)
  })

  it('labels steps from 1', () => {
    expect(stepLabel({ title: 'Whisk the egg base', text: '', ingredientRefs: [] }, 2)).toBe('Step 3: Whisk the egg base')
    expect(stepLabel({ title: null, text: 'x', ingredientRefs: [] }, 0)).toBe('Step 1')
  })
})

describe('groupIngredients', () => {
  const g = (...labels: Array<string | null>) => labels.map((group, i) => ({ i, group }))
  it.each([
    ['no groups', g(null, null), [[null, [0, 1]]]],
    ['first-appearance order', g('egg base', 'egg base', 'fillings', 'egg base'), [['egg base', [0, 1, 3]], ['fillings', [2]]]],
    ['ungrouped items form one null group', g(null, 'sauce', null, 'sauce'), [[null, [0, 2]], ['sauce', [1, 3]]]],
  ] as Array<[string, Array<{ i: number; group: string | null }>, Array<[string | null, number[]]>]>)('%s', (_n, items, expected) => {
    expect(groupIngredients(items).map((x) => [x.group, x.items.map((y) => y.i)])).toEqual(expected)
  })
})

describe('findTechniques', () => {
  const found = (text: string) => findTechniques(text).map((s) => [s.key, s.term, text.slice(s.start, s.end)])
  it.each([
    ['Sauté the onions, then sear the beef.', [['saute', 'Sauté', 'Sauté'], ['sear', 'sear', 'sear']]],
    ['Keep sautéing until soft.', [['saute', 'sautéing', 'sautéing']]],
    ['Bake for 20 minutes on a baking sheet with baking soda.', [['bake', 'Bake', 'Bake']]],
    ['Stir-fry the greens. Stir fry again.', [['stir-fry', 'Stir-fry', 'Stir-fry'], ['stir-fry', 'Stir fry', 'Stir fry']]],
    ['Reduce the heat and let the sauce reduce by half.', [['reduce', 'reduce', 'reduce']]],
    ['Add the rest of the cheese. Let it rest 5 minutes.', [['rest', 'rest', 'rest']]],
    ['Check the temperature; research the searchable broiler.', []],
    ['Whisk the eggs, fold in the cheese, then simmer, deglaze and broil.', [
      ['whisk', 'Whisk', 'Whisk'], ['fold', 'fold', 'fold'], ['simmer', 'simmer', 'simmer'],
      ['deglaze', 'deglaze', 'deglaze'], ['broil', 'broil', 'broil'],
    ]],
  ])('%s', (text, expected) => {
    expect(found(text)).toEqual(expected)
  })
})

describe('formatAmount', () => {
  it.each([
    [1, 'lb', null, '1 lb', '450 g'],
    [8, 'oz', null, '8 oz', '225 g'],
    [2, 'lb', null, '2 lb', '900 g'],
    [3, 'lb', null, '3 lb', '1.4 kg'],
    [450, 'g', null, '450 g', '1 lb'],
    [200, 'g', null, '200 g', '7 oz'],
    [1.5, 'cup', null, '1½ cups', null],
    [2, 'clove', null, '2 cloves', null],
    [3, null, null, '3', null],
    [null, null, 'to taste', 'to taste', null],
    [null, null, 'for cooking', '', null],
    [null, null, null, '', null],
    [null, 'pinch', null, 'a pinch', null],
  ] as Array<[number | null, string | null, string | null, string, string | null]>)('(%s, %s, %s)', (q, unit, note, primary, secondary) => {
    expect(formatAmount(q, unit, note)).toEqual({ primary, secondary })
  })
})
