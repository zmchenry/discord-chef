import { weekDates, type WeekSlot, type WeekView } from "../../../../shared/planningApi";
import { MARKER_LABEL } from "../planning/format";

// What a slot says in the compact week: the recipe, "Leftovers: Chili"
// (the dinner before; the first day's comes from the server), or a marker.
export function slotLabel(week: WeekView, slot: WeekSlot | undefined, leftoversFrom: Record<string, string>): string | null {
  if (!slot) return null;
  if (slot.kind === "recipe") return slot.recipe?.title ?? "A recipe";
  if (slot.kind === "leftovers" && slot.meal === "lunch") {
    const i = weekDates(week.id).indexOf(slot.date);
    const before = i > 0 ? week.slots.find((s) => s.date === weekDates(week.id)[i - 1] && s.meal === "dinner") : undefined;
    const from = before?.kind === "recipe" ? before.recipe?.title : leftoversFrom[slot.date];
    if (from) return `Leftovers: ${from}`;
  }
  return MARKER_LABEL[slot.kind];
}

// The first day without a dinner; with every dinner set, B & L if any
// breakfast or lunch is open, else the review.
export function firstOpenStep(week: WeekView): number {
  const i = week.days.findIndex((d) => !week.slots.some((s) => s.date === d.date && s.meal === "dinner"));
  if (i >= 0) return i;
  return week.slots.filter((s) => s.meal !== "dinner").length < 14 ? 7 : 8;
}
