import { Info } from "lucide-react";

import { useRecipeNutrition } from "./api";
import { fmt } from "./format";

const ROWS = [
  { key: "kcal", label: "Calories", unit: " kcal" },
  { key: "protein", label: "Protein", unit: " g" },
  { key: "carbs", label: "Carbs", unit: " g" },
  { key: "fat", label: "Fat", unit: " g" },
  { key: "fiber", label: "Fiber", unit: " g" },
] as const;

// Per-serving nutrition for one recipe: a bordered card, label left, value
// right, marked as an estimate. Self-contained (fetches its own data), so the
// recipe page only mounts it.
export function RecipeNutrition({ recipeId }: { recipeId: string }) {
  const q = useRecipeNutrition(recipeId);
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
          <abbr title="estimated" className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-text no-underline">
            est.
          </abbr>
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
          <dl className="m-0 mt-2">
            {ROWS.map((r) => (
              <div key={r.key} className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-b-0">
                <dt className="text-muted">{r.label}</dt>
                <dd className="m-0 font-semibold tabular-nums">
                  {fmt(n.perServing[r.key])}
                  <span className="font-normal text-muted">{r.unit}</span>
                </dd>
              </div>
            ))}
          </dl>
          <Hint
            missing={n.missing}
            lines={n.lines}
            low={n.confidence === "low"}
            assumed={n.servingsAssumed ? n.servings : null}
            filling={n.filling}
          />
        </>
      )}
    </section>
  );
}

function Hint(p: { missing: number; lines: number; low: boolean; assumed: number | null; filling: boolean }) {
  const parts: string[] = [];
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
