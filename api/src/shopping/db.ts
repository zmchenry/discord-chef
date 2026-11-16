import { cleanText, parseIngredientLine, SECTIONS, tryNormalizeSectionName } from '../../../shared/normalize'
import type { ShoppingSort, Trip } from '../../../shared/schema'
import type { PinnedIngredient, ShoppingItemView, ShoppingListView, ShoppingWeekResponse } from '../../../shared/shopping'
import { formatPart } from '../../../shared/shopping/aggregate'
import { learnedRanks } from '../../../shared/shopping/sort'
import { pinnedTotals, recommendStore, storeTotals } from '../../../shared/shopping/store'
import { listStores } from '../db'

// Data access for shopping. Same conventions as api/src/db.ts: the D1
// binding is passed in, and the snake_case -> camelCase mapping lives here.

export interface ListRow {
  id: number
  week_id: string
  trip: Trip | null
  store_id: number
  status: 'open' | 'done'
  sort: ShoppingSort
  generated_at: number | null
}

export interface ItemRow {
  id: number
  list_id: number
  ingredient_id: number | null
  name: string
  quantity: number | null
  unit: string | null
  amount_text: string | null
  section: string | null
  recipe_ids: string
  source: 'generated' | 'manual' | 'staple'
  manual_rank: number | null
  checked_at: number | null
  checked_by: string | null
  // The ingredient's store pin, joined in by ITEM_SELECT.
  pin_store_id?: number | null
}

// Items with their ingredient's store pin.
const ITEM_SELECT = `SELECT si.*, i.store_id AS pin_store_id FROM shopping_items si
  LEFT JOIN ingredients i ON i.id = si.ingredient_id`

interface IngredientRow {
  id: number
  name: string
  section: string | null
  perishable: number
  is_staple: number
  aliases: string
  store_id: number | null
}

const strings = (json: string): string[] => {
  const v: unknown = JSON.parse(json)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export const toItemView = (r: ItemRow): ShoppingItemView => ({
  id: r.id,
  listId: r.list_id,
  ingredientId: r.ingredient_id,
  name: r.name,
  quantity: r.quantity,
  unit: r.unit,
  amount: r.amount_text ?? (r.quantity != null ? formatPart({ quantity: r.quantity, unit: r.unit }) : null),
  section: r.section,
  recipeIds: strings(r.recipe_ids),
  source: r.source,
  manualRank: r.manual_rank,
  checkedAt: r.checked_at,
  checkedBy: r.checked_by,
  storeId: r.pin_store_id ?? null,
})

const toIngredient = (r: IngredientRow): PinnedIngredient => ({
  id: r.id,
  name: r.name,
  section: r.section,
  perishable: r.perishable === 1,
  isStaple: r.is_staple === 1,
  aliases: strings(r.aliases),
  storeId: r.store_id,
})

const TRIP_ORDER = `CASE trip WHEN 'midweek' THEN 1 ELSE 0 END`

export async function getShoppingWeek(db: D1Database, weekId: string): Promise<ShoppingWeekResponse> {
  const weekItems = `${ITEM_SELECT} JOIN shopping_lists l ON l.id = si.list_id WHERE l.week_id = ?1`
  const [listRes, itemRes, recipeRes, priceRes] = await db.batch([
    db.prepare(`SELECT * FROM shopping_lists WHERE week_id = ?1 ORDER BY ${TRIP_ORDER}`).bind(weekId),
    db.prepare(`${weekItems} ORDER BY si.id`).bind(weekId),
    db
      .prepare(
        `SELECT id, title FROM recipes WHERE id IN (
           SELECT j.value FROM (${weekItems}) w, json_each(w.recipe_ids) j)`,
      )
      .bind(weekId),
    db
      .prepare(
        `SELECT ingredient_id AS ingredientId, store_id AS storeId, cents FROM ingredient_prices
         WHERE ingredient_id IN (SELECT w.ingredient_id FROM (${weekItems}) w)`,
      )
      .bind(weekId),
  ])
  const lists = listRes.results as ListRow[]
  const items = itemRes.results as ItemRow[]
  const prices = priceRes.results as Array<{ ingredientId: number; storeId: number; cents: number }>
  const stores = await listStores(db)
  const storeIds = stores.map((s) => s.id)

  // Learned walking order, once per store in use.
  const learned = new Map<number, ReturnType<typeof learnedRanks>>()
  for (const storeId of new Set(lists.map((l) => l.store_id))) {
    const { results } = await db
      .prepare(
        `SELECT list_id AS listId, ingredient_id AS ingredientId, section, checked_at AS checkedAt
         FROM check_events WHERE store_id = ?1 ORDER BY checked_at DESC LIMIT 3000`,
      )
      .bind(storeId)
      .all<{ listId: number | null; ingredientId: number | null; section: string | null; checkedAt: number }>()
    learned.set(storeId, learnedRanks(results))
  }

  const views: ShoppingListView[] = lists.map((l) => {
    const its = items.filter((i) => i.list_id === l.id).map(toItemView)
    return {
      id: l.id,
      weekId: l.week_id,
      trip: l.trip,
      storeId: l.store_id,
      status: l.status,
      generatedAt: l.generated_at,
      sort: l.sort,
      items: its,
      totals: prices.length ? storeTotals(its, prices, storeIds) : [],
      pinnedTotals: pinnedTotals(its, prices, storeIds),
      recommendation: recommendStore(its, prices),
      learned: learned.get(l.store_id) ?? { sections: {}, ingredients: {} },
    }
  })

  return {
    weekId,
    twoTrips: lists.some((l) => l.trip !== null),
    lists: views,
    recipes: Object.fromEntries((recipeRes.results as Array<{ id: string; title: string }>).map((r) => [r.id, r.title])),
    stores,
  }
}

export async function getList(db: D1Database, id: number): Promise<ListRow | null> {
  return db.prepare('SELECT * FROM shopping_lists WHERE id = ?1').bind(id).first<ListRow>()
}

export async function getItem(db: D1Database, id: number): Promise<(ItemRow & { store_id: number; week_id: string }) | null> {
  return db
    .prepare(
      `SELECT si.*, l.store_id, l.week_id FROM shopping_items si
       JOIN shopping_lists l ON l.id = si.list_id WHERE si.id = ?1`,
    )
    .bind(id)
    .first<ItemRow & { store_id: number; week_id: string }>()
}

const uncheckStatements = (db: D1Database, itemId: number) => [
  db.prepare('UPDATE shopping_items SET checked_at = NULL, checked_by = NULL WHERE id = ?1').bind(itemId),
  db.prepare('DELETE FROM check_events WHERE item_id = ?1').bind(itemId),
]

export interface ItemPatch {
  checked?: boolean
  manualRank?: number | null
  quantity?: string | null
  name?: string
}

// Checking writes a check_events row (the walking-order signal) and
// unchecking deletes it again, so a mis-tap teaches nothing.
export async function patchItem(
  db: D1Database,
  id: number,
  patch: ItemPatch,
  userId: string,
  now = Date.now(),
): Promise<ShoppingItemView | null> {
  const item = await getItem(db, id)
  if (!item) return null
  const stmts: D1PreparedStatement[] = []
  if (patch.checked === true && item.checked_at == null) {
    stmts.push(
      db.prepare('UPDATE shopping_items SET checked_at = ?2, checked_by = ?3 WHERE id = ?1').bind(id, now, userId),
      db
        .prepare(
          `INSERT INTO check_events (store_id, ingredient_id, section, checked_at, list_id, item_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(item.store_id, item.ingredient_id, item.section, now, item.list_id, id),
    )
  } else if (patch.checked === false && item.checked_at != null) {
    stmts.push(...uncheckStatements(db, id))
  }
  if (patch.manualRank !== undefined) {
    stmts.push(db.prepare('UPDATE shopping_items SET manual_rank = ?2 WHERE id = ?1').bind(id, patch.manualRank))
  }
  if (patch.quantity !== undefined) {
    stmts.push(
      db
        .prepare('UPDATE shopping_items SET amount_text = ?2, quantity = NULL, unit = NULL WHERE id = ?1')
        .bind(id, patch.quantity || null),
    )
  }
  if (patch.name !== undefined) {
    const name = parseIngredientLine(patch.name).name || cleanText(patch.name).toLowerCase()
    if (name) stmts.push(db.prepare('UPDATE shopping_items SET name = ?2 WHERE id = ?1').bind(id, name))
  }
  if (stmts.length) await db.batch(stmts)
  const row = await db.prepare(`${ITEM_SELECT} WHERE si.id = ?1`).bind(id).first<ItemRow>()
  return row && toItemView(row)
}

export async function deleteItem(db: D1Database, id: number): Promise<string | null> {
  const item = await getItem(db, id)
  if (!item) return null
  await db.batch([
    db.prepare('DELETE FROM check_events WHERE item_id = ?1').bind(id),
    db.prepare('DELETE FROM shopping_items WHERE id = ?1').bind(id),
  ])
  return item.week_id
}

const nextRank = async (db: D1Database, listId: number) =>
  ((await db
    .prepare('SELECT max(manual_rank) AS r FROM shopping_items WHERE list_id = ?1')
    .bind(listId)
    .first<number>('r')) ?? -1) + 1

const findIngredient = (db: D1Database, name: string) =>
  db
    .prepare(
      `SELECT * FROM ingredients WHERE name = ?1
       UNION ALL
       SELECT i.* FROM ingredients i, json_each(i.aliases) a WHERE a.value = ?1
       LIMIT 1`,
    )
    .bind(name)
    .first<IngredientRow>()

// Adds a manual item or a staple. Adding something already on the list
// (unchecked or checked) puts it back as unchecked rather than duplicating
// it. Returns false when the ingredient id is unknown.
export async function addItem(
  db: D1Database,
  listId: number,
  input: { name?: string; ingredientId?: number },
  now = Date.now(),
): Promise<boolean> {
  let ingredient: IngredientRow | null = null
  let name: string
  let amount: string | null = null
  let quantity: number | null = null
  let unit: string | null = null
  if (input.ingredientId !== undefined) {
    ingredient = await db.prepare('SELECT * FROM ingredients WHERE id = ?1').bind(input.ingredientId).first<IngredientRow>()
    if (!ingredient) return false
    name = ingredient.name
  } else {
    const parsed = parseIngredientLine(input.name ?? '')
    name = parsed.name || cleanText(input.name ?? '').toLowerCase()
    if (parsed.quantity != null) {
      quantity = parsed.quantity
      unit = parsed.unit
      amount = formatPart({ quantity, unit })
    }
    ingredient = await findIngredient(db, name)
    if (ingredient) name = ingredient.name
  }

  const existing = await db
    .prepare(
      `SELECT * FROM shopping_items WHERE list_id = ?1
       AND (ingredient_id = ?2 OR (?2 IS NULL AND ingredient_id IS NULL AND name = ?3)) LIMIT 1`,
    )
    .bind(listId, ingredient?.id ?? null, name)
    .first<ItemRow>()
  if (existing) {
    if (existing.checked_at != null) await db.batch(uncheckStatements(db, existing.id))
    return true
  }

  await db
    .prepare(
      `INSERT INTO shopping_items
         (list_id, ingredient_id, name, quantity, unit, amount_text, section, recipe_ids, source, manual_rank, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '[]', ?8, ?9, ?10)`,
    )
    .bind(
      listId,
      ingredient?.id ?? null,
      name,
      quantity,
      unit,
      amount,
      ingredient?.section ?? null,
      ingredient?.is_staple ? 'staple' : 'manual',
      await nextRank(db, listId),
      now,
    )
    .run()
  return true
}

export async function updateList(
  db: D1Database,
  id: number,
  update: { storeId?: number; sort?: ShoppingSort },
): Promise<'ok' | 'no-store'> {
  if (update.storeId !== undefined) {
    const store = await db.prepare('SELECT 1 AS x FROM stores WHERE id = ?1').bind(update.storeId).first()
    if (!store) return 'no-store'
  }
  await db
    .prepare('UPDATE shopping_lists SET store_id = coalesce(?2, store_id), sort = coalesce(?3, sort) WHERE id = ?1')
    .bind(id, update.storeId ?? null, update.sort ?? null)
    .run()
  return 'ok'
}

export async function getSections(db: D1Database, storeId: number): Promise<string[] | null> {
  const json = await db.prepare('SELECT section_order FROM stores WHERE id = ?1').bind(storeId).first<string>('section_order')
  return json == null ? null : strings(json)
}

// Normalises each name to the fixed section list, drops duplicates and
// appends any section left out. Returns the unknown names when there are
// any, so nothing is saved.
export async function putSections(
  db: D1Database,
  storeId: number,
  input: string[],
): Promise<{ sections: string[] } | { unknown: string[] } | null> {
  const unknown = input.filter((s) => !tryNormalizeSectionName(s))
  if (unknown.length) return { unknown }
  const sections = [...new Set([...input.map((s) => tryNormalizeSectionName(s)!), ...SECTIONS])]
  const res = await db
    .prepare('UPDATE stores SET section_order = ?2 WHERE id = ?1')
    .bind(storeId, JSON.stringify(sections))
    .run()
  return res.meta.changes ? { sections } : null
}

export async function listStaples(db: D1Database): Promise<PinnedIngredient[]> {
  const { results } = await db.prepare('SELECT * FROM ingredients WHERE is_staple = 1 ORDER BY name').all<IngredientRow>()
  return results.map(toIngredient)
}

// Pins an ingredient to a store, or unpins it (null). Returns 'no-store'
// for an unknown store and null for an unknown ingredient.
export async function setIngredientStore(
  db: D1Database,
  ingredientId: number,
  storeId: number | null,
): Promise<PinnedIngredient | 'no-store' | null> {
  if (storeId !== null) {
    const store = await db.prepare('SELECT 1 AS x FROM stores WHERE id = ?1').bind(storeId).first()
    if (!store) return 'no-store'
  }
  const row = await db
    .prepare('UPDATE ingredients SET store_id = ?2 WHERE id = ?1 RETURNING *')
    .bind(ingredientId, storeId)
    .first<IngredientRow>()
  return row && toIngredient(row)
}

export async function listStorePins(db: D1Database): Promise<Array<{ ingredientId: number; storeId: number }>> {
  const { results } = await db
    .prepare('SELECT id AS ingredientId, store_id AS storeId FROM ingredients WHERE store_id IS NOT NULL ORDER BY id')
    .all<{ ingredientId: number; storeId: number }>()
  return results
}
