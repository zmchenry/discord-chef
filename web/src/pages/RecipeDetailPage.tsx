import { ArrowLeft, CalendarPlus, Check, Clock, ExternalLink, Mic, Pencil, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { tagLabel } from "../../../shared/normalize";
import { OverflowMenu, type MenuItem } from "../components/OverflowMenu";
import { Button, Card, Chip, LinkButton, StateMessage } from "../components/ui";
import { AddToWeekSheet } from "../features/planning/AddToWeekSheet";
import { IngredientStorePin } from "../features/shopping/StorePin";
import { formatMinutes, totalMinutes } from "../lib/recipeForm";
import { useArchiveRecipe, useRecipe } from "../lib/queries";

export function RecipeDetailPage() {
  const { id } = useParams();
  const recipe = useRecipe(id);
  const archive = useArchiveRecipe();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<{ where: string; weekId: string } | null>(null);

  if (recipe.isPending) return <StateMessage title="Loading…" />;
  if (recipe.isError)
    return (
      <StateMessage title="Couldn't load this recipe">
        <p className="m-0">{recipe.error.message}</p>
        <Link to="/recipes" className="inline-flex min-h-11 items-center font-semibold text-primary">
          Back to recipes
        </Link>
      </StateMessage>
    );

  const r = recipe.data;
  const onArchive = () => {
    if (!window.confirm(`Delete "${r.title}"? It will disappear from your recipes.`)) return;
    archive.mutate(r.id, { onSuccess: () => navigate("/recipes", { replace: true }) });
  };
  const live = !r.archivedAt;
  const noIngredients = r.ingredients.length === 0;
  const speak = `/recipes/speak?recipe=${r.id}`;

  // One primary action: fill in a bare recipe by voice, otherwise put it on
  // the week. Everything else is behind the more-actions button.
  const menu: MenuItem[] = [];
  if (live) menu.push({ label: "Edit", icon: Pencil, onSelect: () => navigate(`/recipes/${r.id}/edit`) });
  if (live && noIngredients) menu.push({ label: "Add to this week", icon: CalendarPlus, onSelect: () => setAdding(true) });
  if (live && !noIngredients) menu.push({ label: "Fill in by voice", icon: Mic, onSelect: () => navigate(speak) });
  if (r.sourceUrl) {
    const url = r.sourceUrl;
    menu.push({ label: "Open the original", icon: ExternalLink, onSelect: () => window.open(url, "_blank", "noopener,noreferrer") });
  }
  if (live) menu.push({ label: "Delete", icon: Trash2, destructive: true, onSelect: onArchive, disabled: archive.isPending });

  return (
    <article className="grid gap-4 px-4 pt-3">
      <div className="flex items-center justify-between gap-2">
        <LinkButton to="/recipes" variant="ghost" aria-label="Back to recipes" className="-ml-3 px-3">
          <ArrowLeft size={20} aria-hidden="true" />
          <span>Recipes</span>
        </LinkButton>
        {menu.length > 0 && <OverflowMenu items={menu} title={r.title} />}
      </div>
      <header className="grid gap-2">
        <h1 className="m-0 break-words text-3xl">
          {r.icon && <span aria-hidden="true">{r.icon} </span>}
          {r.title}
        </h1>
        {r.archivedAt && <p className="m-0 font-semibold text-danger">Archived</p>}
        {r.description && <p className="m-0 text-muted">{r.description}</p>}
        <div className="flex flex-wrap gap-2">
          {r.prepMinutes !== null && (
            <Chip>
              <Clock size={15} aria-hidden="true" /> Prep {formatMinutes(r.prepMinutes) ?? "0 min"}
            </Chip>
          )}
          {r.cookMinutes !== null && (
            <Chip>
              <Clock size={15} aria-hidden="true" /> Cook {formatMinutes(r.cookMinutes) ?? "0 min"}
            </Chip>
          )}
          {r.servings !== null && (
            <Chip>
              <Users size={15} aria-hidden="true" /> Serves {r.servings}
            </Chip>
          )}
          {r.tags.map((t) => (
            <Chip key={t} className="bg-accent-soft text-accent">
              {tagLabel(t)}
            </Chip>
          ))}
        </div>
        {live &&
          (noIngredients ? (
            <LinkButton to={speak} className="mt-1 justify-self-start">
              <Mic size={20} aria-hidden="true" />
              Add ingredients by voice
            </LinkButton>
          ) : (
            <Button className="mt-1 justify-self-start" onClick={() => setAdding(true)}>
              <CalendarPlus size={20} aria-hidden="true" />
              Add to this week
            </Button>
          ))}
        {added && (
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-sm font-semibold text-accent" role="status">
            <Check size={16} aria-hidden="true" /> Added to {added.where}.
            <Link to={`/week?week=${added.weekId}`} className="inline-flex min-h-11 items-center text-primary">
              See the week
            </Link>
          </p>
        )}
      </header>

      <Card className="p-4">
        <h2 className="m-0 mb-2 text-xl">Ingredients</h2>
        {r.ingredients.length === 0 ? (
          <p className="m-0 text-muted">No ingredients yet.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {r.ingredients.map((i) => (
              <li key={i.id} className="flex items-center gap-2 border-b border-border py-2 last:border-b-0">
                <span className="min-w-0 flex-1">
                  {i.rawText}
                  {i.optional && <span className="text-muted"> (optional)</span>}
                </span>
                {i.ingredientId !== null && (
                  <IngredientStorePin ingredientId={i.ingredientId} name={i.ingredientName ?? i.rawText} editable={live} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="m-0 mb-2 text-xl">Steps</h2>
        {r.instructions.length === 0 ? (
          <p className="m-0 text-muted">No steps written down.</p>
        ) : (
          <ol className="m-0 grid gap-3 pl-6">
            {r.instructions.map((step, n) => (
              <li key={n} className="pl-1">
                {step}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {adding && (
        <AddToWeekSheet
          recipe={{ id: r.id, title: r.title, icon: r.icon, totalMinutes: totalMinutes(r) }}
          onClose={() => setAdding(false)}
          onAdded={(where, weekId) => {
            setAdding(false);
            setAdded({ where, weekId });
          }}
        />
      )}
    </article>
  );
}
