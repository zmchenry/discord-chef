import { ThumbsUp } from "lucide-react";

import type { HistoryResponse } from "../../../../shared/mealHistory";
import { Card } from "../../components/ui";

type Stats = HistoryResponse["stats"];

// The numbers behind the timeline: three stat tiles, then ranked bars
// (one hue, value at the tip) for most made, protein and cuisine.
export function StatsPanel({ stats, weeks }: { stats: Stats; weeks: number }) {
  const { variety, homeDinnerStreak: streak } = stats;
  const delta = variety.last4 - variety.prev4;
  return (
    <Card className="grid gap-5 p-4">
      <h2 className="m-0 text-xl">The last {weeks} weeks</h2>
      <dl className="m-0 grid grid-cols-3 gap-2">
        <Tile
          label="Different recipes"
          value={variety.last4}
          note={!variety.prev4 ? "in 4 weeks" : delta === 0 ? "Same as the 4 before" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} vs the 4 before`}
        />
        <Tile label="Home dinner streak" value={streak.current} note={`Best ${streak.best}`} />
        <Tile label="Ate out" value={stats.ateOut} note={`${stats.skipped} skipped`} />
      </dl>
      {stats.mostMade.length > 0 && (
        <Bars
          title="Most made"
          rows={stats.mostMade.map((m) => ({
            label: `${m.icon ? `${m.icon} ` : ""}${m.title}`,
            count: m.count,
            extra: m.up > 0 ? m.up : null,
          }))}
        />
      )}
      {stats.proteins.length > 0 && <Bars title="Main protein" rows={stats.proteins} />}
      {stats.cuisines.length > 0 && <Bars title="Cuisine" rows={stats.cuisines} />}
    </Card>
  );
}

function Tile({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="grid content-start gap-0.5 rounded-sm bg-surface-2 p-3">
      <dt className="text-xs font-semibold leading-tight text-muted">{label}</dt>
      <dd className="m-0 font-body text-3xl font-semibold leading-none">{value}</dd>
      <dd className="m-0 text-xs text-muted">{note}</dd>
    </div>
  );
}

function Bars({ title, rows }: { title: string; rows: Array<{ label: string; count: number; extra?: number | null }> }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <section className="grid gap-2" aria-label={title}>
      <h3 className="m-0 font-body text-xs font-bold uppercase tracking-wider text-muted">{title}</h3>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {rows.slice(0, 5).map((r) => (
          <li
            key={r.label}
            className="grid min-h-6 grid-cols-[minmax(0,10rem)_minmax(0,1fr)_2rem] items-center gap-2 text-sm"
            title={`${r.label}: ${r.count}`}
          >
            <span className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate font-semibold">{r.label}</span>
              {r.extra ? (
                <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted" aria-label={`${r.extra} thumbs up`}>
                  <ThumbsUp size={12} aria-hidden="true" />
                  {r.extra}
                </span>
              ) : null}
            </span>
            <span className="h-2.5" aria-hidden="true">
              <span className="block h-full rounded-r-[4px] bg-accent" style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }} />
            </span>
            <span className="text-right font-semibold tabular-nums">{r.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
