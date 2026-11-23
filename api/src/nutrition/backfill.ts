import { fillAmounts, recipesNeedingAmounts } from './amounts'
import { fillNutrition } from './estimate'

// Every cron run (15 minutes) until nothing is left: a few recipes get
// amounts for their lines written without one, then one batch of catalog
// ingredients used by active recipes gets nutrition. Idempotent; a failed
// call is simply tried again next run. Never throws.
export const AMOUNT_RECIPES_PER_RUN = 4
export const NUTRITION_PER_RUN = 40

export async function runNutritionBackfill(env: Pick<Env, 'DB' | 'ANTHROPIC_API_KEY'>): Promise<void> {
  const key = env.ANTHROPIC_API_KEY
  if (!key) return
  try {
    const ids = await recipesNeedingAmounts(env.DB, AMOUNT_RECIPES_PER_RUN)
    await Promise.all(ids.map((id) => fillAmounts(env.DB, key, id)))
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT ri.ingredient_id AS id FROM recipe_ingredients ri
       JOIN recipes r ON r.id = ri.recipe_id AND r.archived_at IS NULL
       WHERE ri.ingredient_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM ingredient_nutrition n WHERE n.ingredient_id = ri.ingredient_id)
       ORDER BY random() LIMIT ?1`,
    )
      .bind(NUTRITION_PER_RUN)
      .all<{ id: number }>()
    if (results.length) await fillNutrition(env, results.map((r) => r.id), { force: true })
  } catch (err) {
    console.error(JSON.stringify({ event: 'nutrition_backfill_failed', error: String(err) }))
  }
}
