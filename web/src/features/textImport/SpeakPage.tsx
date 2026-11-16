import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, LoaderCircle, Mic, Square, Wand2 } from "lucide-react";
import { useId, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button, Card, LinkButton } from "../../components/ui";
import { cx } from "../../lib/cx";
import { useRecipe } from "../../lib/queries";
import type { ImportedDraft } from "../linkImport/draft";
import { importFromText } from "./api";
import { useDictation } from "./dictation";

// The text survives a trip to the preview and back (per tab only).
const storageKey = (recipeId: string | undefined) => `chef.speak.${recipeId ?? "new"}`;
function loadText(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function saveText(key: string, text: string) {
  try {
    if (text) sessionStorage.setItem(key, text);
    else sessionStorage.removeItem(key);
  } catch {
    // Private mode or blocked storage: the text just isn't remembered.
  }
}

// /recipes/speak and /recipes/speak?recipe=<id>: dictate or type a recipe,
// then preview it in the normal recipe form before saving.
export function SpeakPage() {
  const [params] = useSearchParams();
  const recipeId = params.get("recipe") ?? undefined;
  const recipe = useRecipe(recipeId);
  const key = storageKey(recipeId);
  const [text, setTextState] = useState(() => loadText(key));
  const setText = (t: string) => {
    setTextState(t);
    saveText(key, t);
  };
  const mic = useDictation(text, setText);
  const navigate = useNavigate();
  const fieldId = useId();

  const preview = useMutation({
    mutationFn: () => importFromText(text.trim(), recipeId),
    onSuccess: (res) => {
      const imported: ImportedDraft = { ...res, via: "text" };
      navigate(recipeId ? `/recipes/${recipeId}/edit` : "/recipes/new", { state: { imported } });
    },
  });

  const onPreview = () => {
    if (mic.listening) mic.stop();
    if (text.trim()) preview.mutate();
  };

  const backTo = recipeId ? `/recipes/${recipeId}` : "/recipes";
  const title = recipeId ? "Add by voice" : "Add by voice or text";
  const example = recipeId
    ? "Ingredients: 1 lb ground beef, chili crisp, 2 cups rice. Steps: Brown the beef. Stir in the chili crisp…"
    : "Beef chili crisp. Ingredients: 1 lb ground beef, chili crisp… Steps: Brown the beef…";

  return (
    <div className="grid gap-4 px-4 pt-3" aria-busy={preview.isPending}>
      <div className="flex items-center gap-2">
        <LinkButton to={backTo} variant="ghost" aria-label="Back" className="-ml-3 px-3">
          <ArrowLeft size={20} aria-hidden="true" />
        </LinkButton>
        <div className="min-w-0">
          <h1 className="m-0 text-2xl">{title}</h1>
          {recipeId && recipe.data && <p className="m-0 truncate text-muted">for {recipe.data.title}</p>}
        </div>
      </div>

      <Card className="grid gap-1 bg-surface-2 p-4 shadow-none">
        <p className="m-0 text-sm font-semibold text-muted">Say it like this</p>
        <p className="m-0 font-display text-lg leading-snug">“{example}”</p>
      </Card>

      <div className="grid gap-1">
        <label htmlFor={fieldId} className="text-sm font-semibold">
          {recipeId ? "Ingredients and steps" : "Your recipe"}
        </label>
        <textarea
          id={fieldId}
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mic.supported ? "Tap the mic and start talking, or type here." : "Type or dictate here."}
          className={cx(
            "block min-h-48 w-full rounded-sm border bg-surface px-3 py-3 text-lg leading-relaxed text-text placeholder:text-muted",
            mic.listening ? "border-primary shadow-[0_0_0_2px_var(--color-primary)]" : "border-border",
          )}
        />
      </div>

      {mic.supported ? (
        <div className="grid justify-items-center gap-2">
          <button
            type="button"
            onClick={mic.listening ? mic.stop : mic.start}
            aria-pressed={mic.listening}
            aria-label={mic.listening ? "Stop listening" : "Start listening"}
            className={cx(
              "pressable relative grid size-20 place-items-center rounded-full shadow-card",
              mic.listening ? "bg-danger text-on-primary" : "bg-primary text-on-primary",
            )}
          >
            {mic.listening && (
              <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-danger opacity-30 motion-reduce:animate-none" />
            )}
            {mic.listening ? <Square size={28} fill="currentColor" aria-hidden="true" /> : <Mic size={34} aria-hidden="true" />}
          </button>
          <p role="status" className={cx("m-0 min-h-6 text-center font-semibold", mic.listening ? "text-danger" : "text-muted")}>
            {mic.listening ? "Listening… tap to stop" : text ? "Tap to keep talking" : "Tap to talk"}
          </p>
          {mic.error && (
            <p role="alert" className="m-0 text-center text-sm font-semibold text-danger">
              {mic.error}
            </p>
          )}
        </div>
      ) : (
        <p className="m-0 text-muted">Tip: tap the mic on your keyboard to dictate.</p>
      )}

      <div className="flex gap-3">
        <Button onClick={onPreview} disabled={!text.trim() || preview.isPending} className="min-h-12 flex-1 text-lg">
          {preview.isPending ? (
            <>
              <LoaderCircle size={20} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              Reading it…
            </>
          ) : (
            <>
              <Wand2 size={20} aria-hidden="true" />
              Preview
            </>
          )}
        </Button>
        {text && (
          <Button variant="ghost" onClick={() => setText("")} disabled={mic.listening || preview.isPending}>
            Clear
          </Button>
        )}
      </div>

      {preview.isError && (
        <p role="alert" className="m-0 font-semibold text-danger">
          Couldn't read it: {preview.error.message}
        </p>
      )}
      <p className="m-0 pb-4 text-sm text-muted">You'll check everything in the recipe form before it's saved.</p>
    </div>
  );
}
