import { ArrowDownUp, ChevronLeft, ChevronRight, RefreshCw, Split, Tag } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { ShoppingSort } from "../../../../shared/schema";
import type { ShoppingListView, ShoppingWeekResponse } from "../../../../shared/shopping";
import { splitAlreadyHave } from "../../../../shared/shopping/pantry";
import { sortItems } from "../../../../shared/shopping/sort";
import { groupByStore } from "../../../../shared/shopping/store";
import { addDays, defaultShoppingWeek, formatWeekRange } from "../../../../shared/shopping/week";
import { OverflowMenu, type MenuItem } from "../../components/OverflowMenu";
import { Button, Card, StateMessage } from "../../components/ui";
import { AlreadyHave } from "../pantry/AlreadyHave";
import { useSetPantry } from "../pantry/api";
import { cx } from "../../lib/cx";
import { AddItem } from "./AddItem";
import { AlsoAt, ItemList, type Row } from "./ItemList";
import { SectionOrder, StorePicker } from "./StorePicker";
import {
  useAddItem,
  useCheckItem,
  useDeleteItem,
  useGenerate,
  usePinIngredient,
  useRankItem,
  useRefreshPrices,
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

  const prices = useRefreshPrices(weekId);
  const [tripIndex, setTripIndex] = useState(0);
  const [editingAisles, setEditingAisles] = useState(false);

  const hasList = !!week.data && week.data.lists.length > 0;
  const list = hasList ? week.data.lists[Math.min(tripIndex, week.data.lists.length - 1)] : null;
  const store = (list && week.data?.stores.find((s) => s.id === list.storeId)) ?? null;

  // Checking items is the job here, so there is no primary button: list
  // upkeep sits behind the more-actions button.
  const menu: MenuItem[] = [];
  if (hasList) {
    menu.push({
      label: generate.isPending ? "Rebuilding…" : "Rebuild list",
      hint: "From the recipes planned this week",
      icon: RefreshCw,
      onSelect: () => generate.mutate(undefined),
      disabled: generate.isPending,
    });
    menu.push({
      label: "Two trips",
      hint: "Fresh things for Thu–Sat on a midweek trip",
      icon: Split,
      checked: week.data.twoTrips,
      disabled: generate.isPending,
      onSelect: () => {
        setTripIndex(0);
        generate.mutate(!week.data.twoTrips);
      },
    });
    menu.push({
      label: "Estimate prices",
      hint: "For store totals",
      icon: Tag,
      onSelect: () => prices.mutate(),
      disabled: prices.isPending,
    });
    if (store)
      menu.push({ label: `Change ${store.name}'s aisle order`, icon: ArrowDownUp, onSelect: () => setEditingAisles(true) });
  }
  const priceNote = prices.isPending
    ? "Estimating prices…"
    : prices.isError
      ? "Couldn't estimate prices."
      : prices.isSuccess && prices.data.estimated === 0
        ? "No prices came back. Try again later."
        : null;

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
          {menu.length > 0 && <OverflowMenu items={menu} title="Shopping list" />}
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
          <WeekLists
            week={week.data}
            list={list!}
            store={store}
            onTrip={setTripIndex}
            editingAisles={editingAisles}
            onEditAisles={setEditingAisles}
            note={generate.isPending ? "Rebuilding the list…" : priceNote}
          />
        )}
      </div>
    </>
  );
}

function WeekLists({
  week,
  list,
  store,
  onTrip,
  editingAisles,
  onEditAisles,
  note,
}: {
  week: ShoppingWeekResponse;
  list: ShoppingListView;
  store: ShoppingWeekResponse["stores"][number] | null;
  onTrip: (i: number) => void;
  editingAisles: boolean;
  onEditAisles: (on: boolean) => void;
  note: string | null;
}) {
  const update = useUpdateList(week.weekId);
  const check = useCheckItem(week.weekId);
  const rank = useRankItem(week.weekId);
  const add = useAddItem(week.weekId);
  const remove = useDeleteItem(week.weekId);
  const pin = usePinIngredient(week.weekId);
  const pantry = useSetPantry();

  // Items already in the pantry sit in a collapsed group at the end, out of the counts.
  const { toBuy, have } = useMemo(() => splitAlreadyHave(list.items), [list.items]);
  const rows: Row[] = useMemo(() => toBuy.map((i) => ({ ...i, checked: i.checkedAt !== null })), [toBuy]);
  // Items pinned to another store go in "Also at <store>" groups at the end.
  const split = useMemo(() => groupByStore(rows, list.storeId, week.stores.map((s) => s.id)), [rows, list.storeId, week.stores]);
  const groups = useMemo(() => sortItems(split.main, list.sort, store, list.learned), [split.main, list.sort, store, list.learned]);
  const also = split.also.flatMap(({ storeId, items }) => {
    const at = week.stores.find((s) => s.id === storeId);
    if (!at) return [];
    // One flat list per store, in that store's aisle order (or A-Z / my order).
    const mode = list.sort === "smart" ? "aisle" : list.sort;
    const sorted = sortItems(items, mode, at).flatMap((g) => g.items);
    const total = list.pinnedTotals.find((t) => t.storeId === storeId);
    return [{ store: at, items: sorted, cents: total && total.priced > 0 ? total.cents : null }];
  });
  const rowProps = {
    recipes: week.recipes,
    stores: week.stores,
    reorder: list.sort === "manual",
    onCheck: (item: Row, checked: boolean) => item.id > 0 && check.mutate({ id: item.id, checked }),
    onRemove: (item: Row) => item.id > 0 && remove.mutate(item.id),
    onMove: (item: Row, manualRank: number) => rank.mutate({ id: item.id, manualRank, previous: item.manualRank }),
    onPin: (item: Row, storeId: number | null) =>
      item.ingredientId != null && pin.mutate({ ingredientId: item.ingredientId, storeId }),
    onUsedUp: (item: Row) => item.ingredientId != null && pantry.mutate({ ingredientId: item.ingredientId, onHand: false }),
  };
  const done = rows.filter((r) => r.checked).length;
  const recipeCount = new Set(rows.flatMap((r) => r.recipeIds)).size;
  const learnedNothing = Object.keys(list.learned.sections).length === 0;

  return (
    <div className="grid gap-4">
      <div className="grid gap-2.5">
        {week.twoTrips && (
          <Segmented
            label="Trip"
            options={week.lists.map((l, i) => [String(i), `${l.trip === "midweek" ? "Midweek" : "Weekend"} · ${l.items.filter((x) => x.checkedAt === null && !x.onHand).length}`])}
            value={String(week.lists.indexOf(list))}
            onChange={(v) => onTrip(Number(v))}
          />
        )}
        <StorePicker stores={week.stores} list={list} onPick={(storeId) => update.mutate({ listId: list.id, storeId })} />
        {note && (
          <p className="m-0 px-1 text-sm text-muted" role="status">
            {note}
          </p>
        )}
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
      </div>

      {editingAisles && store && <SectionOrder key={store.id} weekId={week.weekId} store={store} onDone={() => onEditAisles(false)} />}

      <AddItem onAdd={(item) => add.mutate({ listId: list.id, ...item })} />

      {rows.length === 0 && have.length === 0 ? (
        <StateMessage title="Nothing to buy">Plan some recipes for this week, then tap Update. Or add items above.</StateMessage>
      ) : (
        <>
          {split.main.length > 0 && <ItemList groups={groups} {...rowProps} />}
          {also.map((a) => (
            <AlsoAt key={a.store.id} store={a.store} cents={a.cents} items={a.items} {...rowProps} />
          ))}
          <AlreadyHave items={have} onNeed={(item) => item.ingredientId != null && pantry.mutate({ ingredientId: item.ingredientId, onHand: false })} />
        </>
      )}
    </div>
  );
}
