import type { ReceiptLineView, ReceiptSaveInput, ReceiptSaveResponse, ReceiptView } from '../../../shared/receipts'
import { linePrice, pickPrice, type PriceSource } from '../../../shared/receipts/prices'
import type { ReadLine } from './claude'

// Receipts and their lines (migration 0011). The photo is never stored.

interface ReceiptRow {
  id: number
  store_id: number
  purchased_on: string | null
  status: 'review' | 'saved'
  created_at: number
}

interface LineRow {
  id: number
  text: string
  price_cents: number
  quantity: number
  unit_price_cents: number | null
  weight: string | null
  size: string | null
  ingredient_id: number | null
  ingredient_name: string | null
  match: ReceiptLineView['match']
}

const toLine = (r: LineRow): ReceiptLineView => {
  const l = {
    priceCents: r.price_cents,
    quantity: r.quantity,
    unitPriceCents: r.unit_price_cents,
    weight: r.weight,
    size: r.size,
  }
  return {
    id: r.id,
    text: r.text,
    ...l,
    ingredientId: r.ingredient_id,
    ingredientName: r.ingredient_name,
    match: r.match,
    price: linePrice(l),
  }
}

export async function getReceipt(db: D1Database, id: number, printedStore: string | null = null): Promise<ReceiptView | null> {
  const [rRes, lRes] = await db.batch([
    db.prepare('SELECT * FROM receipts WHERE id = ?1').bind(id),
    db
      .prepare(
        `SELECT l.*, i.name AS ingredient_name FROM receipt_lines l
         LEFT JOIN ingredients i ON i.id = l.ingredient_id
         WHERE l.receipt_id = ?1 ORDER BY l.position`,
      )
      .bind(id),
  ])
  const r = (rRes.results as ReceiptRow[])[0]
  if (!r) return null
  return {
    id: r.id,
    storeId: r.store_id,
    printedStore,
    purchasedOn: r.purchased_on,
    status: r.status,
    lines: (lRes.results as LineRow[]).map(toLine),
  }
}

export async function insertReceipt(
  db: D1Database,
  r: { storeId: number; purchasedOn: string | null; userId: string; now: number },
  lines: ReadonlyArray<ReadLine & { ingredientId: number | null; match: 'name' | 'claude' | null }>,
): Promise<number> {
  const row = await db
    .prepare('INSERT INTO receipts (store_id, purchased_on, created_by, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id')
    .bind(r.storeId, r.purchasedOn, r.userId, r.now)
    .first<{ id: number }>()
  const id = row!.id
  if (lines.length) {
    await db.batch(
      lines.map((l, i) =>
        db
          .prepare(
            `INSERT INTO receipt_lines (receipt_id, position, text, price_cents, quantity, unit_price_cents, weight, size, ingredient_id, match)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
          )
          .bind(id, i, l.text, l.price_cents, l.quantity, l.unit_price_cents, l.weight, l.size, l.ingredientId, l.match),
      ),
    )
  }
  return id
}

// The time a receipt's prices are dated: noon on the printed purchase date,
// else when it was scanned.
export const receiptTime = (r: { purchased_on: string | null; created_at: number }) =>
  r.purchased_on ? Date.parse(`${r.purchased_on}T12:00:00Z`) : r.created_at

// Applies the checked matches, then writes one price per matched ingredient
// (its first line) at the receipt's store wherever pickPrice prefers it to
// the price already there: estimates and older receipt prices give way,
// manual prices never do. null when the receipt does not exist.
export async function saveReceipt(db: D1Database, id: number, input: ReceiptSaveInput, now = Date.now()): Promise<ReceiptSaveResponse | null> {
  const receipt = await db.prepare('SELECT * FROM receipts WHERE id = ?1').bind(id).first<ReceiptRow>()
  if (!receipt) return null

  // Matches: only this receipt's lines, only ingredients that exist.
  const wanted = [...new Set(input.lines.flatMap((l) => (l.ingredientId != null ? [l.ingredientId] : [])))]
  const { results: known } = await db
    .prepare('SELECT id FROM ingredients WHERE id IN (SELECT value FROM json_each(?1))')
    .bind(JSON.stringify(wanted))
    .all<{ id: number }>()
  const exists = new Set(known.map((k) => k.id))
  const { results: current } = await db
    .prepare('SELECT id, ingredient_id FROM receipt_lines WHERE receipt_id = ?1')
    .bind(id)
    .all<{ id: number; ingredient_id: number | null }>()
  const before = new Map(current.map((l) => [l.id, l.ingredient_id]))
  const updates = input.lines.filter(
    (l) => before.has(l.id) && (l.ingredientId == null || exists.has(l.ingredientId)) && before.get(l.id) !== l.ingredientId,
  )
  if (updates.length) {
    await db.batch(
      updates.map((l) =>
        db.prepare(`UPDATE receipt_lines SET ingredient_id = ?1, match = 'user' WHERE id = ?2`).bind(l.ingredientId, l.id),
      ),
    )
  }

  const view = (await getReceipt(db, id))!
  const firstLine = new Map<number, ReceiptLineView>()
  for (const l of view.lines) if (l.ingredientId != null && !firstLine.has(l.ingredientId)) firstLine.set(l.ingredientId, l)

  const at = receiptTime(receipt)
  const { results: existing } = await db
    .prepare(
      `SELECT ingredient_id, source, updated_at FROM ingredient_prices
       WHERE store_id = ?1 AND ingredient_id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(receipt.store_id, JSON.stringify([...firstLine.keys()]))
    .all<{ ingredient_id: number; source: PriceSource; updated_at: number }>()
  const have = new Map(existing.map((e) => [e.ingredient_id, { source: e.source, updatedAt: e.updated_at }]))

  let keptManual = 0
  const writes: D1PreparedStatement[] = []
  for (const [ingredientId, line] of firstLine) {
    const old = have.get(ingredientId)
    const incoming = { source: 'receipt' as const, updatedAt: at }
    if (old && pickPrice([old, incoming], now) !== incoming) {
      if (old.source === 'manual') keptManual++
      continue
    }
    writes.push(
      db
        .prepare(
          `INSERT INTO ingredient_prices (ingredient_id, store_id, cents, unit, source, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'receipt', ?5)
           ON CONFLICT (ingredient_id, store_id) DO UPDATE SET
             cents = excluded.cents, unit = excluded.unit, source = 'receipt', updated_at = excluded.updated_at
           WHERE ingredient_prices.source != 'manual'`,
        )
        .bind(ingredientId, receipt.store_id, line.price.cents, line.price.unit, at),
    )
  }
  writes.push(db.prepare(`UPDATE receipts SET status = 'saved', saved_at = ?1 WHERE id = ?2`).bind(now, id))
  await db.batch(writes)
  return { saved: writes.length - 1, keptManual }
}
