import { ArrowDown, ArrowUp } from "lucide-react";

import type { ReasonWire } from "../../../shared/planningApi";
import { cx } from "../lib/cx";
import { ReasonText } from "./ReasonText";

// Why a suggestion sits where it does: up reasons lifted it, down reasons
// sank it, strongest first. The first chip is drawn a little stronger. The
// arrow carries the direction for colour-blind readers, and screen readers
// hear "helps" or "hurts".
export function ReasonChips({ why, reasons = [] }: { why: ReasonWire[]; reasons?: string[] }) {
  const items: ReasonWire[] = why.length ? why : reasons.map((text) => ({ text, tone: "up" }));
  if (items.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Why it's here">
      {items.map((r, i) => {
        const Icon = r.tone === "down" ? ArrowDown : r.tone === "up" ? ArrowUp : null;
        return (
          <li
            key={r.text}
            className={cx(
              "inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-semibold",
              r.tone === "down" ? "bg-surface-2 text-muted" : "bg-accent-soft text-accent",
              i === 0 && "font-bold shadow-[inset_0_0_0_1px_currentColor]",
            )}
          >
            {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />}
            <span className="sr-only">{r.tone === "down" ? "Hurts: " : r.tone === "up" ? "Helps: " : ""}</span>
            <ReasonText text={r.text} />
          </li>
        );
      })}
    </ul>
  );
}
