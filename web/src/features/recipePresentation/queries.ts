import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";

import type { OrganizeProposal, StructuredIngredient } from "../../../../shared/recipePresentation";
import { formatPart } from "../../../../shared/shopping/aggregate";
import { defaultShoppingWeek } from "../../../../shared/shopping/week";
import { keys } from "../../lib/queries";
import { shoppingApi } from "../shopping/api";
import { shoppingKey } from "../shopping/queries";
import { organizeApi } from "./api";

const ORGANIZE = ["organize"];

// Saves an organization (the previewed proposal, or a fresh one from
// Claude) and puts the result in the recipe cache. The callbacks live on
// the mutation, so a save started on the form still lands after it has
// navigated to the recipe.
export function useOrganize() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORGANIZE,
    mutationFn: ({ id, proposal }: { id: string; proposal?: OrganizeProposal }) => organizeApi.apply(id, proposal),
    onSuccess: (recipe) => {
      qc.setQueryData(keys.recipe(recipe.id), recipe);
      void qc.invalidateQueries({ queryKey: [...keys.recipes, "list"] });
    },
  });
}

// True while this recipe is being organized anywhere in the app.
export function useOrganizing(id: string): boolean {
  const pending = useMutationState({
    filters: { mutationKey: ORGANIZE, status: "pending" },
    select: (m) => (m.state.variables as { id: string } | undefined)?.id,
  });
  return pending.includes(id);
}

// What a shopping-list line says for an ingredient: "2 lb ground beef".
function shoppingLine(i: StructuredIngredient): string {
  const name = i.ingredientName ?? i.rawText;
  return i.quantity !== null ? `${formatPart({ quantity: i.quantity, unit: i.unit })} ${name}` : name;
}

// Adds every ingredient to this week's shopping list (the first list when
// the week has two trips), building the list first if there is none. The
// add-item API skips what is already on it.
export function useAddToGroceries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ingredients: StructuredIngredient[]) => {
      const weekId = defaultShoppingWeek(new Date());
      let week = await shoppingApi.week(weekId);
      if (!week.lists.length) week = await shoppingApi.generate(weekId);
      const list = week.lists[0];
      if (!list) throw new Error("This week has no shopping list yet.");
      for (const i of ingredients) {
        week = await shoppingApi.addItem(
          list.id,
          i.ingredientId !== null && i.quantity === null ? { ingredientId: i.ingredientId } : { name: shoppingLine(i).slice(0, 100) },
        );
      }
      qc.setQueryData(shoppingKey(weekId), week);
      return { weekId, count: ingredients.length };
    },
  });
}
