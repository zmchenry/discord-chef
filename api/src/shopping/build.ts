import { normalizeIngredientName } from '../../../shared/normalize'
import type { Trip } from '../../../shared/schema'
import { aggregate, formatAmount, itemKey, type AggregatedItem, type AggregateSlot } from '../../../shared/shopping/aggregate'
import { sortItems } from '../../../shared/shopping/sort'
import { splitTrips } from '../../../shared/shopping/trips'
import type { ItemRow, ListRow } from './db'
import { estimateWeekPrices } from './prices'

// (Re)builds a week's shopping list(s) from its plan_slots. Planning's
// "finish week" calls this too.
//
// Regenerating keeps what people did on the list: an item that is still
// needed keeps its id, check mark and manual order; manual items and
// staples are never touched (except to move onto a surviving list); only
// generated items no recipe needs any more are deleted.
//
// twoTrips switches between one list (trip null) and a weekend + midweek
// pair. Absent, the week keeps its current split (one list for a new week).
// waitUntil, when given, runs price estimates for the list without making
// the caller wait on them.

interface SlotRow {
  slot_id: number
  day: number
  recipe_id: string
  slot_servings: number | null
  recipe_servings: number | null
  ingredient_id: number | null
  ingredient_name: string | null
  raw_text: string
  quantity: number | null
  unit: string | null
  section: string | null
  perishable: number
}

const tripKey = (t: Trip | null) => t ?? ''

export async function buildListForWeek(
  env: Pick<Env, 'DB' | 'ANTHROPIC_API_KEY'>,
  weekId: string,
  opts: { twoTrips?: boolean; waitUntil?: (p: Promise<unknown>) => void } = {},
  now = Date.now(),
): Promise<void> {
  const db = env.DB
  await db
    .prepare('INSERT INTO weeks (id, created_at, updated_at) VALUES (?1, ?2, ?2) ON CONFLICT(id) DO NOTHING')
    .bind(weekId, now)
    .run()

  const [slotRes, listRes, itemRes, storeRes] = await db.batch([
    db
      .prepare(
        `SELECT ps.id AS slot_id, ps.day, ps.recipe_id, r.servings AS recipe_servings,
                -- A portion split bigger than the recipe scales it up (never down: leftovers).
                coalesce((SELECT CASE WHEN p.total > r.servings THEN p.total END FROM plan_slot_portions p
                          WHERE p.slot_id = ps.id AND p.slot_key = ps.recipe_id), ps.servings) AS slot_servings,
                ri.ingredient_id, i.name AS ingredient_name, ri.raw_text, ri.quantity, ri.unit,
                i.section, coalesce(i.perishable, 0) AS perishable
         FROM plan_slots ps
         JOIN recipes r ON r.id = ps.recipe_id
         JOIN recipe_ingredients ri ON ri.recipe_id = ps.recipe_id
         LEFT JOIN ingredients i ON i.id = ri.ingredient_id
         WHERE ps.week_id = ?1 AND ps.kind = 'recipe'
         ORDER BY ps.day, CASE ps.meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END, ri.position`,
      )
      .bind(weekId),
    db.prepare('SELECT * FROM shopping_lists WHERE week_id = ?1 ORDER BY id').bind(weekId),
    db
      .prepare('SELECT si.* FROM shopping_items si JOIN shopping_lists l ON l.id = si.list_id WHERE l.week_id = ?1 ORDER BY si.id')
      .bind(weekId),
    db.prepare('SELECT id, section_order FROM stores ORDER BY is_default DESC, id'),
  ])
  const rows = slotRes.results as SlotRow[]
  const existingLists = listRes.results as ListRow[]
  const existingItems = itemRes.results as ItemRow[]
  const stores = storeRes.results as Array<{ id: number; section_order: string }>

  // 1. Aggregate the plan.
  const slots = new Map<number, AggregateSlot>()
  for (const r of rows) {
    let slot = slots.get(r.slot_id)
    if (!slot) {
      const scale = r.slot_servings && r.recipe_servings ? r.slot_servings / r.recipe_servings : 1
      slots.set(r.slot_id, (slot = { day: r.day, recipeId: r.recipe_id, scale, ingredients: [] }))
    }
    slot.ingredients.push({
      ingredientId: r.ingredient_id,
      name: r.ingredient_name ?? normalizeIngredientName(r.raw_text),
      quantity: r.quantity,
      unit: r.unit,
      section: r.section,
      perishable: r.perishable === 1,
    })
  }
  const items = aggregate([...slots.values()])

  const twoTrips = opts.twoTrips ?? existingLists.some((l) => l.trip !== null)
  const byTrip = new Map<string, AggregatedItem[]>()
  if (twoTrips) {
    const split = splitTrips(items, [...slots.values()])
    byTrip.set('weekend', split.weekend)
    byTrip.set('midweek', split.midweek)
  } else {
    byTrip.set('', items)
  }
  const targets: Array<Trip | null> = twoTrips ? ['weekend', 'midweek'] : [null]

  // 2. Make sure each target list exists. A list whose trip is going away
  //    is reused (renamed) before a new one is created, so ids, store
  //    choice and check history carry over between one and two trips.
  const lists = new Map<string, { id: number; storeId: number; sectionOrder: string[] }>()
  const spare = existingLists.filter((l) => !targets.includes(l.trip))
  const defaultStore = existingLists[0]?.store_id ?? stores[0].id
  const orderOf = (storeId: number) =>
    JSON.parse(stores.find((s) => s.id === storeId)?.section_order ?? '[]') as string[]
  for (const trip of targets) {
    let list = existingLists.find((l) => l.trip === trip)
    if (!list) {
      const reuse = spare.shift()
      if (reuse) {
        await db.prepare('UPDATE shopping_lists SET trip = ?2 WHERE id = ?1').bind(reuse.id, trip).run()
        list = { ...reuse, trip }
      } else {
        const id = await db
          .prepare(
            `INSERT INTO shopping_lists (week_id, trip, store_id, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id`,
          )
          .bind(weekId, trip, defaultStore, now)
          .first<number>('id')
        list = { id: id!, week_id: weekId, trip, store_id: defaultStore, status: 'open', sort: 'aisle', generated_at: null }
      }
    }
    lists.set(tripKey(trip), { id: list.id, storeId: list.store_id, sectionOrder: orderOf(list.store_id) })
  }
  const firstList = lists.get(tripKey(targets[0]))!
  const listForTrip = (trip: Trip | null) => lists.get(tripKey(trip)) ?? firstList
  const tripOfList = new Map(existingLists.map((l) => [l.id, l.trip]))

  // 3. Match generated items to existing ones by ingredient (or name).
  const stmts: D1PreparedStatement[] = []
  const generated = new Map<string, ItemRow>()
  for (const it of existingItems) {
    if (it.source !== 'generated') continue
    const key = itemKey(it.ingredient_id, it.name)
    if (generated.has(key)) stmts.push(db.prepare('DELETE FROM shopping_items WHERE id = ?1').bind(it.id))
    else generated.set(key, it)
  }

  // Ranks continue after the highest rank already on each list.
  const maxRank = new Map<number, number>()
  const bumpRank = (listId: number, rank: number | null) =>
    rank != null && maxRank.set(listId, Math.max(maxRank.get(listId) ?? -1, rank))

  // Manual items and staples stay, moved onto a surviving list if theirs is
  // going away.
  for (const it of existingItems) {
    if (it.source === 'generated') continue
    const target = listForTrip(tripOfList.get(it.list_id) ?? null)
    if (target.id !== it.list_id) {
      stmts.push(db.prepare('UPDATE shopping_items SET list_id = ?2 WHERE id = ?1').bind(it.id, target.id))
    }
    bumpRank(target.id, it.manual_rank)
  }

  const fresh: Array<{ listId: number; item: AggregatedItem }> = []
  for (const [trip, tripItems] of byTrip) {
    const list = lists.get(trip)!
    for (const item of tripItems) {
      const old = generated.get(item.key)
      const single = item.parts.length === 1 ? item.parts[0] : null
      const values = [
        list.id,
        item.ingredientId,
        item.name,
        single?.quantity ?? null,
        single?.unit ?? null,
        formatAmount(item.parts),
        item.section,
        JSON.stringify(item.recipeIds),
      ] as const
      if (old) {
        generated.delete(item.key)
        bumpRank(list.id, old.manual_rank)
        stmts.push(
          db
            .prepare(
              `UPDATE shopping_items SET list_id = ?2, ingredient_id = ?3, name = ?4, quantity = ?5, unit = ?6,
                 amount_text = ?7, section = ?8, recipe_ids = ?9 WHERE id = ?1`,
            )
            .bind(old.id, ...values),
        )
      } else {
        fresh.push({ listId: list.id, item })
      }
    }
  }

  // New items get manual ranks in aisle order, after everything kept.
  for (const list of lists.values()) {
    const mine = fresh.filter((f) => f.listId === list.id)
    const sorted = sortItems(
      mine.map((f) => ({ ...f.item, manualRank: null, checked: false, f })),
      'aisle',
      list,
    ).flatMap((g) => g.items)
    let rank = (maxRank.get(list.id) ?? -1) + 1
    for (const { f } of sorted) {
      const it = f.item
      const single = it.parts.length === 1 ? it.parts[0] : null
      stmts.push(
        db
          .prepare(
            `INSERT INTO shopping_items
               (list_id, ingredient_id, name, quantity, unit, amount_text, section, recipe_ids, source, manual_rank, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'generated', ?9, ?10)`,
          )
          .bind(
            list.id,
            it.ingredientId,
            it.name,
            single?.quantity ?? null,
            single?.unit ?? null,
            formatAmount(it.parts),
            it.section,
            JSON.stringify(it.recipeIds),
            rank++,
            now,
          ),
      )
    }
  }

  // 4. Generated items no recipe needs any more, and lists no longer used.
  for (const old of generated.values()) stmts.push(db.prepare('DELETE FROM shopping_items WHERE id = ?1').bind(old.id))
  for (const l of spare) stmts.push(db.prepare('DELETE FROM shopping_lists WHERE id = ?1').bind(l.id))
  for (const list of lists.values()) {
    stmts.push(db.prepare('UPDATE shopping_lists SET generated_at = ?2 WHERE id = ?1').bind(list.id, now))
  }
  await db.batch(stmts)

  // 5. Price estimates for anything new, after the response (see prices.ts).
  opts.waitUntil?.(estimateWeekPrices(env, weekId))
}
