import { ChevronDown } from "lucide-react";

import { Card } from "../../components/ui";
import { cx } from "../../lib/cx";
import { CONFIDENCE_LABEL, fmt } from "../nutrition/format";
import {
  caveats,
  MACRO_LABEL,
  MACRO_UNIT,
  MACROS,
  remainingText,
  SLOT_LABEL,
  SLOTS,
  type DayTotals,
  type Macro,
  type PersonTotals,
  type SlotKey,
} from "./model";

// Bar scale when there's no goal to scale by.
const FALLBACK: Record<Macro, number> = { kcal: 2500, protein: 150, carbs: 300, fat: 100 };

// One hue per person (the same as the week's nutrition view), and the day's
// slots as steps of it, darkest first: breakfast to snack reads left to right
// in time order. Literal class names so Tailwind sees them.
const SEGMENTS: ReadonlyArray<Record<SlotKey, string>> = [
  { breakfast: "bg-primary", lunch: "bg-primary/75", dinner: "bg-primary/55", snack: "bg-primary/35" },
  { breakfast: "bg-accent", lunch: "bg-accent/75", dinner: "bg-accent/55", snack: "bg-accent/35" },
];
const LEGEND: Record<SlotKey, string> = { breakfast: "bg-muted", lunch: "bg-muted/75", dinner: "bg-muted/55", snack: "bg-muted/35" };
const segmentsFor = (i: number) => SEGMENTS[i % SEGMENTS.length]!;

// A bullet bar made of the day's slots: each slot's share as a segment (2px
// surface gaps between), the goal as a tick, the rest as an empty track.
export function StackedGoalBar({
  person,
  index,
  macro,
  totals,
  thin,
}: {
  person: string;
  index: number;
  macro: Macro;
  totals: PersonTotals;
  thin?: boolean;
}) {
  const value = totals.totals[macro];
  const goal = totals.goal[macro];
  const max = Math.max(goal ? goal * 1.25 : FALLBACK[macro], value, 1);
  const parts = SLOTS.map((s) => ({ slot: s, v: totals.bySlot[s][macro] })).filter((p) => p.v > 0);
  const unit = MACRO_UNIT[macro];
  return (
    <div className={cx("relative", thin ? "h-2" : "h-3")}>
      <div className="flex h-full gap-[2px]">
        {parts.map((p) => (
          <div
            key={p.slot}
            title={`${person} · ${SLOT_LABEL[p.slot]}: ${fmt(p.v)} ${unit}`}
            className={cx("h-full first:rounded-l-full", segmentsFor(index)[p.slot])}
            style={{ width: `${(p.v / max) * 100}%` }}
          />
        ))}
        <div className={cx("h-full flex-1 rounded-r-full bg-surface-2", parts.length === 0 && "rounded-l-full")} />
      </div>
      {goal ? (
        <div
          aria-hidden="true"
          className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-text"
          style={{ left: `calc(${(goal / max) * 100}% - 1px)` }}
        />
      ) : null}
    </div>
  );
}

// "1,980 / 2,400 kcal", "210 g"
const valueText = (macro: Macro, t: PersonTotals) => {
  const goal = t.goal[macro];
  const u = MACRO_UNIT[macro];
  return goal ? `${fmt(t.totals[macro])} / ${fmt(goal)} ${u}` : `${fmt(t.totals[macro])} ${u}`;
};

// The full panel: per person, every macro against its goal, stacked by slot.
export function MacroPanel({ people, totals, name }: { people: readonly string[]; totals: DayTotals; name: string }) {
  return (
    <Card id="macros" className="grid scroll-mt-40 gap-4 p-4" aria-live="polite">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-xl">Day {name}</h2>
        <span className="text-sm text-muted">{totals.confidence ? CONFIDENCE_LABEL[totals.confidence] : "Estimates"}</span>
      </div>
      {people.map((p, i) => {
        const t = totals.people[p]!;
        const left = remainingText(t.remaining);
        return (
          <section key={p} aria-label={p} className="grid gap-2.5">
            <div>
              <h3 className="m-0 font-body text-base font-bold">{p}</h3>
              {left && <p className="m-0 text-sm font-semibold">{left}</p>}
            </div>
            {MACROS.map((m) => (
              <div key={m} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted">{MACRO_LABEL[m]}</span>
                  <span className="font-semibold tabular-nums">{valueText(m, t)}</span>
                </div>
                <StackedGoalBar person={p} index={i} macro={m} totals={t} />
              </div>
            ))}
          </section>
        );
      })}
      <ul aria-label="Bar segments, left to right" className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs text-muted">
        {SLOTS.map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cx("size-2.5 rounded-full", LEGEND[s])} />
            {SLOT_LABEL[s]}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-text" />
          Goal
        </li>
      </ul>
      <p className="m-0 text-sm text-muted">{caveats(totals)}</p>
      <PerSlotTable people={people} totals={totals} />
    </Card>
  );
}

// The numbers behind the bars, folded away.
function PerSlotTable({ people, totals }: { people: readonly string[]; totals: DayTotals }) {
  return (
    <details className="group">
      <summary className="pressable -mx-1 flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-sm px-1 text-sm font-semibold text-primary">
        By meal <ChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180" />
      </summary>
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1 font-semibold">Meal</th>
            {people.map((p) => (
              <th key={p} className="py-1 text-right font-semibold">
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SLOTS.map((s) => (
            <tr key={s} className="border-t border-border">
              <th scope="row" className="py-1.5 text-left font-normal text-muted">
                {SLOT_LABEL[s]}
              </th>
              {people.map((p) => {
                const m = totals.people[p]!.bySlot[s];
                return (
                  <td key={p} className="py-1.5 text-right">
                    {fmt(m.kcal)} kcal · {fmt(m.protein)} g P
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

// Phones: a slim sticky strip with each person's calories and what's left.
// Tapping it goes to the full panel.
export function MacroStrip({ people, totals }: { people: readonly string[]; totals: DayTotals }) {
  return (
    <a
      href="#macros"
      onClick={(e) => {
        e.preventDefault();
        document.getElementById("macros")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
      aria-label="Go to the full macro panel"
      className="sticky top-0 z-[5] grid gap-1.5 border-b border-border bg-bg px-4 py-2 text-text no-underline lg:hidden"
    >
      {people.map((p, i) => {
        const t = totals.people[p]!;
        const left = remainingText(t.remaining);
        return (
          <span key={p} className="grid gap-0.5">
            <span className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-bold">{p}</span>
              <span className="min-w-0 truncate text-muted">{left ?? `${fmt(t.totals.kcal)} kcal · ${fmt(t.totals.protein)} g protein`}</span>
            </span>
            <StackedGoalBar person={p} index={i} macro="kcal" totals={t} thin />
          </span>
        );
      })}
      <span className="text-xs text-muted">{caveats(totals)}</span>
    </a>
  );
}
