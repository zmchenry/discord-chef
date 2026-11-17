import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";

import {
  generateIdeasResponseSchema,
  ideaListResponseSchema,
  ideaSchema,
  type GenerateIdeasInput,
  type IdeaStatus,
} from "../../../../shared/discovery";
import { errorResponseSchema } from "../../../../shared/schema";
import { ApiError } from "../../lib/api";

// Mirrors lib/api.ts's request() error handling.
async function request<T extends z.ZodTypeAny>(
  schema: T,
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
    try {
      const parsed = errorResponseSchema.safeParse(await res.json());
      if (parsed.success) message = parsed.data.error;
    } catch {
      // Not JSON.
    }
    throw new ApiError(res.status, message);
  }
  return schema.parse(await res.json());
}

const ideasKey = ["ideas"] as const;

export const useIdeas = () =>
  useQuery({
    queryKey: ideasKey,
    queryFn: ({ signal }) => request(ideaListResponseSchema, "/ideas", { signal }).then((r) => r.ideas),
  });

export function useGenerateIdeas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateIdeasInput) =>
      request(generateIdeasResponseSchema, "/ideas/generate", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ideasKey }),
  });
}

export function useSetIdeaStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: IdeaStatus }) =>
      request(ideaSchema, `/ideas/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ideasKey }),
  });
}

// "Add to recipes" is the normal link import, started with the idea's page.
export const importPath = (url: string) => `/recipes/import?url=${encodeURIComponent(url)}`;
