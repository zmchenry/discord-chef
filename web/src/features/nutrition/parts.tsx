import { Target } from "lucide-react";

import { MACRO_LABEL, MACRO_UNIT, versusGoal, type Macro } from "../../../../shared/nutrition/goals";
import { Card, LinkButton } from "../../components/ui";
import { cx } from "../../lib/cx";
import { FALLBACK_MAX, fmt, personFill } from "./format";
import { GoalBar } from "./GoalBar";

// Small pieces the Day, Week and Trends views share.

// "est.": every number here is an estimate.
export function Est({ className }: { className?: string }) {
  return (
    <abbr
      title="Estimated from the recipes' ingredients"
      className={cx("rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-text no-underline", className)}
    >
      est.
    </abbr>
  );
}

// The person's colour beside their name; the name carries identity.
export function PersonName({ name, index, className }: { name: string; index: number; className?: string }) {
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-2 font-bold", className)}>
      <span aria-hidden="true" className={cx("h-2.5 w-2.5 shrink-0 rounded-full", personFill(index))} />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function GoalsPrompt({ text = "No goals yet. Set daily targets to see how each day lands for each of you." }: { text?: string }) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="m-0 min-w-0 flex-1">{text}</p>
      <LinkButton to="/more/goals" variant="secondary">
        <Target size={18} aria-hidden="true" /> Set goals
      </LinkButton>
    </Card>
  );
}

// One macro against its goal: label, "1,640 / 2,400 kcal", the meter, and
// what's left or over.
export function MacroMeter({
  macro,
  value,
  goal,
  index,
}: {
  macro: Macro;
  value: number;
  goal: number | null;
  index: number;
}) {
  const p = versusGoal(value, goal);
  const unit = MACRO_UNIT[macro];
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{MACRO_LABEL[macro]}</span>
        <span className="text-sm tabular-nums">
          <span className="font-bold">{fmt(value)}</span>
          <span className="text-muted">
            {goal ? ` / ${fmt(goal)}` : ""} {unit}
          </span>
        </span>
      </div>
      <GoalBar value={value} goal={goal} fallbackMax={FALLBACK_MAX[macro]} fill={personFill(index)} size="lg" />
      {p.ratio !== null && (
        <span className="text-xs text-muted">
          {p.over ? `${fmt(p.over)} ${unit} over` : `${fmt(p.left!)} ${unit} to go`} · {Math.round(p.ratio * 100)}%
        </span>
      )}
    </div>
  );
}

// A row of toggle buttons: views (Day / Week / Trends) or macros.
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx("grid gap-1 rounded-full bg-surface-2 p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            "pressable min-h-11 truncate rounded-full px-2 text-sm font-bold",
            value === o.id ? "bg-surface text-text shadow-card" : "bg-transparent text-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
