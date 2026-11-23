import { describe, expect, it } from "vitest";

import {
  dayTotals,
  emptySlots,
  planChanges,
  remainingText,
  type RecipeFacts,
  type ScratchItem,
  type SlotKey,
  type Variation,
} from "./model";

const PEOPLE = ["Zach", "Liz"];
// Zach 2400 kcal, Liz 1600: a 2-serving meal splits 1.25 / 0.75.
const GOALS = {
  Zach: { kcal: 2400, protein: 160, carbs: null, fat: null },
  Liz: { kcal: 1600, protein: 110, carbs: 180, fat: 60 },
};
const facts = (kcal: number, protein: number, missing = 0, lines = 5): RecipeFacts => ({
  perServing: { kcal, protein, carbs: 10, fat: 4 },
  confidence: missing ? "medium" : "high",
  lines,
  missing,
});
const FACTS: Record<string, RecipeFacts | null | undefined> = {
  oats: facts(400, 20),
  chili: facts(600, 40, 2),
  empty: facts(0, 0, 3, 3), // every line unknown
  none: null, // no data at all
  slow: undefined, // still loading
};

let n = 0;
const item = (recipeId: string | null, servings = 2, marker?: ScratchItem["marker"]): ScratchItem => ({
  key: `k${n++}`,
  recipeId,
  title: recipeId ?? "x",
  icon: null,
  servings,
  marker,
});
const day = (slots: Partial<Record<SlotKey, ScratchItem[]>>): Variation => ({ name: "A", slots: { ...emptySlots(), ...slots } });

describe("dayTotals", () => {
  const cases: Array<{
    name: string;
    v: Variation;
    zach: number | null;
    liz: number | null;
    gaps: number;
    missing?: number;
  }> = [
    { name: "empty day", v: day({}), zach: 0, liz: 0, gaps: 0 },
    // 400 * 1.25 = 500, 400 * 0.75 = 300
    { name: "2 servings split by kcal goals", v: day({ breakfast: [item("oats")] }), zach: 500, liz: 300, gaps: 0 },
    // The 3rd and 4th servings are for nobody.
    { name: "extra servings count for nobody", v: day({ breakfast: [item("oats", 4)] }), zach: 500, liz: 300, gaps: 0 },
    // One serving: halves of the split (0.625 -> 0.5 rounded to quarters, 0.375 -> 0.5).
    { name: "one serving shrinks both shares", v: day({ breakfast: [item("oats", 1)] }), zach: 200, liz: 200, gaps: 0 },
    {
      name: "slots and extras add up",
      v: day({ breakfast: [item("oats")], dinner: [item("chili")], snack: [item("oats"), item("oats")] }),
      zach: 500 * 3 + 750,
      liz: 300 * 3 + 450,
      gaps: 0,
      missing: 2,
    },
    { name: "all-unknown recipe is a gap, not zero", v: day({ lunch: [item("empty")] }), zach: 0, liz: 0, gaps: 1 },
    { name: "no data is a gap", v: day({ lunch: [item("none")] }), zach: 0, liz: 0, gaps: 1 },
    { name: "eat out is a gap", v: day({ dinner: [item(null, 2, "eat_out")] }), zach: 0, liz: 0, gaps: 1 },
    { name: "skip is nothing eaten", v: day({ dinner: [item(null, 2, "skip")] }), zach: 0, liz: 0, gaps: 0 },
    { name: "leftovers count their source recipe", v: day({ lunch: [item("chili", 2, "leftovers")] }), zach: 750, liz: 450, gaps: 0, missing: 2 },
  ];
  it.each(cases)("$name", ({ v, zach, liz, gaps, missing = 0 }) => {
    const t = dayTotals({ people: PEOPLE, goals: GOALS, variation: v, facts: FACTS });
    expect(t.people.Zach!.totals.kcal).toBe(zach);
    expect(t.people.Liz!.totals.kcal).toBe(liz);
    expect(t.gaps).toBe(gaps);
    expect(t.missingIngredients).toBe(missing);
  });

  it("tracks loading, per-slot contributions and remaining vs goals", () => {
    const t = dayTotals({
      people: PEOPLE,
      goals: GOALS,
      variation: day({ breakfast: [item("oats")], dinner: [item("chili")], lunch: [item("slow")] }),
      facts: FACTS,
    });
    expect(t.loading).toBe(1);
    expect(t.people.Liz!.gaps).toBe(1);
    expect(t.people.Liz!.bySlot.dinner.kcal).toBe(450);
    expect(t.people.Liz!.bySlot.breakfast.protein).toBe(15);
    // Liz: 1600 - 750 kcal, 110 - (15 + 30) g protein; Zach has no fat goal.
    expect(t.people.Liz!.remaining).toEqual({ kcal: 850, protein: 65, carbs: 180 - 15, fat: 60 - 6 });
    expect(t.people.Zach!.remaining.fat).toBeNull();
    expect(t.confidence).toBe("medium");
  });

  it("splits evenly when someone has no kcal goal", () => {
    const t = dayTotals({
      people: PEOPLE,
      goals: { Zach: { kcal: null, protein: null, carbs: null, fat: null } },
      variation: day({ breakfast: [item("oats")] }),
      facts: FACTS,
    });
    expect(t.people.Zach!.totals.kcal).toBe(400);
    expect(t.people.Liz!.totals.kcal).toBe(400);
    expect(t.people.Liz!.remaining.kcal).toBeNull();
  });
});

describe("remainingText", () => {
  it.each([
    [{ kcal: 420, protein: 38, carbs: null, fat: null }, "420 kcal and 38 g protein left"],
    [{ kcal: -120, protein: -5, carbs: null, fat: null }, "120 kcal and 5 g protein over"],
    [{ kcal: -120, protein: 12, carbs: null, fat: null }, "120 kcal over, 12 g protein left"],
    [{ kcal: 1500, protein: null, carbs: null, fat: null }, "1,500 kcal left"],
    [{ kcal: null, protein: null, carbs: 20, fat: null }, null],
  ])("%j", (r, text) => expect(remainingText(r)).toBe(text));
});

describe("planChanges", () => {
  const plan = {
    breakfast: { kind: "recipe" as const, recipeId: "oats", title: "Oats", icon: null, servings: 2, sourceId: null },
    lunch: { kind: "leftovers" as const, recipeId: null, title: "Leftovers", icon: null, servings: 2, sourceId: "chili" },
    dinner: { kind: "recipe" as const, recipeId: "chili", title: "Chili", icon: null, servings: 2, sourceId: null },
  };
  it("replaces, rescales, keeps and leaves alone", () => {
    const v = day({
      breakfast: [item("oats")],
      lunch: [item("chili", 2, "leftovers")],
      dinner: [item("tacos", 3)],
      snack: [item("oats")],
    });
    expect(planChanges(v, plan).map((c) => c.action)).toEqual(["same", "same", "replace"]);
    const w = day({ breakfast: [item("oats", 3)] });
    expect(planChanges(w, plan).map((c) => c.action)).toEqual(["servings", "keep", "keep"]);
    expect(planChanges(day({ dinner: [item("chili")] }), {}).map((c) => c.action)).toEqual(["keep", "keep", "replace"]);
  });
});
