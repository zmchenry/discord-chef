import { useState } from "react";
import { Link } from "react-router-dom";

import type { RecipeSummary } from "../../../../shared/schema";
import { Card } from "../../components/ui";
import { formatMinutes, totalMinutes } from "../../lib/recipeForm";
import { TagPill } from "./pills";

// A browse card on the Recipes list: the photo (or the emoji tile) on the
// left, the bold title, "40 min · serves 4" and up to three tags.
export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const time = formatMinutes(totalMinutes(recipe));
  const meta = [time, recipe.servings ? `serves ${recipe.servings}` : null].filter(Boolean).join(" · ");
  const tags = recipe.tags.slice(0, 3);
  const [broken, setBroken] = useState(false);
  return (
    <Card className="h-full overflow-hidden">
      <Link to={`/recipes/${recipe.id}`} className="pressable flex h-full min-h-24 items-stretch gap-3.5 p-2.5 text-text no-underline">
        {recipe.imageUrl && !broken ? (
          <img
            src={recipe.imageUrl}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className="size-[5.5rem] shrink-0 self-center rounded-sm bg-surface-2 object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-[5.5rem] shrink-0 place-items-center self-center rounded-sm bg-surface-2 text-[2.75rem] leading-none"
          >
            {recipe.icon ?? <span className="font-body text-3xl font-bold text-muted">{recipe.title.charAt(0).toUpperCase()}</span>}
          </span>
        )}
        <span className="grid min-w-0 flex-1 content-center gap-1 py-0.5">
          <span className="line-clamp-2 font-body text-[1.0625rem] font-bold leading-snug">{recipe.title}</span>
          {meta && <span className="text-sm text-muted">{meta}</span>}
          {tags.length > 0 && (
            <span className="mt-0.5 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <TagPill key={t} tag={t} size="sm" />
              ))}
            </span>
          )}
        </span>
      </Link>
    </Card>
  );
}
