import { ClaudeError, MESSAGES_URL, MODEL } from '../linkImport/claude'

// The idea search: one Messages API turn with the basic web search server
// tool plus a strict save_ideas tool that carries the answer back as JSON.
// (Structured outputs are not used here: web search answers carry
// citations, which do not mix with output_config.format.) Plain fetch, like
// linkImport/claude.ts.
//
// Cost per run, roughly: up to MAX_SEARCHES searches at $10 per 1,000, plus
// the search results read as input tokens (tens of thousands of tokens at the
// model's rates), so about 3 to 5 cents, almost all of it the searches.

const API_VERSION = '2026-10-21'
const TIMEOUT_MS = 90_000
// Requests per run: a paused turn (pause_turn) or a reply that forgot to
// call save_ideas gets one more request each, up to this many in all.
const MAX_REQUESTS = 3
export const MAX_SEARCHES = 4

export interface FoundIdea {
  title: string
  url: string
  site: string
  minutes: number | null
  keyIngredients: string[]
  why: { text: string; tone: 'up' | 'info' }[]
}

const SAVE_TOOL = {
  name: 'save_ideas',
  description:
    'Save the recipe ideas you found. Call it once, after searching, with every idea. Each url must come from your search results.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ideas'],
    properties: {
      ideas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'url', 'site', 'minutes', 'keyIngredients', 'why'],
          properties: {
            title: { type: 'string', description: 'The recipe name, without the site name' },
            url: { type: 'string', description: 'The recipe page, exactly as it appeared in the search results' },
            site: { type: 'string', description: 'The site name, e.g. "Serious Eats"' },
            minutes: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'Total time, or null if unknown' },
            keyIngredients: { type: 'array', items: { type: 'string' }, description: '3 to 6 main ingredients, lowercase, no amounts' },
            why: {
              type: 'array',
              description: '1 to 3 short reasons it fits, strongest first',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['text', 'tone'],
                properties: {
                  text: { type: 'string', description: 'At most about 5 words' },
                  tone: { type: 'string', enum: ['up', 'info'] },
                },
              },
            },
          },
        },
      },
    },
  },
} as const

interface Block {
  type: string
  name?: string
  input?: unknown
  content?: unknown
}

interface MessagesResponse {
  stop_reason?: string
  content?: Block[]
  usage?: Record<string, unknown>
}

// Comparable form of a page address: no scheme, www, query, hash or
// trailing slash.
export function urlKey(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

async function send(body: object, apiKey: string): Promise<MessagesResponse> {
  let res: Response
  try {
    res = await fetch(MESSAGES_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': API_VERSION },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ClaudeError('The idea search did not answer.')
  }
  if (!res.ok) {
    console.error(JSON.stringify({ event: 'discovery_claude_error', status: res.status, body: (await res.text()).slice(0, 500) }))
    throw new ClaudeError('The idea search failed.')
  }
  return (await res.json()) as MessagesResponse
}

// Runs the search and returns ideas whose url Claude actually saw in a
// search result (anything else is dropped as made up).
export async function findIdeasWithClaude(opts: { system: string; prompt: string; apiKey: string }): Promise<FoundIdea[]> {
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [{ role: 'user', content: opts.prompt }]
  const seen = new Set<string>()

  for (let i = 0; i < MAX_REQUESTS; i++) {
    const msg = await send(
      {
        model: MODEL,
        max_tokens: 16000,
        system: opts.system,
        output_config: { effort: 'low' },
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }, SAVE_TOOL],
        tool_choice: { type: 'auto' },
        messages,
      },
      opts.apiKey,
    )
    console.log(JSON.stringify({ event: 'discovery_claude_usage', stop: msg.stop_reason, usage: msg.usage }))

    for (const block of msg.content ?? []) {
      // A failed search has an error object here instead of a list.
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content as { url?: string }[]) {
          const key = r.url && urlKey(r.url)
          if (key) seen.add(key)
        }
      }
    }

    const save = msg.content?.find((b) => b.type === 'tool_use' && b.name === 'save_ideas')
    if (save) {
      const ideas = (save.input as { ideas?: FoundIdea[] } | undefined)?.ideas ?? []
      return ideas.filter((idea) => {
        const key = urlKey(idea.url)
        return key !== null && seen.has(key) && idea.title.trim().length > 0
      })
    }
    if (msg.stop_reason === 'refusal') throw new ClaudeError('The idea search was declined.')
    if (msg.stop_reason === 'max_tokens') throw new ClaudeError('The idea search ran out of room.')

    // pause_turn: send the turn back as is to let it carry on. A plain reply
    // (end_turn) gets a nudge to save what it found.
    messages.push({ role: 'assistant', content: msg.content ?? [] })
    if (msg.stop_reason !== 'pause_turn') {
      messages.push({ role: 'user', content: 'Call save_ideas now with the ideas you found.' })
    }
  }
  throw new ClaudeError('The idea search came back empty.')
}
