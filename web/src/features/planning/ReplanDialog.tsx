import { useState } from "react";

import { Modal } from "../../components/Modal";

// Asks how to replan: keep your own picks (default) or keep only locked meals.
// Both clear, then auto-fill again.
export function ReplanDialog({
  onReplan,
  onClose,
  busy,
}: {
  onReplan: (keep: "mine" | "locked") => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [keep, setKeep] = useState<"mine" | "locked">("mine");
  const go = (k: "mine" | "locked") => {
    setKeep(k);
    onReplan(k);
  };

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title="Replan this week?"
      description="Auto-fill picks new meals around the ones you keep, using your calendar and themes."
      primary={{ label: "Replan", busy: busy && keep === "mine", onClick: () => go("mine") }}
      secondary={{ label: "Cancel", onClick: onClose, disabled: busy }}
      additional={[{ label: "Keep only locked", busy: busy && keep === "locked", onClick: () => go("locked") }]}
    >
      <ul className="m-0 grid gap-1.5 pl-5 text-sm text-muted">
        <li>
          <span className="font-semibold text-text">Replan</span> keeps everything you picked and redoes the auto picks.
        </li>
        <li>
          <span className="font-semibold text-text">Keep only locked</span> redoes every meal you haven&apos;t locked.
        </li>
      </ul>
    </Modal>
  );
}
