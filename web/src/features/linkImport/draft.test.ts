import { describe, expect, it } from "vitest";

import { sharedUrl, withDraftExtras } from "./draft";

describe("sharedUrl", () => {
  it.each([
    ["?url=https://a.example/r", "https://a.example/r"],
    ["?title=Pancakes&text=" + encodeURIComponent("Try these! https://a.example/p?x=1."), "https://a.example/p?x=1"],
    ["?text=no%20link%20here", ""],
    ["", ""],
  ])("%s -> %s", (search, expected) => {
    expect(sharedUrl(new URLSearchParams(search))).toBe(expected);
  });
});

describe("withDraftExtras", () => {
  it("keeps parsed rows for unchanged lines and the draft's hidden fields", () => {
    const draft = {
      title: "Pancakes",
      description: "Fluffy.",
      imageUrl: "https://a.example/p.jpg",
      ingredients: [{ rawText: "2 eggs", name: "eggs", quantity: 2, unit: null, note: null }],
    };
    const input = { title: "Pancakes", description: null, imageUrl: null, ingredients: [{ rawText: "2 eggs" }, { rawText: "salt" }] };
    expect(withDraftExtras(input, draft)).toEqual({
      title: "Pancakes",
      description: "Fluffy.",
      imageUrl: "https://a.example/p.jpg",
      ingredients: [draft.ingredients[0], { rawText: "salt" }],
    });
  });
});
