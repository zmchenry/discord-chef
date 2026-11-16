import { ChevronRight, Clock, Keyboard, Link2, Mic, Plus, Search, Users } from "lucide-react";
import { useDeferredValue } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import type { RecipeSummary } from "../../../shared/schema";
import { ActionMenu } from "../components/OverflowMenu";
import { Card, Chip, PageHeader, StateMessage } from "../components/ui";
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
  const navigate = useNavigate();

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
          <ActionMenu
            label="Add recipe"
            trigger={
              <>
                <Plus size={20} aria-hidden="true" />
                Add recipe
              </>
            }
            triggerClassName="pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary pl-3 pr-4 font-semibold text-on-primary"
            items={[
              { label: "Say it", hint: "Talk it through, or paste text", icon: Mic, onSelect: () => navigate("/recipes/speak") },
              { label: "Paste a link", hint: "Import from a recipe page", icon: Link2, onSelect: () => navigate("/recipes/import") },
              { label: "Type it", hint: "Fill in the form yourself", icon: Keyboard, onSelect: () => navigate("/recipes/new") },
            ]}
          />
        }
      />
      <div className="grid gap-3 px-4">
        <div className="relative lg:max-w-md">
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

        {/* One line: tighter chips fit on a phone; narrower screens scroll sideways. */}
        <div
          role="group"
          aria-label="Filter by meal"
          className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {[undefined, ...MEAL_FILTERS].map((t) => {
            const active = tag === t;
            return (
              <button
                key={t ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => update("tag", t)}
                className={cx(
                  "pressable min-h-11 min-w-11 shrink-0 whitespace-nowrap rounded-full px-3 text-sm font-bold",
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
    <ul className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2 xl:grid-cols-3" aria-label="Recipes">
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
    <Card className="h-full overflow-hidden">
      <Link to={`/recipes/${recipe.id}`} className="pressable flex h-full min-h-16 items-center gap-3 p-3 text-text no-underline">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-sm bg-surface-2 text-2xl">
          {recipe.icon ?? recipe.title.charAt(0).toUpperCase()}
        </span>
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="line-clamp-2 font-display text-lg font-semibold leading-snug">{recipe.title}</span>
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
