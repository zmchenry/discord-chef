import type { NutritionTrendsWire, WeekNutritionWire } from "../../../../shared/nutrition";
import { MACRO_LABEL, type Macro } from "../../../../shared/nutrition/goals";
import { Card } from "../../components/ui";
import { cx } from "../../lib/cx";
import { LineChart, type ChartPoint } from "../nutrition/charts";
import { fmt, personSvg, withUnit } from "../nutrition/format";
import { PersonName } from "../nutrition/parts";
import { shortDate } from "../planning/format";

type Adherence = WeekNutritionWire["week"][string]["adherence"];

// Segments of the bar, in order. Followed is the only strong one; the rest
// are quiet tones, each named in the legend so colour is never the key.
const PARTS = [
  { key: "followed", label: "as planned", tone: "bg-primary" },
  { key: "logged", label: "ate other food", tone: "bg-accent" },
  { key: "swapped", label: "swapped", tone: "bg-muted" },
  { key: "ate_out", label: "ate out", tone: "bg-text/40" },
  { key: "skipped", label: "skipped", tone: "bg-border" },
] as const;

function AdherenceBar({ a }: { a: Adherence }) {
  if (!a.planned) return null;
  return (
    <div className="grid gap-1.5">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        {PARTS.map((p) => (a[p.key] ? <div key={p.key} className={p.tone} style={{ width: `${(a[p.key] / a.planned) * 100}%` }} /> : null))}
      </div>
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
        {PARTS.filter((p) => a[p.key]).map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1">
            <span className={cx("inline-block size-2 rounded-full", p.tone)} aria-hidden="true" />
            {a[p.key]} {p.label}
          </span>
        ))}
      </p>
    </div>
  );
}

const diff = (actual: number, plan: number, unit: string) => {
  const d = Math.round(actual - plan);
  return d === 0 ? "same as the plan" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))} ${unit} vs the plan`;
};

// Week view: per person, how much of the plan they followed, the extras on
// top, and what they actually ate per day next to what the plan would have given.
export function PlanVsActual({ data, macro }: { data: WeekNutritionWire; macro: Macro }) {
  return (
    <Card className="grid gap-4 p-4">
      <h2 className="m-0 text-lg">Plan vs actual</h2>
      {data.people.map((name, i) => {
        const w = data.week[name]!;
        const a = w.adherence;
        return (
          <div key={name} className="grid gap-2 border-t border-border pt-3 first-of-type:border-t-0 first-of-type:pt-0">
            <div className="flex items-baseline justify-between gap-2">
              <PersonName name={name} index={i} />
              <span className="text-sm tabular-nums">
                {a.rate === null ? (
                  <span className="text-muted">No planned meals yet</span>
                ) : (
                  <>
                    <span className="font-bold">{Math.round(a.rate * 100)}%</span>
                    <span className="text-muted">
                      {" "}
                      followed · {a.followed} of {a.planned}
                    </span>
                  </>
                )}
              </span>
            </div>
            <AdherenceBar a={a} />
            <p className="m-0 text-sm">
              {a.extras > 0 && (
                <span>
                  +{a.extras} extra{a.extras === 1 ? "" : "s"} (snacks, drinks, unplanned meals).{" "}
                </span>
              )}
              {w.daysKnown > 0 && (
                <span className="tabular-nums">
                  <span className="font-semibold">{withUnit(w.perDay[macro], macro)}</span>
                  <span className="text-muted">
                    {" "}
                    a day eaten, {diff(w.perDay[macro], w.planPerDay[macro], macro === "kcal" ? "kcal" : "g")} ({withUnit(w.planPerDay[macro], macro)}).
                  </span>
                </span>
              )}
            </p>
          </div>
        );
      })}
    </Card>
  );
}

// Trends: the share of planned meals followed each week, one line per
// person, and the chosen macro eaten next to the plan as numbers.
export function AdherenceTrend({
  data,
  macro,
  picked,
  onPick,
}: {
  data: NutritionTrendsWire;
  macro: Macro;
  picked: string | null;
  onPick: (w: string) => void;
}) {
  const last = data.weeks.length - 1;
  if (!data.weeks.some((w) => data.people.some((p) => w.people[p]?.adherence != null))) return null;
  return (
    <Card className="grid gap-3 p-4">
      <h2 className="m-0 text-lg">Following the plan</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.people.map((name, i) => {
          const points: ChartPoint[] = data.weeks.map((w, j) => {
            const r = w.people[name]?.adherence;
            const v = r == null ? null : Math.round(r * 100);
            return {
              key: w.weekId,
              label: shortDate(w.weekId),
              strong: j === last,
              value: v,
              description: `${name}, week of ${shortDate(w.weekId)}: ${v === null ? "nothing planned" : `${v}% of planned meals followed`}`,
            };
          });
          const now = points[last]?.value;
          return (
            <div key={name} className="grid gap-2">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <PersonName name={name} index={i} />
                <span className="text-muted">{now == null ? "—" : `${now}% this week`}</span>
              </div>
              <LineChart points={points} goal={null} stroke={personSvg(i)} selected={picked} onSelect={onPick} />
            </div>
          );
        })}
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer content-center font-semibold">{MACRO_LABEL[macro]} eaten vs planned, by week</summary>
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
                      {x?.perDay && x.planPerDay ? (
                        <>
                          {fmt(x.perDay[macro])} <span className="text-muted">/ {fmt(x.planPerDay[macro])}</span>
                        </>
                      ) : (
                        <span className="text-muted">unknown</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="m-0 mt-1 text-xs text-muted">Eaten / what the plan would have given, per day.</p>
      </details>
    </Card>
  );
}
