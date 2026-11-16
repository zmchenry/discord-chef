import type { z } from "zod";

import {
  calendarSettingsSchema,
  householdSettingsSchema,
  recommendationsResponseSchema,
  suggestionsResponseSchema,
  themesSettingsSchema,
  weekViewSchema,
  type HouseholdSettings,
  type SlotSetInput,
  type ThemeWire,
} from "../../../../shared/planningApi";
import { errorResponseSchema, type Meal } from "../../../../shared/schema";
import { ApiError } from "../../lib/api";

async function request<T extends z.ZodTypeAny>(
  schema: T,
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<z.infer<T>> {
  const method = init.method ?? "GET";
  const res = await fetch(`/api${path}`, {
    method,
    // POSTs without a body still send a JSON content-type (the API requires it).
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

const slotPath = (week: string, date: string, meal: Meal) => `/weeks/${week}/slots/${date}/${meal}`;

export const planningApi = {
  week: (week: string, signal?: AbortSignal) => request(weekViewSchema, `/weeks/${week}`, { signal }),
  setSlot: (week: string, date: string, meal: Meal, body: SlotSetInput) =>
    request(weekViewSchema, slotPath(week, date, meal), { method: "PUT", body }),
  clearSlot: (week: string, date: string, meal: Meal) =>
    request(weekViewSchema, slotPath(week, date, meal), { method: "DELETE" }),
  autofill: (week: string) => request(weekViewSchema, `/weeks/${week}/autofill`, { method: "POST" }),
  finish: (week: string) => request(weekViewSchema, `/weeks/${week}/finish`, { method: "POST" }),
  replan: (week: string, keep: "mine" | "locked") =>
    request(weekViewSchema, `/weeks/${week}/replan`, { method: "POST", body: { keep } }),
  suggestions: (week: string, date: string, meal: Meal, q: string, signal?: AbortSignal) => {
    const sp = new URLSearchParams({ date, meal });
    if (q.trim()) sp.set("q", q.trim());
    return request(suggestionsResponseSchema, `/weeks/${week}/suggestions?${sp}`, { signal }).then((r) => r.suggestions);
  },
  recommendations: (week: string, signal?: AbortSignal) =>
    request(recommendationsResponseSchema, `/weeks/${week}/recommendations`, { signal }).then((r) => r.recommendations),

  themes: (signal?: AbortSignal) => request(themesSettingsSchema, "/settings/themes", { signal }).then((r) => r.themes),
  saveThemes: (themes: ThemeWire[]) =>
    request(themesSettingsSchema, "/settings/themes", { method: "PUT", body: { themes } }).then((r) => r.themes),
  calendar: (signal?: AbortSignal) => request(calendarSettingsSchema, "/settings/calendar", { signal }),
  saveCalendar: (icalUrl: string | null) =>
    request(calendarSettingsSchema, "/settings/calendar", { method: "PUT", body: { icalUrl } }),
  household: (signal?: AbortSignal) => request(householdSettingsSchema, "/settings/household", { signal }),
  saveHousehold: (body: HouseholdSettings) =>
    request(householdSettingsSchema, "/settings/household", { method: "PUT", body }),
};
