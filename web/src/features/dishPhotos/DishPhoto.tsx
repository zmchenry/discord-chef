import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, ImagePlus, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import type { MenuItem } from "../../components/OverflowMenu";
import { Button } from "../../components/ui";
import { keys } from "../../lib/queries";
import { downscaleImage } from "../receipts/downscale";
import { dishPhotoApi } from "./api";

// A photo of what was cooked becomes the recipe's picture. Cooking mode asks
// for one on the last step of a recipe with no picture (and queues a push for
// later); the recipe page offers it in the ⋯ menu, and opens straight to the
// prompt from that push (?photo=1).

interface Recipeish {
  id: string;
  title: string;
  imageUrl: string | null;
  archivedAt?: number | null;
}

type Upload = ReturnType<typeof useDishPhotoUpload>;

function useDishPhotoUpload(recipeId: string) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const m = useMutation({
    // Phone photos are several MB; about 1600px is plenty for a recipe picture.
    mutationFn: async (file: File) => dishPhotoApi.upload(recipeId, await downscaleImage(file)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.recipes }),
  });
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) m.mutate(file);
  };
  return {
    open: () => input.current?.click(),
    status: m.status,
    error: m.error,
    savedUrl: m.data?.imageUrl ?? null,
    fileInput: (
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onChange}
      />
    ),
  };
}

function PhotoCard({
  upload,
  text,
  showPhoto = true,
  focus = false,
  extra,
}: {
  upload: Upload;
  text: string;
  showPhoto?: boolean;
  focus?: boolean;
  extra?: ReactNode;
}) {
  const card = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focus) return;
    card.current?.scrollIntoView?.({ block: "center" });
    button.current?.focus({ preventScroll: true });
  }, [focus]);

  if (upload.status === "success")
    return (
      <section ref={card} className="grid gap-3" aria-live="polite">
        {showPhoto && upload.savedUrl && (
          <img src={upload.savedUrl} alt="Your photo of the dish" className="block aspect-[4/3] w-full rounded-card object-cover" />
        )}
        <p className="m-0 flex items-center gap-2 font-semibold text-accent">
          <Check size={20} aria-hidden="true" className="shrink-0" />
          Saved as the recipe photo
        </p>
      </section>
    );

  const busy = upload.status === "pending";
  return (
    <section ref={card} className="grid gap-3 rounded-card bg-surface-2 p-4" aria-live="polite">
      <p className="m-0 flex items-start gap-3 text-lg font-semibold leading-snug">
        <Camera size={24} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
        <span>{text}</span>
      </p>
      {upload.status === "error" && (
        <p className="m-0 text-sm font-semibold text-danger" role="alert">
          {upload.error?.message ?? "Saving the photo failed."} Try again.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button ref={button} variant="secondary" className="min-h-12" disabled={busy} onClick={upload.open}>
          {busy ? (
            <LoaderCircle size={20} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Camera size={20} aria-hidden="true" />
          )}
          {busy ? "Saving…" : "Take a photo"}
        </Button>
        {extra}
      </div>
    </section>
  );
}

// Asks the server, once per cook session, to push "How did it turn out?"
// about 15 minutes after the cook reached the last step.
const REMIND_KEY = (id: string) => `chef.photoReminder.${id}`;
const SESSION_MS = 6 * 3600_000;

function usePhotoReminder(recipeId: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    try {
      const last = Number(sessionStorage.getItem(REMIND_KEY(recipeId)));
      if (last && Date.now() - last < SESSION_MS) return;
      sessionStorage.setItem(REMIND_KEY(recipeId), String(Date.now()));
    } catch {
      // Storage blocked: ask anyway, the server keeps one per recipe.
    }
    dishPhotoApi.remind(recipeId).catch(() => undefined);
  }, [recipeId, enabled]);
}

/** Cooking mode, under the last step: only for a recipe that had no picture. */
export function CookPhotoCard({ recipe }: { recipe: Recipeish }) {
  const [bare] = useState(!recipe.imageUrl);
  const upload = useDishPhotoUpload(recipe.id);
  usePhotoReminder(recipe.id, bare);
  if (!bare) return null;
  return (
    <>
      {upload.fileInput}
      <PhotoCard upload={upload} text="No photo yet. Snap one when it's plated, and it becomes this recipe's picture." />
    </>
  );
}

/** The recipe page: a ⋯ menu item, and the prompt when opened from the push (?photo=1). */
export function useRecipePhoto(recipe: Recipeish | undefined): { menuItem: MenuItem | null; element: ReactNode } {
  const [params, setParams] = useSearchParams();
  const asked = params.get("photo") === "1";
  const upload = useDishPhotoUpload(recipe?.id ?? "");
  if (!recipe || recipe.archivedAt) return { menuItem: null, element: null };

  const dismiss = () => {
    const next = new URLSearchParams(params);
    next.delete("photo");
    setParams(next, { replace: true });
  };
  const show = asked || upload.status !== "idle";
  return {
    menuItem: {
      label: recipe.imageUrl ? "Replace photo" : "Add a photo",
      icon: ImagePlus,
      onSelect: upload.open,
      disabled: upload.status === "pending",
    },
    element: (
      <>
        {upload.fileInput}
        {show && (
          <PhotoCard
            upload={upload}
            showPhoto={false}
            focus={asked}
            text={
              recipe.imageUrl
                ? "Snap a new photo and it replaces this recipe's picture."
                : `How did ${recipe.title} turn out? Snap a photo and it becomes this recipe's picture.`
            }
            extra={
              asked && (
                <Button variant="ghost" className="min-h-12" onClick={dismiss}>
                  Not now
                </Button>
              )
            }
          />
        )}
      </>
    ),
  };
}
