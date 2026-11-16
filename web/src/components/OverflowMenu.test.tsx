import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pencil, Tag, Trash2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { OverflowMenu } from "./OverflowMenu";

describe("OverflowMenu", () => {
  it("opens, moves with arrows, selects, and gives focus back", async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    const del = vi.fn();
    render(
      <OverflowMenu
        items={[
          { label: "Edit", icon: Pencil, onSelect: edit },
          { label: "Two trips", icon: Tag, onSelect: () => {}, checked: true },
          { label: "Delete", icon: Trash2, onSelect: del, destructive: true },
        ]}
      />,
    );
    const button = screen.getByRole("button", { name: "More actions" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    expect(screen.getByRole("menuitemcheckbox", { name: /Two trips/ })).toHaveAttribute("aria-checked", "true");

    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(del).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();

    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
    expect(edit).not.toHaveBeenCalled();
  });
});
