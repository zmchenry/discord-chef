import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

import { sundayOf } from "../../../../shared/planningApi";
import { useWeekNutrition } from "./api";
import { fmt, personFill } from "./format";
import { GoalBar } from "./GoalBar";

// One compact line at the bottom of a day card: each person's estimated kcal
// against their goal. Nothing on a day with no known meals. Taps through to
// the week's nutrition view.
export function DayNutritionBar({ date }: { date: string }) {
  const weekId = sundayOf(date);
  const q = useWeekNutrition(weekId);
  const day = q.data?.days.find((d) => d.date === date);
  if (!q.data || !day) return null;
  const people = q.data.people
    .map((name, i) => ({ name, i, d: day.people[name]!, goal: q.data.goals.find((g) => g.person === name)?.kcal ?? null }))
    .filter((p) => p.d.home);
  if (!people.some((p) => p.d.known > 0)) return null;
  const gaps = Math.max(...people.map((p) => p.d.gaps));
  const label = `Estimated nutrition: ${people
    .map((p) => `${p.name} ${fmt(p.d.totals.kcal)}${p.goal ? ` of ${fmt(p.goal)}` : ""} kcal`)
    .join(", ")}${gaps ? `, ${gaps} meal${gaps === 1 ? "" : "s"} unknown` : ""}`;

  return (
    <Link
      to={`/week/nutrition?week=${weekId}#d-${date}`}
      aria-label={label}
      className="pressable mt-2 flex min-h-11 items-center gap-2 rounded-sm px-1 pt-1 text-text no-underline"
    >
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="flex gap-3">
          {people.map((p) => (
            <span key={p.name} className="grid min-w-0 flex-1 gap-1">
              <span className="flex items-baseline justify-between gap-1 text-xs">
                <span className="truncate font-semibold">{p.name}</span>
                <span className="tabular-nums text-muted">
                  {fmt(p.d.totals.kcal)}
                  {p.goal ? `/${fmt(p.goal)}` : " kcal"}
                </span>
              </span>
              <GoalBar value={p.d.totals.kcal} goal={p.goal} fallbackMax={2500} fill={personFill(p.i)} />
            </span>
          ))}
        </span>
        <span className="text-xs text-muted">
          est. kcal{gaps ? ` · ${gaps} meal${gaps === 1 ? "" : "s"} unknown` : ""}
        </span>
      </span>
      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted" />
    </Link>
  );
}
