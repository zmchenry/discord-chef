import { useState } from "react";

import type { NutritionTrendsWire } from "../../../../shared/nutrition";
import { hasAnyGoal, MACRO_LABEL, MACRO_UNIT, type Macro } from "../../../../shared/nutrition/goals";
import { sundayOf, todayIn } from "../../../../shared/planningApi";
import { Card, StateMessage } from "../../components/ui";
import { shortDate } from "../planning/format";
import { useTrends } from "./api";
import { LineChart, type ChartPoint } from "./charts";
import { fmt, goalFor, macroOptions, personSvg, shownMacros, withUnit } from "./format";
import { Est, GoalsPrompt, PersonName, Segmented } from "./parts";

// Trends: the last 8 weeks, each person's average per day for one macro,
// from what was planned. A week with nothing known is a gap in the line.
export function TrendsView({ macro, onMacro, onOpenWeek }: { macro: Macro; onMacro: (m: Macro) => void; onOpenWeek: (w: string) => void }) {
  const end = sundayOf(todayIn());
  const q = useTrends(end);
  const [picked, setPicked] = useState<string | null>(null);

  if (q.isPending) return <StateMessage title="Adding up 8 weeks…" />;
  if (q.isError) return <StateMessage title="Couldn't load trends">{q.error.message}</StateMessage>;
  const data = q.data;
  return (
    <div className="grid gap-3">
      <Segmented label="Macro" options={macroOptions(shownMacros(data.goals))} value={macro} onChange={onMacro} className="lg:max-w-xl" />
      {!hasAnyGoal(data.goals) && <GoalsPrompt text="No goals yet. Set them to see each week against a target." />}
      <div className="grid gap-3 lg:grid-cols-2">
        {data.people.map((name, i) => (
          <PersonTrend
            key={name}
            data={data}
            name={name}
            index={i}
            macro={macro}
            picked={picked}
            onPick={setPicked}
            onOpenWeek={onOpenWeek}
          />
        ))}
      </div>
      <TrendTable data={data} macro={macro} />
      <p className="m-0 text-sm text-muted">
        Average per day from planned meals, leaving out unknown days. This week counts through today.
      </p>
    </div>
  );
}

function PersonTrend(p: {
  data: NutritionTrendsWire;
  name: string;
  index: number;
  macro: Macro;
  picked: string | null;
  onPick: (w: string) => void;
  onOpenWeek: (w: string) => void;
}) {
  const { data, name, macro } = p;
  const goal = goalFor(data.goals, name)?.[macro] ?? null;
  const unit = MACRO_UNIT[macro];
  const last = data.weeks.length - 1;
  const points: ChartPoint[] = data.weeks.map((w, i) => {
    const v = w.people[name]?.perDay?.[macro] ?? null;
    return {
      key: w.weekId,
      label: shortDate(w.weekId),
      strong: i === last,
      value: v,
      faded: !!w.people[name]?.partial,
      description: `${name}, week of ${shortDate(w.weekId)}: ${v === null ? "unknown" : `${fmt(v)} ${unit} a day`}`,
    };
  });
  const known = points.filter((x) => x.value !== null);
  const overall = known.length ? Math.round(known.reduce((a, x) => a + x.value!, 0) / known.length) : null;
  const sel = p.picked ? data.weeks.find((w) => w.weekId === p.picked) : undefined;
  const s = sel?.people[name];

  return (
    <Card className="grid gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <PersonName name={name} index={p.index} className="text-lg" />
        {known.length > 0 && <Est />}
      </div>
      <div className="grid gap-0.5">
        <span className="text-sm text-muted">{known.length} of 8 weeks known, per day</span>
        <span className="text-2xl font-bold">
          {overall === null ? "No estimate" : withUnit(overall, macro)}
          {goal && overall !== null && <span className="text-base font-semibold text-muted"> of {fmt(goal)}</span>}
        </span>
      </div>
      <p className="m-0 flex min-h-11 items-center justify-between gap-2 rounded-sm bg-surface-2 px-3 py-1 text-sm" aria-live="polite">
        {sel && s ? (
          <>
            <span className="tabular-nums">
              <span className="font-bold">Week of {shortDate(sel.weekId)}:</span>{" "}
              {s.perDay ? `${withUnit(s.perDay[macro], macro)} a day · ${s.days} day${s.days === 1 ? "" : "s"}` : "nothing known"}
            </span>
            <button
              type="button"
              onClick={() => p.onOpenWeek(sel.weekId)}
              className="min-h-11 shrink-0 bg-transparent px-1 font-semibold text-primary"
            >
              Open week
            </button>
          </>
        ) : (
          <span className="text-muted">Tap a week for its numbers.</span>
        )}
      </p>
      <LineChart points={points} goal={goal} stroke={personSvg(p.index)} selected={p.picked} onSelect={p.onPick} />
    </Card>
  );
}

function TrendTable({ data, macro }: { data: NutritionTrendsWire; macro: Macro }) {
  return (
    <details className="rounded-card bg-surface p-4 shadow-card">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">{MACRO_LABEL[macro]} by week, as numbers</summary>
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-2 pr-2 font-semibold">Week of</th>
            {data.people.map((p) => (
              <th key={p} className="py-2 pl-2 text-right font-semibold">
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.weeks.map((w) => (
            <tr key={w.weekId} className="border-t border-border">
              <td className="py-2 pr-2">{shortDate(w.weekId)}</td>
              {data.people.map((p) => {
                const x = w.people[p];
                return (
                  <td key={p} className="py-2 pl-2 text-right tabular-nums">
                    {x?.perDay ? withUnit(x.perDay[macro], macro) : <span className="text-muted">unknown</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
