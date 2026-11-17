import { ArrowLeft, Link2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button, LinkButton, StateMessage, TextField } from "../../components/ui";
import { useRecipe } from "../../lib/queries";
import { ImportPage } from "../linkImport/ImportPage";
import { sharedUrl } from "../linkImport/draft";
import { LinkMergeModal } from "./LinkMergeModal";

// /recipes/import: the link import page, or with ?recipe=<id>, a link
// imported into that recipe (merged after a confirm, not a new recipe).
export function LinkImportRoute() {
  const [params] = useSearchParams();
  const recipeId = params.get("recipe");
  return recipeId ? <ImportIntoRecipe recipeId={recipeId} shared={sharedUrl(params)} /> : <ImportPage />;
}

function ImportIntoRecipe({ recipeId, shared }: { recipeId: string; shared: string }) {
  const recipe = useRecipe(recipeId);
  const navigate = useNavigate();
  const [typed, setUrl] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const back = `/recipes/${recipeId}`;

  if (recipe.isPending) return <StateMessage title="Loading…" />;
  if (recipe.isError) return <StateMessage title="Couldn't load this recipe">{recipe.error.message}</StateMessage>;
  const r = recipe.data;
  const url = typed ?? (shared || r.sourceUrl || "");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) setReading(url.trim());
  };

  return (
    <>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 px-4 pt-3">
        <div className="flex items-center gap-2">
          <LinkButton to={back} variant="ghost" aria-label="Back to the recipe" className="-ml-3 px-3">
            <ArrowLeft size={20} aria-hidden="true" />
          </LinkButton>
          <div className="min-w-0">
            <h1 className="m-0 text-2xl">Import from link</h1>
            <p className="m-0 truncate text-muted">into {r.title}</p>
          </div>
        </div>
        <p className="m-0 text-muted">
          Steps, missing ingredients and times come from the page. The title and tags stay. You'll see what changes before it's
          saved.
        </p>
        <TextField
          label="Recipe link"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button type="submit" disabled={!url.trim()}>
          <Link2 size={20} aria-hidden="true" />
          Read the page
        </Button>
      </form>
      {reading && (
        <LinkMergeModal
          key={reading}
          recipe={r}
          initialUrl={reading}
          autoStart
          onClose={() => setReading(null)}
          onSaved={() => navigate(back, { replace: true })}
        />
      )}
    </>
  );
}
