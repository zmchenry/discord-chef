import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";

import {
  goalsSettingsSchema,
  nutritionRefreshResponseSchema,
  nutritionTrendsSchema,
  recipeNutritionSchema,
  weekNutritionSchema,
  type GoalInput,
  type WeekNutritionWire,
} from "../../../../shared/nutrition";
import { errorResponseSchema, type Meal } from "../../../../shared/schema";
import { ApiError } from "../../lib/api";
import { useWeek } from "../planning/queries";

async function request<T extends z.ZodTypeAny>(
  schema: T,
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<z.infer<T>> {
  const method = init.method ?? "GET";
  const res = await fetch(`/api${path}`, {
    method,
    headers: method === "GET" ? undefined : { "content-type": "application/json" },
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

export const nutritionApi = {
  recipe: (id: string, signal?: AbortSignal) =>
    request(recipeNutritionSchema, `/nutrition/recipes/${encodeURIComponent(id)}`, { signal }),
  week: (week: string, signal?: AbortSignal) => request(weekNutritionSchema, `/nutrition/weeks/${week}`, { signal }),
  setServings: (week: string, date: string, meal: Meal, servings: number | null) =>
    request(weekNutritionSchema, `/nutrition/weeks/${week}/servings/${date}/${meal}`, { method: "PUT", body: { servings } }),
  refresh: (body: { weekId?: string; recipeId?: string }) =>
    request(nutritionRefreshResponseSchema, "/nutrition/refresh", { method: "POST", body }),
  goals: (signal?: AbortSignal) => request(goalsSettingsSchema, "/settings/goals", { signal }).then((r) => r.goals),
  trends: (end: string, signal?: AbortSignal) => request(nutritionTrendsSchema, `/nutrition/trends?end=${end}`, { signal }),
  saveGoals: (goals: GoalInput[]) =>
    request(goalsSettingsSchema, "/settings/goals", { method: "PUT", body: { goals } }).then((r) => r.goals),
};

export const nutritionKeys = {
  recipe: (id: string) => ["nutrition", "recipe", id] as const,
  weekAll: (id: string) => ["nutrition", "week", id] as const,
  week: (id: string, sig: string) => ["nutrition", "week", id, sig] as const,
  goals: ["settings", "goals"] as const,
  trends: (end: string) => ["nutrition", "trends", end] as const,
};

// While the server is still estimating, ask again a few times.
const POLL_MS = 6000;
const POLLS = 5;
const poll = (q: { state: { data?: { filling: boolean }; dataUpdateCount: number } }) =>
  q.state.data?.filling && q.state.dataUpdateCount <= POLLS ? POLL_MS : false;

export const useRecipeNutrition = (id: string) =>
  useQuery({
    queryKey: nutritionKeys.recipe(id),
    queryFn: ({ signal }) => nutritionApi.recipe(id, signal),
    refetchInterval: poll,
  });

// The week's nutrition follows the planner's own week query: the key carries
// what the slots hold, so any change to the plan refetches it, and it waits
// while a slot write is in flight so it never reads a half-saved week.
export function useWeekNutrition(weekId: string) {
  const week = useWeek(weekId);
  const writing = useIsMutating({ mutationKey: ["slot", weekId] }) > 0;
  const sig = week.data
    ? week.data.slots
        .map((s) => `${s.date}${s.meal}${s.kind}${s.recipeId ?? ""}`)
        .sort()
        .join("|")
    : "";
  return useQuery({
    queryKey: nutritionKeys.week(weekId, sig),
    queryFn: ({ signal }) => nutritionApi.week(weekId, signal),
    enabled: !writing && !week.isPending,
    placeholderData: (prev) => prev,
    refetchInterval: poll,
  });
}

export function useSetServings(weekId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["servings", weekId],
    scope: { id: `servings-${weekId}` },
    mutationFn: (v: { date: string; meal: Meal; servings: number | null }) =>
      nutritionApi.setServings(weekId, v.date, v.meal, v.servings),
    onSuccess: (data: WeekNutritionWire) => {
      // Every cached signature of this week gets the fresh numbers.
      qc.setQueriesData({ queryKey: nutritionKeys.weekAll(weekId) }, data);
    },
  });
}

export const useGoals = () => useQuery({ queryKey: nutritionKeys.goals, queryFn: ({ signal }) => nutritionApi.goals(signal) });

export const useTrends = (end: string) =>
  useQuery({ queryKey: nutritionKeys.trends(end), queryFn: ({ signal }) => nutritionApi.trends(end, signal), staleTime: 60_000 });

// Line positions of a recipe whose amounts are estimates (from the cached
// recipe nutrition the page already loads).
export function useEstimatedAmounts(recipeId: string | undefined): ReadonlySet<number> {
  const q = useQuery({
    queryKey: nutritionKeys.recipe(recipeId ?? ""),
    queryFn: ({ signal }) => nutritionApi.recipe(recipeId!, signal),
    enabled: !!recipeId,
  });
  return new Set(q.data?.estimatedAmounts ?? []);
}
