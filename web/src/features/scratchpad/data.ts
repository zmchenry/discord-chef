import { useQueries } from "@tanstack/react-query";

import { sundayOf } from "../../../../shared/planningApi";
import type { Meal } from "../../../../shared/schema";
import { useRecipes } from "../../lib/queries";
import { nutritionApi, nutritionKeys, useWeekNutrition } from "../nutrition/api";
import { useSuggestions, useWeek } from "../planning/queries";
import { MARKER_TITLE, PLAN_MEALS, type PlannedMeal, type RecipeFacts, type SlotKey } from "./model";
import type { RecentRecipe } from "./storage";

// Every recipe's nutrition, through the same cache as the recipe page. Asks
// again a few times while the server is still estimating ingredients.
export function useRecipeFacts(ids: readonly string[]): Record<string, RecipeFacts | null | undefined> {
  const unique = [...new Set(ids)].sort();
  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: nutritionKeys.recipe(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => nutritionApi.recipe(id, signal),
      staleTime: 60_000,
      refetchInterval: (q: { state: { data?: { filling: boolean }; dataUpdateCount: number } }) =>
        q.state.data?.filling && q.state.dataUpdateCount <= 5 ? 6000 : false,
    })),
  });
  return Object.fromEntries(
    unique.map((id, i) => {
      const r = results[i]!;
      if (r.data) {
        const { perServing: p, confidence, lines, missing } = r.data;
        return [id, { perServing: { kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat }, confidence, lines, missing }];
      }
      return [id, r.isError ? null : undefined];
    }),
  );
}

// The day as planned: what each meal holds and at how many servings.
export function usePlannedDay(date: string) {
  const weekId = sundayOf(date);
  const week = useWeek(weekId);
  const nutrition = useWeekNutrition(weekId);
  const meals = nutrition.data?.days.find((d) => d.date === date)?.meals ?? [];
  const plan: Partial<Record<Meal, PlannedMeal>> = {};
  for (const meal of PLAN_MEALS) {
    const s = week.data?.slots.find((x) => x.date === date && x.meal === meal);
    if (!s) continue;
    const m = meals.find((x) => x.meal === meal);
    const sourceId = s.kind === "leftovers" ? (m?.serves.sourceId ?? null) : null;
    const source = sourceId ? week.data?.slots.find((x) => x.recipeId === sourceId)?.recipe : null;
    plan[meal] = {
      kind: s.kind,
      recipeId: s.recipeId,
      title:
        s.kind === "recipe"
          ? (s.recipe?.title ?? "Recipe")
          : s.kind === "leftovers" && source
            ? `Leftovers: ${source.title}`
            : MARKER_TITLE[s.kind],
      icon: s.kind === "recipe" ? (s.recipe?.icon ?? null) : null,
      servings: m?.serves.servings ?? 2,
      sourceId,
    };
  }
  return {
    weekId,
    plan,
    // Servings come from the nutrition view; wait for it unless it failed.
    isPending: week.isPending || (nutrition.isPending && !nutrition.isError),
    isError: week.isError,
  };
}

// What ◀ ▶ steps through: the planner's ranked suggestions for that meal
// (snacks: recently picked, then the recipe list), current one included.
export function useSwapList(date: string, slot: SlotKey, recent: RecentRecipe[]): RecentRecipe[] {
  const meal: Meal = slot === "snack" ? "lunch" : slot;
  const suggestions = useSuggestions(sundayOf(date), date, meal, "");
  const recipes = useRecipes({});
  if (slot !== "snack") {
    return (suggestions.data ?? []).slice(0, 15).map((s) => ({ id: s.recipeId, title: s.title, icon: s.icon }));
  }
  const all = (recipes.data ?? []).map((r) => ({ id: r.id, title: r.title, icon: r.icon }));
  const seen = new Set(recent.map((r) => r.id));
  return [...recent, ...all.filter((r) => !seen.has(r.id))].slice(0, 20);
}
