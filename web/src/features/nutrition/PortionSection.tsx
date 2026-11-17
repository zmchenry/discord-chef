import { useIsMutating } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { Meal } from "../../../../shared/schema";
import { cx } from "../../lib/cx";
import { useSetPortions, useWeekNutrition } from "./api";
import { fmt, servings } from "./format";

const STEP = 0.25;
const MAX = 6;

// A small section in the slot sheet: how this meal is split between the
// people at home ("Zach 1.5 servings · Liz 1"), with a stepper per person.
// The default follows the calorie goals; a change is saved per meal.
export function PortionSection({ weekId, date, meal }: { weekId: string; date: string; meal: Meal }) {
  const q = useWeekNutrition(weekId);
  const setPortions = useSetPortions(weekId);
  const saving = useIsMutating({ mutationKey: ["portions", weekId] }) > 0;
  const day = q.data?.days.find((d) => d.date === date);
  const m = day?.meals.find((x) => x.meal === meal);
  const serverKey = m ? JSON.stringify(m.portions) : "";
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!saving && serverKey) setDraft(JSON.parse(serverKey) as Record<string, number>);
  }, [serverKey, saving]);

  if (!q.data || !day || !m || !draft || (m.kind !== "recipe" && m.kind !== "leftovers")) return null;
  const people = q.data.people.filter((p) => p in draft);
  const away = q.data.people.filter((p) => !day.people[p]?.home);
  if (!people.length) return null;

  const change = (person: string, delta: number) => {
    const next = { ...draft, [person]: Math.min(MAX, Math.max(0, Math.round((draft[person]! + delta) / STEP) * STEP)) };
    setDraft(next);
    setPortions.mutate({ date, meal, portions: next });
  };
  const titleId = `portions-${date}-${meal}`;

  return (
    <section aria-labelledby={titleId} className="grid gap-2 rounded-sm bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={titleId} className="m-0 font-body text-sm font-bold">
          Portions
        </h3>
        {m.custom && (
          <button
            type="button"
            onClick={() => setPortions.mutate({ date, meal, portions: null })}
            className="pressable -my-3 inline-flex min-h-11 items-center bg-transparent px-1 text-sm font-semibold text-primary"
          >
            Use default
          </button>
        )}
      </div>
      <p className="m-0 text-sm text-muted">
        {people.map((p) => `${p} ${p === people[0] ? servings(draft[p]!) : draft[p]}`).join(" · ")}
        {m.perServing ? ` · about ${fmt(m.perServing.kcal)} kcal a serving (est.)` : ""}
        {away.length ? ` · ${away.join(" and ")} away` : ""}
      </p>
      <ul className="m-0 grid list-none gap-1 p-0">
        {people.map((p) => (
          <li key={p} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-semibold">{p}</span>
            <span className="flex items-center gap-1">
              <StepButton label={`Less for ${p}`} disabled={draft[p]! <= 0} onClick={() => change(p, -STEP)}>
                <Minus size={18} />
              </StepButton>
              <output aria-live="polite" className="w-12 text-center font-semibold tabular-nums">
                {draft[p]}
              </output>
              <StepButton label={`More for ${p}`} disabled={draft[p]! >= MAX} onClick={() => change(p, STEP)}>
                <Plus size={18} />
              </StepButton>
            </span>
          </li>
        ))}
      </ul>
      {setPortions.isError && <p className="m-0 text-sm font-semibold text-danger">{setPortions.error.message}</p>}
    </section>
  );
}

function StepButton(p: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={p.label}
      disabled={p.disabled}
      onClick={p.onClick}
      className={cx("pressable grid size-11 place-items-center rounded-full bg-surface-2 text-text disabled:opacity-40")}
    >
      {p.children}
    </button>
  );
}
