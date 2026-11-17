import { describe, expect, it } from "vitest";

import type { StructuredRecipe as Recipe } from "../../../../shared/recipePresentation";
import { describeMerge, mergeLinkImport } from "./merge";

const ing = (id: number, rawText: string, ingredientName: string, quantity: number | null = null) => ({
  id,
  position: id,
  rawText,
  ingredientId: id,
  ingredientName,
  quantity,
  unit: null,
  note: null,
  optional: false,
  group: null,
  flavors: [],
});

const base: Recipe = {
  id: "r1",
  title: "Beef Chili Crisp",
  description: null,
  sourceUrl: null,
  imageUrl: null,
  icon: "🌶️",
  servings: null,
  prepMinutes: 10,
  cookMinutes: null,
  instructions: [],
  notes: "Keep the crispy bits",
  tags: ["dinner", "fast"],
  ingredients: [ing(1, "ground beef", "ground beef"), ing(2, "2 cups rice", "rice", 2)],
  createdBy: null,
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
  notionPageId: null,
};

const url = "https://a.example/beef";
const draft = {
  title: "The Best Chili Crisp Beef Bowls",
  tags: ["asian"],
  servings: 4,
  prepMinutes: 15,
  cookMinutes: 20,
  imageUrl: "https://a.example/beef.jpg",
  sourceUrl: url,
  instructions: ["Brown the beef.", "Stir in the chili crisp.", "Serve over rice."],
  ingredients: [
    { rawText: "1 lb lean ground beef", name: "lean ground beef", quantity: 1, unit: "lb" },
    { rawText: "3 cups cooked rice", name: "cooked rice", quantity: 3, unit: "cup" },
    { rawText: "2 tbsp chili crisp", name: "chili crisp", quantity: 2, unit: "tbsp" },
    { rawText: "2 green onions", name: "green onions", quantity: 2 },
  ],
};

describe("mergeLinkImport", () => {
  it("keeps the title and tags, fills steps, adds missing ingredients and fills times", () => {
    const { input, summary } = mergeLinkImport(base, draft, url);
    expect(input).toMatchObject({
      title: "Beef Chili Crisp",
      tags: ["dinner", "fast"],
      icon: "🌶️",
      notes: "Keep the crispy bits",
      instructions: draft.instructions,
      prepMinutes: 10,
      cookMinutes: 20,
      servings: 4,
      sourceUrl: url,
    });
    // The bare "ground beef" takes the page's amount; rice already had one.
    expect(input.ingredients?.map((i) => i.rawText)).toEqual([
      "1 lb lean ground beef",
      "2 cups rice",
      "2 tbsp chili crisp",
      "2 green onions",
    ]);
    expect(describeMerge(summary)).toBe(
      "Adds 3 steps and 2 ingredients, fills amounts for 1 ingredient, fills the picture, link, servings and cook time.",
    );
  });

  it("replaces existing steps, and finds nothing new the second time", () => {
    const once = mergeLinkImport({ ...base, instructions: ["Cook it."] }, draft, url);
    expect(describeMerge(once.summary)).toMatch(/^Adds 2 ingredients, replaces 1 step with 3,/);

    const saved: Recipe = {
      ...base,
      servings: 4,
      cookMinutes: 20,
      imageUrl: draft.imageUrl,
      sourceUrl: url,
      instructions: (once.input.instructions ?? []).map((s) => (typeof s === "string" ? s : { title: s.title ?? null, text: s.text, ingredientRefs: s.ingredientRefs ?? [] })),
      ingredients: (once.input.ingredients ?? []).map((i, n) => ing(n, i.rawText, i.name ?? i.rawText, i.quantity ?? null)),
    };
    const again = mergeLinkImport(saved, draft, url);
    expect(describeMerge(again.summary)).toBe("Nothing new: the recipe already has everything on that page.");
  });
});
