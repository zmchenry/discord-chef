import type { ImportUrlResponse } from "../../../../shared/linkImport";
import type { StructuredRecipeInput } from "../../../../shared/recipePresentation";
import type { RecipeInput } from "../../../../shared/schema";
import type { ImportTextResponse } from "../../../../shared/textImport";
import type { RecipeFormValues } from "../../lib/recipeForm";

// What an import page hands to the recipe form in router state. `via:
// "text"` is the voice/text import (features/textImport), else a link.
export type ImportedDraft = (ImportUrlResponse | ImportTextResponse) & { via?: "link" | "text" };

export function importedDraftFrom(state: unknown): ImportedDraft | undefined {
  const d = (state as { imported?: ImportedDraft } | null)?.imported;
  return d && typeof d.draft?.title === "string" ? d : undefined;
}

export function draftToForm(d: RecipeInput): RecipeFormValues {
  return {
    title: d.title,
    tags: (d.tags ?? []).join(", "),
    servings: d.servings?.toString() ?? "",
    prepMinutes: d.prepMinutes?.toString() ?? "",
    cookMinutes: d.cookMinutes?.toString() ?? "",
    ingredients: (d.ingredients ?? []).map((i) => i.rawText).join("\n"),
    instructions: (d.instructions ?? []).join("\n"),
    sourceUrl: d.sourceUrl ?? "",
  };
}

// The form only edits some fields. Carry the rest over from the draft
// (description, image), and keep the parsed row for every ingredient line
// the user left unchanged (and its group, when the form had one).
export function withDraftExtras(input: StructuredRecipeInput, d: RecipeInput): StructuredRecipeInput {
  const rows = new Map((d.ingredients ?? []).map((i) => [i.rawText, i]));
  return {
    ...input,
    description: input.description ?? d.description ?? null,
    imageUrl: input.imageUrl ?? d.imageUrl ?? null,
    ingredients: (input.ingredients ?? []).map((i) => {
      const row = rows.get(i.rawText);
      return row ? { ...row, ...(i.group ? { group: i.group } : {}) } : i;
    }),
  };
}

// The share target sends ?url=, or (Android Chrome) the link inside ?text=.
export function sharedUrl(params: URLSearchParams): string {
  const direct = params.get("url")?.trim();
  if (direct) return direct;
  const inText = (params.get("text") ?? "").match(/https?:\/\/[^\s<>"']+/i)?.[0];
  return inText ? inText.replace(/[).,;!?]+$/, "") : "";
}
