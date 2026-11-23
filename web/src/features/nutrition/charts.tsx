import { useLayoutEffect, useRef, useState } from "react";

import { cx } from "../../lib/cx";
import { fmt } from "./format";

// Two small charts for one person and one macro: daily columns (Week) and
// weekly averages as a line (Trends). Both draw the goal as a solid line,
// leave unknown points as gaps (never zero), and let a tap, hover or focus
// pick a point; the page shows the picked point's numbers above the chart
// and the same numbers in a table under it.

export interface ChartPoint {
  key: string;
  label: string;
  // Accessible name for the point's button.
  description: string;
  value: number | null;
  // Partly known (some meals unknown): drawn lighter.
  faded?: boolean;
  strong?: boolean;
}

const PLOT_H = 128;

// 0 and two or three round steps up to just past the largest value.
function niceTicks(top: number): number[] {
  const t = Math.max(top, 1);
  const raw = t / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks = [];
  for (let v = 0; v < t + step * 0.999; v += step) ticks.push(Math.round(v));
  if (ticks[ticks.length - 1]! < t) ticks.push(Math.round(ticks[ticks.length - 1]! + step));
  return ticks;
}

const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : fmt(n));

function Axis({ ticks, top }: { ticks: number[]; top: number }) {
  return (
    <>
      {ticks.map((t) => (
        <div key={t} className="absolute inset-x-0 border-t border-border" style={{ bottom: `${(t / top) * 100}%` }}>
          <span className="absolute -left-1 -translate-x-full -translate-y-1/2 text-[11px] tabular-nums text-muted">
            {compact(t)}
          </span>
        </div>
      ))}
    </>
  );
}

function GoalLine({ goal, top }: { goal: number; top: number }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-[2]" style={{ bottom: `${(goal / top) * 100}%` }}>
      <div className="h-0.5 -translate-y-px rounded-full bg-text" />
      <span className="absolute right-0 -top-[18px] rounded-sm bg-surface px-1 text-[11px] font-bold text-text">goal</span>
    </div>
  );
}

export function ColumnChart({
  points,
  goal,
  fill,
  selected,
  onSelect,
}: {
  points: ChartPoint[];
  goal: number | null;
  fill: string;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const ticks = niceTicks(Math.max(...points.map((p) => p.value ?? 0), (goal ?? 0) * 1.1));
  const top = ticks[ticks.length - 1]!;
  return (
    <div className="pl-10 pr-1">
      <div className="relative" style={{ height: PLOT_H }}>
        <Axis ticks={ticks} top={top} />
        {goal ? <GoalLine goal={goal} top={top} /> : null}
        <div className="absolute inset-0 flex">
          {points.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-label={p.description}
              aria-pressed={selected === p.key}
              onClick={() => onSelect(p.key)}
              onPointerEnter={(e) => e.pointerType === "mouse" && onSelect(p.key)}
              onFocus={() => onSelect(p.key)}
              className={cx(
                "relative flex flex-1 items-end justify-center rounded-sm px-0.5 outline-offset-0",
                selected === p.key ? "bg-surface-2" : "bg-transparent",
              )}
            >
              {p.value === null ? (
                <span className="mb-1 text-xs font-bold text-muted" aria-hidden="true">
                  ?
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className={cx("block w-[60%] max-w-6 rounded-t-[4px]", fill, p.faded && "opacity-45")}
                  style={{ height: `${Math.max((p.value / top) * 100, p.value > 0 ? 1.5 : 0)}%` }}
                />
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 flex" aria-hidden="true">
        {points.map((p) => (
          <span key={p.key} className={cx("flex-1 text-center text-xs", p.strong ? "font-bold text-text" : "text-muted")}>
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function LineChart({
  points,
  goal,
  stroke,
  selected,
  onSelect,
}: {
  points: ChartPoint[];
  goal: number | null;
  // The series colour as SVG classes.
  stroke: { stroke: string; fill: string };
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const ticks = niceTicks(Math.max(...points.map((p) => p.value ?? 0), (goal ?? 0) * 1.1));
  const top = ticks[ticks.length - 1]!;
  const band = width / Math.max(points.length, 1);
  const x = (i: number) => band * (i + 0.5);
  const y = (v: number) => PLOT_H - (v / top) * PLOT_H;

  // One path per run of known weeks: an unknown week breaks the line.
  const runs: string[] = [];
  let run: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (run.length) runs.push(run.join(" "));
      run = [];
    } else run.push(`${run.length ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  });
  if (run.length) runs.push(run.join(" "));
  const known = points.map((p, i) => [p, i] as const).filter(([p]) => p.value !== null);
  const lastKnown = known[known.length - 1];
  // The end label sits on the side away from the line coming into it.
  const before = known[known.length - 2];
  const labelBelow = !!lastKnown && !!before && before[1] === lastKnown[1] - 1 && before[0].value! > lastKnown[0].value!;
  const selectedIndex = points.findIndex((p) => p.key === selected);

  return (
    <div className="pl-10 pr-1">
      <div ref={ref} className="relative" style={{ height: PLOT_H }}>
        {selectedIndex >= 0 && (
          <div
            aria-hidden="true"
            className="absolute inset-y-0 rounded-sm bg-surface-2"
            style={{ left: `${(selectedIndex / points.length) * 100}%`, width: `${100 / points.length}%` }}
          />
        )}
        <Axis ticks={ticks} top={top} />
        {goal ? <GoalLine goal={goal} top={top} /> : null}
        {width > 0 && (
          <svg aria-hidden="true" width={width} height={PLOT_H} className="absolute inset-0 z-[3] overflow-visible">
            {runs.map((d) => (
              <path key={d} d={d} className={cx(stroke.stroke, "fill-none")} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {points.map((p, i) =>
              p.value === null ? null : (
                <circle
                  key={p.key}
                  cx={x(i)}
                  cy={y(p.value)}
                  r={selected === p.key ? 6 : 5}
                  className={cx(stroke.fill, "stroke-surface", p.faded && "opacity-60")}
                  strokeWidth={2}
                />
              ),
            )}
            {lastKnown && (
              <text
                x={x(lastKnown[1])}
                y={y(lastKnown[0].value!) + (labelBelow ? 20 : -10)}
                textAnchor={lastKnown[1] === points.length - 1 ? "end" : "middle"}
                className="fill-text text-[11px] font-bold"
              >
                {fmt(lastKnown[0].value!)}
              </text>
            )}
          </svg>
        )}
        <div className="absolute inset-0 z-[4] flex">
          {points.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-label={p.description}
              aria-pressed={selected === p.key}
              onClick={() => onSelect(p.key)}
              onPointerEnter={(e) => e.pointerType === "mouse" && onSelect(p.key)}
              onFocus={() => onSelect(p.key)}
              className="flex-1 rounded-sm bg-transparent"
            />
          ))}
        </div>
      </div>
      <div className="mt-1 flex" aria-hidden="true">
        {points.map((p, i) => (
          <span
            key={p.key}
            className={cx(
              "flex-1 truncate text-center text-[11px]",
              p.strong ? "font-bold text-text" : "text-muted",
              // Every other label on narrow screens so they never collide.
              i % 2 === 1 && i !== points.length - 1 && "max-[480px]:invisible",
            )}
          >
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
