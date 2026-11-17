import { planServings, type MealServings } from '../../../shared/household/servings'
import { weekDates } from '../../../shared/planningApi'
import { weekSlots } from '../nutrition/db'

// A week's servings by slot id: how many each meal makes and how far each
// recipe scales. Shopping reads the factors from here.
export async function weekServings(db: D1Database, weekId: string): Promise<Map<number, MealServings>> {
  const dates = weekDates(weekId)
  const slots = await weekSlots(db, weekId)
  const recipeIds = [...new Set(slots.flatMap((s) => (s.recipeId ? [s.recipeId] : [])))]
  const recipes = await db
    .prepare('SELECT id, servings FROM recipes WHERE id IN (SELECT value FROM json_each(?1))')
    .bind(JSON.stringify(recipeIds))
    .all<{ id: string; servings: number | null }>()
  const result = planServings({
    dates,
    slots,
    recipeServings: Object.fromEntries(recipes.results.map((r) => [r.id, r.servings])),
  })
  const byKey = new Map(result.map((r) => [`${r.date}:${r.meal}`, r]))
  return new Map(
    slots.flatMap((s) => {
      const ms = byKey.get(`${s.date}:${s.meal}`)
      return ms ? [[s.id, ms] as const] : []
    }),
  )
}
