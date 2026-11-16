import { ChevronRight, Clock, Link2, Plus, Search, Users } from "lucide-react";
import { useDeferredValue } from "react";
import { Link, useSearchParams } from "react-router-dom";

import type { RecipeSummary } from "../../../shared/schema";
import { Card, Chip, LinkButton, PageHeader, StateMessage } from "../components/ui";
import { cx } from "../lib/cx";
import { formatMinutes, totalMinutes } from "../lib/recipeForm";
import { useRecipes } from "../lib/queries";

import { MEAL_TAGS, tagLabel } from "../../../shared/normalize";

const MEAL_FILTERS = MEAL_TAGS;

export function RecipesPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const tag = params.get("tag") ?? undefined;
  const deferredQ = useDeferredValue(q);
  const recipes = useRecipes({ q: deferredQ.trim() || undefined, tag });

  const update = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Recipes"
        action={
          <div className="flex gap-2">
            <LinkButton to="/recipes/import" variant="secondary" aria-label="Import from link" className="px-3">
              <Link2 size={20} aria-hidden="true" />
              <span>Import</span>
            </LinkButton>
            <LinkButton to="/recipes/new" aria-label="New recipe" className="px-3">
              <Plus size={20} aria-hidden="true" />
              <span>New</span>
            </LinkButton>
          </div>
        }
      />
      <div className="grid gap-3 px-4">
        <div className="relative">
          <label htmlFor="recipe-search" className="sr-only">
            Search recipes
          </label>
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            id="recipe-search"
            type="search"
            placeholder="Search recipes"
            value={q}
            onChange={(e) => update("q", e.target.value)}
            className="block min-h-11 w-full rounded-full border border-border bg-surface py-2 pl-10 pr-4 text-base text-text placeholder:text-muted"
          />
        </div>

        <div role="group" aria-label="Filter by meal" className="flex flex-wrap gap-2">
          {[undefined, ...MEAL_FILTERS].map((t) => {
            const active = tag === t;
            return (
              <button
                key={t ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => update("tag", t)}
                className={cx(
                  "pressable min-h-11 rounded-full px-4 text-sm font-bold",
                  active ? "bg-primary text-on-primary" : "bg-surface-2 text-text",
                )}
              >
                {t ? tagLabel(t) : "All"}
              </button>
            );
          })}
        </div>

        <RecipeList state={recipes} filtered={!!(q || tag)} />
      </div>
    </>
  );
}

function RecipeList({ state, filtered }: { state: ReturnType<typeof useRecipes>; filtered: boolean }) {
  if (state.isPending) return <StateMessage title="Loading recipes…" />;
  if (state.isError) return <StateMessage title="Couldn't load recipes">{state.error.message}</StateMessage>;
  if (state.data.length === 0)
    return (
      <StateMessage title={filtered ? "No matches" : "No recipes yet"}>
        {filtered ? "Try another search or filter." : "Add your first one with New."}
      </StateMessage>
    );
  return (
    <ul className="m-0 grid list-none gap-3 p-0" aria-label="Recipes">
      {state.data.map((r) => (
        <li key={r.id}>
          <RecipeRow recipe={r} />
        </li>
      ))}
    </ul>
  );
}

export function RecipeRow({ recipe }: { recipe: RecipeSummary }) {
  const time = formatMinutes(totalMinutes(recipe));
  return (
    <Card className="overflow-hidden">
      <Link to={`/recipes/${recipe.id}`} className="pressable flex min-h-16 items-center gap-3 p-3 text-text no-underline">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-sm bg-surface-2 text-2xl">
          {recipe.icon ?? recipe.title.charAt(0).toUpperCase()}
        </span>
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="truncate font-display text-lg font-semibold">{recipe.title}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {time && (
              <span className="inline-flex items-center gap-1">
                <Clock size={14} aria-hidden="true" />
                {time}
              </span>
            )}
            {recipe.servings && (
              <span className="inline-flex items-center gap-1">
                <Users size={14} aria-hidden="true" />
                {recipe.servings}
              </span>
            )}
            <span>
              {recipe.ingredientCount} {recipe.ingredientCount === 1 ? "ingredient" : "ingredients"}
            </span>
          </span>
          {recipe.tags.length > 0 && (
            <span className="flex flex-wrap gap-1.5">
              {recipe.tags.map((t) => (
                <Chip key={t} className="py-0.5 text-xs">
                  {tagLabel(t)}
                </Chip>
              ))}
            </span>
          )}
        </span>
        <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-muted" />
      </Link>
    </Card>
  );
}
