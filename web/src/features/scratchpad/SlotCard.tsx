import { ArrowLeftRight, ChevronLeft, ChevronRight, Minus, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { clampServings, formatServings, MAX_SERVINGS, MIN_SERVINGS, SERVINGS_STEP } from "../../../../shared/household/servings";
import { OverflowMenu } from "../../components/OverflowMenu";
import { Card } from "../../components/ui";
import { cx } from "../../lib/cx";
import { fmt } from "../nutrition/format";
import { SLOT_LABEL, type ItemTotals, type ScratchItem, type SlotKey } from "./model";
import type { RecentRecipe } from "./storage";

// One slot of the day: its items, each with ◀ ▶ to step through ideas, a
// servings stepper, and what each person gets from it.
export function SlotCard({
  slot,
  items,
  totals,
  people,
  swapList,
  onSwap,
  onPick,
  onServings,
  onRemove,
  onAdd,
}: {
  slot: SlotKey;
  items: ScratchItem[];
  totals: Record<string, ItemTotals>;
  people: readonly string[];
  swapList: RecentRecipe[];
  onSwap: (key: string | null, r: RecentRecipe) => void;
  onPick: (key: string | null) => void;
  onServings: (key: string, servings: number) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
}) {
  const label = SLOT_LABEL[slot];
  // Step from the current recipe through the list; off the list, start at its ends.
  const step = (current: string | null, dir: 1 | -1): RecentRecipe | null => {
    if (swapList.length === 0) return null;
    const at = swapList.findIndex((r) => r.id === current);
    const next = at < 0 ? (dir === 1 ? 0 : swapList.length - 1) : (at + dir + swapList.length) % swapList.length;
    const r = swapList[next]!;
    return r.id === current ? null : r;
  };
  const swapButtons = (key: string | null, current: string | null, title: string, children: ReactNode) => {
    const prev = step(current, -1);
    const next = step(current, 1);
    return (
      <div className="flex items-center gap-1">
        <IconButton label={`Previous idea for ${title}`} disabled={!prev} onClick={() => prev && onSwap(key, prev)}>
          <ChevronLeft size={20} />
        </IconButton>
        {children}
        <IconButton label={`Next idea for ${title}`} disabled={!next} onClick={() => next && onSwap(key, next)}>
          <ChevronRight size={20} />
        </IconButton>
      </div>
    );
  };

  return (
    <Card className="grid gap-2 p-3">
      <h2 className="m-0 flex items-center gap-2 px-1 text-xl">
        <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-surface-2 font-body text-sm font-bold text-muted">
          {label[0]}
        </span>
        {label}
      </h2>

      {items.length === 0 &&
        swapButtons(
          null,
          null,
          label.toLowerCase(),
          <button
            type="button"
            onClick={() => onPick(null)}
            className="pressable flex min-h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-sm border border-dashed border-border bg-transparent px-2 text-muted"
          >
            <Plus size={18} aria-hidden="true" className="text-primary" /> Pick {label.toLowerCase()}
          </button>,
        )}

      {items.map((item, idx) => {
        const t = totals[item.key];
        const name = idx === 0 ? label.toLowerCase() : `${label.toLowerCase()} extra`;
        return (
          <div key={item.key} className={cx("grid gap-2", idx > 0 && "border-t border-border pt-2")}>
            {idx > 0 && <p className="m-0 px-1 text-xs font-bold uppercase tracking-wider text-muted">Extra</p>}
            {swapButtons(
              item.key,
              item.marker ? null : item.recipeId,
              name,
              <button
                type="button"
                onClick={() => onPick(item.key)}
                aria-label={`${label}: ${item.title}. Change`}
                className="pressable flex min-h-14 min-w-0 flex-1 items-center rounded-sm border border-accent/40 bg-accent-soft px-3 text-left text-text"
              >
                <span className="line-clamp-2 font-semibold leading-snug">
                  {item.icon ? `${item.icon} ` : ""}
                  {item.title}
                </span>
              </button>,
            )}
            <div className="flex items-center justify-between gap-2 pl-1">
              {item.marker === "skip" || item.marker === "eat_out" ? (
                <span className="text-sm text-muted">{item.marker === "skip" ? "Nothing eaten" : "Unknown: not counted"}</span>
              ) : (
                <span className="flex items-center gap-1">
                  <span className="mr-1 text-sm text-muted">Servings</span>
                  <IconButton
                    label={`Fewer servings of ${item.title}`}
                    disabled={item.servings <= MIN_SERVINGS}
                    onClick={() => onServings(item.key, clampServings(item.servings - SERVINGS_STEP))}
                  >
                    <Minus size={18} />
                  </IconButton>
                  <output aria-live="polite" className="w-9 text-center text-lg font-bold tabular-nums">
                    {formatServings(item.servings)}
                  </output>
                  <IconButton
                    label={`More servings of ${item.title}`}
                    disabled={item.servings >= MAX_SERVINGS}
                    onClick={() => onServings(item.key, clampServings(item.servings + SERVINGS_STEP))}
                  >
                    <Plus size={18} />
                  </IconButton>
                </span>
              )}
              <OverflowMenu
                title={item.title}
                items={[
                  { label: "Change recipe…", icon: ArrowLeftRight, onSelect: () => onPick(item.key) },
                  { label: "Remove", icon: Trash2, destructive: true, onSelect: () => onRemove(item.key) },
                ]}
              />
            </div>
            {t && <Contribution t={t} people={people} />}
          </div>
        );
      })}

      {items.length > 0 && (
        <button
          type="button"
          onClick={onAdd}
          className="pressable -mb-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-full bg-transparent px-2 text-sm font-semibold text-primary"
        >
          <Plus size={16} aria-hidden="true" /> Add item
        </button>
      )}
    </Card>
  );
}

// "Zach 1¼ · 500 kcal · 25 g protein", then the estimate's honesty line.
function Contribution({ t, people }: { t: ItemTotals; people: readonly string[] }) {
  if (t.status === "none") return null;
  if (t.status === "loading") return <p className="m-0 px-1 text-sm text-muted">Adding it up…</p>;
  if (t.status === "gap")
    return <p className="m-0 px-1 text-sm text-muted">No nutrition for this yet: it's a gap in the totals, not zero.</p>;
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-3 px-1 text-sm tabular-nums">
      {people.map((p) =>
        t.portions[p] ? (
          <span key={p}>
            <span className="font-semibold">{p}</span> <span className="text-muted">{formatServings(t.portions[p]!)} ·</span>{" "}
            {fmt(t.perPerson[p]!.kcal)} kcal · {fmt(t.perPerson[p]!.protein)} g P
          </span>
        ) : null,
      )}
      <span className="text-xs text-muted">
        est.{t.missing ? ` · ${t.missing} ingredient${t.missing === 1 ? "" : "s"} unknown` : ""}
      </span>
    </p>
  );
}

function IconButton(p: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={p.label}
      disabled={p.disabled}
      onClick={p.onClick}
      className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-text disabled:opacity-40"
    >
      {p.children}
    </button>
  );
}
