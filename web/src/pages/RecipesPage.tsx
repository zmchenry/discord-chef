import { Keyboard, Lightbulb, Link2, Mic, Plus, Search } from "lucide-react";
import { useDeferredValue } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ActionMenu, OverflowMenu } from "../components/OverflowMenu";
import { PageHeader, StateMessage } from "../components/ui";
import { RecipeCard } from "../features/recipePresentation/RecipeCard";
import { cx } from "../lib/cx";
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
          <div className="flex items-center gap-1">
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
            <OverflowMenu
              items={[{ label: "Ideas", hint: "New recipes from the web", icon: Lightbulb, onSelect: () => navigate("/recipes/ideas") }]}
            />
          </div>
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
          <RecipeCard recipe={r} />
        </li>
      ))}
    </ul>
  );
}
