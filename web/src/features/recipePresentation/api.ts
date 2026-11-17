import type { z } from "zod";

import {
  organizeAllResponseSchema,
  organizePreviewResponseSchema,
  structuredRecipeSchema,
  type OrganizeProposal,
} from "../../../../shared/recipePresentation";
import { errorResponseSchema } from "../../../../shared/schema";
import { ApiError } from "../../lib/api";

// The organize endpoints (api/src/recipePresentation). Every response is
// parsed with its shared schema, as in lib/api.ts.

async function post<T extends z.ZodTypeAny>(schema: T, path: string, body: unknown = {}): Promise<z.infer<T>> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const parsed = errorResponseSchema.safeParse(await res.json());
      if (parsed.success) message = parsed.data.error;
    } catch {
      // Not JSON. Keep the status text.
    }
    throw new ApiError(res.status, message);
  }
  return schema.parse(await res.json());
}

const path = (id: string) => `/recipes/${encodeURIComponent(id)}/organize`;

export const organizeApi = {
  preview: (id: string) => post(organizePreviewResponseSchema, `${path(id)}/preview`).then((r) => r.proposal),
  apply: (id: string, proposal?: OrganizeProposal) => post(structuredRecipeSchema, path(id), proposal ? { proposal } : {}),
  all: () => post(organizeAllResponseSchema, "/recipes/organize-all"),
};
