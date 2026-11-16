import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { ShoppingSort } from "../../../../shared/schema";
import type { ShoppingListView, ShoppingWeekResponse } from "../../../../shared/shopping";
import { sortItems } from "../../../../shared/shopping/sort";
import { addDays, defaultShoppingWeek, formatWeekRange } from "../../../../shared/shopping/week";
import { Button, Card, StateMessage } from "../../components/ui";
import { cx } from "../../lib/cx";
import { AddItem } from "./AddItem";
import { ItemList, type Row } from "./ItemList";
import { SectionOrder, StorePicker } from "./StorePicker";
import {
  useAddItem,
  useCheckItem,
  useDeleteItem,
  useGenerate,
  useRankItem,
  useShoppingWeek,
  useUpdateList,
} from "./queries";

const SORTS: Array<[ShoppingSort, string]> = [
  ["aisle", "Aisle"],
  ["alpha", "A–Z"],
  ["manual", "My order"],
  ["smart", "Smart"],
];

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<[T, string]>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid gap-0.5 rounded-full bg-surface-2 p-[3px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className={cx(
            "min-h-11 truncate rounded-full px-1 text-sm font-bold transition-colors",
            v === value ? "bg-surface text-text shadow-card" : "text-muted",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function ShoppingPage() {
  const [params, setParams] = useSearchParams();
  const weekId = params.get("week") ?? defaultShoppingWeek(new Date());
  const week = useShoppingWeek(weekId);
  const generate = useGenerate(weekId);

  const goWeek = (days: number) => {
    const next = new URLSearchParams(params);
    next.set("week", addDays(weekId, days));
    setParams(next, { replace: true });
  };

  const hasList = !!week.data && week.data.lists.length > 0;

  return (
    <>
      <header className="grid gap-0.5 px-4 pb-3 pt-3">
        <div className="-ml-3 flex items-center">
          <button type="button" aria-label="Previous week" onClick={() => goWeek(-7)} className="pressable grid size-11 place-items-center rounded-full text-muted">
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <p className="m-0 text-xs font-bold uppercase tracking-[0.08em] text-muted">For {formatWeekRange(weekId)}</p>
          <button type="button" aria-label="Next week" onClick={() => goWeek(7)} className="pressable grid size-11 place-items-center rounded-full text-muted">
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="m-0 text-3xl">Shopping list</h1>
          {hasList && (
            <Button variant="secondary" className="px-3 text-sm" onClick={() => generate.mutate(undefined)} disabled={generate.isPending}>
              <RefreshCw size={16} aria-hidden="true" className={cx(generate.isPending && "animate-spin motion-reduce:animate-none")} />
              {generate.isPending ? "Updating" : "Update"}
            </Button>
          )}
        </div>
      </header>
      <div className="px-4">
        {week.isPending ? (
          <StateMessage title="Loading the list…" />
        ) : week.isError ? (
          <StateMessage title="Couldn't load the list">{week.error.message}</StateMessage>
        ) : !hasList ? (
          <Card className="grid justify-items-start gap-3 p-4">
            <p className="m-0">No list for this week yet. Build it from the recipes planned for {formatWeekRange(weekId)}.</p>
            <Button onClick={() => generate.mutate(undefined)} disabled={generate.isPending}>
              {generate.isPending ? "Building…" : "Build the list"}
            </Button>
            {generate.isError && <p className="m-0 text-sm font-semibold text-danger">{generate.error.message}</p>}
          </Card>
        ) : (
          <WeekLists week={week.data} />
        )}
      </div>
    </>
  );
}

function WeekLists({ week }: { week: ShoppingWeekResponse }) {
  const [tripIndex, setTripIndex] = useState(0);
  const [editingAisles, setEditingAisles] = useState(false);
  const generate = useGenerate(week.weekId);
  const update = useUpdateList(week.weekId);
  const check = useCheckItem(week.weekId);
  const rank = useRankItem(week.weekId);
  const add = useAddItem(week.weekId);
  const remove = useDeleteItem(week.weekId);

  const list: ShoppingListView = week.lists[Math.min(tripIndex, week.lists.length - 1)];
  const store = week.stores.find((s) => s.id === list.storeId) ?? null;

  const rows: Row[] = useMemo(() => list.items.map((i) => ({ ...i, checked: i.checkedAt !== null })), [list.items]);
  const groups = useMemo(() => sortItems(rows, list.sort, store, list.learned), [rows, list.sort, store, list.learned]);
  const done = rows.filter((r) => r.checked).length;
  const recipeCount = new Set(rows.flatMap((r) => r.recipeIds)).size;
  const learnedNothing = Object.keys(list.learned.sections).length === 0;

  return (
    <div className="grid gap-4">
      <div className="grid gap-2.5">
        {week.twoTrips && (
          <Segmented
            label="Trip"
            options={week.lists.map((l, i) => [String(i), `${l.trip === "midweek" ? "Midweek" : "Weekend"} · ${l.items.filter((x) => x.checkedAt === null).length}`])}
            value={String(week.lists.indexOf(list))}
            onChange={(v) => setTripIndex(Number(v))}
          />
        )}
        <StorePicker stores={week.stores} list={list} onPick={(storeId) => update.mutate({ listId: list.id, storeId })} />
        <button
          type="button"
          role="switch"
          aria-checked={week.twoTrips}
          disabled={generate.isPending}
          onClick={() => {
            setTripIndex(0);
            generate.mutate(!week.twoTrips);
          }}
          className="flex min-h-11 items-center justify-between gap-3 px-1 text-left disabled:opacity-60"
        >
          <span className="grid leading-tight">
            <span className="font-semibold">Two trips</span>
            <span className="text-sm text-muted">Fresh things for Thu–Sat on a midweek trip</span>
          </span>
          <span
            aria-hidden="true"
            className={cx(
              "relative h-7 w-12 shrink-0 rounded-full transition-colors",
              week.twoTrips ? "bg-accent" : "bg-surface-2 shadow-[inset_0_0_0_1.5px_var(--color-border)]",
            )}
          >
            <span
              className={cx(
                "absolute left-0.5 top-0.5 size-6 rounded-full bg-surface shadow-card transition-transform",
                week.twoTrips && "translate-x-5",
              )}
            />
          </span>
        </button>
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between text-[13px] font-semibold tabular-nums text-muted">
          <span>
            {done} of {rows.length} in the cart
          </span>
          {recipeCount > 0 && <span>{recipeCount === 1 ? "1 recipe" : `${recipeCount} recipes`}</span>}
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-label="In the cart"
          aria-valuemin={0}
          aria-valuemax={rows.length}
          aria-valuenow={done}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${rows.length ? (done / rows.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Segmented label="Sort list" options={SORTS} value={list.sort} onChange={(sort) => update.mutate({ listId: list.id, sort })} />
        {list.sort === "smart" && learnedNothing && (
          <p className="m-0 px-1 text-sm text-muted">Aisle order for now. Smart learns your route after a couple of trips.</p>
        )}
        {list.sort === "manual" && <p className="m-0 px-1 text-sm text-muted">Drag the handles to put the list in your order.</p>}
        {list.sort === "aisle" && store && !editingAisles && (
          <button type="button" onClick={() => setEditingAisles(true)} className="min-h-11 justify-self-start px-1 text-sm font-semibold text-primary">
            Change {store.name}'s aisle order
          </button>
        )}
      </div>

      {editingAisles && store && <SectionOrder key={store.id} weekId={week.weekId} store={store} onDone={() => setEditingAisles(false)} />}

      <AddItem onAdd={(item) => add.mutate({ listId: list.id, ...item })} />

      {rows.length === 0 ? (
        <StateMessage title="Nothing to buy">Plan some recipes for this week, then tap Update. Or add items above.</StateMessage>
      ) : (
        <ItemList
          groups={groups}
          recipes={week.recipes}
          reorder={list.sort === "manual"}
          onCheck={(item, checked) => item.id > 0 && check.mutate({ id: item.id, checked })}
          onRemove={(item) => item.id > 0 && remove.mutate(item.id)}
          onMove={(item, manualRank) => rank.mutate({ id: item.id, manualRank, previous: item.manualRank })}
        />
      )}
    </div>
  );
}
