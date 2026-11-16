import { ArrowLeft, Clock, ExternalLink, Mic, Pencil, Trash2, Users } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { tagLabel } from "../../../shared/normalize";
import { Button, Card, Chip, LinkButton, StateMessage } from "../components/ui";
import { formatMinutes } from "../lib/recipeForm";
import { useArchiveRecipe, useRecipe } from "../lib/queries";

export function RecipeDetailPage() {
  const { id } = useParams();
  const recipe = useRecipe(id);
  const archive = useArchiveRecipe();
  const navigate = useNavigate();

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
    if (!window.confirm(`Archive "${r.title}"? It will disappear from the list.`)) return;
    archive.mutate(r.id, { onSuccess: () => navigate("/recipes", { replace: true }) });
  };

  return (
    <article className="grid gap-4 px-4 pt-3">
      <div className="flex items-center justify-between gap-2">
        <LinkButton to="/recipes" variant="ghost" aria-label="Back to recipes" className="-ml-3 px-3">
          <ArrowLeft size={20} aria-hidden="true" />
          <span>Recipes</span>
        </LinkButton>
        <LinkButton to={`/recipes/${r.id}/edit`} variant="secondary">
          <Pencil size={18} aria-hidden="true" />
          Edit
        </LinkButton>
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
      </header>

      <Card className="p-4">
        <h2 className="m-0 mb-2 text-xl">Ingredients</h2>
        {r.ingredients.length === 0 ? (
          <div className="grid gap-3">
            <p className="m-0 text-muted">No ingredients yet.</p>
            {!r.archivedAt && (
              <LinkButton to={`/recipes/speak?recipe=${r.id}`} className="min-h-14 px-3">
                <Mic size={22} aria-hidden="true" />
                Add ingredients and steps by voice
              </LinkButton>
            )}
          </div>
        ) : (
          <ul className="m-0 list-none p-0">
            {r.ingredients.map((i) => (
              <li key={i.id} className="border-b border-border py-2 last:border-b-0">
                {i.rawText}
                {i.optional && <span className="text-muted"> (optional)</span>}
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

      {r.ingredients.length > 0 && !r.archivedAt && (
        <Link
          to={`/recipes/speak?recipe=${r.id}`}
          className="inline-flex min-h-11 items-center gap-2 justify-self-start font-semibold text-primary"
        >
          <Mic size={18} aria-hidden="true" />
          Add more by voice
        </Link>
      )}

      {r.sourceUrl && (
        <a
          href={r.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-11 items-center gap-2 break-all font-semibold text-primary"
        >
          <ExternalLink size={18} aria-hidden="true" className="shrink-0" />
          Original recipe
        </a>
      )}

      {!r.archivedAt && (
        <Button variant="danger" onClick={onArchive} disabled={archive.isPending} className="justify-self-start">
          <Trash2 size={18} aria-hidden="true" />
          Archive
        </Button>
      )}
    </article>
  );
}
