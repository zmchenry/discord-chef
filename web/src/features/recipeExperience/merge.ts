import { normalizeIngredientName } from "../../../../shared/normalize";
import type { StructuredRecipe as Recipe, StructuredRecipeInput as RecipeInput } from "../../../../shared/recipePresentation";
import type { RecipeIngredientInput } from "../../../../shared/schema";

// Merging a link import into a recipe that already exists, like the voice
// import does: the title, tags and icon stay; steps are filled in, or replaced
// by the page's; ingredients the recipe lacks are added (and a bare
// "ground beef" picks up the page's "1 lb ground beef"); missing times,
// servings, description, picture and link are filled.

export interface MergeSummary {
  /** Steps the recipe had before (replaced when the page has steps). */
  stepsBefore: number;
  stepsAfter: number;
  stepsChanged: boolean;
  /** Display text of each added ingredient line. */
  addedIngredients: string[];
  /** Existing lines that gained an amount from the page. */
  filledAmounts: string[];
  /** Plain labels of other fields that get filled, e.g. "cook time". */
  filled: string[];
}

export interface MergeResult {
  input: RecipeInput;
  summary: MergeSummary;
}

const MAX = 100;

export function recipeToInput(r: Recipe): RecipeInput {
  return {
    title: r.title,
    description: r.description,
    sourceUrl: r.sourceUrl,
    imageUrl: r.imageUrl,
    icon: r.icon,
    servings: r.servings,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    instructions: r.instructions,
    notes: r.notes,
    tags: r.tags,
    notionPageId: r.notionPageId,
    ingredients: r.ingredients.map((i) => ({
      rawText: i.rawText,
      ...(i.ingredientName ? { name: i.ingredientName } : {}),
      quantity: i.quantity,
      unit: i.unit,
      note: i.note,
      optional: i.optional,
      group: i.group,
    })),
  };
}

const nameOf = (i: RecipeIngredientInput) => normalizeIngredientName(i.name ?? i.rawText);
const words = (s: string) => ` ${s.replace(/[^a-z0-9]+/g, " ").trim()} `;

// "ground beef" matches "lean ground beef" and "beef" matches "ground beef":
// one name is the other's whole words. Empty names never match.
function sameIngredient(a: string, b: string): boolean {
  if (!a || !b) return false;
  const wa = words(a);
  const wb = words(b);
  return wa.includes(wb) || wb.includes(wa);
}

export function mergeLinkImport(base: Recipe, draft: RecipeInput, url: string): MergeResult {
  const existing = recipeToInput(base);
  const imported = draft.ingredients ?? [];
  const usedImports = new Set<number>();
  const filledAmounts: string[] = [];

  const ingredients = (existing.ingredients ?? []).map((line) => {
    const name = nameOf(line);
    const at = imported.findIndex((d, n) => !usedImports.has(n) && sameIngredient(name, nameOf(d)));
    if (at < 0) return line;
    usedImports.add(at);
    const page = imported[at];
    // A bare name takes the page's line, amount and all.
    if (line.quantity == null && page.quantity != null) {
      filledAmounts.push(page.rawText);
      return { ...page, optional: line.optional || page.optional };
    }
    return line;
  });
  const added = imported.filter((_d, n) => !usedImports.has(n));
  const allIngredients = [...ingredients, ...added].slice(0, MAX);
  const addedIngredients = added.slice(0, Math.max(0, MAX - ingredients.length)).map((d) => d.rawText);

  const pageSteps = (draft.instructions ?? []).slice(0, MAX);
  const steps = pageSteps.length ? pageSteps : base.instructions;
  // Steps may be strings or structured step objects.
  const stepsChanged = JSON.stringify(steps) !== JSON.stringify(base.instructions);

  const filled: string[] = [];
  const fill = <T>(have: T | null, page: T | null | undefined, label: string): T | null => {
    if (have != null || page == null) return have;
    filled.push(label);
    return page;
  };

  const input: RecipeInput = {
    ...existing,
    description: fill(base.description, draft.description, "description"),
    imageUrl: fill(base.imageUrl, draft.imageUrl, "picture"),
    sourceUrl: fill(base.sourceUrl, draft.sourceUrl ?? url, "link"),
    servings: fill(base.servings, draft.servings, "servings"),
    prepMinutes: fill(base.prepMinutes, draft.prepMinutes, "prep time"),
    cookMinutes: fill(base.cookMinutes, draft.cookMinutes, "cook time"),
    instructions: steps,
    ingredients: allIngredients,
  };

  return {
    input,
    summary: {
      stepsBefore: base.instructions.length,
      stepsAfter: steps.length,
      stepsChanged,
      addedIngredients,
      filledAmounts,
      filled,
    },
  };
}

export const hasChanges = (s: MergeSummary) =>
  s.stepsChanged || s.addedIngredients.length > 0 || s.filledAmounts.length > 0 || s.filled.length > 0;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// One sentence for the confirm dialog: "Adds 6 steps and 4 ingredients."
export function describeMerge(s: MergeSummary): string {
  if (!hasChanges(s)) return "Nothing new: the recipe already has everything on that page.";
  const adds: string[] = [];
  let lead = "";
  if (s.stepsChanged && s.stepsBefore === 0) adds.push(plural(s.stepsAfter, "step"));
  if (s.addedIngredients.length) adds.push(plural(s.addedIngredients.length, "ingredient"));
  if (adds.length) lead = `Adds ${list(adds)}`;
  const more: string[] = [];
  if (s.stepsChanged && s.stepsBefore > 0) more.push(`replaces ${plural(s.stepsBefore, "step")} with ${s.stepsAfter}`);
  if (s.filledAmounts.length) more.push(`fills amounts for ${plural(s.filledAmounts.length, "ingredient")}`);
  if (s.filled.length) more.push(`fills the ${list(s.filled)}`);
  const sentence = [lead, ...more].filter(Boolean).join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
