import type { z } from "zod";

import {
  errorResponseSchema,
  ingredientListResponseSchema,
  meSchema,
  recipeListResponseSchema,
  recipeSchema,
  storeListResponseSchema,
  type RecipeInput,
  type RecipeListQuery,
} from "../../../shared/schema";

// A thin, typed client for /api. Every response is parsed with the shared
// zod schema, so a contract drift between Worker and app fails loudly at the
// call site instead of rendering undefined.
//
// No auth code: in production Cloudflare Access sets the CF_Authorization
// cookie, which fetch sends same-origin by default. In local development the
// Worker's dev session provider signs every request in as a fixed dev user.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: unknown[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T extends z.ZodTypeAny>(
  schema: T | null,
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<z.infer<T>> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let issues: unknown[] | undefined;
    try {
      const parsed = errorResponseSchema.safeParse(await res.json());
      if (parsed.success) {
        message = parsed.data.error;
        issues = parsed.data.issues;
      }
    } catch {
      // Not JSON (e.g. an Access login page). Keep the status text.
    }
    throw new ApiError(res.status, message, issues);
  }
  if (schema === null || res.status === 204) return undefined as z.infer<T>;
  return schema.parse(await res.json());
}

function queryString(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  me: (signal?: AbortSignal) => request(meSchema, "/me", { signal }),

  listRecipes: (query: RecipeListQuery = {}, signal?: AbortSignal) =>
    request(recipeListResponseSchema, `/recipes${queryString(query)}`, { signal }).then((r) => r.recipes),

  getRecipe: (id: string, signal?: AbortSignal) =>
    request(recipeSchema, `/recipes/${encodeURIComponent(id)}`, { signal }),

  createRecipe: (input: RecipeInput) => request(recipeSchema, "/recipes", { method: "POST", body: input }),

  updateRecipe: (id: string, input: RecipeInput) =>
    request(recipeSchema, `/recipes/${encodeURIComponent(id)}`, { method: "PUT", body: input }),

  archiveRecipe: (id: string) => request(null, `/recipes/${encodeURIComponent(id)}`, { method: "DELETE" }),

  searchIngredients: (q: string, signal?: AbortSignal) =>
    request(ingredientListResponseSchema, `/ingredients${queryString({ q })}`, { signal }).then((r) => r.ingredients),

  listStores: (signal?: AbortSignal) => request(storeListResponseSchema, "/stores", { signal }).then((r) => r.stores),
};
