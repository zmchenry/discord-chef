// The day scratch pad's model and math. Pure: no I/O, no React.
//
// A day has four slots (breakfast, lunch, dinner, snack), each holding zero
// or more items. Each item is a recipe (or a plan marker) at some servings.
// The first servings of every item are split between the people by their
// kcal goals (household/servings.splitPortions); servings beyond one each
// count for nobody. An item whose nutrition is unknown is a gap, never zero.

import { DEFAULT_SERVINGS, splitPortions } from "../../../../shared/household/servings";
import type { Goals, Portions } from "../../../../shared/nutrition/week";
import type { Confidence } from "../../../../shared/nutrition/recipe";
import type { Meal, SlotKind } from "../../../../shared/schema";

export const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type SlotKey = (typeof SLOTS)[number];
export const SLOT_LABEL: Record<SlotKey, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};
// The slots the week plan has; snacks live only here.
export const PLAN_MEALS: readonly Meal[] = ["breakfast", "lunch", "dinner"];

export const MACROS = ["kcal", "protein", "carbs", "fat"] as const;
export type Macro = (typeof MACROS)[number];
export type Macros = Record<Macro, number>;
export const MACRO_LABEL: Record<Macro, string> = { kcal: "Calories", protein: "Protein", carbs: "Carbs", fat: "Fat" };
export const MACRO_UNIT: Record<Macro, string> = { kcal: "kcal", protein: "g", carbs: "g", fat: "g" };
export const NO_MACROS: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export type Marker = Exclude<SlotKind, "recipe">;

export interface ScratchItem {
  // Stable within a variation, for React keys and edits.
  key: string;
  // The recipe eaten: the slot's own, or for leftovers the dinner it comes from.
  recipeId: string | null;
  title: string;
  icon: string | null;
  servings: number;
  // From the plan: leftovers, eat out or skip. Absent for a picked recipe.
  marker?: Marker;
}

export const VARIATION_NAMES = ["A", "B", "C"] as const;
export type VariationName = (typeof VARIATION_NAMES)[number];

export interface Variation {
  name: VariationName;
  slots: Record<SlotKey, ScratchItem[]>;
}

export interface DayScratch {
  active: number;
  variations: Variation[];
}

export const emptySlots = (): Record<SlotKey, ScratchItem[]> => ({ breakfast: [], lunch: [], dinner: [], snack: [] });

// What the panel knows about one recipe's nutrition.
export interface RecipeFacts {
  perServing: Macros;
  confidence: Confidence;
  // Ingredient lines with no estimate. All of them: the recipe is unknown.
  lines: number;
  missing: number;
}

export type ItemStatus = "known" | "gap" | "loading" | "none";

export interface ItemTotals {
  status: ItemStatus;
  portions: Portions;
  // What each person gets from it (zero for a gap: see `status`).
  perPerson: Record<string, Macros>;
  missing: number;
  confidence: Confidence | null;
}

export interface PersonTotals {
  totals: Macros;
  bySlot: Record<SlotKey, Macros>;
  goal: Record<Macro, number | null>;
  // goal - total; negative is over. null with no goal.
  remaining: Record<Macro, number | null>;
  // Items this person eats whose numbers we don't have.
  gaps: number;
}

export interface DayTotals {
  people: Record<string, PersonTotals>;
  items: Record<string, ItemTotals>;
  gaps: number;
  loading: number;
  // Ingredient lines with no estimate, over the known recipes.
  missingIngredients: number;
  confidence: Confidence | null;
}

const add = (a: Macros, b: Macros, times = 1): Macros => ({
  kcal: a.kcal + b.kcal * times,
  protein: a.protein + b.protein * times,
  carbs: a.carbs + b.carbs * times,
  fat: a.fat + b.fat * times,
});
const round = (a: Macros): Macros => ({
  kcal: Math.round(a.kcal),
  protein: Math.round(a.protein),
  carbs: Math.round(a.carbs),
  fat: Math.round(a.fat),
});

const CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

// A recipe is known when at least one ingredient line has an estimate.
export const isKnown = (f: RecipeFacts | null | undefined): f is RecipeFacts => !!f && f.lines > 0 && f.missing < f.lines;

// facts: recipe id -> its nutrition; undefined = still loading; null = no data.
export function dayTotals(input: {
  people: readonly string[];
  goals: Goals;
  variation: Variation;
  facts: Record<string, RecipeFacts | null | undefined>;
}): DayTotals {
  const { people, goals, variation, facts } = input;
  const out: DayTotals = { people: {}, items: {}, gaps: 0, loading: 0, missingIngredients: 0, confidence: null };
  const sums = Object.fromEntries(
    people.map((p) => [p, { totals: NO_MACROS, bySlot: Object.fromEntries(SLOTS.map((s) => [s, NO_MACROS])), gaps: 0 }]),
  ) as Record<string, { totals: Macros; bySlot: Record<SlotKey, Macros>; gaps: number }>;
  let worst: Confidence | null = null;

  for (const slot of SLOTS) {
    for (const item of variation.slots[slot]) {
      // Skip: nobody eats anything. Eat out: eaten, unknown.
      const portions = item.marker === "skip" ? {} : splitPortions(people, item.servings, goals);
      const f = item.recipeId ? facts[item.recipeId] : null;
      const status: ItemStatus =
        item.marker === "skip" ? "none" : !item.recipeId ? "gap" : f === undefined ? "loading" : isKnown(f) ? "known" : "gap";
      const perPerson: Record<string, Macros> = {};
      for (const p of people) {
        const share = portions[p] ?? 0;
        perPerson[p] = status === "known" ? round(add(NO_MACROS, f!.perServing, share)) : NO_MACROS;
        const s = sums[p]!;
        if (status === "known") {
          s.totals = add(s.totals, f!.perServing, share);
          s.bySlot[slot] = add(s.bySlot[slot], f!.perServing, share);
        } else if ((status === "gap" || status === "loading") && share > 0) {
          s.gaps++;
        }
      }
      if (status === "gap") out.gaps++;
      if (status === "loading") out.loading++;
      if (status === "known") {
        out.missingIngredients += f!.missing;
        if (!worst || CONF_RANK[f!.confidence] < CONF_RANK[worst]) worst = f!.confidence;
      }
      out.items[item.key] = {
        status,
        portions,
        perPerson,
        missing: status === "known" ? f!.missing : 0,
        confidence: status === "known" ? f!.confidence : null,
      };
    }
  }

  for (const p of people) {
    const s = sums[p]!;
    const totals = round(s.totals);
    const g = goals[p];
    const goal: Record<Macro, number | null> = {
      kcal: g?.kcal ?? null,
      protein: g?.protein ?? null,
      carbs: g?.carbs ?? null,
      fat: g?.fat ?? null,
    };
    out.people[p] = {
      totals,
      bySlot: Object.fromEntries(SLOTS.map((k) => [k, round(s.bySlot[k])])) as Record<SlotKey, Macros>,
      goal,
      remaining: Object.fromEntries(MACROS.map((m) => [m, goal[m] === null ? null : goal[m]! - totals[m]])) as Record<
        Macro,
        number | null
      >,
      gaps: s.gaps,
    };
  }
  out.confidence = worst;
  return out;
}

// "420 kcal and 38 g protein left", "120 kcal over, 12 g protein left".
// null with neither goal.
export function remainingText(r: PersonTotals["remaining"]): string | null {
  const part = (n: number | null, unit: string) =>
    n === null ? null : n >= 0 ? `${n.toLocaleString("en-US")} ${unit} left` : `${(-n).toLocaleString("en-US")} ${unit} over`;
  const k = part(r.kcal, "kcal");
  const p = part(r.protein, "g protein");
  if (k && p) {
    const kLeft = r.kcal! >= 0;
    const pLeft = r.protein! >= 0;
    // "420 kcal and 38 g protein left" when both go the same way.
    if (kLeft === pLeft) return `${k.replace(/ (left|over)$/, "")} and ${p}`;
    return `${k}, ${p}`;
  }
  return k ?? p;
}

// The honest small print: estimates, unknown ingredients, unknown meals.
export function caveats(t: DayTotals): string {
  const bits = ["est."];
  if (t.missingIngredients) bits.push(`${t.missingIngredients} ingredient${t.missingIngredients === 1 ? "" : "s"} unknown`);
  if (t.gaps) bits.push(`${t.gaps} item${t.gaps === 1 ? "" : "s"} unknown, not counted`);
  if (t.loading) bits.push("adding up…");
  return bits.join(" · ");
}

// Each person's macros in `b` minus `a`.
export function deltaTotals(a: DayTotals, b: DayTotals): Record<string, Macros> {
  return Object.fromEntries(
    Object.keys(b.people).map((p) => {
      const x = a.people[p]?.totals ?? NO_MACROS;
      const y = b.people[p]!.totals;
      return [p, { kcal: y.kcal - x.kcal, protein: y.protein - x.protein, carbs: y.carbs - x.carbs, fat: y.fat - x.fat }];
    }),
  );
}

// --- The plan ---------------------------------------------------------------------

// One planned meal as the scratch pad reads it.
export interface PlannedMeal {
  kind: SlotKind;
  recipeId: string | null;
  title: string;
  icon: string | null;
  servings: number;
  // For leftovers: the recipe they come from.
  sourceId: string | null;
}

export const MARKER_TITLE: Record<Marker, string> = { leftovers: "Leftovers", eat_out: "Eat out", skip: "Skip" };

// The plan's breakfast, lunch and dinner as scratch items.
export function itemsFromPlan(plan: Partial<Record<Meal, PlannedMeal>>, newKey: () => string): Record<SlotKey, ScratchItem[]> {
  const slots = emptySlots();
  for (const meal of PLAN_MEALS) {
    const m = plan[meal];
    if (!m) continue;
    slots[meal] = [
      m.kind === "recipe"
        ? { key: newKey(), recipeId: m.recipeId, title: m.title, icon: m.icon, servings: m.servings }
        : { key: newKey(), recipeId: m.kind === "leftovers" ? m.sourceId : null, title: m.title, icon: m.icon, servings: m.servings, marker: m.kind },
    ];
  }
  return slots;
}

export interface PlanChange {
  meal: Meal;
  from: PlannedMeal | null;
  to: ScratchItem | null;
  // replace: a different meal. servings: same meal, new servings. same: no
  // change. keep: nothing here, so the plan keeps what it has.
  action: "replace" | "servings" | "same" | "keep";
}

const kindOf = (i: ScratchItem): SlotKind => i.marker ?? "recipe";

// What "Use for <day>" does to each planned meal. Only the first item of a
// meal goes to the plan; extras and snacks stay here.
export function planChanges(variation: Variation, plan: Partial<Record<Meal, PlannedMeal>>): PlanChange[] {
  return PLAN_MEALS.map((meal): PlanChange => {
    const to = variation.slots[meal][0] ?? null;
    const from = plan[meal] ?? null;
    if (!to) return { meal, from, to, action: "keep" };
    const sameMeal =
      !!from && from.kind === kindOf(to) && (from.kind === "recipe" ? from.recipeId === to.recipeId : true);
    if (!sameMeal) return { meal, from, to, action: "replace" };
    return { meal, from, to, action: from.servings === to.servings ? "same" : "servings" };
  });
}

// The servings to save for a meal: null is the default.
export const servingsToSave = (n: number) => (n === DEFAULT_SERVINGS ? null : n);
