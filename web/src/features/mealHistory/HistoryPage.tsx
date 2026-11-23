import { ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useId } from "react";
import { useSearchParams } from "react-router-dom";

import type { HistoryEntryWire } from "../../../../shared/mealHistory";
import { addDays, sundayOf } from "../../../../shared/planningApi";
import { MEALS, mealSchema, type Meal } from "../../../../shared/schema";
import { PageHeader, StateMessage } from "../../components/ui";
import { cx } from "../../lib/cx";
import { BackToMore } from "../planning/SettingsLink";
import { dayName, MEAL_LABEL, shortDate } from "../planning/format";
import { useHistory } from "./api";
import { EntryMenu } from "./EntryMenu";
import { EntryThumb } from "./EntryThumb";
import { entryTitle, STATUS } from "./format";
import { InsightsCard } from "./InsightsCard";
import { StatsPanel } from "./StatsPanel";

const WEEKS = 8;

// /history: what we actually ate, newest first, grouped by week, with the
// insights card and stats above (one column: the shell keeps this page at
// the 720px detail width). Filters (meal, recipe) live in the URL, so the
// recipe page can link to ?recipe=<id>.
export function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const meal = mealSchema.safeParse(params.get("meal")).data;
  const recipeId = params.get("recipe") ?? undefined;
  const history = useHistory();
  const recipeSelectId = useId();

  const setFilter = (k: "meal" | "recipe", v: string | undefined) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const all = history.data?.entries ?? [];
  const recipes = new Map<string, string>();
  for (const e of all) if (e.recipe && (e.status === "eaten" || e.status === "swapped")) recipes.set(e.recipe.id, e.recipe.title);
  const shown = all.filter((e) => (!meal || e.meal === meal) && (!recipeId || e.recipe?.id === recipeId));
  const weeks = new Map<string, HistoryEntryWire[]>();
  for (const e of shown) {
    const w = sundayOf(e.date);
    weeks.set(w, [...(weeks.get(w) ?? []), e]);
  }

  return (
    <div className="pb-6">
      <BackToMore />
      <PageHeader title="History" />
      {history.isPending ? (
        <StateMessage title="Loading what you ate…" />
      ) : history.isError ? (
        <StateMessage title="Couldn't load history">{history.error.message}</StateMessage>
      ) : (
        <div className="grid gap-4 px-4">
          <div className="grid gap-4">
            <InsightsCard />
            <StatsPanel stats={history.data.stats} weeks={WEEKS} />
          </div>

          <div className="grid content-start gap-4">
            <div className="grid gap-2">
              <div role="group" aria-label="Meal" className="flex flex-wrap gap-1.5">
                {[undefined, ...MEALS].map((m) => (
                  <button
                    key={m ?? "all"}
                    type="button"
                    aria-pressed={meal === m}
                    onClick={() => setFilter("meal", m)}
                    className={cx(
                      "pressable min-h-11 rounded-full px-4 text-sm font-bold",
                      meal === m ? "bg-text text-bg" : "bg-surface-2 text-text",
                    )}
                  >
                    {m ? MEAL_LABEL[m] : "All meals"}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor={recipeSelectId} className="sr-only">
                  Recipe
                </label>
                <select
                  id={recipeSelectId}
                  value={recipeId ?? ""}
                  onChange={(e) => setFilter("recipe", e.target.value || undefined)}
                  className="min-h-11 min-w-0 flex-1 rounded-sm border border-border bg-surface px-3 text-base text-text"
                >
                  <option value="">Every recipe</option>
                  {[...recipes].sort((a, b) => a[1].localeCompare(b[1])).map(([id, title]) => (
                    <option key={id} value={id}>
                      {title}
                    </option>
                  ))}
                  {recipeId && !recipes.has(recipeId) && <option value={recipeId}>This recipe</option>}
                </select>
                {recipeId && (
                  <button
                    type="button"
                    onClick={() => setFilter("recipe", undefined)}
                    aria-label="Show every recipe"
                    className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-text"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            {weeks.size === 0 ? (
              <StateMessage title={all.length ? "Nothing matches" : "Nothing yet"}>
                {all.length ? "Try another meal or recipe." : "Planned meals show up here once they're eaten."}
              </StateMessage>
            ) : (
              [...weeks].map(([week, entries]) => <WeekGroup key={week} week={week} entries={entries} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WeekGroup({ week, entries }: { week: string; entries: HistoryEntryWire[] }) {
  const out = entries.filter((e) => e.status === "ate_out").length;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 id={headingId} className="m-0 text-lg">
          Week of {shortDate(week)}
          <span className="font-body text-sm font-semibold text-muted"> – {shortDate(addDays(week, 6))}</span>
        </h2>
        <span className="text-sm text-muted">
          {entries.length} meal{entries.length === 1 ? "" : "s"}
          {out ? ` · ${out} out` : ""}
        </span>
      </div>
      <ul className="m-0 grid list-none gap-0 overflow-hidden rounded-card bg-surface p-0 shadow-card">
        {entries.map((e) => (
          <EntryRow key={`${e.date}|${e.meal}`} entry={e} />
        ))}
      </ul>
    </section>
  );
}

function EntryRow({ entry: e }: { entry: HistoryEntryWire }) {
  const Status = STATUS[e.status];
  const ate = e.status === "eaten" || e.status === "swapped";
  return (
    <li className="flex min-h-16 items-center gap-3 border-t border-border px-3 py-2 first:border-t-0">
      <EntryThumb entry={e} />
      <span className="min-w-0 flex-1">
        <span className={cx("block truncate font-semibold", !ate && "text-muted")}>{entryTitle(e)}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
          <span>
            {dayName(e.date)} · {MEAL_LABEL[e.meal as Meal]}
          </span>
          <span aria-hidden="true">·</span>
          <span className={cx("inline-flex items-center gap-1", e.confirmed && "font-semibold text-text")}>
            <Status.icon size={14} aria-hidden="true" />
            {e.status === "swapped" ? "Instead" : Status.label}
            {!e.confirmed && <span className="font-normal"> (assumed)</span>}
          </span>
          {e.rating === 1 && (
            <span className="inline-flex items-center text-accent" aria-label="Loved it">
              <ThumbsUp size={14} aria-hidden="true" />
            </span>
          )}
          {e.rating === -1 && (
            <span className="inline-flex items-center" aria-label="Not again">
              <ThumbsDown size={14} aria-hidden="true" />
            </span>
          )}
        </span>
        {e.note && <span className="block text-sm italic text-muted">{e.note}</span>}
      </span>
      <EntryMenu entry={e} />
    </li>
  );
}
