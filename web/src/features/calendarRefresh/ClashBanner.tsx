import { CalendarX2, Lock } from "lucide-react";
import { useState } from "react";

import type { ClashWire } from "../../../../shared/calendarRefresh";
import type { Meal } from "../../../../shared/schema";
import { cx } from "../../lib/cx";
import { dayName, pill } from "../planning/format";
import type { SlotChange } from "../planning/queries";
import { useDismissClash } from "./api";

// Planned meals that no longer fit the calendar, one row each, with a one-tap
// fix through the normal slot write and "Keep it", which dismisses the clash.
// Nothing changes unless someone taps.
export function ClashBanner({
  weekId,
  clashes,
  onApply,
  onOpen,
}: {
  weekId: string;
  clashes: ClashWire[];
  onApply: (changes: SlotChange[]) => void;
  onOpen: (date: string, meal: Meal) => void;
}) {
  const dismiss = useDismissClash(weekId);
  // Hide a row as soon as it is handled; the next week view drops it for good.
  const [handled, setHandled] = useState<string[]>([]);
  const rows = clashes.filter((c) => !handled.includes(c.fingerprint));
  if (rows.length === 0) return null;
  const done = (c: ClashWire) => setHandled((h) => [...h, c.fingerprint]);

  const fix = (c: ClashWire) => {
    if (!c.fix) return onOpen(c.date, c.meal);
    done(c);
    onApply([
      c.fix.kind === "swap"
        ? {
            date: c.date,
            meal: c.meal,
            set: { kind: "recipe", recipeId: c.fix.recipeId, source: "suggested" },
            recipe: { id: c.fix.recipeId, title: c.fix.title, icon: null, totalMinutes: null },
          }
        : { date: c.date, meal: c.meal, set: { kind: "eat_out", recipeId: null } },
    ]);
  };

  return (
    <section aria-label="Calendar clashes" className="rounded-card border border-primary/30 bg-primary/10 p-4">
      <p className="m-0 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
        <CalendarX2 size={14} aria-hidden="true" /> Calendar changed
      </p>
      <ul className="m-0 mt-1 list-none divide-y divide-border p-0">
        {rows.map((c) => (
          <li key={c.fingerprint} className="py-2.5 first:pt-1.5 last:pb-0">
            <p className="m-0">
              <strong>
                {dayName(c.date)} {c.meal}: {c.recipeTitle}
              </strong>
              {c.locked && (
                <Lock size={14} aria-label="locked" className="ml-1 inline-block align-[-2px] text-muted" />
              )}
            </p>
            <p className="m-0 text-sm text-muted">{c.reason}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={cx(pill, "bg-primary text-on-primary")} onClick={() => fix(c)}>
                {!c.fix ? "Pick another" : c.fix.kind === "swap" ? `Swap for ${c.fix.title}` : "Mark eat out"}
              </button>
              <button
                type="button"
                className={cx(pill, "bg-surface text-text")}
                onClick={() => {
                  done(c);
                  dismiss.mutate(c.fingerprint);
                }}
              >
                Keep it
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
