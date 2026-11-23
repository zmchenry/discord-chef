import { Info } from "lucide-react";

import { MACRO_LABEL, MACRO_UNIT } from "../../../../shared/nutrition/goals";
import { useGoals, useRecipeNutrition } from "./api";
import { fmt } from "./format";
import { Est, PersonName } from "./parts";

const TILES = ["kcal", "protein", "carbs", "fat"] as const;

// Per-serving nutrition for one recipe: calories and the three macros as
// tiles (same labels and units as the nutrition views), fiber under them,
// and how much of each person's daily goal one serving is. Marked as an
// estimate. Self-contained (fetches its own data), so the recipe page only
// mounts it.
export function RecipeNutrition({ recipeId }: { recipeId: string }) {
  const q = useRecipeNutrition(recipeId);
  const goals = useGoals();
  const n = q.data;
  const usable = !!n && n.lines > 0 && n.missing < n.lines;
  const empty = !n ? "" : n.lines === 0 ? "Add ingredients to see an estimate." : n.filling ? "Estimating…" : "No estimate yet.";
  const titleId = `nutrition-${recipeId}`;

  return (
    <section aria-labelledby={titleId} className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={titleId} className="m-0 text-xl">
          Nutrition
        </h2>
        <span className="flex items-center gap-1.5 text-sm text-muted">
          per serving
          <Est />
        </span>
      </div>

      {q.isPending ? (
        <p className="m-0 mt-2 text-muted">Loading…</p>
      ) : q.isError ? (
        <p className="m-0 mt-2 text-muted">Couldn't load nutrition.</p>
      ) : !usable || !n ? (
        <p className="m-0 mt-2 text-muted" role="status">
          {empty}
        </p>
      ) : (
        <>
          <dl className="m-0 mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TILES.map((k) => (
              <div key={k} className="grid gap-0.5 rounded-sm bg-surface-2 px-3 py-2">
                <dt className="text-sm text-muted">{MACRO_LABEL[k]}</dt>
                <dd className="m-0 text-xl font-bold">
                  {fmt(n.perServing[k])}
                  <span className="text-sm font-normal text-muted"> {MACRO_UNIT[k]}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="m-0 mt-2 text-sm text-muted">Fiber {fmt(n.perServing.fiber)} g</p>
          {goals.data && <GoalShares perServing={n.perServing} goals={goals.data} />}
          <Hint
            missing={n.missing}
            lines={n.lines}
            low={n.confidence === "low"}
            assumed={n.servingsAssumed ? n.servings : null}
            filling={n.filling}
            estimatedAmounts={n.estimatedAmounts.length}
          />
        </>
      )}
    </section>
  );
}

// "Zach: 27% of calories · 30% of protein for the day"
function GoalShares({
  perServing,
  goals,
}: {
  perServing: { kcal: number; protein: number };
  goals: Array<{ person: string; kcal: number | null; protein: number | null }>;
}) {
  const pct = (v: number, goal: number | null) => (goal ? `${Math.round((v / goal) * 100)}%` : null);
  const rows = goals
    .map((g, i) => ({
      g,
      i,
      parts: [
        g.kcal && `${pct(perServing.kcal, g.kcal)} of calories`,
        g.protein && `${pct(perServing.protein, g.protein)} of protein`,
      ].filter(Boolean),
    }))
    .filter((r) => r.parts.length);
  if (!rows.length) return null;
  return (
    <ul className="m-0 mt-2 grid list-none gap-1 p-0 text-sm">
      {rows.map(({ g, i, parts }) => (
        <li key={g.person} className="flex flex-wrap items-baseline justify-between gap-x-3">
          <PersonName name={g.person} index={i} className="font-semibold" />
          <span className="text-muted">{parts.join(" · ")} for the day</span>
        </li>
      ))}
    </ul>
  );
}

function Hint(p: { missing: number; lines: number; low: boolean; assumed: number | null; filling: boolean; estimatedAmounts: number }) {
  const parts: string[] = [];
  if (p.estimatedAmounts > 0)
    parts.push(`${p.estimatedAmounts === 1 ? "One amount was" : `${p.estimatedAmounts} amounts were`} estimated (marked est.).`);
  if (p.filling) parts.push("Still estimating some ingredients.");
  else if (p.missing > 0) parts.push(`${p.missing} of ${p.lines} ingredients aren't counted.`);
  if (p.assumed) parts.push(`No serving count, so this assumes ${p.assumed}.`);
  if (p.low && !parts.length) parts.push("Low confidence: several ingredients have no amount.");
  if (!parts.length) return null;
  return (
    <p className="m-0 mt-2 flex items-start gap-1.5 text-sm text-muted">
      <Info size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{parts.join(" ")}</span>
    </p>
  );
}
