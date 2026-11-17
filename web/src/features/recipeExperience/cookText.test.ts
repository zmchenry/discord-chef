import { describe, expect, it } from "vitest";

import { detectDurations, formatAmountText, formatClock, formatQuantity, scaleIngredientText } from "./cookText";

describe("detectDurations", () => {
  it.each([
    ["Simmer for 10 minutes.", [600]],
    ["Cook 1-2 minutes per side.", [120]],
    ["Bake 3 to 4 mins, then rest 5 min.", [240, 300]],
    ["Let it rise for an hour.", [3600]],
    ["Roast 1 hour 30 minutes", [5400]],
    ["Braise for 1 1/2 hours", [5400]],
    ["Chill for half an hour", [1800]],
    ["Rest an hour and a half", [5400]],
    ["Microwave 45 seconds", [45]],
    ["Leave a 5-minute gap, then toast.", [300]],
    ["Preheat the oven to 400 degrees.", []],
    ["Bake at 350 until golden.", []],
    ["Add a few minutes more if needed.", []],
  ])("%s", (text, seconds) => {
    expect(detectDurations(text).map((d) => d.seconds)).toEqual(seconds);
  });
});

describe("formatQuantity and scaling", () => {
  it.each([
    [1.5, "1½"],
    [1 / 3, "⅓"],
    [2, "2"],
    [0.75, "¾"],
    [2.67, "2⅔"],
    [0.1, "0.1"],
    [13.4, "13"],
    [0.99, "1"],
  ])("%s -> %s", (n, text) => {
    expect(formatQuantity(n)).toBe(text);
  });

  it.each([
    ["1 1/2 cups flour", 2, "3 cups flour"],
    ["½ tsp salt", 2, "1 tsp salt"],
    ["1½ cups milk", 0.5, "¾ cups milk"],
    ["2-3 cloves garlic", 0.5, "1-1½ cloves garlic"],
    ["1 lb ground beef", 1.5, "1½ lb ground beef"],
    ["salt and pepper", 2, "salt and pepper"],
    ["2 eggs", 1, "2 eggs"],
  ])("%s x%s -> %s", (raw, factor, text) => {
    expect(scaleIngredientText(raw, factor)).toBe(text);
  });

  it("formats amounts", () => {
    expect([
      formatAmountText(1.5, "cup"),
      formatAmountText(0.5, "tsp"),
      formatAmountText(1, "cup"),
      formatAmountText(2, null),
    ]).toEqual(["1½ cups", "½ tsp", "1 cup", "2"]);
  });

  it("formats a countdown", () => {
    expect([formatClock(605), formatClock(3725), formatClock(0.2)]).toEqual(["10:05", "1:02:05", "0:01"]);
  });
});
