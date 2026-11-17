import { useIsMutating } from "@tanstack/react-query";
import { ChefHat, Minus, Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import {
  clampServings,
  formatServings,
  MAX_SERVINGS,
  MIN_SERVINGS,
  SERVINGS_STEP,
} from "../../../../shared/household/servings";
import type { Meal } from "../../../../shared/schema";
import { useSetServings, useWeekNutrition } from "./api";
import { fmt } from "./format";

// "¾ of the recipe", "1½× the recipe"
const factorText = (f: number) =>
  f === 1 ? "the recipe as written" : f < 1 ? `${formatServings(f)} of the recipe` : `${formatServings(f)}× the recipe`;

// A small section in the slot sheet: how many servings this meal makes
// (2 by default, the two adults), in half steps, how far that scales the
// recipe, and a way into cooking mode at that size. Saved per meal; the
// shopping list scales by it too.
export function PortionSection({ weekId, date, meal }: { weekId: string; date: string; meal: Meal }) {
  const q = useWeekNutrition(weekId);
  const setServings = useSetServings(weekId);
  const saving = useIsMutating({ mutationKey: ["servings", weekId] }) > 0;
  const m = q.data?.days.find((d) => d.date === date)?.meals.find((x) => x.meal === meal);
  const server = m?.serves.servings ?? null;
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => {
    if (!saving && server !== null) setDraft(server);
  }, [server, saving]);

  if (!m || draft === null || (m.kind !== "recipe" && m.kind !== "leftovers")) return null;
  const { serves } = m;

  const change = (delta: number) => {
    const next = clampServings(draft + delta);
    setDraft(next);
    setServings.mutate({ date, meal, servings: next });
  };
  // While a change is saving, the leftovers and factor are a step behind;
  // scale the factor by the draft so the line never lags the stepper.
  const cook = draft + serves.leftovers;
  const factor = serves.factor === null ? null : (serves.factor * cook) / (serves.servings + serves.leftovers || 1);
  const extra = [
    serves.leftovers ? `+${formatServings(serves.leftovers)} for leftovers` : null,
    factor !== null && factor > 0 && Math.abs(factor - Math.round(factor * 4) / 4) < 0.01 ? factorText(Math.round(factor * 4) / 4) : null,
  ].filter(Boolean);
  const titleId = `servings-${date}-${meal}`;

  return (
    <section aria-labelledby={titleId} className="grid gap-2 rounded-sm bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="m-0 font-body text-sm font-bold">
          Servings
        </h3>
        <span className="flex items-center gap-1">
          <StepButton label="Fewer servings" disabled={draft <= MIN_SERVINGS} onClick={() => change(-SERVINGS_STEP)}>
            <Minus size={18} />
          </StepButton>
          <output aria-live="polite" className="w-12 text-center text-lg font-bold tabular-nums">
            {formatServings(draft)}
          </output>
          <StepButton label="More servings" disabled={draft >= MAX_SERVINGS} onClick={() => change(SERVINGS_STEP)}>
            <Plus size={18} />
          </StepButton>
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <p className="m-0 min-w-0">
          <span className="block font-semibold">Serves {formatServings(draft)}</span>
          {extra.length > 0 && <span className="block text-sm text-muted">{extra.join(" · ")}</span>}
        </p>
        {m.kind === "recipe" && serves.sourceId && (
          <Link
            to={`/recipes/${serves.sourceId}/cook?servings=${cook}`}
            className="pressable -mr-1 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-primary no-underline"
          >
            <ChefHat size={16} aria-hidden="true" /> Cook for {formatServings(cook)}
          </Link>
        )}
      </div>
      {m.perServing && <p className="m-0 text-sm text-muted">About {fmt(m.perServing.kcal)} kcal a serving (est.)</p>}
      {setServings.isError && <p className="m-0 text-sm font-semibold text-danger">{setServings.error.message}</p>}
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
      className="pressable grid size-11 place-items-center rounded-full bg-surface-2 text-text disabled:opacity-40"
    >
      {p.children}
    </button>
  );
}
