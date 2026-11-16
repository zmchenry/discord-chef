import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SlotKind, Meal } from "../../../../shared/schema";
import type { SlotRecipe, WeekSlot, WeekView } from "../../../../shared/planningApi";
import { planningApi } from "./api";

export const planningKeys = {
  week: (id: string) => ["week", id] as const,
  suggestions: (id: string, date: string, meal: Meal, q: string) => ["week", id, "suggestions", date, meal, q] as const,
  recommendations: (id: string) => ["week", id, "recommendations"] as const,
  themes: ["settings", "themes"] as const,
  calendar: ["settings", "calendar"] as const,
  household: ["settings", "household"] as const,
};

export const useWeek = (id: string) =>
  useQuery({ queryKey: planningKeys.week(id), queryFn: ({ signal }) => planningApi.week(id, signal) });

export const useSuggestions = (id: string, date: string, meal: Meal, q: string) =>
  useQuery({
    queryKey: planningKeys.suggestions(id, date, meal, q),
    queryFn: ({ signal }) => planningApi.suggestions(id, date, meal, q, signal),
    placeholderData: (prev) => prev,
  });

export const useRecommendations = (id: string) =>
  useQuery({ queryKey: planningKeys.recommendations(id), queryFn: ({ signal }) => planningApi.recommendations(id, signal) });

// One slot write: set (kind + recipe) or clear (set: null). `recipe` is only
// for the optimistic render.
export interface SlotChange {
  date: string;
  meal: Meal;
  set: { kind: SlotKind; recipeId: string | null; locked?: boolean; source?: "manual" | "suggested" } | null;
  recipe?: SlotRecipe | null;
}

function applyChange(week: WeekView, ch: SlotChange): WeekView {
  const others = week.slots.filter((s) => !(s.date === ch.date && s.meal === ch.meal));
  const prev = week.slots.find((s) => s.date === ch.date && s.meal === ch.meal);
  let slots = others;
  if (ch.set) {
    const unchanged = prev && prev.kind === ch.set.kind && prev.recipeId === ch.set.recipeId;
    const next: WeekSlot = {
      date: ch.date,
      meal: ch.meal,
      kind: ch.set.kind,
      recipeId: ch.set.recipeId,
      recipe: ch.recipe ?? (unchanged ? prev.recipe : null),
      source: unchanged ? prev.source : (ch.set.source ?? "manual"),
      locked: ch.set.locked ?? prev?.locked ?? false,
    };
    slots = [...others, next];
  }
  return { ...week, slots, summary: { ...week.summary, filled: slots.length } };
}

// Writes go out one at a time per week (scope), each applied to the cache
// first and rolled back on failure. The server's week replaces the cache only
// when no other write is still in flight, so a late response never undoes a
// newer optimistic change.
export function useSlotMutation(weekId: string) {
  const qc = useQueryClient();
  const key = planningKeys.week(weekId);
  const mutationKey = ["slot", weekId];
  return useMutation({
    mutationKey,
    scope: { id: `slots-${weekId}` },
    mutationFn: async (changes: SlotChange[]) => {
      let last: WeekView | undefined;
      for (const ch of changes) {
        last = ch.set
          ? await planningApi.setSlot(weekId, ch.date, ch.meal, ch.set)
          : await planningApi.clearSlot(weekId, ch.date, ch.meal);
      }
      return last;
    },
    onMutate: async (changes) => {
      await qc.cancelQueries({ queryKey: key, exact: true });
      const before = qc.getQueryData<WeekView>(key);
      if (before) qc.setQueryData<WeekView>(key, changes.reduce(applyChange, before));
      return { before };
    },
    onError: (_err, _changes, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
    },
    onSuccess: (week) => {
      if (week && qc.isMutating({ mutationKey }) === 1) qc.setQueryData(key, week);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: planningKeys.recommendations(weekId) });
      void qc.invalidateQueries({ queryKey: ["week", weekId, "suggestions"] });
    },
  });
}

export function useWeekAction(weekId: string, action: "autofill" | "finish" | "replan") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => planningApi[action](weekId),
    onSuccess: (week) => {
      qc.setQueryData(planningKeys.week(weekId), week);
      void qc.invalidateQueries({ queryKey: planningKeys.recommendations(weekId) });
    },
  });
}
