import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderAt } from "../test/render";
import { TabBar } from "./TabBar";

describe("TabBar", () => {
  it("marks the current route's tab, including nested routes", () => {
    renderAt(<TabBar />, { path: "/recipes/abc" });
    expect(screen.getByRole("link", { name: "Recipes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Week" })).not.toHaveAttribute("aria-current");
  });
});
