import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { stepLabel, stepParagraphs, type RecipeStep } from "../../../../shared/recipeStructure";
import { RecipeNutrition } from "../nutrition/RecipeNutrition";
import { TagLink, TechniqueText } from "./pills";

// The hero, method, nutrition slot and "More" parts of the recipe screen.

// A photo when there is one; otherwise a calm neutral tile with the
// recipe's emoji; with neither, nothing.
export function RecipeHero({ imageUrl, icon }: { imageUrl: string | null; icon: string | null }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (imageUrl && broken !== imageUrl)
    return (
      <div className="-mx-4 overflow-hidden bg-surface-2 lg:mx-0 lg:rounded-card">
        <img
          src={imageUrl}
          alt=""
          onError={() => setBroken(imageUrl)}
          className="block aspect-[4/3] w-full object-cover lg:aspect-[16/9]"
        />
      </div>
    );
  if (icon)
    return (
      <div aria-hidden="true" className="grid h-40 place-items-center rounded-card bg-surface-2 text-[5.5rem] leading-none">
        {icon}
      </div>
    );
  return null;
}

export function MethodSection({ steps, organizing }: { steps: RecipeStep[]; organizing: boolean }) {
  return (
    <section aria-labelledby="method-title" className="grid gap-3">
      <h2 id="method-title" className="m-0 font-body text-2xl font-bold">
        Method
      </h2>
      {organizing && (
        <p className="m-0 flex items-center gap-2 text-sm font-semibold text-muted" role="status">
          <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> Tidying up the steps…
        </p>
      )}
      {steps.length === 0 ? (
        <p className="m-0 text-muted">No steps written down.</p>
      ) : (
        <ol className="m-0 grid list-none gap-6 p-0">
          {steps.map((s, n) => (
            <li key={n} className="grid gap-2">
              <h3 className="m-0 font-body text-xl font-bold leading-snug">{stepLabel(s, n)}</h3>
              {stepParagraphs(s).map((p, k) => (
                <p key={k} className="m-0 text-[1.0625rem] leading-[1.7]">
                  <TechniqueText text={p} />
                </p>
              ))}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// Nutrition is the nutrition feature's own card (heading included); this
// page only mounts it.
export function NutritionSlot({ recipeId }: { recipeId: string }) {
  return <RecipeNutrition recipeId={recipeId} />;
}

export function MoreSection({ tags, notes }: { tags: string[]; notes: string | null }) {
  if (!tags.length && !notes) return null;
  return (
    <section aria-labelledby="more-title" className="grid gap-3">
      <h2 id="more-title" className="m-0 font-body text-2xl font-bold">
        More
      </h2>
      {tags.length > 0 && (
        <div className="grid gap-1">
          <h3 className="m-0 font-body text-base font-bold text-muted">Tags</h3>
          <ul className="m-0 flex list-none flex-wrap gap-x-2 p-0" aria-label="Tags">
            {tags.map((t) => (
              <li key={t}>
                <TagLink tag={t} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {notes && (
        <div className="rounded-card border border-border bg-surface p-4">
          <h3 className="m-0 mb-1.5 font-body text-base font-bold">Our notes</h3>
          <p className="m-0 whitespace-pre-line leading-relaxed text-muted">{notes}</p>
        </div>
      )}
    </section>
  );
}
