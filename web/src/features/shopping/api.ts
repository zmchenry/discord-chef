import type { z } from "zod";

import { priceRefreshResponseSchema } from "../../../../shared/prices";
import { errorResponseSchema, ingredientListResponseSchema } from "../../../../shared/schema";
import {
  pinnedIngredientSchema,
  shoppingItemViewSchema,
  shoppingWeekResponseSchema,
  stapleListResponseSchema,
  storePinsResponseSchema,
  storeSectionsSchema,
  type AddShoppingItem,
  type GenerateShoppingInput,
  type ShoppingItemPatch,
  type ShoppingListUpdate,
} from "../../../../shared/shopping";
import { ApiError } from "../../lib/api";

// The shopping endpoints. Same shape as lib/api.ts: every response is
// parsed with its shared schema.

async function send<T extends z.ZodTypeAny>(schema: T, path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<z.infer<T>> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const parsed = errorResponseSchema.safeParse(await res.json());
      if (parsed.success) message = parsed.data.error;
    } catch {
      // Not JSON. Keep the status text.
    }
    throw new ApiError(res.status, message);
  }
  return schema.parse(await res.json());
}

export const shoppingApi = {
  week: (weekId: string, signal?: AbortSignal) => send(shoppingWeekResponseSchema, `/weeks/${weekId}/shopping`, "GET", undefined, signal),
  generate: (weekId: string, input: GenerateShoppingInput = {}) =>
    send(shoppingWeekResponseSchema, `/weeks/${weekId}/shopping/generate`, "POST", input),
  patchItem: (id: number, patch: ShoppingItemPatch) => send(shoppingItemViewSchema, `/shopping/items/${id}`, "PATCH", patch),
  deleteItem: (id: number) => send(shoppingWeekResponseSchema, `/shopping/items/${id}`, "DELETE"),
  addItem: (listId: number, input: AddShoppingItem) =>
    send(shoppingWeekResponseSchema, `/shopping/lists/${listId}/items`, "POST", input),
  updateList: (listId: number, update: ShoppingListUpdate) =>
    send(shoppingWeekResponseSchema, `/shopping/lists/${listId}`, "PUT", update),
  staples: (signal?: AbortSignal) => send(stapleListResponseSchema, "/staples", "GET", undefined, signal).then((r) => r.staples),
  searchIngredients: (q: string, signal?: AbortSignal) =>
    send(ingredientListResponseSchema, `/ingredients?q=${encodeURIComponent(q)}&limit=8`, "GET", undefined, signal).then(
      (r) => r.ingredients,
    ),
  sections: (storeId: number, signal?: AbortSignal) =>
    send(storeSectionsSchema, `/stores/${storeId}/sections`, "GET", undefined, signal).then((r) => r.sections),
  putSections: (storeId: number, sections: string[]) =>
    send(storeSectionsSchema, `/stores/${storeId}/sections`, "PUT", { sections }).then((r) => r.sections),
  setIngredientStore: (ingredientId: number, storeId: number | null) =>
    send(pinnedIngredientSchema, `/ingredients/${ingredientId}/store`, "PUT", { storeId }),
  storePins: (signal?: AbortSignal) => send(storePinsResponseSchema, "/store-pins", "GET", undefined, signal).then((r) => r.pins),
  refreshPrices: (weekId: string) => send(priceRefreshResponseSchema, "/prices/refresh", "POST", { weekId }),
};
