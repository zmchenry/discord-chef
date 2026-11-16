import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Modal, MultiStepModal, type ModalStep } from "./Modal";

const noop = () => {};

describe("Modal", () => {
  it("puts additional actions left and keeps secondary/primary compact", () => {
    render(
      <Modal
        open
        onClose={noop}
        title="Replan this week?"
        description="Picks new meals."
        primary={{ label: "Replan", onClick: noop }}
        secondary={{ label: "Cancel", onClick: noop }}
        additional={[{ label: "Keep only locked", onClick: noop }]}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Replan this week?" })).toHaveAccessibleDescription("Picks new meals.");
    const footer = screen.getByTestId("modal-footer");
    expect(footer).toHaveClass("flex");
    expect(footer).not.toHaveClass("grid-cols-2");
    const names = [...footer.querySelectorAll("button")].map((b) => b.textContent);
    expect(names).toEqual(["Keep only locked", "Cancel", "Replan"]);
  });

  it("splits the footer between secondary and primary without additional actions", async () => {
    const onClick = vi.fn();
    render(
      <Modal
        open
        onClose={noop}
        title="Delete it?"
        primary={{ label: "Delete", onClick, destructive: true }}
        secondary={{ label: "Cancel", onClick: noop }}
      />,
    );
    const footer = screen.getByTestId("modal-footer");
    expect(footer).toHaveClass("grid", "grid-cols-2");
    expect([...footer.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Cancel", "Delete"]);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders nothing when closed", () => {
    render(<Modal open={false} onClose={noop} title="Hidden" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

function Flow({ onFinish, failOn }: { onFinish: () => void; failOn?: string }) {
  const [open, setOpen] = useState(true);
  const steps: ModalStep[] = ["One", "Two", "Three"].map((label) => ({
    id: label,
    label,
    title: `Title ${label}`,
    render: ({ index, count }) => <p>{`Body ${label} (${index + 1}/${count})`}</p>,
    onNext:
      label === failOn
        ? async () => {
            throw new Error("nope");
          }
        : undefined,
  }));
  return <MultiStepModal open={open} onClose={() => setOpen(false)} steps={steps} onFinish={onFinish} finishLabel="Save" />;
}

describe("MultiStepModal", () => {
  it("moves forward and back, lets you jump to visited steps only, and finishes", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    render(<Flow onFinish={onFinish} />);

    expect(screen.getByText("Body One (1/3)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Step 2/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Body Two (2/3)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Title Two" })).toHaveFocus();
    expect(screen.getByText("Step 2 of 3: Two")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Body One (1/3)")).toBeInTheDocument();
    // Step 2 was visited, so it is a button; step 3 was not.
    expect(screen.queryByRole("button", { name: /Step 3/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Step 2: Two" }));
    expect(screen.getByText("Body Two (2/3)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Body Three (3/3)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(onFinish).toHaveBeenCalledOnce());
  });

  it("stays on the step when onNext throws", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    render(<Flow onFinish={onFinish} failOn="One" />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
    expect(screen.getByText("Body One (1/3)")).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
  });
});
