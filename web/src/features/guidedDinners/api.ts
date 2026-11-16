import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";

import {
  breakfastLunchSettingsSchema,
  fillBreakfastLunchResponseSchema,
  type BreakfastLunchInput,
  type FillBreakfastLunchResponse,
} from "../../../../shared/guidedDinners";
import { suggestionsResponseSchema } from "../../../../shared/planningApi";
import { errorResponseSchema } from "../../../../shared/schema";
import { ApiError } from "../../lib/api";
import { planningKeys } from "../planning/queries";

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

export const guidedApi = {
  // Every ranked dinner for one day (the guided flow groups them itself).
  dinnerIdeas: (week: string, date: string, q: string, signal?: AbortSignal) => {
    const sp = new URLSearchParams({ date, meal: "dinner", limit: "500" });
    if (q.trim()) sp.set("q", q.trim());
    return request(suggestionsResponseSchema, `/weeks/${week}/suggestions?${sp}`, { signal }).then((r) => r.suggestions);
  },
  fill: (week: string, refill = false) =>
    request(fillBreakfastLunchResponseSchema, `/weeks/${week}/fill-breakfast-lunch`, {
      method: "POST",
      body: refill ? { refill } : {},
    }),
  settings: (signal?: AbortSignal) => request(breakfastLunchSettingsSchema, "/settings/breakfast-lunch", { signal }),
  saveSettings: (body: BreakfastLunchInput) =>
    request(breakfastLunchSettingsSchema, "/settings/breakfast-lunch", { method: "PUT", body }),
};

export const guidedKeys = {
  // Under ["week", id, "suggestions"], so a slot write refreshes it.
  ideas: (week: string, date: string, q: string) => ["week", week, "suggestions", date, "dinner", q, "all"] as const,
  fill: (week: string) => ["week", week, "breakfast-lunch"] as const,
  settings: ["settings", "breakfast-lunch"] as const,
};

export const useDinnerIdeas = (week: string, date: string, q: string) =>
  useQuery({
    queryKey: guidedKeys.ideas(week, date, q),
    queryFn: ({ signal }) => guidedApi.dinnerIdeas(week, date, q, signal),
    placeholderData: (prev) => prev,
  });

// Fills the empty breakfasts and lunches; the response's week replaces the cache.
export function useFillBreakfastLunch(week: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (refill: boolean = false) => guidedApi.fill(week, refill),
    onSuccess: (res) => {
      qc.setQueryData(planningKeys.week(week), res.week);
      qc.setQueryData<FillBreakfastLunchResponse>(guidedKeys.fill(week), res);
      void qc.invalidateQueries({ queryKey: planningKeys.recommendations(week) });
    },
  });
}

// The last fill's extras (where leftovers come from), if this session has one.
export const useLastFill = (week: string) =>
  useQuery<FillBreakfastLunchResponse | null>({
    queryKey: guidedKeys.fill(week),
    queryFn: () => null,
    staleTime: Infinity,
  });

export const useBreakfastLunchSettings = () =>
  useQuery({ queryKey: guidedKeys.settings, queryFn: ({ signal }) => guidedApi.settings(signal) });
