import { cx } from "../../lib/cx";

// A meter: the estimate as a fill on a neutral track, the goal as a tick.
// With no goal the bar is scaled to `fallbackMax`. Decorative: the numbers
// always sit beside it.
export function GoalBar({
  value,
  goal,
  fallbackMax,
  fill,
  size = "md",
  className,
}: {
  value: number;
  goal: number | null;
  fallbackMax: number;
  fill: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const max = Math.max(goal ? goal * 1.25 : fallbackMax, value, 1);
  const h = { sm: "h-1", md: "h-1.5", lg: "h-2.5" }[size];
  const tick = { sm: "-top-0.5 h-2", md: "-top-0.5 h-2.5", lg: "-top-1 h-[18px]" }[size];
  return (
    <div aria-hidden="true" className={cx("relative rounded-full bg-surface-2", h, className)}>
      <div className={cx("h-full rounded-full", fill)} style={{ width: `${(value / max) * 100}%` }} />
      {goal ? (
        <div
          className={cx("absolute w-0.5 rounded-full bg-text ring-2 ring-surface", tick)}
          style={{ left: `calc(${(goal / max) * 100}% - 1px)` }}
        />
      ) : null}
    </div>
  );
}

