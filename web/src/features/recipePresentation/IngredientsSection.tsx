import { Check, Plus } from "lucide-react";
import { Link } from "react-router-dom";

import { displayIngredientName } from "../../../../shared/normalize";
import type { StructuredIngredient } from "../../../../shared/recipePresentation";
import { formatAmount, groupIngredients } from "../../../../shared/recipeStructure";
import { Button } from "../../components/ui";
import { useEstimatedAmounts } from "../nutrition/api";
import { IngredientStorePin } from "../shopping/StorePin";
import { FlavorPill } from "./pills";
import { useAddToGroceries } from "./queries";

// Ingredients as bordered cards, one per group (the ungrouped lines form one
// card with no header). Each line: the name with its flavor pills, and the
// amount on the right with a conversion or note under it.

function ingredientDisplay(i: StructuredIngredient) {
  const name = i.ingredientName ? displayIngredientName(i.ingredientName) : i.rawText;
  // A line that parsed to nothing useful shows as written, with no amount.
  if (!i.ingredientName) return { name, primary: "", secondary: i.optional ? "optional" : null };
  const amount = formatAmount(i.quantity, i.unit, i.note);
  const note = amount.primary === "to taste" ? null : i.note;
  const extra = [amount.secondary ?? note, i.optional ? "optional" : null].filter(Boolean).join(" · ");
  return { name, primary: amount.primary, secondary: extra || null };
}

export function IngredientsSection({
  ingredients,
  live,
  recipeId,
}: {
  ingredients: StructuredIngredient[];
  live: boolean;
  recipeId?: string;
}) {
  const add = useAddToGroceries();
  // Amounts the nutrition backfill estimated (the line had none) show "est.".
  const estimated = useEstimatedAmounts(recipeId);
  const groups = groupIngredients(ingredients);
  return (
    <section aria-labelledby="ingredients-title" className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="ingredients-title" className="m-0 font-body text-2xl font-bold">
          Ingredients
        </h2>
        {live && ingredients.length > 0 && (
          <Button variant="secondary" className="px-3 text-sm" disabled={add.isPending} onClick={() => add.mutate(ingredients)}>
            <Plus size={16} aria-hidden="true" />
            {add.isPending ? "Adding…" : "Add to groceries"}
          </Button>
        )}
      </div>
      {add.isSuccess && (
        <p className="m-0 flex flex-wrap items-center gap-x-2 text-sm font-semibold text-accent" role="status">
          <Check size={16} aria-hidden="true" /> Added to this week’s list.
          <Link to={`/shop?week=${add.data.weekId}`} className="inline-flex min-h-11 items-center text-primary">
            See the list
          </Link>
        </p>
      )}
      {add.isError && (
        <p className="m-0 text-sm font-semibold text-danger" role="alert">
          Couldn’t add them: {add.error.message}
        </p>
      )}

      {ingredients.length === 0 ? (
        <p className="m-0 text-muted">No ingredients yet.</p>
      ) : (
        groups.map((g, n) => (
          <div key={g.group ?? `none-${n}`} className="overflow-hidden rounded-card border border-border bg-surface">
            {g.group && (
              <h3 className="m-0 border-b border-border px-4 py-2.5 font-body text-sm font-bold text-muted first-letter:uppercase">
                {g.group}
              </h3>
            )}
            <ul className="m-0 list-none p-0">
              {g.items.map((i) => (
                <IngredientRow key={i.id} ingredient={i} estimated={estimated.has(i.position)} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function IngredientRow({ ingredient: i, estimated }: { ingredient: StructuredIngredient; estimated: boolean }) {
  const d = ingredientDisplay(i);
  return (
    <li className="flex min-h-14 items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="grid min-w-0 flex-1 gap-1">
        <span className="break-words text-[1.0625rem] leading-snug text-muted">{d.name}</span>
        {i.flavors.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {i.flavors.map((f) => (
              <FlavorPill key={f} flavor={f} />
            ))}
          </span>
        )}
      </div>
      {(d.primary || d.secondary) && (
        <div className="max-w-[45%] shrink-0 text-right leading-snug">
          {/* The amount always stays on one line; a note under it may wrap. */}
          {d.primary && (
            <div className="whitespace-nowrap font-bold">
              {d.primary}
              {estimated && (
                <abbr title="Estimated amount: the recipe didn't say" className="ml-1 text-xs font-semibold text-muted no-underline">
                  est.
                </abbr>
              )}
            </div>
          )}
          {d.secondary && <div className="text-sm text-muted">{d.secondary}</div>}
        </div>
      )}
      {/* The store pin shows here; it is set from the Shop list's row menu. */}
      {i.ingredientId !== null && <IngredientStorePin ingredientId={i.ingredientId} name={i.ingredientName ?? i.rawText} editable={false} />}
    </li>
  );
}
