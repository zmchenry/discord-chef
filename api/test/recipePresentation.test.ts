import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StructuredRecipe } from '../../shared/recipePresentation'
import { parseSteps } from '../../shared/recipeStructure'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

let testDb: TestDb
beforeEach(async () => {
  testDb = await createTestDb()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await testDb.dispose()
})

const claudeReply = (body: unknown) =>
  new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(body) }] }))

describe('organize a recipe', () => {
  it('stores groups, step titles and refs from Claude; old string steps still parse', async () => {
    const env = { ...devEnv(testDb.db), ANTHROPIC_API_KEY: 'test-key' } as Env
    const created = await call(
      env,
      devRequest('POST', '/api/recipes', {
        title: 'Breakfast Casserole',
        ingredients: [{ rawText: '8 eggs' }, { rawText: '1 cup milk' }, { rawText: '1 lb sausage' }],
        instructions: ['Brown the sausage in a skillet.', 'Whisk the eggs and milk. Pour over and bake.'],
      }),
    )
    expect(created.status).toBe(201)
    const before = (await created.json()) as StructuredRecipe
    expect(parseSteps(before.instructions).map((s) => [s.title, s.text])).toEqual([
      [null, 'Brown the sausage in a skillet.'],
      [null, 'Whisk the eggs and milk. Pour over and bake.'],
    ])
    expect(before.ingredients.map((i) => [i.group, i.flavors])).toEqual([[null, []], [null, []], [null, []]])

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(String(init.body)) as { system: string }
      if (sent.system.includes('flavor')) return claudeReply({ ingredients: [{ id: 3, flavors: ['salty', 'fat', 'umami'] }] })
      return claudeReply({
        groups: [
          { name: 'Egg base', ingredients: [0, 1] },
          { name: 'fillings', ingredients: [2] },
        ],
        steps: [
          { title: 'Brown the sausage.', paragraphs: ['Brown the sausage in a skillet.'], ingredients: [2, 7] },
          { title: 'Whisk and bake', paragraphs: ['Whisk the eggs and milk.', 'Pour over and bake.'], ingredients: [0, 1] },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await call(env, devRequest('POST', `/api/recipes/${before.id}/organize`, {}))
    expect(res.status).toBe(200)
    const after = (await res.json()) as StructuredRecipe
    expect(after.ingredients.map((i) => i.group)).toEqual(['egg base', 'egg base', 'fillings'])
    expect(after.instructions).toEqual([
      { title: 'Brown the sausage', text: 'Brown the sausage in a skillet.', ingredientRefs: [2] },
      { title: 'Whisk and bake', text: 'Whisk the eggs and milk.\n\nPour over and bake.', ingredientRefs: [0, 1] },
    ])

    // Flavors are estimated in the background for the recipe's ingredients.
    await vi.waitFor(async () => {
      const got = (await (await call(env, devRequest('GET', `/api/recipes/${before.id}`))).json()) as StructuredRecipe
      expect(got.ingredients[2].flavors).toEqual(['salty', 'fat'])
    })

    // An edit from the plain form keeps working and keeps the structure it sends.
    const put = await call(
      env,
      devRequest('PUT', `/api/recipes/${before.id}`, {
        title: 'Breakfast Casserole',
        ingredients: after.ingredients.map((i) => ({ rawText: i.rawText, group: i.group })),
        instructions: [after.instructions[0], 'Whisk the eggs and milk, pour over and bake.'],
      }),
    )
    expect(put.status).toBe(200)
    const edited = (await put.json()) as StructuredRecipe
    expect(parseSteps(edited.instructions).map((s) => s.title)).toEqual(['Brown the sausage', null])
    expect(edited.ingredients.map((i) => i.group)).toEqual(['egg base', 'egg base', 'fillings'])

    // Nothing left for the backfill: the recipe has titled steps.
    const all = await call(env, devRequest('POST', '/api/recipes/organize-all', {}))
    expect(all.status).toBe(202)
    expect(await all.json()).toMatchObject({ recipes: 0, remainingRecipes: 0 })
  })

  it('503s without an API key', async () => {
    const res = await call(devEnv(testDb.db), devRequest('POST', '/api/recipes/organize-all', {}))
    expect(res.status).toBe(503)
  })
})
