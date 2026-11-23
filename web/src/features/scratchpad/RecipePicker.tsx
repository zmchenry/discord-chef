import { Check, Search, X } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { sundayOf } from "../../../../shared/planningApi";
import { Sheet } from "../../components/Sheet";
import { StateMessage } from "../../components/ui";
import { useRecipes } from "../../lib/queries";
import { useSuggestions } from "../planning/queries";
import { SLOT_LABEL, type SlotKey } from "./model";
import type { RecentRecipe } from "./storage";

// Pick a recipe for one slot. Breakfast, lunch and dinner search the
// planner's ranked suggestions for that day and meal (the Week page's
// picker); snacks search the whole recipe list. Tapping a row picks it.
export function RecipePicker({
  date,
  slot,
  currentId,
  recent,
  onPick,
  onClose,
}: {
  date: string;
  slot: SlotKey;
  currentId: string | null;
  recent: RecentRecipe[];
  onPick: (r: RecentRecipe) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const query = useDeferredValue(q).trim();
  const ranked = useSuggestions(sundayOf(date), date, slot === "snack" ? "lunch" : slot, query);
  const all = useRecipes(query ? { q: query } : {});
  const list =
    slot === "snack"
      ? { pending: all.isPending, error: all.error, rows: (all.data ?? []).map((r) => ({ id: r.id, title: r.title, icon: r.icon })) }
      : {
          pending: ranked.isPending,
          error: ranked.error,
          rows: (ranked.data ?? []).map((s) => ({ id: s.recipeId, title: s.title, icon: s.icon })),
        };
  const titleId = `pick-${slot}`;

  const row = (r: RecentRecipe) => {
    const current = r.id === currentId;
    return (
      <li key={r.id}>
        <button
          type="button"
          onClick={() => onPick(r)}
          aria-current={current || undefined}
          className="pressable flex min-h-14 w-full items-center gap-3 rounded-sm bg-surface px-3 text-left text-text shadow-card"
        >
          <span className="min-w-0 flex-1 font-semibold leading-snug">
            {r.icon ? `${r.icon} ` : ""}
            {r.title}
          </span>
          {current && <Check size={18} aria-label="Current pick" className="shrink-0 text-primary" />}
        </button>
      </li>
    );
  };

  return (
    <Sheet labelledBy={titleId} onClose={onClose}>
      <header className="flex items-start gap-1 pl-4 pr-2 pt-2 lg:pt-4">
        <h2 id={titleId} className="m-0 min-w-0 flex-1 pt-1 text-2xl">
          {SLOT_LABEL[slot]}
        </h2>
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
        {!query && recent.length > 0 && (
          <>
            <h3 className="m-0 font-body text-xs font-bold uppercase tracking-wider text-muted">Recently tried</h3>
            <ul className="m-0 grid list-none gap-2 p-0">{recent.slice(0, 4).map(row)}</ul>
          </>
        )}
        <h3 className="m-0 mt-1 font-body text-xs font-bold uppercase tracking-wider text-muted">
          {query ? "Matches" : slot === "snack" ? "All recipes" : "Best fits"}
        </h3>
        {list.pending ? (
          <StateMessage title="Finding recipes…" />
        ) : list.error ? (
          <StateMessage title="Couldn't load recipes">{list.error.message}</StateMessage>
        ) : list.rows.length === 0 ? (
          <StateMessage title={query ? "No recipes match" : "No recipes yet"} />
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">{list.rows.slice(0, 40).map(row)}</ul>
        )}
      </div>
    </Sheet>
  );
}
