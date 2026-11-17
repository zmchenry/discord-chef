import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  haveEnough,
  pantryItemSchema,
  pantryResponseSchema,
  type PantryItem,
  type PantryUpdate,
} from "../../../../shared/pantry";
import type { ShoppingWeekResponse } from "../../../../shared/shopping";
import { errorResponseSchema } from "../../../../shared/schema";
import { ApiError } from "../../lib/api";

async function send<T>(path: string, parse: (x: unknown) => T, init?: { method: string; body: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? "GET",
    headers: init ? { "content-type": "application/json" } : undefined,
    body: init ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(await res.json().catch(() => null));
    throw new ApiError(res.status, parsed.success ? parsed.data.error : `${res.status} ${res.statusText}`);
  }
  return parse(await res.json());
}

export const pantryKey = ["pantry"] as const;

export function usePantry() {
  return useQuery({
    queryKey: pantryKey,
    queryFn: () => send("/pantry", (x) => pantryResponseSchema.parse(x).items),
    // Check-offs in the store change it, so always refetch on open.
    staleTime: 0,
  });
}

// Same key as the shopping writes, so the list's polling waits for this.
const SHOPPING_WRITE = ["shopping-write"];

// Sets one ingredient on hand or out. Optimistic on the pantry list and on
// every cached shopping week, so "Need it after all" moves the row at once.
export function useSetPantry() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: SHOPPING_WRITE,
    mutationFn: ({ ingredientId, ...body }: PantryUpdate & { ingredientId: number }) =>
      send(`/pantry/${ingredientId}`, (x) => pantryItemSchema.parse(x), { method: "PUT", body }),
    onMutate: async ({ ingredientId, onHand, low = false }) => {
      await qc.cancelQueries({ queryKey: pantryKey });
      await qc.cancelQueries({ queryKey: ["shopping"] });
      const prevPantry = qc.getQueryData<PantryItem[]>(pantryKey);
      const prevWeeks = qc.getQueriesData<ShoppingWeekResponse>({ queryKey: ["shopping"] });
      qc.setQueryData<PantryItem[]>(pantryKey, (items) =>
        items?.map((i) => (i.ingredientId === ingredientId ? { ...i, onHand, low: onHand && low, assumed: false } : i)),
      );
      const enough = haveEnough({ onHand, low }, { name: "", section: null });
      for (const [key] of prevWeeks) {
        qc.setQueryData<ShoppingWeekResponse>(key, (week) =>
          week && {
            ...week,
            lists: week.lists.map((l) => ({
              ...l,
              items: l.items.map((i) => (i.ingredientId === ingredientId ? { ...i, onHand: enough } : i)),
            })),
          },
        );
      }
      return { prevPantry, prevWeeks };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.prevPantry) qc.setQueryData(pantryKey, ctx.prevPantry);
      for (const [key, data] of ctx?.prevWeeks ?? []) qc.setQueryData(key, data);
    },
    onSuccess: (item) =>
      qc.setQueryData<PantryItem[]>(pantryKey, (items) => items?.map((i) => (i.ingredientId === item.ingredientId ? item : i))),
    // The store totals change with what is still to buy.
    onSettled: () => qc.invalidateQueries({ queryKey: ["shopping"] }),
  });
}
