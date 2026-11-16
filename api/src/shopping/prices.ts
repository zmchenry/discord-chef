import type { IngredientPrice } from '../../../shared/shopping'

// Per-ingredient, per-store prices (ingredient_prices, migration 0003).

interface PriceRow {
  ingredient_id: number
  store_id: number
  cents: number
  unit: string | null
  source: 'estimate' | 'manual'
  updated_at: number
}

const toPrice = (r: PriceRow): IngredientPrice => ({
  ingredientId: r.ingredient_id,
  storeId: r.store_id,
  cents: r.cents,
  unit: r.unit,
  source: r.source,
  updatedAt: r.updated_at,
})

// Fills in estimated prices for ingredients that have none, at every store.
// A no-op until the Claude API key exists: it will ask for estimates, cache
// them as source 'estimate' (never overwriting a 'manual' row) and return
// the rows it wrote.
// TODO: wire Claude-based estimation once ANTHROPIC_API_KEY is set.
export async function estimatePrices(_env: Pick<Env, 'DB'>, _ingredientIds: readonly number[]): Promise<IngredientPrice[]> {
  return []
}

export async function getPrices(db: D1Database, ingredientId: number): Promise<IngredientPrice[]> {
  const { results } = await db
    .prepare('SELECT * FROM ingredient_prices WHERE ingredient_id = ?1 ORDER BY store_id')
    .bind(ingredientId)
    .all<PriceRow>()
  return results.map(toPrice)
}

// Manual entry. cents null removes that store's price. Returns null when
// the ingredient does not exist.
export async function setManualPrices(
  db: D1Database,
  ingredientId: number,
  prices: ReadonlyArray<{ storeId: number; cents: number | null; unit: string | null }>,
  now = Date.now(),
): Promise<IngredientPrice[] | null> {
  const exists = await db.prepare('SELECT 1 AS x FROM ingredients WHERE id = ?1').bind(ingredientId).first()
  if (!exists) return null
  const stmts = prices.map((p) =>
    p.cents == null
      ? db.prepare('DELETE FROM ingredient_prices WHERE ingredient_id = ?1 AND store_id = ?2').bind(ingredientId, p.storeId)
      : db
          .prepare(
            `INSERT INTO ingredient_prices (ingredient_id, store_id, cents, unit, source, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'manual', ?5)
             ON CONFLICT (ingredient_id, store_id) DO UPDATE SET
               cents = excluded.cents, unit = excluded.unit, source = 'manual', updated_at = excluded.updated_at`,
          )
          .bind(ingredientId, p.storeId, p.cents, p.unit, now),
  )
  if (stmts.length) await db.batch(stmts)
  return getPrices(db, ingredientId)
}
