import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Recipe, RecipeInput, RecipeListResponse } from '../../shared/schema'
import { call, devEnv, devRequest, prodEnv } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

let testDb: TestDb
let env: Env

beforeEach(async () => {
  testDb = await createTestDb()
  env = devEnv(testDb.db)
})

afterEach(async () => {
  await testDb.dispose()
})

const pancakes: RecipeInput = {
  title: 'Pancakes',
  description: 'Weekend breakfast',
  servings: 4,
  prepMinutes: 10,
  cookMinutes: 15,
  tags: ['Breakfast', 'weekend', ' breakfast '],
  ingredients: [{ rawText: '2 cups flour', name: 'Flour' }, { rawText: 'Milk' }, { rawText: 'eggs', optional: true }],
  instructions: ['Mix', 'Fry'],
  sourceUrl: 'https://example.com/pancakes',
}

async function create(input: RecipeInput): Promise<Recipe> {
  const res = await call(env, devRequest('POST', '/api/recipes', input))
  expect(res.status).toBe(201)
  return (await res.json()) as Recipe
}

async function list(query = ''): Promise<RecipeListResponse['recipes']> {
  const res = await call(env, devRequest('GET', `/api/recipes${query}`))
  expect(res.status).toBe(200)
  return ((await res.json()) as RecipeListResponse).recipes
}

describe('recipes CRUD', () => {
  it('round-trips create, read, list, update and archive', async () => {
    const created = await create(pancakes)
    expect(created).toMatchObject({
      title: 'Pancakes',
      servings: 4,
      tags: ['breakfast', 'weekend'],
      instructions: ['Mix', 'Fry'],
      createdBy: 'zach@example.com',
      archivedAt: null,
      notes: null,
      imageUrl: null,
    })
    expect(created.ingredients.map((i) => [i.position, i.rawText, i.ingredientName, i.optional])).toEqual([
      [0, '2 cups flour', 'flour', false],
      [1, 'Milk', 'milk', false],
      [2, 'eggs', 'eggs', true],
    ])

    const got = await call(env, devRequest('GET', `/api/recipes/${created.id}`))
    expect(got.status).toBe(200)
    expect(await got.json()).toEqual(created)

    expect(await list()).toEqual([
      expect.objectContaining({ id: created.id, title: 'Pancakes', tags: ['breakfast', 'weekend'], ingredientCount: 3 }),
    ])

    const put = await call(
      env,
      devRequest('PUT', `/api/recipes/${created.id}`, {
        ...pancakes,
        title: 'Buttermilk pancakes',
        tags: ['breakfast'],
        ingredients: [{ rawText: 'buttermilk' }, { rawText: 'flour' }],
      }),
    )
    expect(put.status).toBe(200)
    const updated = (await put.json()) as Recipe
    expect(updated.title).toBe('Buttermilk pancakes')
    expect(updated.tags).toEqual(['breakfast'])
    expect(updated.ingredients.map((i) => i.ingredientName)).toEqual(['buttermilk', 'flour'])
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)

    // The old lines are gone, not appended to.
    const { results } = await testDb.db
      .prepare('SELECT count(*) AS n FROM recipe_ingredients WHERE recipe_id = ?')
      .bind(created.id)
      .all<{ n: number }>()
    expect(results[0].n).toBe(2)

    const del = await call(env, devRequest('DELETE', `/api/recipes/${created.id}`))
    expect(del.status).toBe(204)
    expect(await list()).toEqual([])

    // Archived recipes stay readable by id.
    const after = (await (await call(env, devRequest('GET', `/api/recipes/${created.id}`))).json()) as Recipe
    expect(after.archivedAt).toEqual(expect.any(Number))
  })

  it('filters the list by ?q= and ?tag=', async () => {
    await create(pancakes)
    await create({ title: 'Chicken tacos', tags: ['dinner', 'fast'] })
    await create({ title: 'Taco salad', description: 'uses leftover taco meat', tags: ['lunch'] })
    await create({ title: '100% rye', tags: ['bread'] })

    expect((await list('?q=taco')).map((r) => r.title)).toEqual(['Chicken tacos', 'Taco salad'])
    expect((await list('?q=LEFTOVER')).map((r) => r.title)).toEqual(['Taco salad'])
    expect((await list('?tag=Dinner')).map((r) => r.title)).toEqual(['Chicken tacos'])
    expect((await list('?q=taco&tag=lunch')).map((r) => r.title)).toEqual(['Taco salad'])
    // LIKE wildcards in q are literal.
    expect((await list('?q=%25')).map((r) => r.title)).toEqual(['100% rye'])
    expect((await list('?q=_')).map((r) => r.title)).toEqual([])
  })

  it('400s an invalid body with zod issues', async () => {
    const res = await call(env, devRequest('POST', '/api/recipes', { title: '   ', servings: 0 }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; issues: unknown[] }
    expect(body.error).toBe('invalid')
    expect(body.issues.length).toBeGreaterThan(0)
  })

  it('400s a text/plain POST (the CSRF posture in index.ts)', async () => {
    const res = await call(
      env,
      new Request('https://chef.zmchenry.com/api/recipes', {
        method: 'POST',
        headers: { 'x-dev-user-id': 'zach@example.com', 'content-type': 'text/plain' },
        body: JSON.stringify({ title: 'Sneaky' }),
      }),
    )
    expect(res.status).toBe(400)
    expect(await list()).toEqual([])
  })

  it('404s unknown ids on GET, PUT and DELETE', async () => {
    const id = crypto.randomUUID()
    expect((await call(env, devRequest('GET', `/api/recipes/${id}`))).status).toBe(404)
    expect((await call(env, devRequest('PUT', `/api/recipes/${id}`, { title: 'x' }))).status).toBe(404)
    expect((await call(env, devRequest('DELETE', `/api/recipes/${id}`))).status).toBe(404)
  })

  it('requires a session', async () => {
    const res = await call(prodEnv(testDb.db), devRequest('GET', '/api/recipes'))
    expect(res.status).toBe(401)
  })
})
