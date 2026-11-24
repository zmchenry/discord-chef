import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import type { HistoryEntryWire } from "../../../../shared/mealHistory";
import { todayIn } from "../../../../shared/planningApi";
import { cx } from "../../lib/cx";
import { MEAL_LABEL, pill } from "../planning/format";
import { useLogMeal, usePending } from "./api";
import { EntryMenu } from "./EntryMenu";
import { EntryThumb } from "./EntryThumb";
import { entryTitle, STATUS } from "./format";

const SHOWN = 3;

const key = (e: { date: string; meal: string }) => `${e.date}|${e.meal}`;

// On the Week page: yesterday's and today's meals that are over. A planned
// meal already counts as eaten, so one tap ("Ate it") confirms it and asks
// for a thumbs up or down; the row ⋯ says it went differently. Hidden once
// everything is confirmed and rated.
export function CheckInCard() {
  const pending = usePending();
  const log = useLogMeal();
  // Rows answered on this visit stay put, showing what was saved.
  const [touched, setTouched] = useState<string[]>([]);
  const touch = (e: HistoryEntryWire) => setTouched((t) => (t.includes(key(e)) ? t : [...t, key(e)]));

  const [all, setAll] = useState(false);
  const rateable = (e: HistoryEntryWire) => (e.status === "eaten" || e.status === "swapped") && !!e.recipe && e.rating === null;
  // Unanswered meals, plus dinners still waiting for a thumbs up or down.
  const rows = (pending.data ?? []).filter(
    (e) => !e.confirmed || (e.meal === "dinner" && rateable(e)) || touched.includes(key(e)),
  );
  if (rows.length === 0) return null;
  const today = todayIn();
  const open = rows.filter((e) => !e.confirmed);
  const shown = all ? rows : rows.slice(0, SHOWN);
  // Confirmed rows drop out, except dinners, which stay to be rated.
  const confirmAll = () =>
    Promise.all(open.map((e) => log.mutateAsync({ date: e.date, meal: e.meal, status: e.status }))).catch(() => undefined);

  return (
    <section aria-labelledby="check-in-title" className="min-w-0 rounded-card bg-surface p-3 shadow-card">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="check-in-title" className="m-0 font-body text-xs font-bold uppercase tracking-wider text-muted">
          How did it go?
        </h2>
        <Link to="/history" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary">
          History
        </Link>
      </div>
      <ul className="m-0 grid min-w-0 list-none gap-1 p-0">
        {shown.map((e) => {
          const when = `${e.date === today ? "Today" : "Yesterday"} · ${MEAL_LABEL[e.meal]}`;
          const Status = STATUS[e.status];
          return (
            <li key={key(e)} className="flex min-h-14 min-w-0 items-center gap-3 rounded-sm px-1 py-1">
              <EntryThumb entry={e} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{entryTitle(e)}</span>
                <span className="block text-sm text-muted">
                  {when}
                  {e.confirmed && e.status !== "eaten" && ` · ${Status.label}`}
                </span>
              </span>
              {!e.confirmed ? (
                <button
                  type="button"
                  className={cx(pill, "min-h-10 shrink-0 px-3 text-sm text-primary shadow-[inset_0_0_0_1.5px_currentColor]")}
                  disabled={log.isPending}
                  aria-label={`Ate ${entryTitle(e)}`}
                  onClick={() => log.mutate({ date: e.date, meal: e.meal, status: e.status }, { onSuccess: () => touch(e) })}
                >
                  <Check size={16} aria-hidden="true" strokeWidth={2.5} />
                  {e.status === "eaten" ? "Ate it" : Status.label}
                </button>
              ) : rateable(e) ? (
                <span className="flex shrink-0 items-center" role="group" aria-label={`Rate ${entryTitle(e)}`}>
                  {([1, -1] as const).map((r) => {
                    const Icon = r === 1 ? ThumbsUp : ThumbsDown;
                    return (
                      <button
                        key={r}
                        type="button"
                        aria-label={r === 1 ? "Loved it" : "Not again"}
                        disabled={log.isPending}
                        onClick={() => log.mutate({ date: e.date, meal: e.meal, status: e.status, rating: r }, { onSuccess: () => touch(e) })}
                        className="pressable grid size-11 place-items-center rounded-full bg-transparent text-muted hover:bg-surface-2"
                      >
                        <Icon size={20} aria-hidden="true" />
                      </button>
                    );
                  })}
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-accent" role="status">
                  {e.rating === 1 ? <ThumbsUp size={16} aria-hidden="true" /> : e.rating === -1 ? <ThumbsDown size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                  Saved
                </span>
              )}
              <EntryMenu entry={e} onLogged={() => touch(e)} />
            </li>
          );
        })}
      </ul>
      {(rows.length > shown.length || open.length > 1) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-1 pt-1">
          {rows.length > shown.length ? (
            <button type="button" onClick={() => setAll(true)} className="pressable inline-flex min-h-11 items-center bg-transparent p-0 text-sm font-semibold text-primary">
              {rows.length - shown.length} more
            </button>
          ) : (
            <span />
          )}
          {open.length > 1 && (
            <button
              type="button"
              onClick={confirmAll}
              disabled={log.isPending}
              className="pressable inline-flex min-h-11 items-center gap-1.5 bg-transparent p-0 text-sm font-semibold text-primary"
            >
              <Check size={16} aria-hidden="true" strokeWidth={2.5} /> All as planned
            </button>
          )}
        </div>
      )}
    </section>
  );
}
