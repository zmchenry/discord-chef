import { Ban, Check, Repeat, Shuffle, Utensils, type LucideIcon } from "lucide-react";

import type { HistoryEntryWire, MealStatus } from "../../../../shared/mealHistory";

export const STATUS: Record<MealStatus, { label: string; icon: LucideIcon }> = {
  eaten: { label: "Ate it", icon: Check },
  skipped: { label: "Skipped", icon: Ban },
  ate_out: { label: "Ate out", icon: Utensils },
  swapped: { label: "Something else", icon: Shuffle },
};

/** What the row is called: the recipe, the free text, or the marker. */
export function entryTitle(e: HistoryEntryWire): string {
  if (e.status === "swapped") return e.recipe?.title ?? e.freeText ?? "Something else";
  if (e.plannedKind === "leftovers") return "Leftovers";
  if (e.status === "ate_out" && !e.recipe) return "Ate out";
  if (e.status === "skipped" && !e.recipe) return "Skipped";
  return e.recipe?.title ?? "A meal";
}

export const entryIcon = (e: HistoryEntryWire): LucideIcon | null =>
  e.plannedKind === "leftovers" && e.status === "eaten" ? Repeat : null;

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** "today", "yesterday", "12 days ago", "5 weeks ago". */
export function ago(date: string, today: string): string {
  const d = daysBetween(date, today);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 21) return `${d} days ago`;
  if (d < 70) return `${Math.floor(d / 7)} weeks ago`;
  return `${Math.floor(d / 30)} months ago`;
}
