import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Link2, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button, Card, LinkButton, TextField } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { importFromUrl } from "./api";
import { sharedUrl, type ImportedDraft } from "./draft";

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// /recipes/import, also the PWA share target (?url= or ?text=). On success it
// opens the normal new-recipe form, prefilled, for a check before saving.
export function ImportPage() {
  const [params] = useSearchParams();
  const shared = sharedUrl(params);
  const [url, setUrl] = useState(shared);
  const [fieldError, setFieldError] = useState<string>();
  const navigate = useNavigate();

  const run = useMutation({
    mutationFn: (link: string) => importFromUrl(link),
    onSuccess: (imported: ImportedDraft) => navigate("/recipes/new", { replace: true, state: { imported } }),
  });

  const start = (link: string) => {
    const trimmed = link.trim();
    if (!isHttpUrl(trimmed)) {
      setFieldError("Enter a full link starting with https://");
      return;
    }
    setFieldError(undefined);
    run.mutate(trimmed);
  };

  // A shared link starts straight away (once, even under StrictMode).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (shared && !autoStarted.current) {
      autoStarted.current = true;
      start(shared);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    start(url);
  };

  const errorText =
    run.error instanceof ApiError && run.error.status === 422
      ? "Couldn't find a recipe on that page."
      : run.error
        ? `Couldn't import it: ${run.error.message}`
        : null;

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 px-4 pt-3" aria-labelledby="import-title" aria-busy={run.isPending}>
      <div className="flex items-center gap-2">
        <LinkButton to="/recipes" variant="ghost" aria-label="Back to recipes" className="-ml-3 px-3">
          <ArrowLeft size={20} aria-hidden="true" />
        </LinkButton>
        <h1 id="import-title" className="m-0 text-2xl">
          Import from link
        </h1>
      </div>

      <p className="m-0 text-muted">Paste a link to a recipe page. You'll get to check everything before it's saved.</p>

      <TextField
        label="Recipe link"
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder="https://"
        value={url}
        error={fieldError}
        disabled={run.isPending}
        onChange={(e) => setUrl(e.target.value)}
      />

      <Button type="submit" disabled={run.isPending}>
        {run.isPending ? (
          <>
            <LoaderCircle size={20} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            Reading the page…
          </>
        ) : (
          <>
            <Link2 size={20} aria-hidden="true" />
            Import recipe
          </>
        )}
      </Button>

      <p role="status" className="m-0 min-h-6 text-sm text-muted">
        {run.isPending ? "This can take a few seconds." : ""}
      </p>

      {errorText && (
        <Card className="grid gap-1 p-4" role="alert">
          <p className="m-0 font-semibold text-danger">{errorText}</p>
          <Link to="/recipes/new" className="inline-flex min-h-11 items-center font-semibold text-primary">
            Add it by hand instead
          </Link>
        </Card>
      )}

      <p className="m-0 text-sm text-muted">Tip: on Android, share a page from Chrome to Chef to land here with the link filled in.</p>
    </form>
  );
}
