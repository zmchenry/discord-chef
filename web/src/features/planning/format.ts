import type { Meal, SlotKind } from "../../../../shared/schema";
import { WEEKDAY_SHORT, weekdayOf } from "../../../../shared/planningApi";

const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// "Nov 22"
export const shortDate = (iso: string) => monthDay.format(new Date(`${iso}T00:00:00Z`));

// "Sun"
export const dayName = (iso: string) => WEEKDAY_SHORT[weekdayOf(iso)];

export const MEAL_LABEL: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

export const MARKER_LABEL: Record<Exclude<SlotKind, "recipe">, string> = {
  leftovers: "Leftovers",
  eat_out: "Eat out",
  skip: "Skip",
};

// The Button component's pill shape, for buttons that need their own colours.
export const pill =
  "pressable inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 font-semibold disabled:opacity-60";

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
