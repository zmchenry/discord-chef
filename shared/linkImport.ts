import { z } from 'zod'

import { recipeInputSchema } from './schema'

// POST /api/import/url: read a recipe off a web page and return it as an
// unsaved draft. The client shows it in the recipe form, then saves it with
// POST /api/recipes like any other recipe.
//
// Errors: 400 for a link that is not public http(s), 502 when the page could
// not be fetched, 422 { error: "couldn't find a recipe on that page" }.

export const importUrlRequestSchema = z.object({
  url: z.string().trim().url().max(2000),
})
export type ImportUrlRequest = z.infer<typeof importUrlRequestSchema>

// 'jsonld': the page's schema.org Recipe markup. 'claude': no usable markup,
// so the page text was read by a model (less exact; check it over).
export const importSourceSchema = z.enum(['jsonld', 'claude'])
export type ImportSource = z.infer<typeof importSourceSchema>

export const importUrlResponseSchema = z.object({
  draft: recipeInputSchema,
  source: importSourceSchema,
  // Plain-English notes for the user, e.g. "No steps were found."
  warnings: z.array(z.string()),
})
export type ImportUrlResponse = z.infer<typeof importUrlResponseSchema>
