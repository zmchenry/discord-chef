import { cx } from "../../lib/cx";

// A bullet bar: the estimate as a fill, the goal as a tick. With no goal the
// bar is scaled to `fallbackMax`. Decorative: the numbers sit beside it.
export function GoalBar({
  value,
  goal,
  fallbackMax,
  fill,
  className,
}: {
  value: number;
  goal: number | null;
  fallbackMax: number;
  fill: string;
  className?: string;
}) {
  const max = Math.max(goal ? goal * 1.25 : fallbackMax, value, 1);
  return (
    <div aria-hidden="true" className={cx("relative h-1.5 rounded-full bg-surface-2", className)}>
      <div className={cx("h-full rounded-full", fill)} style={{ width: `${(value / max) * 100}%` }} />
      {goal ? (
        <div className="absolute -top-0.5 h-2.5 w-0.5 rounded-full bg-text" style={{ left: `calc(${(goal / max) * 100}% - 1px)` }} />
      ) : null}
    </div>
  );
}
