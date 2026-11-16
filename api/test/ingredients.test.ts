import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { normaliseIngredientName, normaliseTags } from '../../shared/normalize'
import { recipeInputSchema, type Ingredient, type RecipeInput } from '../../shared/schema'
import { createRecipe, ensureUser, getRecipe, searchIngredients } from '../src/db'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

let testDb: TestDb

beforeEach(async () => {
  testDb = await createTestDb()
  await ensureUser(testDb.db, 'zach@example.com')
})

afterEach(async () => {
  await testDb.dispose()
})

const make = (input: RecipeInput) => createRecipe(testDb.db, 'zach@example.com', recipeInputSchema.parse(input))
const catalog = async () =>
  (await testDb.db.prepare('SELECT name FROM ingredients ORDER BY name').all<{ name: string }>()).results.map(
    (r) => r.name,
  )

describe('normaliseIngredientName', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normaliseIngredientName('  Red   Bell\tPepper \n')).toBe('red bell pepper')
  })
  it('leaves an already-canonical name alone', () => {
    expect(normaliseIngredientName('cilantro')).toBe('cilantro')
  })
  it('normaliseTags dedupes after normalising and drops empties', () => {
    expect(normaliseTags(['Dinner', ' dinner', 'Fast  Food', 'fast food', '  '])).toEqual(['dinner', 'fast food'])
  })
})

describe('ingredient matching', () => {
  it('dedupes across spelling variants and across recipes', async () => {
    const a = await make({ title: 'A', ingredients: [{ rawText: 'Olive Oil' }, { rawText: '  olive   oil ' }] })
    const b = await make({ title: 'B', ingredients: [{ rawText: '2 tbsp olive oil', name: 'OLIVE OIL' }] })
    expect(await catalog()).toEqual(['olive oil'])
    const ids = new Set([...a.ingredients, ...b.ingredients].map((i) => i.ingredientId))
    expect(ids.size).toBe(1)
    // The raw line is kept as typed.
    expect(b.ingredients[0].rawText).toBe('2 tbsp olive oil')
  })

  it('matches an alias instead of creating a new ingredient', async () => {
    await testDb.db
      .prepare(`INSERT INTO ingredients (name, aliases, created_at) VALUES ('scallion', '["green onion"]', 0)`)
      .run()
    const r = await make({ title: 'Fried rice', ingredients: [{ rawText: 'Green Onion' }] })
    expect(await catalog()).toEqual(['scallion'])
    expect(r.ingredients[0].ingredientName).toBe('scallion')
  })

  it('writes nothing when any statement in the recipe batch fails', async () => {
    // Bypass zod to hit a CHECK constraint mid-batch (quantity must be > 0).
    const bad = recipeInputSchema.parse({
      title: 'Broken',
      tags: ['dinner'],
      ingredients: [{ rawText: 'brand new thing' }, { rawText: 'salt' }],
    })
    bad.ingredients[1].quantity = -1
    await expect(createRecipe(testDb.db, 'zach@example.com', bad)).rejects.toThrow()
    expect(await catalog()).toEqual([])
    const { results } = await testDb.db.prepare('SELECT count(*) AS n FROM recipes').all<{ n: number }>()
    expect(results[0].n).toBe(0)
  })

  it('keeps an unknown-id lookup null', async () => {
    expect(await getRecipe(testDb.db, 'nope')).toBeNull()
  })
})

describe('searchIngredients and GET /api/ingredients', () => {
  beforeEach(async () => {
    await make({
      title: 'Salsa',
      ingredients: ['Tomato', 'Green tomato', 'Onion', 'Cilantro', 'Tomatillo'].map((rawText) => ({ rawText })),
    })
  })

  it('puts prefix matches before substring matches', async () => {
    const names = (await searchIngredients(testDb.db, ' TOMA')).map((i) => i.name)
    expect(names).toEqual(['tomatillo', 'tomato', 'green tomato'])
  })

  it('returns the first names alphabetically with no q, honouring limit', async () => {
    expect((await searchIngredients(testDb.db, undefined, 2)).map((i) => i.name)).toEqual(['cilantro', 'green tomato'])
  })

  it('is served over HTTP with the wire shape', async () => {
    const res = await call(devEnv(testDb.db), devRequest('GET', '/api/ingredients?q=cil'))
    expect(res.status).toBe(200)
    const { ingredients } = (await res.json()) as { ingredients: Ingredient[] }
    expect(ingredients).toEqual([
      { id: expect.any(Number), name: 'cilantro', section: null, perishable: false, isStaple: false, aliases: [] },
    ])
  })

  it('400s a limit out of range', async () => {
    const res = await call(devEnv(testDb.db), devRequest('GET', '/api/ingredients?limit=500'))
    expect(res.status).toBe(400)
  })
})
