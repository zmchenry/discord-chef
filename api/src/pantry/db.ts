import { haveEnough, isOnHand, type PantryItem, type PantryState } from '../../../shared/pantry'

// Pantry data access. A missing row means the default (shared/pantry.ts).

interface PantryRow {
  id: number
  name: string
  section: string | null
  on_hand: number | null
  low: number | null
  updated_at: number | null
  updated_by: string | null
}

const SELECT = `SELECT i.id, i.name, i.section, p.on_hand, p.low, p.updated_at, p.updated_by
  FROM ingredients i LEFT JOIN pantry p ON p.ingredient_id = i.id`

const stateOf = (r: PantryRow): PantryState | null => (r.on_hand == null ? null : { onHand: r.on_hand === 1, low: r.low === 1 })

const toItem = (r: PantryRow): PantryItem => {
  const state = stateOf(r)
  return {
    ingredientId: r.id,
    name: r.name,
    section: r.section,
    onHand: isOnHand(state, r),
    low: state?.low ?? false,
    assumed: state === null,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }
}

export async function listPantry(db: D1Database): Promise<PantryItem[]> {
  const { results } = await db.prepare(`${SELECT} ORDER BY i.name`).all<PantryRow>()
  return results.map(toItem)
}

// The upsert behind PUT /pantry/:id, also used when items are checked off.
export const setPantryStatement = (db: D1Database, ingredientId: number, onHand: boolean, low: boolean, userId: string | null, now = Date.now()) =>
  db
    .prepare(
      `INSERT INTO pantry (ingredient_id, on_hand, low, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(ingredient_id) DO UPDATE SET on_hand = ?2, low = ?3, updated_at = ?4, updated_by = ?5`,
    )
    .bind(ingredientId, onHand ? 1 : 0, onHand && low ? 1 : 0, now, userId)

// Returns null for an unknown ingredient.
export async function setPantry(
  db: D1Database,
  ingredientId: number,
  update: { onHand: boolean; low: boolean },
  userId: string,
): Promise<PantryItem | null> {
  const exists = await db.prepare('SELECT 1 AS x FROM ingredients WHERE id = ?1').bind(ingredientId).first()
  if (!exists) return null
  await setPantryStatement(db, ingredientId, update.onHand, update.low, userId).run()
  const row = await db.prepare(`${SELECT} WHERE i.id = ?1`).bind(ingredientId).first<PantryRow>()
  return row && toItem(row)
}

// Of these ingredients, the ones the list can skip (on hand, not low).
export async function haveEnoughOf(db: D1Database, ingredientIds: Array<number | null>): Promise<Set<number>> {
  const ids = [...new Set(ingredientIds.filter((id): id is number => id != null))]
  if (!ids.length) return new Set()
  const { results } = await db
    .prepare(`${SELECT} WHERE i.id IN (SELECT value FROM json_each(?1))`)
    .bind(JSON.stringify(ids))
    .all<PantryRow>()
  return new Set(results.filter((r) => haveEnough(stateOf(r), r)).map((r) => r.id))
}
