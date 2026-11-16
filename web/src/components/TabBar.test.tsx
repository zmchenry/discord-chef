import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderAt } from "../test/render";
import { TabBar } from "./TabBar";

describe("TabBar", () => {
  it("renders the four tabs as links in a labelled nav", () => {
    renderAt(<TabBar />, { path: "/week" });
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Week", "/week"],
      ["Recipes", "/recipes"],
      ["Shop", "/shop"],
      ["More", "/more"],
    ]);
  });

  it("marks the current route's tab, including nested routes", () => {
    renderAt(<TabBar />, { path: "/recipes/abc" });
    expect(screen.getByRole("link", { name: "Recipes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Week" })).not.toHaveAttribute("aria-current");
  });
});
