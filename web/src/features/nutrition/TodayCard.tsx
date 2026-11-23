import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

import { hasAnyGoal, MACRO_SHORT, type Macro } from "../../../../shared/nutrition/goals";
import { sundayOf, todayIn } from "../../../../shared/planningApi";
import { Card } from "../../components/ui";
import { cx } from "../../lib/cx";
import { useWeekNutrition } from "./api";
import { FALLBACK_MAX, fmt, goalFor, personFill } from "./format";
import { GoalBar } from "./GoalBar";
import { Est, PersonName } from "./parts";

const SMALL: Macro[] = ["protein", "carbs", "fat"];

// The Week page's first card: today's estimated calories and P/C/F per
// person against their goals. Tapping it opens the Day view.
export function TodayCard({ className }: { className?: string }) {
  const today = todayIn();
  const q = useWeekNutrition(sundayOf(today));
  const day = q.data?.days.find((d) => d.date === today);
  if (!q.data || !day) return null;
  const { people, goals } = q.data;
  const noGoals = !hasAnyGoal(goals);
  const anyKnown = people.some((p) => day.people[p]!.home && day.people[p]!.known > 0);

  return (
    <Card className={cx("grid", className)}>
      <Link
        to="/week/nutrition"
        className="pressable grid gap-3 rounded-card p-4 text-text no-underline"
        aria-label={`Today's nutrition: ${people
          .map((p) => {
            const d = day.people[p]!;
            const g = goalFor(goals, p);
            return !d.home ? `${p} away` : `${p} ${fmt(d.totals.kcal)}${g?.kcal ? ` of ${fmt(g.kcal)}` : ""} kcal`;
          })
          .join(", ")}. Open nutrition.`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="font-display text-xl font-semibold">Today</span>
            {anyKnown && <Est />}
          </span>
          <span className="flex items-center gap-1 text-sm font-semibold text-muted">
            Nutrition <ChevronRight size={18} aria-hidden="true" />
          </span>
        </span>
        {!anyKnown ? (
          <span className="text-sm text-muted">Nothing with an estimate planned today yet.</span>
        ) : (
          <span className="grid gap-3 sm:grid-cols-2 sm:gap-6">
            {people.map((name, i) => {
              const d = day.people[name]!;
              const g = goalFor(goals, name);
              if (!d.home)
                return (
                  <span key={name} className="flex items-center justify-between text-sm">
                    <PersonName name={name} index={i} />
                    <span className="text-muted">Away</span>
                  </span>
                );
              return (
                <span key={name} className="grid gap-1.5">
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <PersonName name={name} index={i} />
                    <span className="tabular-nums">
                      <span className="font-bold">{fmt(d.totals.kcal)}</span>
                      <span className="text-muted">{g?.kcal ? ` / ${fmt(g.kcal)}` : ""} kcal</span>
                    </span>
                  </span>
                  <GoalBar value={d.totals.kcal} goal={g?.kcal ?? null} fallbackMax={FALLBACK_MAX.kcal} fill={personFill(i)} />
                  <span className="grid grid-cols-3 gap-3">
                    {SMALL.map((m) => (
                      <span key={m} className="grid gap-1">
                        <span className="text-xs tabular-nums">
                          <span className="font-semibold">{MACRO_SHORT[m]}</span> {fmt(d.totals[m])}
                          <span className="text-muted">{g?.[m] ? `/${fmt(g[m]!)}` : ""}g</span>
                        </span>
                        <GoalBar value={d.totals[m]} goal={g?.[m] ?? null} fallbackMax={FALLBACK_MAX[m]} fill={personFill(i)} size="sm" />
                      </span>
                    ))}
                  </span>
                  {d.gaps > 0 && (
                    <span className="text-xs text-muted">
                      {d.gaps} meal{d.gaps === 1 ? "" : "s"} unknown
                    </span>
                  )}
                </span>
              );
            })}
          </span>
        )}
      </Link>
      {noGoals && (
        <p className="m-0 flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-sm text-muted">
          No goals yet.
          <Link to="/more/goals" className="inline-flex min-h-11 items-center font-semibold text-primary">
            Set goals
          </Link>
        </p>
      )}
    </Card>
  );
}
