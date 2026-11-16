import { describe, expect, it } from "vitest";

import type { Recipe } from "../../../shared/schema";
import { emptyForm, formToInput, formatMinutes, recipeToForm, validateForm } from "./recipeForm";

const base: Recipe = {
  id: "r1",
  title: "Chili",
  description: "Big pot",
  sourceUrl: null,
  imageUrl: "https://example.com/chili.jpg",
  icon: "🌶️",
  servings: 6,
  prepMinutes: 20,
  cookMinutes: 90,
  instructions: ["Brown", "Simmer"],
  notes: "Freezes well",
  tags: ["dinner"],
  ingredients: [
    { id: 1, position: 0, rawText: "1 lb beef", ingredientId: 9, ingredientName: "ground beef", quantity: 1, unit: "lb", note: null, optional: false },
    { id: 2, position: 1, rawText: "cilantro", ingredientId: 3, ingredientName: "cilantro", quantity: null, unit: null, note: null, optional: true },
  ],
  createdBy: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  notionPageId: "abc",
};

describe("recipe form mapping", () => {
  it("round-trips a recipe, keeping hidden fields and parsed ingredient data", () => {
    const input = formToInput(recipeToForm(base), base);
    expect(input).toEqual({
      title: "Chili",
      description: "Big pot",
      sourceUrl: null,
      imageUrl: "https://example.com/chili.jpg",
      icon: "🌶️",
      servings: 6,
      prepMinutes: 20,
      cookMinutes: 90,
      instructions: ["Brown", "Simmer"],
      notes: "Freezes well",
      tags: ["dinner"],
      ingredients: [
        { rawText: "1 lb beef", name: "ground beef", quantity: 1, unit: "lb", note: null, optional: false },
        { rawText: "cilantro", name: "cilantro", quantity: null, unit: null, note: null, optional: true },
      ],
      notionPageId: "abc",
    });
  });

  it("treats an edited ingredient line as new", () => {
    const form = { ...recipeToForm(base), ingredients: "2 lb beef\ncilantro" };
    expect(formToInput(form, base).ingredients?.[0]).toEqual({ rawText: "2 lb beef" });
  });

  it("splits lines, drops blanks and normalises tags", () => {
    const input = formToInput({
      ...emptyForm,
      title: "  Toast ",
      tags: "Breakfast, , breakfast,Fast",
      ingredients: " bread \n\n butter ",
      instructions: "Toast it\n",
      servings: "",
    });
    expect(input).toMatchObject({
      title: "Toast",
      tags: ["breakfast", "fast"],
      ingredients: [{ rawText: "bread" }, { rawText: "butter" }],
      instructions: ["Toast it"],
      servings: null,
    });
  });

  it("validates title, numbers and the source link", () => {
    expect(validateForm({ ...emptyForm, title: "x" })).toEqual({});
    expect(
      validateForm({ ...emptyForm, servings: "0", prepMinutes: "1.5", cookMinutes: "-1", sourceUrl: "javascript:alert(1)" }),
    ).toEqual({
      title: expect.any(String),
      servings: expect.any(String),
      prepMinutes: expect.any(String),
      cookMinutes: expect.any(String),
      sourceUrl: expect.any(String),
    });
  });

  it("formats minutes", () => {
    expect(formatMinutes(null)).toBeNull();
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(110)).toBe("1 h 50 min");
  });
});
