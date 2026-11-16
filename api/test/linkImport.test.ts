import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isBlockedHost } from '../src/linkImport/fetchPage'
import { extractJsonLdRecipe, parseIsoDuration } from '../src/linkImport/jsonld'
import { MESSAGES_URL, MODEL } from '../src/linkImport/claude'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

const page = (head: string, body = '<p>hello</p>') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`

const PLAIN = page(
  ld({
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'easy pancakes &amp; syrup',
    image: 'https://example.com/p.jpg',
    recipeYield: '4 servings',
    prepTime: 'PT10M',
    cookTime: 'PT15M',
    recipeCategory: 'Breakfast',
    recipeIngredient: ['1 1/2 cups flour', '2 eggs, beaten'],
    recipeInstructions: 'Mix everything.\nFry in batches.',
  }),
)

const GRAPH = page(
  ld({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', name: 'A blog' },
      {
        '@type': ['Recipe', 'NewsArticle'],
        name: 'Beef Stir-Fry',
        image: [{ '@type': 'ImageObject', url: '/img/beef.jpg' }],
        recipeYield: ['2', '2 bowls'],
        totalTime: 'PT1H',
        keywords: 'weeknight, dinner',
        recipeIngredient: ['1 lb beef'],
        recipeInstructions: [
          {
            '@type': 'HowToSection',
            name: 'Sauce',
            itemListElement: [{ '@type': 'HowToStep', text: 'Whisk the sauce.' }],
          },
          { '@type': 'HowToSection', name: 'Beef', itemListElement: [{ '@type': 'HowToStep', text: 'Sear the beef.' }] },
        ],
      },
    ],
  }),
)

const NONE = page('<title>Just a blog</title>', '<h1>My trip</h1><p>No recipe here.</p>')

describe('extractJsonLdRecipe', () => {
  it.each([
    [
      'plain Recipe',
      PLAIN,
      {
        title: 'easy pancakes & syrup',
        imageUrl: 'https://example.com/p.jpg',
        servings: 4,
        prepMinutes: 10,
        cookMinutes: 15,
        totalMinutes: null,
        ingredients: ['1 1/2 cups flour', '2 eggs, beaten'],
        instructions: ['Mix everything.', 'Fry in batches.'],
        categories: ['Breakfast'],
      },
    ],
    [
      '@graph with HowToSection',
      GRAPH,
      {
        title: 'Beef Stir-Fry',
        imageUrl: '/img/beef.jpg',
        servings: 2,
        totalMinutes: 60,
        ingredients: ['1 lb beef'],
        instructions: ['Whisk the sauce.', 'Sear the beef.'],
        categories: ['weeknight', 'dinner'],
      },
    ],
  ])('%s', (_name, html, expected) => {
    expect(extractJsonLdRecipe(html)).toMatchObject(expected)
  })

  it('returns null with no JSON-LD', () => {
    expect(extractJsonLdRecipe(NONE)).toBeNull()
  })

  it.each([
    ['PT1H30M', 90],
    ['P0DT45M', 45],
    ['PT20M30S', 21],
    ['nonsense', null],
  ])('parses duration %s', (v, minutes) => {
    expect(parseIsoDuration(v)).toBe(minutes)
  })

  it.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['192.168.1.10', true],
    ['[::1]', true],
    ['foo.internal', true],
    ['www.example.com', false],
    ['8.8.8.8', false],
  ])('isBlockedHost(%s) is %s', (host, blocked) => {
    expect(isBlockedHost(host)).toBe(blocked)
  })
})

describe('POST /api/import/url', () => {
  let testDb: TestDb
  beforeEach(async () => {
    testDb = await createTestDb()
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await testDb.dispose()
  })

  // Real fetch is never used: the page and the Messages API are both canned.
  function stubFetch(html: string, claudeReply?: unknown) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url === MESSAGES_URL) return Response.json(claudeReply)
      return new Response(html, { headers: { 'content-type': 'text/html' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  const importUrl = (env: Env, url = 'https://recipes.example.com/pancakes') =>
    call(env, devRequest('POST', '/api/import/url', { url }))

  it('turns JSON-LD into a structured draft', async () => {
    const fetchMock = stubFetch(PLAIN)
    const res = await importUrl(devEnv(testDb.db))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { draft: Record<string, unknown>; source: string; warnings: string[] }
    expect(body.source).toBe('jsonld')
    expect(body.warnings).toEqual([])
    expect(body.draft).toMatchObject({
      title: 'Easy Pancakes and Syrup',
      sourceUrl: 'https://recipes.example.com/pancakes',
      servings: 4,
      prepMinutes: 10,
      cookMinutes: 15,
      tags: ['breakfast', 'fast'],
      instructions: ['Mix everything.', 'Fry in batches.'],
      ingredients: [
        { rawText: '1 1/2 cups flour', name: 'flour', quantity: 1.5, unit: 'cup', note: null },
        { rawText: '2 eggs, beaten', name: 'eggs', quantity: 2, unit: null, note: 'beaten' },
      ],
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('user-agent')).toMatch(/Mozilla/)
  })

  it('422s a page with no recipe and no API key, and falls back to Claude with one', async () => {
    stubFetch(NONE)
    const res = await importUrl(devEnv(testDb.db))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: "couldn't find a recipe on that page" })

    const reply = {
      found: true,
      title: 'trail mix',
      description: null,
      servings: null,
      prepMinutes: 5,
      cookMinutes: null,
      totalMinutes: null,
      ingredients: ['1 cup peanuts'],
      instructions: ['Mix.'],
      categories: ['snack'],
    }
    const fetchMock = stubFetch(NONE, { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }] })
    const env = { ...devEnv(testDb.db), ANTHROPIC_API_KEY: 'test-key' } as Env
    const ok = await importUrl(env)
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { draft: { title: string }; source: string }
    expect(body.source).toBe('claude')
    expect(body.draft.title).toBe('Trail Mix')
    const sent = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(sent.model).toBe(MODEL)
    expect(sent.output_config.format.type).toBe('json_schema')
  })

  it('rejects private hosts without fetching', async () => {
    const fetchMock = stubFetch(PLAIN)
    const res = await importUrl(devEnv(testDb.db), 'http://127.0.0.1:8787/admin')
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
