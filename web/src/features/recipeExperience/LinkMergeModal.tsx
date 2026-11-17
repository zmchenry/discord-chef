import { useMutation } from "@tanstack/react-query";
import { Link2, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Recipe } from "../../../../shared/schema";
import { Modal } from "../../components/Modal";
import { TextField } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { useSaveRecipe } from "../../lib/queries";
import { importFromUrl } from "../linkImport/api";
import { describeMerge, hasChanges, mergeLinkImport } from "./merge";

const isHttpUrl = (s: string) => {
  try {
    return /^https?:$/.test(new URL(s).protocol);
  } catch {
    return false;
  }
};

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

// Read a recipe page (POST /api/import/url) and merge it into an existing
// recipe, after a confirm that says what will change. With `autoStart` it
// reads `initialUrl` straight away (re-import); otherwise it asks for a link.
export function LinkMergeModal({
  recipe,
  initialUrl = "",
  autoStart = false,
  onClose,
  onSaved,
}: {
  recipe: Recipe;
  initialUrl?: string;
  autoStart?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [fieldError, setFieldError] = useState<string>();
  const read = useMutation({
    mutationFn: (link: string) =>
      importFromUrl(link).then((res) => ({ ...res, url: link, merge: mergeLinkImport(recipe, res.draft, link) })),
  });
  const save = useSaveRecipe(recipe.id);

  const start = (link: string) => {
    const trimmed = link.trim();
    if (!isHttpUrl(trimmed)) {
      setFieldError("Enter a full link starting with https://");
      return;
    }
    setFieldError(undefined);
    return read.mutateAsync(trimmed).then(
      () => undefined,
      () => undefined,
    );
  };

  const started = useRef(false);
  useEffect(() => {
    if (autoStart && initialUrl && !started.current) {
      started.current = true;
      void start(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = { label: "Cancel", onClick: onClose };
  const errorText =
    read.error instanceof ApiError && read.error.status === 422
      ? "Couldn't find a recipe on that page."
      : read.error
        ? `Couldn't read it: ${read.error.message}`
        : null;

  // Reviewing what the page adds.
  if (read.data) {
    const { merge, warnings, url: link } = read.data;
    const s = merge.summary;
    const changes = hasChanges(s);
    return (
      <Modal
        open
        onClose={onClose}
        title={changes ? `Update “${recipe.title}”?` : "Already up to date"}
        description={describeMerge(s)}
        secondary={cancel}
        primary={{
          label: "Save changes",
          icon: RefreshCw,
          disabled: !changes,
          onClick: () =>
            save.mutateAsync(merge.input).then(
              () => {
                onSaved?.();
                onClose();
              },
              () => undefined,
            ),
        }}
      >
        <div className="grid gap-4">
          <p className="m-0 text-sm text-muted">From {host(link)}. The title, tags and notes stay as they are.</p>
          {s.stepsChanged && (
            <Section title="Steps">
              <p className="m-0">
                {s.stepsBefore === 0
                  ? `${s.stepsAfter} steps from the page.`
                  : `Your ${s.stepsBefore} step${s.stepsBefore === 1 ? "" : "s"} are replaced by the page's ${s.stepsAfter}.`}
              </p>
            </Section>
          )}
          {s.addedIngredients.length > 0 && <ListSection title="New ingredients" items={s.addedIngredients} />}
          {s.filledAmounts.length > 0 && <ListSection title="Amounts filled in" items={s.filledAmounts} />}
          {warnings.length > 0 && (
            <ul className="m-0 grid gap-1 pl-5 text-sm text-muted">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {save.isError && (
            <p role="alert" className="m-0 text-sm font-semibold text-danger">
              Couldn't save: {save.error.message}
            </p>
          )}
        </div>
      </Modal>
    );
  }

  // Reading the page that was already known.
  if (autoStart && (read.isPending || read.isIdle)) {
    return (
      <Modal open onClose={onClose} title="Re-import from link" description={`Reading ${host(initialUrl)}…`} secondary={cancel}>
        <p role="status" className="m-0 flex items-center gap-2 text-muted">
          <LoaderCircle size={20} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          This can take a few seconds.
        </p>
      </Modal>
    );
  }

  // Asking for a link (or showing why reading it failed).
  return (
    <Modal
      open
      onClose={onClose}
      title={autoStart ? "Re-import from link" : "Import from a link"}
      description="Steps, missing ingredients and times come from the page. You'll see what changes before anything is saved."
      secondary={cancel}
      primary={{ label: read.isError ? "Try again" : "Read the page", icon: Link2, onClick: () => start(url) }}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void start(url);
        }}
        className="grid gap-3"
      >
        <TextField
          label="Recipe link"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://"
          value={url}
          error={fieldError}
          disabled={read.isPending}
          onChange={(e) => setUrl(e.target.value)}
        />
        {errorText && (
          <p role="alert" className="m-0 text-sm font-semibold text-danger">
            {errorText}
          </p>
        )}
      </form>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1">
      <h3 className="m-0 font-body text-base font-bold">{title}</h3>
      {children}
    </section>
  );
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <Section title={title}>
      <ul className="m-0 grid list-none gap-0 divide-y divide-border rounded-sm border border-border p-0">
        {items.map((t, n) => (
          <li key={n} className="px-3 py-2">
            {t}
          </li>
        ))}
      </ul>
    </Section>
  );
}
