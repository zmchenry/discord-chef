import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { WeekNutritionWire } from "../../../../shared/nutrition";
import { averageDays, hasAnyGoal, MACRO_LABEL, MACRO_UNIT, versusGoal, type Macro } from "../../../../shared/nutrition/goals";
import { addDays, todayIn } from "../../../../shared/planningApi";
import { Card, StateMessage } from "../../components/ui";
import { dayName, shortDate } from "../planning/format";
import { PlanVsActual } from "../foodLog/PlanVsActual";
import { useWeekNutrition } from "./api";
import { ColumnChart, type ChartPoint } from "./charts";
import { fmt, goalFor, macroOptions, personFill, shownMacros, withUnit } from "./format";
import { Est, GoalsPrompt, PersonName, Segmented } from "./parts";

export function WeekStepper({ weekId, onWeek, label }: { weekId: string; onWeek: (w: string) => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        aria-label="Previous week"
        onClick={() => onWeek(addDays(weekId, -7))}
        className="pressable grid min-h-11 min-w-11 place-items-center rounded-full bg-transparent text-text"
      >
        <ChevronLeft size={22} aria-hidden="true" />
      </button>
      <span className="text-center font-display text-xl font-semibold">{label}</span>
      <button
        type="button"
        aria-label="Next week"
        onClick={() => onWeek(addDays(weekId, 7))}
        className="pressable grid min-h-11 min-w-11 place-items-center rounded-full bg-transparent text-text"
      >
        <ChevronRight size={22} aria-hidden="true" />
      </button>
    </div>
  );
}

// Week: per person, the chosen macro day by day against the goal, the
// week's average per day, and every macro's average in a table.
export function WeekView({
  weekId,
  onWeek,
  macro,
  onMacro,
  onOpenDay,
}: {
  weekId: string;
  onWeek: (w: string) => void;
  macro: Macro;
  onMacro: (m: Macro) => void;
  onOpenDay: (date: string) => void;
}) {
  const q = useWeekNutrition(weekId);
  const [picked, setPicked] = useState<string | null>(null);
  const label = `${shortDate(weekId)} – ${shortDate(addDays(weekId, 6))}`;

  return (
    <div className="grid gap-3">
      <WeekStepper weekId={weekId} onWeek={onWeek} label={label} />
      {q.isPending ? (
        <StateMessage title="Adding it up…" />
      ) : q.isError ? (
        <StateMessage title="Couldn't load nutrition">{q.error.message}</StateMessage>
      ) : (
        <>
          <Segmented
            label="Macro"
            options={macroOptions(shownMacros(q.data.goals))}
            value={macro}
            onChange={onMacro}
            className="lg:max-w-xl"
          />
          {!hasAnyGoal(q.data.goals) && <GoalsPrompt />}
          <div className="grid gap-3 lg:grid-cols-2">
            {q.data.people.map((name, i) => (
              <PersonWeek
                key={name}
                data={q.data}
                name={name}
                index={i}
                macro={macro}
                picked={picked}
                onPick={setPicked}
                onOpenDay={onOpenDay}
              />
            ))}
          </div>
          <PlanVsActual data={q.data} macro={macro} />
          <Averages data={q.data} />
          <DailyTable data={q.data} macro={macro} />
          <p className="m-0 text-sm text-muted">
            Faded bars had a meal with no estimate; <span className="font-bold">?</span> marks a day with nothing known.
            Averages leave unknown days out.
          </p>
        </>
      )}
    </div>
  );
}

function PersonWeek({
  data,
  name,
  index,
  macro,
  picked,
  onPick,
  onOpenDay,
}: {
  data: WeekNutritionWire;
  name: string;
  index: number;
  macro: Macro;
  picked: string | null;
  onPick: (d: string) => void;
  onOpenDay: (d: string) => void;
}) {
  const goal = goalFor(data.goals, name)?.[macro] ?? null;
  const days = data.days.map((d) => ({ date: d.date, p: d.people[name]! }));
  const avg = averageDays(days.map((d) => d.p));
  const today = todayIn();
  const unit = MACRO_UNIT[macro];
  const points: ChartPoint[] = days.map(({ date, p }) => {
    const value = p.home && p.known > 0 ? p.totals[macro] : null;
    return {
      key: date,
      label: dayName(date).slice(0, 2),
      strong: date === today,
      value,
      faded: value !== null && p.gaps > 0,
      description: `${name}, ${dayName(date)} ${shortDate(date)}: ${
        !p.home ? "away" : value === null ? "unknown" : `${fmt(value)} ${unit}${goal ? ` of ${fmt(goal)}` : ""}`
      }`,
    };
  });
  const sel = picked ? days.find((d) => d.date === picked) : undefined;
  const avgValue = avg.perDay?.[macro] ?? null;
  const pct = avgValue !== null ? versusGoal(avgValue, goal).ratio : null;

  return (
    <Card className="grid gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <PersonName name={name} index={index} className="text-lg" />
        {avg.days > 0 && <Est />}
      </div>
      <div className="grid gap-0.5">
        <span className="text-sm text-muted">Average per day</span>
        <span className="text-2xl font-bold">
          {avgValue === null ? "No estimate" : withUnit(avgValue, macro)}
          {goal && avgValue !== null && (
            <span className="text-base font-semibold text-muted">
              {" "}
              of {fmt(goal)} · {Math.round(pct! * 100)}%
            </span>
          )}
        </span>
        <span className="text-xs text-muted">
          {avg.days} day{avg.days === 1 ? "" : "s"} counted
          {avg.partial ? ` · ${avg.partial} with unknown meals` : ""}
          {avg.unknown ? ` · ${avg.unknown} unknown` : ""}
        </span>
      </div>
      <p className="m-0 flex min-h-11 items-center justify-between gap-2 rounded-sm bg-surface-2 px-3 py-1 text-sm" aria-live="polite">
        {sel ? (
          <>
            <span className="tabular-nums">
              <span className="font-bold">
                {dayName(sel.date)} {shortDate(sel.date)}:
              </span>{" "}
              {!sel.p.home
                ? "away"
                : sel.p.known === 0
                  ? "nothing known"
                  : `${withUnit(sel.p.totals[macro], macro)}${goal ? ` of ${fmt(goal)}` : ""}${sel.p.gaps ? ` · ${sel.p.gaps} unknown` : ""}`}
            </span>
            <button type="button" onClick={() => onOpenDay(sel.date)} className="min-h-11 shrink-0 bg-transparent px-1 font-semibold text-primary">
              Open day
            </button>
          </>
        ) : (
          <span className="text-muted">Tap a day for its numbers.</span>
        )}
      </p>
      <ColumnChart points={points} goal={goal} fill={personFill(index)} selected={picked} onSelect={onPick} />
    </Card>
  );
}

// Every macro's weekly average next to the goal, per person: also the
// chart's table view.
function Averages({ data }: { data: WeekNutritionWire }) {
  const macros = shownMacros(data.goals);
  const avg = Object.fromEntries(data.people.map((p) => [p, averageDays(data.days.map((d) => d.people[p]!))]));
  return (
    <Card className="overflow-x-auto p-4">
      <h2 className="m-0 mb-2 text-lg">Weekly averages</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-2 pr-2 font-semibold">Per day</th>
            {data.people.map((p) => (
              <th key={p} className="py-2 pl-2 text-right font-semibold">
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {macros.map((m) => (
            <tr key={m} className="border-t border-border">
              <td className="py-2 pr-2">{MACRO_LABEL[m]}</td>
              {data.people.map((p) => {
                const v = avg[p]!.perDay?.[m];
                const g = goalFor(data.goals, p)?.[m];
                return (
                  <td key={p} className="py-2 pl-2 text-right tabular-nums">
                    {v == null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <>
                        <span className="font-bold">{fmt(v)}</span>
                        <span className="text-muted">
                          {g ? ` / ${fmt(g)}` : ""} {MACRO_UNIT[m]}
                        </span>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// The columns as numbers.
function DailyTable({ data, macro }: { data: WeekNutritionWire; macro: Macro }) {
  return (
    <details className="rounded-card bg-surface p-4 shadow-card">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">
        {MACRO_LABEL[macro]} by day, as numbers
      </summary>
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-2 pr-2 font-semibold">Day</th>
            {data.people.map((p) => (
              <th key={p} className="py-2 pl-2 text-right font-semibold">
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.days.map((d) => (
            <tr key={d.date} className="border-t border-border">
              <td className="py-2 pr-2">
                {dayName(d.date)} {shortDate(d.date)}
              </td>
              {data.people.map((p) => {
                const x = d.people[p]!;
                return (
                  <td key={p} className="py-2 pl-2 text-right tabular-nums">
                    {!x.home ? (
                      <span className="text-muted">away</span>
                    ) : x.known === 0 ? (
                      <span className="text-muted">unknown</span>
                    ) : (
                      <>
                        {withUnit(x.totals[macro], macro)}
                        {x.gaps ? <span className="text-muted"> +{x.gaps}?</span> : null}
                      </>
                    )}
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
