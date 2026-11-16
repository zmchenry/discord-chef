import type { Page, Route } from "@playwright/test";

import type { Recipe, RecipeSummary } from "../../shared/schema";

// Answers /api/* in the browser so the smoke test needs no Worker or D1.
// Responses are typed against shared/schema.ts, so contract drift fails tsc.
export const recipe: Recipe = {
  id: "7f1c1f43-7a35-4a5e-8d3e-1f2b3c4d5e6f",
  title: "Sheet-pan chicken fajitas with a very long title that has to wrap",
  description: "Weeknight staple.",
  sourceUrl: "https://example.com/fajitas",
  imageUrl: null,
  icon: "🌮",
  servings: 4,
  prepMinutes: 15,
  cookMinutes: 25,
  instructions: ["Slice everything.", "Roast at 425°F for 25 minutes."],
  notes: null,
  tags: ["dinner", "fast"],
  ingredients: [
    { id: 1, position: 0, rawText: "1.5 lb chicken thighs", ingredientId: 1, ingredientName: "chicken thighs", quantity: 1.5, unit: "lb", note: null, optional: false },
    { id: 2, position: 1, rawText: "3 bell peppers", ingredientId: 2, ingredientName: "bell pepper", quantity: 3, unit: null, note: null, optional: false },
  ],
  createdBy: "dev@example.com",
  createdAt: 1_763_200_000_000,
  updatedAt: 1_763_200_000_000,
  archivedAt: null,
  notionPageId: null,
};

const summary: RecipeSummary = {
  id: recipe.id,
  title: recipe.title,
  description: recipe.description,
  icon: recipe.icon,
  imageUrl: null,
  servings: recipe.servings,
  prepMinutes: recipe.prepMinutes,
  cookMinutes: recipe.cookMinutes,
  tags: recipe.tags,
  updatedAt: recipe.updatedAt,
  ingredientCount: recipe.ingredients.length,
};

export async function mockApi(page: Page) {
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    switch (true) {
      case url.pathname === "/api/me":
        return json({ email: "dev@example.com", displayName: null });
      case url.pathname === "/api/recipes":
        return json({ recipes: [summary] });
      case url.pathname === `/api/recipes/${recipe.id}`:
        return json(recipe);
      default:
        return json({ error: "not mocked" }, 404);
    }
  });
}
