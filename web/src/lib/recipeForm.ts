import type { Recipe } from "../../../shared/schema";
import type { StepInput, StructuredRecipeInput } from "../../../shared/recipePresentation";
import { parseSteps, stepOneLine } from "../../../shared/recipeStructure";
import { normalizeTags } from "../../../shared/normalize";

// The recipe form edits a flat, all-strings shape. These two pure functions
// convert between it and the API types, and are where the form's rules live
// (so they are unit-tested without rendering anything).

export interface RecipeFormValues {
  title: string;
  tags: string; // comma-separated
  servings: string;
  prepMinutes: string;
  cookMinutes: string;
  ingredients: string; // one per line
  instructions: string; // one per line
  sourceUrl: string;
}

export const emptyForm: RecipeFormValues = {
  title: "",
  tags: "",
  servings: "",
  prepMinutes: "",
  cookMinutes: "",
  ingredients: "",
  instructions: "",
  sourceUrl: "",
};

// A recipe as the form reads it: a plain Recipe, or one with structure
// (step objects, ingredient groups) from shared/recipePresentation.ts.
export type FormBase = Omit<Recipe, "instructions" | "ingredients"> & {
  instructions: unknown[];
  ingredients: Array<Recipe["ingredients"][number] & { group?: string | null }>;
};

export function recipeToForm(r: FormBase): RecipeFormValues {
  return {
    title: r.title,
    tags: r.tags.join(", "),
    servings: r.servings?.toString() ?? "",
    prepMinutes: r.prepMinutes?.toString() ?? "",
    cookMinutes: r.cookMinutes?.toString() ?? "",
    ingredients: r.ingredients.map((i) => i.rawText).join("\n"),
    instructions: parseSteps(r.instructions).map(stepOneLine).join("\n"),
    sourceUrl: r.sourceUrl ?? "",
  };
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function int(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : NaN;
}

export type FormErrors = Partial<Record<keyof RecipeFormValues, string>>;

export function validateForm(v: RecipeFormValues): FormErrors {
  const errors: FormErrors = {};
  if (!v.title.trim()) errors.title = "Give the recipe a title.";
  const servings = int(v.servings);
  if (Number.isNaN(servings) || (servings !== null && (servings < 1 || servings > 100)))
    errors.servings = "Servings is a whole number from 1 to 100.";
  for (const key of ["prepMinutes", "cookMinutes"] as const) {
    const n = int(v[key]);
    if (Number.isNaN(n) || (n !== null && (n < 0 || n > 1440))) errors[key] = "Minutes is a whole number from 0 to 1440.";
  }
  if (v.sourceUrl.trim()) {
    try {
      const u = new URL(v.sourceUrl.trim());
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    } catch {
      errors.sourceUrl = "Enter a full link starting with https://";
    }
  }
  return errors;
}

// PUT is a full replace, so fields the form does not show (description,
// notes, icon, image, Notion id) are carried over from `base`, and an
// ingredient line whose text is unchanged keeps its parsed name, quantity,
// unit, note, optional flag and group. A changed line keeps the group of
// the line it replaced, or else of the line above.
export function formToInput(v: RecipeFormValues, base?: FormBase): StructuredRecipeInput {
  const previous = new Map(base?.ingredients.map((i) => [i.rawText, i]) ?? []);
  let above: string | null = null;
  const ingredients: NonNullable<StructuredRecipeInput["ingredients"]> = lines(v.ingredients).map((rawText, n) => {
    const prev = previous.get(rawText);
    const group = (prev ? prev.group : (base?.ingredients[n]?.group ?? above)) || null;
    above = group;
    const g = group ? { group } : {};
    if (!prev) return { rawText, ...g };
    return {
      rawText,
      ...(prev.ingredientName ? { name: prev.ingredientName } : {}),
      quantity: prev.quantity,
      unit: prev.unit,
      note: prev.note,
      optional: prev.optional,
      ...g,
    };
  });
  return {
    title: v.title.trim(),
    description: base?.description ?? null,
    sourceUrl: v.sourceUrl.trim() || null,
    imageUrl: base?.imageUrl ?? null,
    icon: base?.icon ?? null,
    servings: int(v.servings),
    prepMinutes: int(v.prepMinutes),
    cookMinutes: int(v.cookMinutes),
    instructions: keepStepStructure(lines(v.instructions), base?.instructions ?? []),
    notes: base?.notes ?? null,
    tags: normalizeTags(v.tags.split(",")),
    ingredients,
    notionPageId: base?.notionPageId ?? null,
  };
}

// The form edits steps one per line. A line equal to a stored step (on one
// line) keeps that step as it was: title, paragraphs and ingredient refs. A
// changed line keeps the title and refs of the step it replaced.
export function keepStepStructure(edited: string[], stored: unknown[]): StepInput[] {
  const steps = parseSteps(stored);
  const used = new Set<number>();
  const byText = edited.map((line) => {
    const i = steps.findIndex((s, k) => !used.has(k) && stepOneLine(s) === line);
    if (i >= 0) used.add(i);
    return i;
  });
  return edited.map((line, n) => {
    const same = byText[n]!;
    if (same >= 0) {
      const s = steps[same]!;
      return s.title || s.ingredientRefs.length ? { title: s.title, text: s.text, ingredientRefs: s.ingredientRefs } : line;
    }
    const was = steps[n];
    if (was && !used.has(n) && (was.title || was.ingredientRefs.length)) {
      used.add(n);
      return { title: was.title, text: line, ingredientRefs: was.ingredientRefs };
    }
    return line;
  });
}

// "1 h 15 min" style total, or null with no times.
export function formatMinutes(total: number | null): string | null {
  if (total === null || total <= 0) return null;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function totalMinutes(r: { prepMinutes: number | null; cookMinutes: number | null }): number | null {
  if (r.prepMinutes === null && r.cookMinutes === null) return null;
  return (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0);
}
