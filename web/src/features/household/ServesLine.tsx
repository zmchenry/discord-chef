import { ChefHat } from "lucide-react";
import { Link } from "react-router-dom";

import { formatServings, servesText } from "../../../../shared/household/servings";
import type { MealNutritionWire } from "../../../../shared/nutrition";

// "¾ of the recipe", "1½× the recipe"
const factorText = (f: number) =>
  f === 1 ? "the recipe as written" : f < 1 ? `${formatServings(f)} of the recipe` : `${formatServings(f)}× the recipe`;

// Who a planned meal feeds, how far the recipe scales, and a way into
// cooking mode at that size. Sits at the top of the slot sheet's portions.
export function ServesLine({ meal }: { meal: Pick<MealNutritionWire, "kind" | "recipeId" | "serves"> }) {
  const { serves } = meal;
  const cook = serves.total + serves.leftovers;
  const factor = serves.factor;
  const extra = [
    serves.leftovers ? `+${formatServings(serves.leftovers)} for leftovers` : null,
    factor !== null && factor > 0 && Math.abs(factor - Math.round(factor * 4) / 4) < 0.01 ? factorText(factor) : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2">
      <p className="m-0 min-w-0">
        <span className="block font-semibold">{servesText(serves)}</span>
        {extra.length > 0 && <span className="block text-sm text-muted">{extra.join(" · ")}</span>}
      </p>
      {meal.kind === "recipe" && meal.recipeId && cook > 0 && (
        <Link
          to={`/recipes/${meal.recipeId}/cook?servings=${cook}`}
          className="pressable -mr-1 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-primary no-underline"
        >
          <ChefHat size={16} aria-hidden="true" /> Cook for {formatServings(cook)}
        </Link>
      )}
    </div>
  );
}
