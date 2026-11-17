import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { displayIngredientName, SECTIONS } from "../../../../shared/normalize";
import type { PantryItem } from "../../../../shared/pantry";
import { Card, PageHeader, StateMessage } from "../../components/ui";
import { cx } from "../../lib/cx";
import { BackToMore } from "../planning/SettingsLink";
import { usePantry, useSetPantry } from "./api";

// What is already in the house. Checking items off in the store marks
// them on hand by itself; this screen is for "used it up" and for things
// bought some other way.

type Filter = "have" | "out" | "all";
const FILTERS: Array<[Filter, string]> = [
  ["have", "On hand"],
  ["out", "Out"],
  ["all", "All"],
];

const sectionRank = (s: string | null) => {
  const i = s === null ? -1 : (SECTIONS as readonly string[]).indexOf(s);
  return i < 0 ? SECTIONS.length : i;
};

export function PantryPage() {
  const pantry = usePantry();
  const set = useSetPantry();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = (pantry.data ?? []).filter(
      (i) => (filter === "all" || (filter === "have") === i.onHand) && (!needle || i.name.includes(needle)),
    );
    const bySection = new Map<string | null, PantryItem[]>();
    for (const i of shown) bySection.set(i.section, [...(bySection.get(i.section) ?? []), i]);
    return [...bySection.entries()].sort(([a], [b]) => sectionRank(a) - sectionRank(b));
  }, [pantry.data, q, filter]);

  const onHandCount = pantry.data?.filter((i) => i.onHand).length ?? 0;

  return (
    <>
      <BackToMore />
      <PageHeader title="Pantry" />
      <div className="mx-auto grid w-full max-w-[720px] gap-3 px-4 pb-8">
        <p className="m-0 text-sm text-muted">
          What's on hand stays off the shopping list. Checking items off in the store marks them on hand.
        </p>
        <label className="flex min-h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
          <Search size={18} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search ingredients"
            aria-label="Search ingredients"
            className="min-h-11 w-full border-0 bg-transparent text-base text-text outline-none placeholder:text-muted"
          />
        </label>
        <div role="group" aria-label="Show" className="grid grid-cols-3 gap-0.5 rounded-full bg-surface-2 p-[3px]">
          {FILTERS.map(([v, text]) => (
            <button
              key={v}
              type="button"
              aria-pressed={v === filter}
              onClick={() => setFilter(v)}
              className={cx(
                "min-h-11 truncate rounded-full px-1 text-sm font-bold transition-colors",
                v === filter ? "bg-surface text-text shadow-card" : "text-muted",
              )}
            >
              {text}
              {v === "have" && pantry.data ? ` · ${onHandCount}` : ""}
            </button>
          ))}
        </div>

        {pantry.isPending ? (
          <StateMessage title="Loading the pantry…" />
        ) : pantry.isError ? (
          <StateMessage title="Couldn't load the pantry">{pantry.error.message}</StateMessage>
        ) : groups.length === 0 ? (
          <StateMessage title={q ? `Nothing matches "${q}"` : filter === "have" ? "Nothing on hand yet" : "Nothing here"}>
            {q ? "Try a shorter name, or show All." : "Items you check off in the store show up here."}
          </StateMessage>
        ) : (
          groups.map(([section, items]) => (
            <section key={section ?? "-"} className="grid gap-1.5" aria-label={section ?? "Other"}>
              <h2 className="m-0 mt-1 flex justify-between px-1 font-body text-xs font-extrabold uppercase tracking-[0.08em] text-muted">
                <span>{section ?? "Other"}</span>
                <span>{items.filter((i) => i.onHand).length} on hand</span>
              </h2>
              <Card className="overflow-hidden">
                <ul className="m-0 list-none p-0">
                  {items.map((item) => (
                    <PantryRow
                      key={item.ingredientId}
                      item={item}
                      onChange={(onHand, low) => set.mutate({ ingredientId: item.ingredientId, onHand, low })}
                    />
                  ))}
                </ul>
              </Card>
            </section>
          ))
        )}
        {set.isError && (
          <p className="m-0 text-sm font-semibold text-danger" role="alert">
            Couldn't save: {set.error.message}
          </p>
        )}
      </div>
    </>
  );
}

function PantryRow({ item, onChange }: { item: PantryItem; onChange: (onHand: boolean, low: boolean) => void }) {
  const name = displayIngredientName(item.name);
  const sub = item.onHand ? (item.low ? "Low, so it stays on the list" : item.assumed ? "Assumed on hand" : null) : null;
  return (
    <li className="flex min-h-14 items-center gap-2 border-b border-border py-1.5 pl-3.5 pr-2 last:border-b-0">
      <span className="grid min-w-0 flex-1 leading-tight">
        <span className={cx("font-bold", !item.onHand && "text-muted")}>{name}</span>
        {sub && <span className="text-[13px] text-muted">{sub}</span>}
      </span>
      {item.onHand && (
        <button
          type="button"
          aria-pressed={item.low}
          aria-label={`${name} is running low`}
          onClick={() => onChange(true, !item.low)}
          className={cx(
            "pressable min-h-11 shrink-0 rounded-full px-3 text-sm font-bold",
            item.low ? "bg-surface-2 text-danger shadow-[inset_0_0_0_1.5px_currentColor]" : "border border-border text-muted",
          )}
        >
          Low
        </button>
      )}
      <button
        type="button"
        aria-pressed={item.onHand}
        aria-label={`${name} on hand`}
        onClick={() => onChange(!item.onHand, false)}
        className={cx(
          "pressable inline-flex min-h-11 w-[6.5rem] shrink-0 items-center justify-center gap-1.5 rounded-full text-sm font-bold",
          item.onHand ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted",
        )}
      >
        {item.onHand && <Check size={16} strokeWidth={3} aria-hidden="true" />}
        {item.onHand ? "On hand" : "Out"}
      </button>
    </li>
  );
}
