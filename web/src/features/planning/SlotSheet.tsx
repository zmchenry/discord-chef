import { Ban, Check, Copy, Repeat, Search, Trash2, Utensils, X, type LucideIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";

import type { Meal, SlotKind } from "../../../../shared/schema";
import type { WeekDay, WeekSlot } from "../../../../shared/planningApi";
import { OverflowMenu } from "../../components/OverflowMenu";
import { ReasonChips } from "../../components/ReasonChips";
import { Sheet } from "../../components/Sheet";
import { Button, StateMessage } from "../../components/ui";
import { cx } from "../../lib/cx";
import { dayName, MARKER_LABEL, MEAL_LABEL, shortDate } from "./format";
import { useSuggestions, type SlotChange } from "./queries";

const QUICK: Array<{ kind: Exclude<SlotKind, "recipe">; label: string; icon: LucideIcon }> = [
  { kind: "leftovers", label: "Leftovers", icon: Repeat },
  { kind: "eat_out", label: "Eat out", icon: Utensils },
  { kind: "skip", label: "Skip", icon: Ban },
];

// The picker for one slot: search, the three markers, then ranked suggestions
// with their reasons. Copy to other days and Clear sit behind the header's
// more-actions button. Only a card's Add button is tappable.
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
  const [copying, setCopying] = useState(false);
  const [copyTo, setCopyTo] = useState<string[]>([]);

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
    <Sheet labelledBy={titleId} onClose={onClose}>
      <header className="flex items-start gap-1 pl-4 pr-2 pt-2 lg:pt-4">
        <div className="min-w-0 flex-1 pt-1">
          <p className="m-0 text-xs font-bold uppercase tracking-wider text-muted">
            {dayName(day.date)} {shortDate(day.date)}
            {day.theme?.meals.includes(meal) ? ` · ${day.theme.label}` : ""}
          </p>
          <h2 id={titleId} className="m-0 text-2xl">
            {MEAL_LABEL[meal]}
          </h2>
          {slot && (
            <p className="m-0 line-clamp-2 text-sm text-muted">
              Now: {slot.kind === "recipe" ? (slot.recipe?.title ?? "a recipe") : MARKER_LABEL[slot.kind]}
            </p>
          )}
        </div>
        {slot && (
          <OverflowMenu
            title={MEAL_LABEL[meal]}
            items={[
              { label: "Copy to other days…", icon: Copy, onSelect: () => setCopying(true) },
              { label: "Clear", icon: Trash2, destructive: true, onSelect: () => pick(null) },
            ]}
          />
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-transparent text-text hover:bg-surface-2"
        >
          <X size={22} />
        </button>
      </header>

      <div className="grid gap-3 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3">
        {slot && copying && (
          <section aria-label="Copy to other days" className="rounded-sm bg-surface p-3">
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
            <div className="mt-2 flex gap-2">
              <Button className="flex-1" disabled={copyTo.length === 0} onClick={copy}>
                Copy{copyTo.length ? ` to ${copyTo.length} day${copyTo.length === 1 ? "" : "s"}` : ""}
              </Button>
              <Button variant="ghost" onClick={() => setCopying(false)}>
                Cancel
              </Button>
            </div>
          </section>
        )}

        <label className="flex min-h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
          <Search size={18} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search recipes"
            aria-label="Search recipes"
            className="min-h-11 w-full border-0 bg-transparent text-base text-text outline-none placeholder:text-muted"
          />
        </label>

        <div role="group" aria-label="Instead of a recipe" className="grid grid-cols-3 gap-1.5">
          {QUICK.map(({ kind, label, icon: Icon }) => {
            const on = slot?.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={on}
                onClick={() => pick({ kind, recipeId: null })}
                className={cx(
                  "pressable flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 text-sm font-semibold",
                  on ? "bg-primary text-on-primary" : "bg-surface-2 text-text",
                )}
              >
                <Icon size={16} aria-hidden="true" className="shrink-0 max-[359px]:hidden" />
                {label}
              </button>
            );
          })}
        </div>

        <h3 className="m-0 mt-1 font-body text-xs font-bold uppercase tracking-wider text-muted">
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
                <li key={s.recipeId} className="grid gap-2 rounded-sm bg-surface p-3 shadow-card">
                  <div>
                    <p className="m-0 line-clamp-2 font-semibold leading-snug">
                      {s.icon ? `${s.icon} ` : ""}
                      {s.title}
                    </p>
                    {s.totalMinutes != null && <p className="m-0 text-sm text-muted">{s.totalMinutes} min</p>}
                  </div>
                  <ReasonChips why={s.why} reasons={s.reasons} />
                  <div className="flex justify-end">
                    {current ? (
                      <span className="inline-flex min-h-11 items-center gap-1.5 px-3 text-sm font-semibold text-muted">
                        <Check size={16} aria-hidden="true" /> Added
                      </span>
                    ) : (
                      <Button
                        className="px-5"
                        aria-label={`Add ${s.title}`}
                        onClick={() =>
                          pick(
                            { kind: "recipe", recipeId: s.recipeId },
                            { id: s.recipeId, title: s.title, icon: s.icon, totalMinutes: s.totalMinutes },
                          )
                        }
                      >
                        Add
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
