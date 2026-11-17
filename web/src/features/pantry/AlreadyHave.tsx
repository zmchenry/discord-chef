import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import { displayIngredientName } from "../../../../shared/normalize";
import type { ShoppingItemView } from "../../../../shared/shopping";
import { Card } from "../../components/ui";
import { cx } from "../../lib/cx";

// The shopping list's "Already have" group: items whose ingredient is in
// the pantry. Collapsed, so a glance confirms nothing was dropped; each row
// can go back on the list.
export function AlreadyHave({ items, onNeed }: { items: ShoppingItemView[]; onNeed: (item: ShoppingItemView) => void }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (!items.length) return null;
  return (
    <section className="grid gap-1.5" aria-label="Already have">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className="pressable flex min-h-11 items-center justify-between gap-2 rounded-sm px-1 text-left"
      >
        <span className="font-body text-xs font-extrabold uppercase tracking-[0.08em] text-muted">
          Already have · {items.length}
        </span>
        <span className="flex items-center gap-1 text-sm font-semibold text-muted">
          {open ? "Hide" : "Show"}
          <ChevronDown size={18} aria-hidden="true" className={cx("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div id={bodyId} className="grid gap-1.5">
          <p className="m-0 px-1 text-[13px] text-muted">On hand at home, so not counted. Out of something? Put it back.</p>
          <Card className="overflow-hidden">
            <ul className="m-0 list-none p-0">
              {items.map((item) => (
                <li key={item.id} className="flex min-h-14 items-center gap-3 border-b border-border py-1.5 pl-3.5 pr-2 last:border-b-0">
                  <span className="grid min-w-0 flex-1 leading-tight">
                    <span className="font-bold text-muted">{displayIngredientName(item.name)}</span>
                    {item.amount && <span className="text-[13px] tabular-nums text-muted">{item.amount}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => onNeed(item)}
                    aria-label={`Need ${displayIngredientName(item.name)} after all`}
                    className="pressable min-h-11 shrink-0 rounded-full px-3 text-sm font-bold text-primary hover:bg-surface-2"
                  >
                    Need it after all
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </section>
  );
}
