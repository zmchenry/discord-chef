import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RecipeSummary } from "../../../shared/schema";
import { renderAt } from "../test/render";
import { RecipesPage } from "./RecipesPage";

const tacos: RecipeSummary = {
  id: "7f1c1f43-7a35-4a5e-8d3e-1f2b3c4d5e6f",
  title: "Chicken tacos",
  description: null,
  icon: null,
  imageUrl: null,
  servings: 4,
  prepMinutes: 15,
  cookMinutes: 20,
  tags: ["dinner", "fast"],
  updatedAt: 1,
  ingredientCount: 6,
};

function mockFetch(recipes: RecipeSummary[]) {
  const fn = vi.fn(async (_url: string) => Response.json({ recipes }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("RecipesPage", () => {
  it("lists recipes from the API with time, servings, count and tags", async () => {
    mockFetch([tacos]);
    renderAt(<RecipesPage />, { path: "/recipes" });
    const link = await screen.findByRole("link", { name: /chicken tacos/i });
    expect(link).toHaveAttribute("href", `/recipes/${tacos.id}`);
    expect(link).toHaveTextContent("35 min");
    expect(link).toHaveTextContent("6 ingredients");
    expect(link).toHaveTextContent("Dinner");
  });

  it("shows the empty state", async () => {
    mockFetch([]);
    renderAt(<RecipesPage />, { path: "/recipes" });
    expect(await screen.findByText("No recipes yet")).toBeInTheDocument();
  });

  it("sends the search and meal filter to the API", async () => {
    const fetch = mockFetch([tacos]);
    renderAt(<RecipesPage />, { path: "/recipes" });
    await screen.findByRole("link", { name: /chicken tacos/i });

    await userEvent.click(screen.getByRole("button", { name: "Dinner" }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("/api/recipes?tag=dinner", expect.anything()));
    expect(screen.getByRole("button", { name: "Dinner" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.type(screen.getByLabelText("Search recipes"), "taco");
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("/api/recipes?q=taco&tag=dinner", expect.anything()));
  });

  it("shows the API error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "unauthenticated" }, { status: 401 })));
    renderAt(<RecipesPage />, { path: "/recipes" });
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
  });
});
