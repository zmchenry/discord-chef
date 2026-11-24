import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import {
  foodLogItemSchema,
  foodLogListSchema,
  meSchema,
  parseResponseSchema,
  type FoodItemFields,
  type FoodMeal,
  type SaveInput,
} from "../../../../shared/foodLog";
import { tuneResponseSchema } from "../../../../shared/foodLog/insights";
import { breakfastLunchSettingsSchema } from "../../../../shared/guidedDinners";
import { errorResponseSchema } from "../../../../shared/schema";
import { ApiError } from "../../lib/api";

async function request<T extends z.ZodTypeAny>(
  schema: T,
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<z.infer<T>> {
  const method = init.method ?? "GET";
  const res = await fetch(`/api${path}`, {
    method,
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const parsed = errorResponseSchema.safeParse(await res.json());
      if (parsed.success) message = parsed.data.error;
    } catch {
      // Not JSON.
    }
    throw new ApiError(res.status, message);
  }
  return schema.parse(await res.json());
}

export const foodLogApi = {
  me: (signal?: AbortSignal) => request(meSchema, "/food-log/me", { signal }),
  setMe: (person: string) => request(meSchema, "/food-log/me", { method: "PUT", body: { person } }),
  parse: (text: string, meal: FoodMeal) => request(parseResponseSchema, "/food-log/parse", { method: "POST", body: { text, meal } }),
  save: (input: SaveInput) => request(foodLogListSchema, "/food-log", { method: "POST", body: input }),
  range: (from: string, to: string, signal?: AbortSignal) =>
    request(foodLogListSchema, `/food-log?from=${from}&to=${to}`, { signal }).then((r) => r.items),
  update: (id: string, fields: FoodItemFields) =>
    request(foodLogItemSchema, `/food-log/items/${encodeURIComponent(id)}`, { method: "PUT", body: fields }),
  remove: (id: string) => request(z.object({ ok: z.boolean() }), `/food-log/items/${encodeURIComponent(id)}`, { method: "DELETE" }),
  tune: (signal?: AbortSignal) => request(tuneResponseSchema, "/food-log/tune", { signal }).then((r) => r.items),
};

export const foodKeys = {
  me: ["food-log", "me"] as const,
  range: (from: string, to: string) => ["food-log", "range", from, to] as const,
  tune: ["food-log", "tune"] as const,
};

// Anything logged changes nutrition, history and the insights.
function useRefreshAfterLog() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["food-log"] });
    void qc.invalidateQueries({ queryKey: ["nutrition"] });
    void qc.invalidateQueries({ queryKey: ["history"] });
  };
}

export const useFoodMe = () => useQuery({ queryKey: foodKeys.me, queryFn: ({ signal }) => foodLogApi.me(signal), staleTime: Infinity });

export function useSetFoodMe() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: foodLogApi.setMe, onSuccess: (me) => qc.setQueryData(foodKeys.me, me) });
}

export const useParseFood = () => useMutation({ mutationFn: (v: { text: string; meal: FoodMeal }) => foodLogApi.parse(v.text, v.meal) });

export function useSaveFood() {
  const refresh = useRefreshAfterLog();
  return useMutation({ mutationFn: foodLogApi.save, onSuccess: refresh });
}

export function useUpdateFood() {
  const refresh = useRefreshAfterLog();
  return useMutation({ mutationFn: (v: { id: string; fields: FoodItemFields }) => foodLogApi.update(v.id, v.fields), onSuccess: refresh });
}

export function useDeleteFood() {
  const refresh = useRefreshAfterLog();
  return useMutation({ mutationFn: foodLogApi.remove, onSuccess: refresh });
}

export const useFoodRange = (from: string, to: string) =>
  useQuery({ queryKey: foodKeys.range(from, to), queryFn: ({ signal }) => foodLogApi.range(from, to, signal) });

export const useTune = () => useQuery({ queryKey: foodKeys.tune, queryFn: ({ signal }) => foodLogApi.tune(signal), staleTime: 60_000 });

// Tune's one-tap action: add a recipe to the breakfast rotation, keeping
// the rest of the breakfast and lunch settings as they are.
export function useAddToRotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (recipeId: string) => {
      const s = await request(breakfastLunchSettingsSchema, "/settings/breakfast-lunch");
      return request(breakfastLunchSettingsSchema, "/settings/breakfast-lunch", {
        method: "PUT",
        body: {
          breakfastRotation: [...s.breakfastRotation.map((r) => r.id), recipeId].slice(-8),
          lunchStaples: s.staplesIsDefault ? [] : s.lunchStaples.map((r) => r.id),
        },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: foodKeys.tune });
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
