import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";

import {
  cookedResponseSchema,
  historyEntrySchema,
  historyResponseSchema,
  insightsResponseSchema,
  pendingResponseSchema,
  recipeHistorySchema,
  type MealLogInput,
} from "../../../../shared/mealHistory";
import { errorResponseSchema, type Meal } from "../../../../shared/schema";
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

export const historyKeys = {
  all: ["history"] as const,
  list: (meal?: Meal, recipeId?: string) => ["history", "list", meal ?? "", recipeId ?? ""] as const,
  pending: ["history", "pending"] as const,
  recipe: (id: string) => ["history", "recipe", id] as const,
  insights: ["history", "insights"] as const,
};

export const useHistory = (meal?: Meal, recipeId?: string) =>
  useQuery({
    queryKey: historyKeys.list(meal, recipeId),
    queryFn: ({ signal }) => {
      const q = new URLSearchParams({ weeks: "8" });
      if (meal) q.set("meal", meal);
      if (recipeId) q.set("recipeId", recipeId);
      return request(historyResponseSchema, `/history?${q}`, { signal });
    },
    placeholderData: (prev) => prev,
  });

export const usePending = () =>
  useQuery({
    queryKey: historyKeys.pending,
    queryFn: ({ signal }) => request(pendingResponseSchema, "/history/pending", { signal }).then((r) => r.entries),
  });

export const useRecipeHistory = (id: string) =>
  useQuery({
    queryKey: historyKeys.recipe(id),
    queryFn: ({ signal }) => request(recipeHistorySchema, `/history/recipes/${encodeURIComponent(id)}`, { signal }),
  });

export const useInsights = () =>
  useQuery({
    queryKey: historyKeys.insights,
    queryFn: ({ signal }) => request(insightsResponseSchema, "/history/insights", { signal }),
    staleTime: 10 * 60_000,
  });

export function useRefreshInsights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request(insightsResponseSchema, "/history/insights/refresh", { method: "POST", body: {} }),
    onSuccess: (data) => qc.setQueryData(historyKeys.insights, data),
  });
}

export function useLogMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MealLogInput) => request(historyEntrySchema, "/history/log", { method: "PUT", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: historyKeys.all }),
  });
}

// Cooking mode's Done. Fire and forget: nothing to show if it isn't planned today.
export function markCooked(recipeId: string): void {
  request(cookedResponseSchema, "/history/cooked", { method: "POST", body: { recipeId } }).catch(() => undefined);
}
