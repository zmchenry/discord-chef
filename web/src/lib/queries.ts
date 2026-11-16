import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { RecipeInput, RecipeListQuery } from "../../../shared/schema";
import { api } from "./api";

// Query keys in one place so mutations invalidate exactly what they change.
export const keys = {
  me: ["me"] as const,
  recipes: ["recipes"] as const,
  recipeList: (q: RecipeListQuery) => ["recipes", "list", q] as const,
  recipe: (id: string) => ["recipes", "detail", id] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: ({ signal }) => api.me(signal) });

export const useRecipes = (query: RecipeListQuery) =>
  useQuery({
    queryKey: keys.recipeList(query),
    queryFn: ({ signal }) => api.listRecipes(query, signal),
    placeholderData: (prev) => prev,
  });

export const useRecipe = (id: string | undefined) =>
  useQuery({
    queryKey: keys.recipe(id ?? ""),
    queryFn: ({ signal }) => api.getRecipe(id!, signal),
    enabled: !!id,
  });

export function useSaveRecipe(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecipeInput) => (id ? api.updateRecipe(id, input) : api.createRecipe(input)),
    onSuccess: (recipe) => {
      qc.setQueryData(keys.recipe(recipe.id), recipe);
      void qc.invalidateQueries({ queryKey: [...keys.recipes, "list"] });
    },
  });
}

export function useArchiveRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.archiveRecipe(id),
    onSuccess: (_void, id) => {
      void qc.invalidateQueries({ queryKey: keys.recipes });
      void qc.invalidateQueries({ queryKey: keys.recipe(id) });
    },
  });
}
