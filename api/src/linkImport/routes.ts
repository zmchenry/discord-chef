import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'

import { importUrlRequestSchema, type ImportSource, type ImportUrlResponse } from '../../../shared/linkImport'
import { recipeInputSchema, type ErrorResponse } from '../../../shared/schema'
import { requireSession, type AppEnv } from '../session'
import { ClaudeError, extractWithClaude, htmlToText } from './claude'
import { toDraft, type ScrapedRecipe } from './draft'
import { PageFetchError, fetchPage } from './fetchPage'
import { extractJsonLdRecipe } from './jsonld'

// A Worker secret (`wrangler secret put ANTHROPIC_API_KEY`), optional: with
// no key, pages without JSON-LD get a 422 instead of the Claude fallback.
declare global {
  interface Env {
    ANTHROPIC_API_KEY?: string
  }
}

export const NO_RECIPE = "couldn't find a recipe on that page"

const error = (message: string): ErrorResponse => ({ error: message })

export function ogImage(html: string): string | null {
  const tag = html.match(/<meta\b[^>]*\bproperty\s*=\s*["']og:image["'][^>]*>/i)?.[0]
  return tag?.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1] ?? null
}

// Mounted at /api by index.ts. JSON body only (see the CSRF note there).
export const linkImportRoutes = new Hono<AppEnv>().post(
  '/import/url',
  requireSession,
  zValidator('json', importUrlRequestSchema, (result, c) => {
    if (!result.success) return c.json<ErrorResponse>({ error: 'invalid', issues: result.error.issues }, 400)
  }),
  async (c) => {
    let page
    try {
      page = await fetchPage(c.req.valid('json').url)
    } catch (err) {
      if (err instanceof PageFetchError) return c.json(error(err.message), err.status)
      throw err
    }

    let scraped: ScrapedRecipe | null = extractJsonLdRecipe(page.html)
    let source: ImportSource = 'jsonld'
    const warnings: string[] = []

    if (!scraped && c.env.ANTHROPIC_API_KEY) {
      source = 'claude'
      try {
        scraped = await extractWithClaude(htmlToText(page.html), page.url, c.env.ANTHROPIC_API_KEY)
      } catch (err) {
        if (err instanceof ClaudeError) return c.json(error(err.message), 502)
        throw err
      }
      if (scraped) {
        scraped.imageUrl = ogImage(page.html)
        warnings.push('This page had no recipe markup, so it was read by AI. Check the amounts and steps.')
      }
    }
    if (!scraped) return c.json(error(NO_RECIPE), 422)

    const { draft, warnings: more } = toDraft(scraped, page.url)
    if (page.truncated) more.push('The page was very large, so only the first part was read.')
    const parsed = recipeInputSchema.safeParse(draft)
    if (!parsed.success) return c.json(error(NO_RECIPE), 422)

    const body: ImportUrlResponse = { draft: parsed.data, source, warnings: [...warnings, ...more] }
    return c.json(body)
  },
)
