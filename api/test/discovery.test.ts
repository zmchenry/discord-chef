import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GenerateIdeasResponse, Idea, IdeaListResponse } from '../../shared/discovery'
import { MODEL } from '../src/linkImport/claude'
import { call, devEnv, devRequest } from './helpers'
import { createTestDb, type TestDb } from './setup/testDb'

// One Messages API reply: two searches' worth of results, then save_ideas
// with three ideas, one of them on a page the search never returned.
const claudeReply = {
  stop_reason: 'tool_use',
  usage: { input_tokens: 21000, output_tokens: 900, server_tool_use: { web_search_requests: 2 } },
  content: [
    { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'birria tacos recipe' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srv_1',
      content: [
        { type: 'web_search_result', url: 'https://www.example-eats.com/birria-tacos/', title: 'Birria Tacos' },
        { type: 'web_search_result', url: 'https://cook.example.org/fish-tacos', title: 'Fish Tacos' },
      ],
    },
    {
      type: 'tool_use',
      id: 'tu_1',
      name: 'save_ideas',
      input: {
        ideas: [
          {
            title: 'Birria Tacos',
            url: 'https://www.example-eats.com/birria-tacos/',
            site: 'Example Eats',
            minutes: 180,
            keyIngredients: ['beef chuck', 'guajillo chiles', 'corn tortillas'],
            why: [{ text: 'Taco Tuesday', tone: 'up' }],
          },
          {
            title: 'Crispy Fish Tacos',
            url: 'https://cook.example.org/fish-tacos?utm_source=x',
            site: 'Cook Example',
            minutes: null,
            keyIngredients: ['cod', 'cabbage', 'lime'],
            why: [
              { text: 'Taco Tuesday', tone: 'up' },
              { text: 'Reuses cilantro', tone: 'up' },
            ],
          },
          {
            title: 'Made Up Tacos',
            url: 'https://nowhere.example.net/made-up',
            site: 'Nowhere',
            minutes: 20,
            keyIngredients: ['air'],
            why: [{ text: 'Taco Tuesday', tone: 'up' }],
          },
        ],
      },
    },
  ],
}

describe('ideas', () => {
  let testDb: TestDb
  beforeEach(async () => {
    testDb = await createTestDb()
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await testDb.dispose()
  })

  it('generates with Claude mocked, caches for a day, saves on import and dismisses', async () => {
    const fetchMock = vi.fn(async () => Response.json(claudeReply))
    vi.stubGlobal('fetch', fetchMock)
    const env = { ...devEnv(testDb.db), ANTHROPIC_API_KEY: 'test-key' } as Env
    await testDb.db
      .prepare(`INSERT INTO day_themes (weekday, label, tags) VALUES (2, 'Taco Tuesday', '["tacos","mexican"]')`)
      .run()

    // No key: a clear message, and no call out.
    const noKey = await call(devEnv(testDb.db), devRequest('POST', '/api/ideas/generate', { theme: 'taco tuesday' }))
    expect(noKey.status).toBe(503)
    expect(((await noKey.json()) as { error: string }).error).toMatch(/API key/)
    expect(fetchMock).not.toHaveBeenCalled()

    const res = await call(env, devRequest('POST', '/api/ideas/generate', { theme: 'taco tuesday' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as GenerateIdeasResponse
    expect(body.cached).toBe(false)
    // The made-up page is dropped; the group is the theme's own label.
    expect(body.ideas.map((i) => [i.title, i.theme, i.status])).toEqual([
      ['Birria Tacos', 'Taco Tuesday', 'new'],
      ['Crispy Fish Tacos', 'Taco Tuesday', 'new'],
    ])
    expect(body.ideas[0]).toMatchObject({ site: 'Example Eats', minutes: 180, why: [{ text: 'Taco Tuesday', tone: 'up' }] })

    // The request: the app's model, the basic web search tool, the theme and its tags.
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(sent.model).toBe(MODEL)
    expect(sent.tools[0]).toMatchObject({ type: 'web_search_20250305', name: 'web_search' })
    expect(sent.messages[0].content).toContain('Theme: Taco Tuesday (tags: tacos, mexican)')

    // Same search within a day: answered from the table.
    const again = (await (await call(env, devRequest('POST', '/api/ideas/generate', { theme: 'Taco Tuesday' }))).json()) as GenerateIdeasResponse
    expect(again.cached).toBe(true)
    expect(again.ideas).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Importing the birria page (the normal link import saves source_url)
    // marks that idea saved. Dismissing the other drops it from the inbox.
    await call(env, devRequest('POST', '/api/recipes', { title: 'Birria Tacos', sourceUrl: 'https://example-eats.com/birria-tacos' }))
    const fish = body.ideas.find((i) => i.title === 'Crispy Fish Tacos')!
    const dismissed = await call(env, devRequest('PATCH', `/api/ideas/${fish.id}`, { status: 'dismissed' }))
    expect(((await dismissed.json()) as Idea).status).toBe('dismissed')

    const list = (await (await call(env, devRequest('GET', '/api/ideas'))).json()) as IdeaListResponse
    expect(list.ideas.map((i) => [i.title, i.status])).toEqual([['Birria Tacos', 'saved']])
  })
})
