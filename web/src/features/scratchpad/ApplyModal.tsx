import { ArrowRight } from "lucide-react";

import { formatServings } from "../../../../shared/household/servings";
import { Modal } from "../../components/Modal";
import { MEAL_LABEL } from "../planning/format";
import { SLOTS, type PlanChange, type Variation } from "./model";

const servingsText = (n: number) => `${formatServings(n)} serving${n === 1 ? "" : "s"}`;

// Confirms "Use for <day>": each planned meal, what it holds now and what it
// becomes. Meals with nothing here keep what the plan has.
export function ApplyModal({
  dayLabel,
  variation,
  changes,
  error,
  onApply,
  onClose,
}: {
  dayLabel: string;
  variation: Variation;
  changes: PlanChange[];
  error: string | null;
  onApply: () => Promise<void>;
  onClose: () => void;
}) {
  const writes = changes.filter((c) => c.action === "replace" || c.action === "servings").length;
  const leftHere = SLOTS.reduce((n, s) => n + variation.slots[s].length, 0) - changes.filter((c) => c.to).length;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Use ${variation.name} for ${dayLabel}?`}
      description={
        writes
          ? `This changes ${writes} meal${writes === 1 ? "" : "s"} in ${dayLabel}'s plan.`
          : `${dayLabel}'s plan already matches ${variation.name}.`
      }
      secondary={{ label: "Cancel", onClick: onClose }}
      primary={{ label: `Use for ${dayLabel}`, onClick: onApply, disabled: writes === 0 }}
    >
      <ul className="m-0 grid list-none gap-2 p-0">
        {changes.map((c) => {
          const changed = c.action === "replace" || c.action === "servings";
          return (
            <li key={c.meal} className="grid gap-0.5 rounded-sm bg-surface-2 px-3 py-2">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-bold">{MEAL_LABEL[c.meal]}</span>
                <span className="text-sm text-muted">
                  {c.action === "replace" ? "Replaced" : c.action === "servings" ? "New servings" : c.action === "same" ? "No change" : "Kept"}
                </span>
              </span>
              {c.action === "keep" || c.action === "same" ? (
                <span className="text-sm text-muted">
                  {c.from ? `${c.from.title} · ${servingsText(c.from.servings)}` : "Nothing planned"}
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-x-2 text-sm">
                  <span className={changed ? "text-muted line-through" : "text-muted"}>
                    {c.from ? `${c.from.title} · ${servingsText(c.from.servings)}` : "Nothing planned"}
                  </span>
                  <ArrowRight size={14} aria-label="becomes" className="shrink-0 text-muted" />
                  <span className="font-semibold">
                    {c.to!.title} · {servingsText(c.to!.servings)}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {leftHere > 0 && (
        <p className="m-0 mt-3 text-sm text-muted">
          Snacks and extras aren't part of the plan; they stay here in the scratch pad.
        </p>
      )}
      {error && <p className="m-0 mt-3 text-sm font-semibold text-danger">{error}</p>}
    </Modal>
  );
}
