import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Recipe } from "../../../shared/schema";
import { renderAt } from "../test/render";
import { RecipeForm } from "./RecipeEditPage";

afterEach(() => vi.unstubAllGlobals());

const saved: Recipe = {
  id: "7f1c1f43-7a35-4a5e-8d3e-1f2b3c4d5e6f",
  title: "Pancakes",
  description: null,
  sourceUrl: null,
  imageUrl: null,
  icon: null,
  servings: 2,
  prepMinutes: null,
  cookMinutes: null,
  instructions: ["Mix", "Fry"],
  notes: null,
  tags: ["breakfast"],
  ingredients: [],
  createdBy: "dev@example.com",
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  notionPageId: null,
};

describe("RecipeForm", () => {
  it("labels every field", () => {
    renderAt(<RecipeForm />);
    for (const label of ["Title", "Tags", "Servings", "Prep min", "Cook min", "Ingredients", "Steps", "Source link"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("validates before sending anything", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    renderAt(<RecipeForm />);
    await userEvent.type(screen.getByLabelText("Servings"), "lots");
    await userEvent.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(screen.getByText("Give the recipe a title.")).toBeInTheDocument();
    expect(screen.getByLabelText("Servings")).toHaveAttribute("aria-invalid", "true");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("POSTs the parsed recipe and navigates to it", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(saved, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    renderAt(<RecipeForm />, { path: "/recipes/new", route: "/recipes/new" });

    await userEvent.type(screen.getByLabelText("Title"), "Pancakes");
    await userEvent.type(screen.getByLabelText("Tags"), "Breakfast, weekend");
    await userEvent.type(screen.getByLabelText("Servings"), "2");
    await userEvent.type(screen.getByLabelText("Ingredients"), "flour{enter}{enter}milk");
    await userEvent.type(screen.getByLabelText("Steps"), "Mix{enter}Fry");
    await userEvent.click(screen.getByRole("button", { name: "Save recipe" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/recipes");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      title: "Pancakes",
      tags: ["breakfast", "weekend"],
      servings: 2,
      ingredients: [{ rawText: "flour" }, { rawText: "milk" }],
      instructions: ["Mix", "Fry"],
      sourceUrl: null,
    });
    expect(await screen.findByText("other page")).toBeInTheDocument();
  });
});
