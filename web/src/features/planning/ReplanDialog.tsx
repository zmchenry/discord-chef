import { useEffect, useRef } from "react";

import { Button } from "../../components/ui";

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
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-20 grid place-items-center p-4">
      <div className="absolute inset-0 bg-text/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="replan-title"
        aria-describedby="replan-desc"
        tabIndex={-1}
        className="relative w-full max-w-sm rounded-card bg-bg p-5 shadow-card outline-none"
      >
        <h2 id="replan-title" className="m-0 font-display text-2xl">
          Replan this week?
        </h2>
        <p id="replan-desc" className="mb-5 mt-2 text-muted">
          Auto-fill picks new meals around the ones you keep, using your calendar and themes.
        </p>
        <div className="grid gap-2">
          <Button onClick={() => onReplan("mine")} disabled={busy}>
            {busy ? "Replanning…" : "Replan"}
          </Button>
          <p className="m-0 -mt-1 mb-1 text-center text-sm text-muted">Keeps everything you picked; redoes the auto picks.</p>
          <Button variant="secondary" onClick={() => onReplan("locked")} disabled={busy}>
            Replan, keep only locked
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
