import { useIsMutating, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type { ShoppingSort } from "../../../../shared/schema";
import type { ShoppingItemView, ShoppingWeekResponse } from "../../../../shared/shopping";
import { shoppingApi } from "./api";

// Every write updates the cached week first (optimistic), so a tap never
// waits on the network. Checks and reorders do not refetch on success: the
// server's answer matches what is already on screen, and merging it could
// undo a newer tap. A failed write puts back only what it changed.

export const shoppingKey = (weekId: string) => ["shopping", weekId] as const;
const MUTATION_KEY = ["shopping-write"];

// While both phones are in the store, each picks up the other's checks.
const POLL_MS = 20_000;

export function useShoppingWeek(weekId: string) {
  const writing = useIsMutating({ mutationKey: MUTATION_KEY }) > 0;
  return useQuery({
    queryKey: shoppingKey(weekId),
    queryFn: ({ signal }) => shoppingApi.week(weekId, signal),
    refetchInterval: writing ? false : POLL_MS,
    placeholderData: (prev) => prev,
  });
}

function editItem(qc: QueryClient, weekId: string, id: number, fn: (item: ShoppingItemView) => ShoppingItemView) {
  qc.setQueryData<ShoppingWeekResponse>(shoppingKey(weekId), (week) =>
    week && {
      ...week,
      lists: week.lists.map((l) => ({ ...l, items: l.items.map((i) => (i.id === id ? fn(i) : i)) })),
    },
  );
}

export function useCheckItem(weekId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: MUTATION_KEY,
    mutationFn: ({ id, checked }: { id: number; checked: boolean }) => shoppingApi.patchItem(id, { checked }),
    onMutate: async ({ id, checked }) => {
      await qc.cancelQueries({ queryKey: shoppingKey(weekId) });
      editItem(qc, weekId, id, (i) => ({ ...i, checkedAt: checked ? Date.now() : null }));
    },
    onError: (_err, { id, checked }) => editItem(qc, weekId, id, (i) => ({ ...i, checkedAt: checked ? null : Date.now() })),
  });
}

export function useRankItem(weekId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: MUTATION_KEY,
    mutationFn: ({ id, manualRank }: { id: number; manualRank: number; previous: number | null }) =>
      shoppingApi.patchItem(id, { manualRank }),
    onMutate: async ({ id, manualRank }) => {
      await qc.cancelQueries({ queryKey: shoppingKey(weekId) });
      editItem(qc, weekId, id, (i) => ({ ...i, manualRank }));
    },
    onError: (_err, { id, previous }) => editItem(qc, weekId, id, (i) => ({ ...i, manualRank: previous })),
  });
}

// Writes whose answer is the whole week: it replaces the cache.
function useWeekWrite<V>(weekId: string, fn: (v: V) => Promise<ShoppingWeekResponse>, optimistic?: (week: ShoppingWeekResponse, v: V) => ShoppingWeekResponse) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: MUTATION_KEY,
    mutationFn: fn,
    onMutate: async (v: V) => {
      await qc.cancelQueries({ queryKey: shoppingKey(weekId) });
      const prev = qc.getQueryData<ShoppingWeekResponse>(shoppingKey(weekId));
      if (prev && optimistic) qc.setQueryData(shoppingKey(weekId), optimistic(prev, v));
      return { prev };
    },
    onError: (_err, _v, ctx) => ctx?.prev && qc.setQueryData(shoppingKey(weekId), ctx.prev),
    onSuccess: (week) => qc.setQueryData(shoppingKey(weekId), week),
  });
}

// "Estimate prices": waits for the estimates, then refetches the week so
// the store totals appear.
export function useRefreshPrices(weekId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => shoppingApi.refreshPrices(weekId),
    onSuccess: () => qc.invalidateQueries({ queryKey: shoppingKey(weekId) }),
  });
}

export const useGenerate = (weekId: string) =>
  useWeekWrite(weekId, (twoTrips?: boolean) => shoppingApi.generate(weekId, { twoTrips }));

let tempId = -1;

export const useAddItem = (weekId: string) =>
  useWeekWrite(
    weekId,
    ({ listId, name, ingredientId }: { listId: number; name?: string; ingredientId?: number; section?: string | null }) =>
      shoppingApi.addItem(listId, ingredientId !== undefined ? { ingredientId } : { name }),
    (week, { listId, name, section }) => ({
      ...week,
      lists: week.lists.map((l) => {
        if (l.id !== listId) return l;
        const rank = Math.max(-1, ...l.items.map((i) => i.manualRank ?? -1)) + 1;
        const item: ShoppingItemView = {
          id: tempId--,
          listId,
          ingredientId: null,
          name: (name ?? "").trim().toLowerCase(),
          quantity: null,
          unit: null,
          amount: null,
          section: section ?? null,
          recipeIds: [],
          source: "manual",
          manualRank: rank,
          checkedAt: null,
          checkedBy: null,
          storeId: null,
        };
        return { ...l, items: [...l.items, item] };
      }),
    }),
  );

export const useDeleteItem = (weekId: string) =>
  useWeekWrite(
    weekId,
    (id: number) => shoppingApi.deleteItem(id),
    (week, id) => ({ ...week, lists: week.lists.map((l) => ({ ...l, items: l.items.filter((i) => i.id !== id) })) }),
  );

export const useUpdateList = (weekId: string) =>
  useWeekWrite(
    weekId,
    ({ listId, ...update }: { listId: number; storeId?: number; sort?: ShoppingSort }) => shoppingApi.updateList(listId, update),
    (week, { listId, storeId, sort }) => ({
      ...week,
      lists: week.lists.map((l) => (l.id === listId ? { ...l, storeId: storeId ?? l.storeId, sort: sort ?? l.sort } : l)),
    }),
  );

// Store pins. The pin lives on the ingredient, so every item for it on any
// list changes at once; the week is refetched for the new totals.
export const storePinsKey = ["store-pins"] as const;

export function useStorePins() {
  return useQuery({ queryKey: storePinsKey, queryFn: ({ signal }) => shoppingApi.storePins(signal) });
}

export function usePinIngredient(weekId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: MUTATION_KEY,
    mutationFn: ({ ingredientId, storeId }: { ingredientId: number; storeId: number | null }) =>
      shoppingApi.setIngredientStore(ingredientId, storeId),
    onMutate: async ({ ingredientId, storeId }) => {
      await qc.cancelQueries({ queryKey: storePinsKey });
      const prevPins = qc.getQueryData<Array<{ ingredientId: number; storeId: number }>>(storePinsKey);
      if (prevPins) {
        const rest = prevPins.filter((p) => p.ingredientId !== ingredientId);
        qc.setQueryData(storePinsKey, storeId === null ? rest : [...rest, { ingredientId, storeId }]);
      }
      if (!weekId) return { prevPins };
      await qc.cancelQueries({ queryKey: shoppingKey(weekId) });
      const prev = qc.getQueryData<ShoppingWeekResponse>(shoppingKey(weekId));
      qc.setQueryData<ShoppingWeekResponse>(shoppingKey(weekId), (week) =>
        week && {
          ...week,
          lists: week.lists.map((l) => ({
            ...l,
            items: l.items.map((i) => (i.ingredientId === ingredientId ? { ...i, storeId } : i)),
          })),
        },
      );
      return { prev, prevPins };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.prevPins) qc.setQueryData(storePinsKey, ctx.prevPins);
      if (weekId && ctx && "prev" in ctx && ctx.prev) qc.setQueryData(shoppingKey(weekId), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: storePinsKey });
      void qc.invalidateQueries({ queryKey: ["shopping"] });
    },
  });
}
