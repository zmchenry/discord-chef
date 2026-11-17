import type { Page, Route } from "@playwright/test";

import type { WeekView } from "../../shared/planningApi";
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

// A week with one locked dinner, one auto-picked lunch and a calendar chip.
function weekView(start: string): WeekView {
  const day = (i: number) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
  const ref = { id: recipe.id, title: recipe.title, icon: recipe.icon, totalMinutes: 40 };
  return {
    id: start,
    status: "draft",
    changedSinceFinish: false,
    days: Array.from({ length: 7 }, (_, i) => ({
      date: day(i),
      weekday: i,
      theme: i === 2 ? { weekday: 2, label: "Taco Tuesday", tags: ["mexican"], meals: ["dinner"] } : null,
      constraints: i === 2 ? [{ kind: "max_minutes", minutes: 25, meals: ["dinner"], reason: "Soccer 5:30–7 → 25 min or less" }] : [],
      events: i === 2 ? [{ title: "Soccer", time: "5:30–7", allDay: false }] : [],
    })),
    slots: [
      { date: day(2), meal: "dinner", kind: "recipe", recipeId: recipe.id, recipe: ref, source: "manual", locked: true },
      { date: day(3), meal: "lunch", kind: "recipe", recipeId: recipe.id, recipe: ref, source: "auto", locked: false },
      { date: day(6), meal: "dinner", kind: "eat_out", recipeId: null, recipe: null, source: "manual", locked: false },
    ],
    summary: { filled: 3, total: 21, estCostCents: null, shared: [] },
    calendar: "ok",
    calendarFetchedAt: Date.now() - 12 * 60_000,
    clashes: [],
  };
}

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
      case /^\/api\/weeks\/[\d-]+$/.test(url.pathname):
        return json(weekView(url.pathname.split("/").pop()!));
      case /^\/api\/weeks\/[\d-]+\/recommendations$/.test(url.pathname):
        return json({ recommendations: [] });
      default:
        return json({ error: "not mocked" }, 404);
    }
  });
}
