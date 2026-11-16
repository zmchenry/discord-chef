import { Check, GripVertical, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { displayIngredientName } from "../../../../shared/normalize";
import type { ShoppingItemView } from "../../../../shared/shopping";
import type { ItemGroup } from "../../../../shared/shopping/sort";
import { Card } from "../../components/ui";
import { cx } from "../../lib/cx";

export type Row = ShoppingItemView & { checked: boolean };

interface ListProps {
  groups: ItemGroup<Row>[];
  recipes: Record<string, string>;
  // My order: rows get a drag handle.
  reorder: boolean;
  onCheck: (item: Row, checked: boolean) => void;
  onRemove: (item: Row) => void;
  onMove: (item: Row, rank: number) => void;
}

export function ItemList({ groups, recipes, reorder, onCheck, onRemove, onMove }: ListProps) {
  return (
    <div className="grid gap-4">
      {groups.map((g) => {
        const left = g.items.filter((i) => !i.checked).length;
        const titled = !reorder && groups.length > 0 && (g.section !== null || groups.length > 1);
        return (
          <section key={g.section ?? "-"} className="grid gap-1.5" aria-label={titled ? (g.section ?? "Other") : "Items"}>
            {titled && (
              <h2 className="m-0 flex justify-between px-1 font-body text-xs font-extrabold uppercase tracking-[0.08em] text-muted">
                <span>{g.section ?? "Other"}</span>
                <span>{left ? `${left} left` : "Done"}</span>
              </h2>
            )}
            <Card className="overflow-hidden">
              <Rows
                items={g.items}
                recipes={recipes}
                reorder={reorder}
                onCheck={onCheck}
                onRemove={onRemove}
                onMove={onMove}
              />
            </Card>
          </section>
        );
      })}
    </div>
  );
}

function forText(item: Row, recipes: Record<string, string>): string | null {
  if (item.source === "staple") return "Staple";
  const names = item.recipeIds.map((id) => recipes[id]).filter(Boolean);
  if (names.length > 2) return `${names.length} recipes`;
  return names.length ? names.join(", ") : null;
}

// The rank that puts `item` at `index` among `order` (which excludes it).
function rankAt(order: Row[], index: number): number {
  const rank = (i: number) => order[i].manualRank ?? i;
  if (order.length === 0) return 0;
  if (index <= 0) return rank(0) - 1;
  if (index >= order.length) return rank(order.length - 1) + 1;
  return (rank(index - 1) + rank(index)) / 2;
}

function Rows({ items, recipes, reorder, onCheck, onRemove, onMove }: Omit<ListProps, "groups"> & { items: Row[] }) {
  const listRef = useRef<HTMLUListElement>(null);
  // While dragging: the item, how far it has moved, the slot it would land in.
  const [drag, setDrag] = useState<{ id: number; startY: number; dy: number; mids: number[]; from: number; to: number } | null>(
    null,
  );

  const movable = items.filter((i) => !i.checked);

  const move = (item: Row, to: number) => {
    const others = movable.filter((i) => i.id !== item.id);
    const from = movable.findIndex((i) => i.id === item.id);
    if (to === from) return;
    onMove(item, rankAt(others, to));
  };

  const startDrag = (e: PointerEvent<HTMLButtonElement>, item: Row) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-movable]") ?? [])];
    const mids = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2;
    });
    const from = movable.findIndex((i) => i.id === item.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: item.id, startY: e.clientY, dy: 0, mids, from, to: from });
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    const y = drag.mids[drag.from] + dy;
    // Slot = how many other rows' midpoints are above the dragged centre.
    const to = drag.mids.filter((m, i) => i !== drag.from && m < y).length;
    setDrag({ ...drag, dy, to });
  };

  const endDrag = (item: Row) => {
    if (drag) move(item, drag.to);
    setDrag(null);
  };

  const onKey = (e: KeyboardEvent, item: Row) => {
    const from = movable.findIndex((i) => i.id === item.id);
    if (e.key === "ArrowUp" && from > 0) move(item, from - 1);
    else if (e.key === "ArrowDown" && from < movable.length - 1) move(item, from + 1);
    else return;
    e.preventDefault();
  };

  // Where the drop line goes: before the row at `to` in the list without the
  // dragged row.
  const others = drag ? movable.filter((i) => i.id !== drag.id) : [];
  const dropBefore = drag && drag.to !== drag.from ? (others[drag.to]?.id ?? null) : null;
  const dropAtEnd = !!drag && drag.to !== drag.from && drag.to >= others.length;
  const lastMovable = movable[movable.length - 1]?.id;

  return (
    <ul ref={listRef} className="m-0 list-none p-0">
      {items.map((item) => {
        const sub = forText(item, recipes);
        const dragging = drag?.id === item.id;
        const canMove = reorder && !item.checked;
        return (
          <li
            key={item.id}
            data-movable={canMove || undefined}
            style={dragging ? { transform: `translateY(${drag.dy}px)` } : undefined}
            className={cx(
              "relative flex items-center border-b border-border last:border-b-0",
              dragging && "z-10 rounded-sm bg-surface shadow-card",
              dropBefore === item.id && !dragging && "shadow-[inset_0_2px_0_var(--color-primary)]",
              dropAtEnd && item.id === lastMovable && !dragging && "shadow-[inset_0_-2px_0_var(--color-primary)]",
            )}
          >
            <label className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 pl-3.5 pr-2">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={item.checked}
                onChange={(e) => onCheck(item, e.target.checked)}
              />
              <span
                aria-hidden="true"
                className="grid size-7 shrink-0 place-items-center rounded-sm border-2 border-muted text-bg transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
              >
                {item.checked && <Check size={16} strokeWidth={3.5} />}
              </span>
              <span className="grid min-w-0 flex-1 leading-tight">
                <span
                  className={cx(
                    "font-bold",
                    item.checked && "text-muted line-through decoration-2",
                  )}
                >
                  {displayIngredientName(item.name)}
                </span>
                {sub && <span className={cx("truncate text-[13px] text-muted", item.checked && "opacity-70")}>{sub}</span>}
              </span>
              {item.amount && (
                <span className={cx("shrink-0 whitespace-nowrap text-sm font-bold tabular-nums text-muted", item.checked && "opacity-70")}>
                  {item.amount}
                </span>
              )}
            </label>
            {item.source !== "generated" && !reorder && (
              <button
                type="button"
                aria-label={`Remove ${item.name}`}
                onClick={() => onRemove(item)}
                className="pressable grid size-11 shrink-0 place-items-center rounded-full text-muted"
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
            {canMove && (
              <button
                type="button"
                aria-label={`Move ${item.name}. Use the arrow keys, or drag.`}
                onPointerDown={(e) => startDrag(e, item)}
                onPointerMove={onPointerMove}
                onPointerUp={() => endDrag(item)}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={(e) => onKey(e, item)}
                className="grid h-14 w-12 shrink-0 cursor-grab touch-none place-items-center text-muted"
              >
                <GripVertical size={20} aria-hidden="true" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
