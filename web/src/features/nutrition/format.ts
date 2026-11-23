import type { GoalWire } from "../../../../shared/nutrition";
import { MACRO_LABEL, MACRO_UNIT, type Macro } from "../../../../shared/nutrition/goals";
import { addDays, todayIn } from "../../../../shared/planningApi";

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// 1850 -> "1,850"
export const fmt = (n: number) => int.format(n);

// 1.5 -> "1.5 servings", 1 -> "1 serving"
export const servings = (n: number) => `${n} serving${n === 1 ? "" : "s"}`;

// One colour per person, in household order: tokens only. Never the only
// way to tell people apart: every chart and row carries the name.
const PERSON_FILL = ["bg-primary", "bg-accent"] as const;
const PERSON_SVG = [
  { stroke: "stroke-primary", fill: "fill-primary" },
  { stroke: "stroke-accent", fill: "fill-accent" },
] as const;
export const personFill = (i: number) => PERSON_FILL[i % PERSON_FILL.length];
export const personSvg = (i: number) => PERSON_SVG[i % PERSON_SVG.length];

export const CONFIDENCE_LABEL = { high: "Good estimate", medium: "Rough estimate", low: "Very rough estimate" } as const;

// "1,850 kcal", "120 g"
export const withUnit = (n: number, m: Macro) => `${fmt(n)} ${MACRO_UNIT[m]}`;

export const goalFor = (goals: readonly GoalWire[], person: string) => goals.find((g) => g.person === person) ?? null;

// The macros a view shows: the four always, fiber once someone has a fiber goal.
export const shownMacros = (goals: readonly GoalWire[]): Macro[] =>
  goals.some((g) => g.fiber != null) ? ["kcal", "protein", "carbs", "fat", "fiber"] : ["kcal", "protein", "carbs", "fat"];

// A scale per macro for bars when there is no goal.
export const FALLBACK_MAX: Record<Macro, number> = { kcal: 2500, protein: 150, carbs: 300, fat: 90, fiber: 35 };

export const macroOptions = (macros: readonly Macro[]) => macros.map((m) => ({ id: m, label: MACRO_LABEL[m] }));

const longFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
// "Monday, Nov 23"
export const longDate = (iso: string) => longFmt.format(new Date(`${iso}T00:00:00Z`));

// "Today", "Yesterday", "Tomorrow" or the long date.
export function dayTitle(iso: string): string {
  const today = todayIn();
  if (iso === today) return "Today";
  if (iso === addDays(today, -1)) return "Yesterday";
  if (iso === addDays(today, 1)) return "Tomorrow";
  return longDate(iso);
}
