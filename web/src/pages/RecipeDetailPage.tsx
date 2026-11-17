import { ArrowLeft, CalendarPlus, Check, ChefHat, Clock, ExternalLink, Mic, Pencil, Sparkles, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { parseSteps } from "../../../shared/recipeStructure";
import { Modal } from "../components/Modal";
import { OverflowMenu, type MenuItem } from "../components/OverflowMenu";
import { Button, LinkButton, StateMessage } from "../components/ui";
import { AddToWeekSheet } from "../features/planning/AddToWeekSheet";
import { IngredientsSection } from "../features/recipePresentation/IngredientsSection";
import { MethodSection, MoreSection, NutritionSlot, RecipeHero } from "../features/recipePresentation/RecipeSections";
import { TidyUpModal } from "../features/recipePresentation/TidyUpModal";
import { useOrganizing } from "../features/recipePresentation/queries";
import { formatMinutes, totalMinutes } from "../lib/recipeForm";
import { useArchiveRecipe, useRecipe } from "../lib/queries";

export function RecipeDetailPage() {
  const { id } = useParams();
  const recipe = useRecipe(id);
  const archive = useArchiveRecipe();
  const navigate = useNavigate();
  const organizing = useOrganizing(id ?? "");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tidying, setTidying] = useState(false);
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
  const onArchive = () => archive.mutate(r.id, { onSuccess: () => navigate("/recipes", { replace: true }) });
  const live = !r.archivedAt;
  const noIngredients = r.ingredients.length === 0;
  const steps = parseSteps(r.instructions);
  const canCook = live && !noIngredients && steps.length > 0;
  const speak = `/recipes/speak?recipe=${r.id}`;
  const total = formatMinutes(totalMinutes(r));
  const split = r.prepMinutes && r.cookMinutes ? `prep ${formatMinutes(r.prepMinutes)}, cook ${formatMinutes(r.cookMinutes)}` : null;

  // One primary action: fill in a bare recipe by voice, cook it when it has
  // steps, otherwise put it on the week. Everything else is behind the
  // more-actions button.
  const menu: MenuItem[] = [];
  if (live) menu.push({ label: "Edit", icon: Pencil, onSelect: () => navigate(`/recipes/${r.id}/edit`) });
  if (live && (noIngredients || canCook)) menu.push({ label: "Add to this week", icon: CalendarPlus, onSelect: () => setAdding(true) });
  if (live && !noIngredients) menu.push({ label: "Fill in by voice", icon: Mic, onSelect: () => navigate(speak) });
  if (live && (!noIngredients || steps.length > 0))
    menu.push({ label: "Tidy up with AI", icon: Sparkles, onSelect: () => setTidying(true), disabled: organizing });
  if (r.sourceUrl) {
    const url = r.sourceUrl;
    menu.push({ label: "Open the original", icon: ExternalLink, onSelect: () => window.open(url, "_blank", "noopener,noreferrer") });
  }
  if (live) menu.push({ label: "Delete", icon: Trash2, destructive: true, onSelect: () => setDeleting(true), disabled: archive.isPending });

  return (
    <article className="grid gap-8 px-4 pb-6 pt-3">
      <div className="grid gap-4">
        <div className="flex items-center justify-between gap-2">
          <LinkButton to="/recipes" variant="ghost" aria-label="Back to recipes" className="-ml-3 px-3">
            <ArrowLeft size={20} aria-hidden="true" />
            <span>Recipes</span>
          </LinkButton>
          {menu.length > 0 && <OverflowMenu items={menu} title={r.title} />}
        </div>

        <RecipeHero imageUrl={r.imageUrl} icon={r.icon} />

        <header className="grid gap-3">
          <div className="grid gap-1.5">
            <h1 className="m-0 break-words font-body text-[2rem] font-bold leading-[1.15] tracking-tight">{r.title}</h1>
            {r.archivedAt && <p className="m-0 font-semibold text-danger">Archived</p>}
            {r.description && <p className="m-0 text-lg leading-snug text-muted">{r.description}</p>}
          </div>
          {(r.servings !== null || total) && (
            <ul className="m-0 grid list-none gap-1.5 p-0 text-[1.0625rem]">
              {r.servings !== null && (
                <li className="flex items-center gap-2.5">
                  <Users size={20} aria-hidden="true" className="shrink-0 text-muted" />
                  Serves {r.servings}
                </li>
              )}
              {total && (
                <li className="flex items-center gap-2.5">
                  <Clock size={20} aria-hidden="true" className="shrink-0 text-muted" />
                  <span>
                    {total}
                    {split && <span className="text-muted"> · {split}</span>}
                  </span>
                </li>
              )}
            </ul>
          )}
          {live &&
            (noIngredients ? (
              <LinkButton to={speak} className="mt-1 min-h-12 w-full text-lg">
                <Mic size={20} aria-hidden="true" />
                Add ingredients by voice
              </LinkButton>
            ) : canCook ? (
              <LinkButton to={`/recipes/${r.id}/cook`} className="mt-1 min-h-12 w-full text-lg">
                <ChefHat size={22} aria-hidden="true" />
                Let’s cook
              </LinkButton>
            ) : (
              <Button className="mt-1 min-h-12 w-full text-lg" onClick={() => setAdding(true)}>
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
      </div>

      <IngredientsSection ingredients={r.ingredients} live={live} />
      <NutritionSlot recipeId={r.id} />
      <MethodSection steps={steps} organizing={organizing} />
      <MoreSection tags={r.tags} notes={r.notes} />

      <Modal
        open={deleting}
        size="sm"
        onClose={() => setDeleting(false)}
        title={`Delete “${r.title}”?`}
        description="It will disappear from your recipes."
        primary={{ label: "Delete", icon: Trash2, destructive: true, busy: archive.isPending, onClick: onArchive }}
        secondary={{ label: "Cancel", onClick: () => setDeleting(false), disabled: archive.isPending }}
      >
        {archive.isError && <p className="m-0 text-sm font-semibold text-danger">{archive.error.message}</p>}
      </Modal>

      <TidyUpModal recipe={r} open={tidying} onClose={() => setTidying(false)} />

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
