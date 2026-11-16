import { Ban, Copy, Repeat, Search, Trash2, Utensils, X, type LucideIcon } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";

import type { Meal, SlotKind } from "../../../../shared/schema";
import type { WeekDay, WeekSlot } from "../../../../shared/planningApi";
import { Button, StateMessage } from "../../components/ui";
import { ReasonText } from "../../components/ReasonText";
import { cx } from "../../lib/cx";
import { dayName, MARKER_LABEL, MEAL_LABEL, pill, shortDate } from "./format";
import { useSuggestions, type SlotChange } from "./queries";

const QUICK: Array<{ kind: Exclude<SlotKind, "recipe">; label: string; icon: LucideIcon }> = [
  { kind: "leftovers", label: "Leftovers", icon: Repeat },
  { kind: "eat_out", label: "Eat out", icon: Utensils },
  { kind: "skip", label: "Skip", icon: Ban },
];

// The picker for one slot: search, ranked suggestions with their reasons,
// markers, clear, and copy to other days.
export function SlotSheet({
  weekId,
  day,
  days,
  meal,
  slot,
  onApply,
  onClose,
}: {
  weekId: string;
  day: WeekDay;
  days: WeekDay[];
  meal: Meal;
  slot: WeekSlot | undefined;
  onApply: (changes: SlotChange[]) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const query = useDeferredValue(q);
  const suggestions = useSuggestions(weekId, day.date, meal, query);
  const [copyTo, setCopyTo] = useState<string[]>([]);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const pick = (set: SlotChange["set"], recipe?: SlotChange["recipe"]) => {
    onApply([{ date: day.date, meal, set, recipe }]);
    onClose();
  };

  const copy = () => {
    if (!slot) return;
    const set = { kind: slot.kind, recipeId: slot.recipeId };
    onApply(copyTo.map((date) => ({ date, meal, set, recipe: slot.recipe })));
    onClose();
  };

  const titleId = `sheet-${day.date}-${meal}`;
  return (
    <div className="fixed inset-0 z-20">
      <div className="absolute inset-0 bg-text/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] max-w-xl flex-col rounded-t-card bg-bg shadow-card outline-none"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" aria-hidden="true" />
        <header className="flex items-start justify-between gap-3 px-4 pt-2">
          <div>
            <p className="m-0 text-xs font-bold uppercase tracking-wider text-muted">
              {dayName(day.date)} {shortDate(day.date)}
              {day.theme?.meals.includes(meal) ? ` · ${day.theme.label}` : ""}
            </p>
            <h2 id={titleId} className="m-0 text-2xl">
              {MEAL_LABEL[meal]}
            </h2>
            {slot && (
              <p className="m-0 text-sm text-muted">
                Now: {slot.kind === "recipe" ? (slot.recipe?.title ?? "a recipe") : MARKER_LABEL[slot.kind]}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="pressable grid h-11 w-11 place-items-center rounded-full bg-transparent text-text"
          >
            <X size={22} />
          </button>
        </header>

        <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3">
          <label className="flex min-h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
            <Search size={18} className="text-muted" aria-hidden="true" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search recipes"
              aria-label="Search recipes"
              className="min-h-11 w-full border-0 bg-transparent text-base text-text outline-none placeholder:text-muted"
            />
          </label>

          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK.map(({ kind, label, icon: Icon }) => (
              <button
                key={kind}
                type="button"
                className={cx(pill, "bg-surface-2 px-3", slot?.kind === kind ? "text-primary" : "text-text")}
                aria-pressed={slot?.kind === kind}
                onClick={() => pick({ kind, recipeId: null })}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </button>
            ))}
            {slot && (
              <Button variant="danger" className="px-3" onClick={() => pick(null)}>
                <Trash2 size={16} aria-hidden="true" /> Clear
              </Button>
            )}
          </div>

          {slot && (
            <div className="mt-3 rounded-sm bg-surface p-3">
              <p className="m-0 flex items-center gap-2 text-sm font-semibold">
                <Copy size={16} aria-hidden="true" /> Copy to other days
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {days
                  .filter((d) => d.date !== day.date)
                  .map((d) => {
                    const on = copyTo.includes(d.date);
                    return (
                      <button
                        key={d.date}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setCopyTo(on ? copyTo.filter((x) => x !== d.date) : [...copyTo, d.date])}
                        className={cx(
                          "pressable min-h-11 min-w-11 rounded-full px-3 text-sm font-bold",
                          on ? "bg-primary text-on-primary" : "bg-surface-2 text-text",
                        )}
                      >
                        {dayName(d.date)}
                      </button>
                    );
                  })}
              </div>
              <Button variant="secondary" className="mt-2 w-full" disabled={copyTo.length === 0} onClick={copy}>
                Copy{copyTo.length ? ` to ${copyTo.length} day${copyTo.length === 1 ? "" : "s"}` : ""}
              </Button>
            </div>
          )}

          <h3 className="mb-2 mt-4 font-body text-xs font-bold uppercase tracking-wider text-muted">
            {query.trim() ? "Matches" : "Best fits"}
          </h3>
          {suggestions.isPending ? (
            <StateMessage title="Finding ideas…" />
          ) : suggestions.isError ? (
            <StateMessage title="Couldn't load suggestions">{suggestions.error.message}</StateMessage>
          ) : suggestions.data.length === 0 ? (
            <StateMessage title={query.trim() ? "No recipes match" : "No suggestions"}>
              {day.constraints.some((c) => c.kind === "eat_out" && c.meals.includes(meal))
                ? "The calendar says you're eating out."
                : "Try a search, or add more recipes."}
            </StateMessage>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {suggestions.data.map((s) => {
                const current = slot?.recipeId === s.recipeId;
                return (
                  <li key={s.recipeId} className="flex items-center gap-3 rounded-sm bg-surface p-3 shadow-card">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 font-semibold">
                        {s.icon ? `${s.icon} ` : ""}
                        {s.title}
                      </p>
                      {s.totalMinutes != null && <p className="m-0 text-sm text-muted">{s.totalMinutes} min</p>}
                      {s.reasons.length > 0 && (
                        <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-1.5 p-0">
                          {s.reasons.map((r) => (
                            <li key={r} className="rounded-sm bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                              <ReasonText text={r} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <Button
                      disabled={current}
                      aria-label={`Add ${s.title}`}
                      onClick={() =>
                        pick(
                          { kind: "recipe", recipeId: s.recipeId },
                          { id: s.recipeId, title: s.title, icon: s.icon, totalMinutes: s.totalMinutes },
                        )
                      }
                    >
                      {current ? "Added" : "Add"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
