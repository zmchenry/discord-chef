import { Card } from "../../components/ui";
import { cx } from "../../lib/cx";
import { fmt } from "../nutrition/format";
import { deltaTotals, MACRO_LABEL, MACRO_UNIT, MACROS, SLOTS, type DayTotals, type Variation } from "./model";

const signed = (n: number) => (n === 0 ? "±0" : n > 0 ? `+${fmt(n)}` : `−${fmt(-n)}`);

// The variations side by side: each person's macros per variation, and how
// far each is from the one being edited. The column nearest the goal gets
// a quiet "closest" mark.
export function ComparePanel({
  people,
  variations,
  totals,
  active,
  onPick,
}: {
  people: readonly string[];
  variations: Variation[];
  totals: DayTotals[];
  active: number;
  onPick: (i: number) => void;
}) {
  if (variations.length < 2) return null;
  const base = totals[active]!;
  return (
    <Card className="grid gap-3 p-4">
      <div>
        <h2 className="m-0 text-xl">Compare</h2>
        <p className="m-0 text-sm text-muted">Differences are against {variations[active]!.name}.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm tabular-nums">
          <thead>
            <tr>
              <th className="py-1 text-left text-xs font-semibold text-muted">
                <span className="sr-only">Person and macro</span>
              </th>
              {variations.map((v, i) => (
                <th key={v.name} className="py-1 text-right">
                  <button
                    type="button"
                    onClick={() => onPick(i)}
                    aria-pressed={i === active}
                    aria-label={`Edit ${v.name}`}
                    className={cx(
                      "pressable min-h-11 min-w-11 rounded-full px-3 text-sm font-bold",
                      i === active ? "bg-primary text-on-primary" : "bg-surface-2 text-text",
                    )}
                  >
                    {v.name}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          {people.map((p) => {
            const deltas = totals.map((t) => deltaTotals(base, t)[p]!);
            return (
              <tbody key={p}>
                <tr>
                  <th colSpan={variations.length + 1} scope="colgroup" className="pt-3 text-left font-body text-sm font-bold">
                    {p}
                  </th>
                </tr>
                {MACROS.map((m) => {
                  const goal = base.people[p]!.goal[m];
                  const vals = totals.map((t) => t.people[p]!.totals[m]);
                  const dist = goal === null ? null : vals.map((v) => Math.abs(goal - v));
                  const best = dist ? dist.indexOf(Math.min(...dist)) : -1;
                  const tie = dist ? dist.filter((d) => d === dist[best]).length > 1 : true;
                  return (
                    <tr key={m} className="border-t border-border">
                      <th scope="row" className="py-1.5 pr-2 text-left font-normal text-muted">
                        {MACRO_LABEL[m]}
                        {goal !== null && <span className="block text-xs">goal {fmt(goal)}</span>}
                      </th>
                      {vals.map((v, i) => (
                        <td key={i} className="py-1.5 pl-2 text-right align-top">
                          <span className="font-semibold">
                            {fmt(v)}
                            <span className="font-normal text-muted"> {MACRO_UNIT[m]}</span>
                          </span>
                          <span className="block text-xs text-muted">
                            {i === active ? "" : signed(deltas[i]![m])}
                            {!tie && i === best ? (i === active ? "closest" : " · closest") : ""}
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
      <ul className="m-0 grid list-none gap-1 p-0 text-sm">
        {variations.map((v) => {
          const titles = SLOTS.flatMap((s) => v.slots[s].map((it) => it.title));
          return (
            <li key={v.name} className="flex gap-2">
              <span className="w-4 shrink-0 font-bold">{v.name}</span>
              <span className="min-w-0 text-muted">{titles.length ? titles.join(" · ") : "Nothing yet"}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
