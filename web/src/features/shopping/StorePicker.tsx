import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";

import type { Store } from "../../../../shared/schema";
import type { ShoppingListView, ShoppingWeekResponse } from "../../../../shared/shopping";
import { MIN_PRICED_SHARE } from "../../../../shared/shopping/store";
import { Card } from "../../components/ui";
import { cx } from "../../lib/cx";
import { shoppingApi } from "./api";
import { shoppingKey } from "./queries";

const dollars = (cents: number) => `$${Math.round(cents / 100)}`;

// One store per trip. Each button shows the trip's estimated total at that
// store once enough items have prices, and the cheapest is marked.
export function StorePicker({
  stores,
  list,
  onPick,
}: {
  stores: Store[];
  list: ShoppingListView;
  onPick: (storeId: number) => void;
}) {
  const totalFor = (storeId: number) => {
    const t = list.totals.find((x) => x.storeId === storeId);
    return t && t.total > 0 && t.priced / t.total >= MIN_PRICED_SHARE ? t.cents : null;
  };
  const rec = list.recommendation;
  const current = totalFor(list.storeId);
  const recStore = rec && rec.storeId !== list.storeId ? stores.find((s) => s.id === rec.storeId) : undefined;

  return (
    <div className="grid gap-1.5">
      <div role="radiogroup" aria-label="Store for this trip" className="grid grid-cols-3 gap-2">
        {stores.map((s) => {
          const selected = s.id === list.storeId;
          const total = totalFor(s.id);
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onPick(s.id)}
              className={cx(
                "pressable grid min-h-12 content-center rounded-sm px-2 py-1 text-center",
                selected ? "bg-primary text-on-primary" : "bg-surface-2 text-text",
              )}
            >
              <span className="font-bold leading-tight">{s.name}</span>
              {total !== null && (
                <span className={cx("text-xs font-semibold leading-tight", !selected && "text-muted")}>
                  ~{dollars(total)}{rec?.storeId === s.id ? " · lowest" : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {recStore && rec && current !== null && current > rec.cents && (
        <p className="m-0 px-1 text-sm font-semibold text-accent">
          {recStore.name} is about {dollars(current - rec.cents)} cheaper for this trip.
        </p>
      )}
    </div>
  );
}

// The store's walking order, one section at a time.
export function SectionOrder({ weekId, store, onDone }: { weekId: string; store: Store; onDone: () => void }) {
  const qc = useQueryClient();
  const [order, setOrder] = useState(store.sectionOrder);
  const save = useMutation({
    mutationFn: (sections: string[]) => shoppingApi.putSections(store.id, sections),
    onSuccess: (sections) =>
      qc.setQueryData<ShoppingWeekResponse>(shoppingKey(weekId), (w) =>
        w && { ...w, stores: w.stores.map((s) => (s.id === store.id ? { ...s, sectionOrder: sections } : s)) },
      ),
  });

  const swap = (i: number, j: number) => {
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    save.mutate(next);
  };

  return (
    <Card className="grid gap-1 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-lg">Aisle order at {store.name}</h2>
        <button type="button" onClick={onDone} className="pressable min-h-11 rounded-full px-3 font-bold text-primary">
          Done
        </button>
      </div>
      <ol className="m-0 list-none p-0">
        {order.map((section, i) => (
          <li key={section} className="flex items-center gap-1 border-b border-border last:border-b-0">
            <span className="w-6 text-sm font-bold tabular-nums text-muted">{i + 1}</span>
            <span className="flex-1 font-semibold">{section}</span>
            <button
              type="button"
              aria-label={`Move ${section} earlier`}
              disabled={i === 0}
              onClick={() => swap(i, i - 1)}
              className="pressable grid size-11 place-items-center rounded-full text-text disabled:opacity-30"
            >
              <ArrowUp size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Move ${section} later`}
              disabled={i === order.length - 1}
              onClick={() => swap(i, i + 1)}
              className="pressable grid size-11 place-items-center rounded-full text-text disabled:opacity-30"
            >
              <ArrowDown size={18} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}
