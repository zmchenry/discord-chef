import type { FoodItemFields, FoodLogItem } from '../../../shared/foodLog'

// D1 access for the food log. snake_case rows in, shared shapes out.

interface Row {
  id: string
  person: string
  date: string
  meal: FoodLogItem['meal']
  label: string
  quantity: string | null
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  fiber: number | null
  source: FoodLogItem['source']
  recipe_id: string | null
  recipe_title: string | null
  servings: number | null
  confidence: FoodLogItem['confidence']
  brand: string | null
  created_by: string | null
  created_at: number
}

const toItem = (r: Row): FoodLogItem => ({
  id: r.id,
  person: r.person,
  date: r.date,
  meal: r.meal,
  label: r.label,
  quantity: r.quantity,
  kcal: r.kcal,
  protein: r.protein,
  carbs: r.carbs,
  fat: r.fat,
  fiber: r.fiber,
  source: r.source,
  recipeId: r.recipe_id,
  recipeTitle: r.recipe_title,
  servings: r.servings,
  confidence: r.confidence,
  brand: r.brand,
  createdBy: r.created_by,
  createdAt: r.created_at,
})

const SELECT = `SELECT f.*, r.title AS recipe_title FROM food_log f LEFT JOIN recipes r ON r.id = f.recipe_id`
const MEAL_ORDER = `CASE f.meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'snack' THEN 2 ELSE 3 END`

/** Every item between from and to (inclusive), oldest first, in meal order. */
export async function loadFoodLog(db: D1Database, from: string, to: string): Promise<FoodLogItem[]> {
  const { results } = await db
    .prepare(`${SELECT} WHERE f.date BETWEEN ?1 AND ?2 ORDER BY f.date, ${MEAL_ORDER}, f.created_at, f.id`)
    .bind(from, to)
    .all<Row>()
  return results.map(toItem)
}

export async function getItem(db: D1Database, id: string): Promise<FoodLogItem | null> {
  const row = await db.prepare(`${SELECT} WHERE f.id = ?1`).bind(id).first<Row>()
  return row ? toItem(row) : null
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10)

const fieldArgs = (f: FoodItemFields) => [
  f.meal,
  f.label,
  f.quantity,
  round1(f.kcal),
  round1(f.protein),
  round1(f.carbs),
  round1(f.fat),
  round1(f.fiber),
  f.source,
  f.recipeId,
  f.servings,
  f.confidence,
  f.brand,
]

export async function insertItems(
  db: D1Database,
  rows: ReadonlyArray<{ person: string; date: string; fields: FoodItemFields }>,
  userId: string,
): Promise<string[]> {
  const now = Date.now()
  const ids = rows.map(() => crypto.randomUUID())
  await db.batch(
    rows.map((r, i) =>
      db
        .prepare(
          `INSERT INTO food_log (id, person, date, meal, label, quantity, kcal, protein, carbs, fat, fiber, source,
             recipe_id, servings, confidence, brand, created_by, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18)`,
        )
        .bind(ids[i], r.person, r.date, ...fieldArgs(r.fields), userId, now),
    ),
  )
  return ids
}

export async function updateItem(db: D1Database, id: string, f: FoodItemFields): Promise<void> {
  await db
    .prepare(
      `UPDATE food_log SET meal = ?2, label = ?3, quantity = ?4, kcal = ?5, protein = ?6, carbs = ?7, fat = ?8,
         fiber = ?9, source = ?10, recipe_id = ?11, servings = ?12, confidence = ?13, brand = ?14, updated_at = ?15
       WHERE id = ?1`,
    )
    .bind(id, ...fieldArgs(f), Date.now())
    .run()
}

export async function deleteItem(db: D1Database, id: string): Promise<boolean> {
  const r = await db.prepare('DELETE FROM food_log WHERE id = ?1').bind(id).run()
  return (r.meta.changes ?? 0) > 0
}

// --- Who is signed in --------------------------------------------------------

// The household person the signed-in user is: their display name when it
// names one, else an email that starts with exactly one person's name
// ("zach.something@..."), else null (the app asks once and saves it as the
// display name).
export async function personFor(db: D1Database, userId: string, people: readonly string[]): Promise<string | null> {
  const row = await db.prepare('SELECT display_name FROM users WHERE id = ?1').bind(userId).first<{ display_name: string | null }>()
  const named = row?.display_name?.trim().toLowerCase()
  if (named) {
    const hit = people.find((p) => p.toLowerCase() === named || named.split(/\s+/)[0] === p.toLowerCase())
    if (hit) return hit
  }
  const local = (userId.split('@')[0] ?? '').toLowerCase().replace(/[^a-z]/g, '')
  const byEmail = people.filter((p) => local.startsWith(p.toLowerCase().replace(/[^a-z]/g, '')))
  return byEmail.length === 1 ? byEmail[0]! : null
}

export async function setPerson(db: D1Database, userId: string, person: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, display_name, created_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name`,
    )
    .bind(userId, person, Date.now())
    .run()
}
