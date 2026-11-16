import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseRecipeText, spokenNumbersToDigits, type ParsedRecipeText } from '../../shared/textImport'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

// Realistic voice-to-text: no punctuation, spoken numbers, "and" between
// ingredients, a missing steps marker.
const CASES: [string, string, Partial<ParsedRecipeText>][] = [
  [
    'the requested shape',
    'beef chili crisp ingredients 1 lb ground beef, chili crisp, 2 cups rice steps brown the beef then add the chili crisp and stir finally serve over rice',
    {
      title: 'beef chili crisp',
      ingredients: ['1 lb ground beef', 'chili crisp', '2 cups rice'],
      steps: ['Brown the beef.', 'Add the chili crisp and stir.', 'Serve over rice.'],
    },
  ],
  [
    'spoken numbers, no punctuation',
    'okay recipe for garlic noodles ingredients one pound spaghetti half a cup butter six cloves garlic a quarter teaspoon red pepper flakes directions boil the pasta melt the butter with the garlic toss everything together',
    {
      title: 'garlic noodles',
      ingredients: ['1 pound spaghetti', '1/2 cup butter', '6 cloves garlic', '1/4 teaspoon red pepper flakes'],
      steps: ['Boil the pasta.', 'Melt the butter with the garlic.', 'Toss everything together.'],
    },
  ],
  [
    '"and" between ingredients',
    'pancakes ingredients 2 cups flour and 2 eggs and 1 cup milk, salt and pepper steps mix it all then fry in batches',
    {
      title: 'pancakes',
      ingredients: ['2 cups flour', '2 eggs', '1 cup milk', 'salt and pepper'],
      steps: ['Mix it all.', 'Fry in batches.'],
    },
  ],
  [
    'no markers, one per line',
    'Tuna melt\n1 can tuna\n2 tbsp mayo\n2 slices bread\nMix the tuna and mayo. Toast the bread with cheese on top.',
    {
      title: 'Tuna melt',
      ingredients: ['1 can tuna', '2 tbsp mayo', '2 slices bread'],
      steps: ['Mix the tuna and mayo.', 'Toast the bread with cheese on top.'],
    },
  ],
  [
    'dozen, "two and a half", servings, meal',
    'breakfast burritos for breakfast serves four ingredients a dozen eggs two and a half cups shredded cheese one pound sausage 8 tortillas steps scramble the eggs with the sausage then roll it all up in the tortillas',
    {
      title: 'breakfast burritos',
      servings: 4,
      meals: ['breakfast'],
      ingredients: ['12 eggs', '2 1/2 cups shredded cheese', '1 pound sausage', '8 tortillas'],
      steps: ['Scramble the eggs with the sausage.', 'Roll it all up in the tortillas.'],
    },
  ],
  [
    'total time and "step one"',
    'quick quesadillas takes twenty minutes ingredients 2 tortillas, 1 cup cheese steps step one heat a pan step two melt the cheese between the tortillas',
    {
      title: 'quick quesadillas',
      totalMinutes: 20,
      ingredients: ['2 tortillas', '1 cup cheese'],
      steps: ['Heat a pan.', 'Melt the cheese between the tortillas.'],
    },
  ],
  [
    'typed, with punctuation and a prep note',
    'Beef chili crisp. Ingredients: 1 lb ground beef, 3 tbsp chili crisp, 2 eggs, beaten. Steps: Brown the beef. Stir in the chili crisp. Serve with rice.',
    {
      title: 'Beef chili crisp',
      ingredients: ['1 lb ground beef', '3 tbsp chili crisp', '2 eggs, beaten'],
      steps: ['Brown the beef.', 'Stir in the chili crisp.', 'Serve with rice.'],
    },
  ],
  [
    'no markers at all, run-on',
    'garlic bread 1 baguette 4 tbsp butter 3 cloves garlic spread the butter on the bread and bake at 400 for 10 minutes',
    {
      title: 'garlic bread',
      ingredients: ['1 baguette', '4 tbsp butter', '3 cloves garlic'],
      steps: ['Spread the butter on the bread and bake at 400 for 10 minutes.'],
    },
  ],
]

describe('parseRecipeText', () => {
  it.each(CASES)('%s', (_name, text, expected) => {
    expect(parseRecipeText(text)).toMatchObject(expected)
  })

  it.each([
    ['three quarters of a cup sugar', '3/4 cup sugar'],
    ['one and a half teaspoons salt', '1 1/2 teaspoons salt'],
    ['a can of black beans', '1 can of black beans'],
    ['twenty five minutes', '25 minutes'],
  ])('spokenNumbersToDigits(%s)', (spoken, digits) => {
    expect(spokenNumbersToDigits(spoken)).toBe(digits)
  })
})

describe('POST /api/import/text', () => {
  let testDb: TestDb
  beforeEach(async () => {
    testDb = await createTestDb()
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await testDb.dispose()
  })

  const importText = (env: Env, body: unknown) => call(env, devRequest('POST', '/api/import/text', body))

  it('parses with no API key, and keeps an existing recipe’s title and tags', async () => {
    // Never reach the network: with no key, Claude must not be called.
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const env = devEnv(testDb.db)

    const res = await importText(env, { text: CASES[0][1] + ' takes 25 minutes for dinner' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { draft: Record<string, unknown>; source: string; warnings: string[] }
    expect(body.source).toBe('parser')
    expect(body.warnings).toEqual([])
    expect(body.draft).toMatchObject({
      title: 'Beef Chili Crisp',
      tags: ['dinner', 'fast'],
      ingredients: [
        { rawText: '1 lb ground beef', name: 'ground beef', quantity: 1, unit: 'lb' },
        { rawText: 'chili crisp', name: 'chili crisp' },
        { rawText: '2 cups rice', quantity: 2, unit: 'cup' },
      ],
    })

    const created = await call(
      env,
      devRequest('POST', '/api/recipes', { title: 'Mapo Tofu', tags: ['dinner', 'weekend'], ingredients: [{ rawText: 'tofu' }] }),
    )
    const { id } = (await created.json()) as { id: string }
    const filled = await importText(env, { text: 'something else ingredients 1 lb ground pork steps fry the pork', recipeId: id })
    expect(filled.status).toBe(200)
    const merged = (await filled.json()) as { draft: Record<string, unknown> }
    expect(merged.draft).toMatchObject({
      title: 'Mapo Tofu',
      tags: ['dinner', 'weekend'],
      ingredients: [{ rawText: 'tofu' }, { rawText: '1 lb ground pork' }],
      instructions: ['Fry the pork.'],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
