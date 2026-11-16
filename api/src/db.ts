import { cleanText, normalizeTag } from '../../shared/normalize'
import type { NormalizedRecipeInput } from '../../shared/recipeInput'
import type {
  Ingredient,
  Me,
  Recipe,
  RecipeIngredient,
  RecipeListQuery,
  RecipeSummary,
  Store,
} from '../../shared/schema'

// The data layer. Every function takes the D1Database binding explicitly
// rather than reading it off Env, so tests can pass a Miniflare-backed
// binding without going through a Worker request. Functions return the wire
// types from shared/schema.ts: the snake_case -> camelCase mapping lives here
// and nowhere else.

// ---------------------------------------------------------------------------
// Row types (exactly what D1 hands back)

interface UserRow {
  id: string
  display_name: string | null
  created_at: number
}

interface RecipeRow {
  id: string
  title: string
  description: string | null
  source_url: string | null
  image_url: string | null
  icon: string | null
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  instructions: string
  notes: string | null
  created_by: string | null
  created_at: number
  updated_at: number
  archived_at: number | null
  notion_page_id: string | null
}

interface RecipeSummaryRow {
  id: string
  title: string
  description: string | null
  icon: string | null
  image_url: string | null
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  updated_at: number
  tags: string
  ingredient_count: number
}

interface RecipeIngredientRow {
  id: number
  position: number
  raw_text: string
  ingredient_id: number | null
  ingredient_name: string | null
  quantity: number | null
  unit: string | null
  note: string | null
  optional: number
}

interface IngredientRow {
  id: number
  name: string
  section: string | null
  perishable: number
  is_staple: number
  aliases: string
}

interface StoreRow {
  id: number
  name: string
  section_order: string
  is_default: number
}

// ---------------------------------------------------------------------------
// Mappers

function parseStringArray(json: string): string[] {
  const v: unknown = JSON.parse(json)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

const toRecipeIngredient = (r: RecipeIngredientRow): RecipeIngredient => ({
  id: r.id,
  position: r.position,
  rawText: r.raw_text,
  ingredientId: r.ingredient_id,
  ingredientName: r.ingredient_name,
  quantity: r.quantity,
  unit: r.unit,
  note: r.note,
  optional: r.optional === 1,
})

const toIngredient = (r: IngredientRow): Ingredient => ({
  id: r.id,
  name: r.name,
  section: r.section,
  perishable: r.perishable === 1,
  isStaple: r.is_staple === 1,
  aliases: parseStringArray(r.aliases),
})

const toStore = (r: StoreRow): Store => ({
  id: r.id,
  name: r.name,
  sectionOrder: parseStringArray(r.section_order),
  isDefault: r.is_default === 1,
})

// LIKE pattern for a user-typed substring, with % _ and \ escaped. Every LIKE
// that takes one of these must say ESCAPE '\'.
function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
}
function likePrefix(q: string): string {
  return `${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
}

// ---------------------------------------------------------------------------
// Users

// Called on every authenticated request (see index.ts). Idempotent.
export async function ensureUser(db: D1Database, email: string, now = Date.now()): Promise<void> {
  await db
    .prepare('INSERT INTO users (id, created_at) VALUES (?1, ?2) ON CONFLICT(id) DO NOTHING')
    .bind(email, now)
    .run()
}

export async function getMe(db: D1Database, email: string): Promise<Me> {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?1').bind(email).first<UserRow>()
  return { email, displayName: row?.display_name ?? null }
}

// ---------------------------------------------------------------------------
// Recipes

const SUMMARY_COLUMNS = `
  r.id, r.title, r.description, r.icon, r.image_url, r.servings,
  r.prep_minutes, r.cook_minutes, r.updated_at,
  (SELECT json_group_array(tag) FROM (
     SELECT t.tag FROM recipe_tags t WHERE t.recipe_id = r.id ORDER BY t.tag
  )) AS tags,
  (SELECT count(*) FROM recipe_ingredients ri WHERE ri.recipe_id = r.id) AS ingredient_count`

export async function listRecipes(db: D1Database, query: RecipeListQuery = {}): Promise<RecipeSummary[]> {
  const where = ['r.archived_at IS NULL']
  const params: unknown[] = []
  if (query.q) {
    params.push(likeContains(query.q))
    const p = `?${params.length}`
    where.push(`(r.title LIKE ${p} ESCAPE '\\' OR r.description LIKE ${p} ESCAPE '\\')`)
  }
  if (query.tag) {
    params.push(normalizeTag(query.tag))
    where.push(`EXISTS (SELECT 1 FROM recipe_tags t WHERE t.recipe_id = r.id AND t.tag = ?${params.length})`)
  }
  const sql = `SELECT ${SUMMARY_COLUMNS} FROM recipes r WHERE ${where.join(' AND ')}
               ORDER BY r.title COLLATE NOCASE, r.id`
  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all<RecipeSummaryRow>()
  return results.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    icon: r.icon,
    imageUrl: r.image_url,
    servings: r.servings,
    prepMinutes: r.prep_minutes,
    cookMinutes: r.cook_minutes,
    updatedAt: r.updated_at,
    tags: parseStringArray(r.tags),
    ingredientCount: r.ingredient_count,
  }))
}

// Returns archived recipes too: plans that reference one still need to show
// it. One round trip via batch.
export async function getRecipe(db: D1Database, id: string): Promise<Recipe | null> {
  const [recipeRes, tagRes, ingRes] = await db.batch([
    db.prepare('SELECT * FROM recipes WHERE id = ?1').bind(id),
    db.prepare('SELECT tag FROM recipe_tags WHERE recipe_id = ?1 ORDER BY tag').bind(id),
    db
      .prepare(
        `SELECT ri.id, ri.position, ri.raw_text, ri.ingredient_id, i.name AS ingredient_name,
                ri.quantity, ri.unit, ri.note, ri.optional
         FROM recipe_ingredients ri
         LEFT JOIN ingredients i ON i.id = ri.ingredient_id
         WHERE ri.recipe_id = ?1
         ORDER BY ri.position`,
      )
      .bind(id),
  ])
  const row = (recipeRes.results as RecipeRow[])[0]
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    sourceUrl: row.source_url,
    imageUrl: row.image_url,
    icon: row.icon,
    servings: row.servings,
    prepMinutes: row.prep_minutes,
    cookMinutes: row.cook_minutes,
    instructions: parseStringArray(row.instructions),
    notes: row.notes,
    tags: (tagRes.results as Array<{ tag: string }>).map((t) => t.tag),
    ingredients: (ingRes.results as RecipeIngredientRow[]).map(toRecipeIngredient),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    notionPageId: row.notion_page_id,
  }
}

// The statements that replace a recipe's tags and ingredient lines. They run
// inside the same db.batch() as the recipe row's INSERT/UPDATE, and D1 runs a
// batch as one transaction, so a failure anywhere leaves the recipe exactly
// as it was.
//
// `input` has been through normalizeRecipeInput (shared/recipeInput.ts), so
// tags and ingredient names are already canonical.
//
// Ingredient matching happens in SQL, not in a read-then-write from the
// Worker, so it is atomic with the rest of the batch:
//   1. For each distinct canonical name, insert a catalog row unless the
//      name already exists (ON CONFLICT on the UNIQUE name) or is already
//      some ingredient's alias (the WHERE NOT EXISTS).
//   2. Each recipe_ingredients row looks its ingredient_id up by name first,
//      then by alias. A line with no name ('') matches nothing and stays
//      unlinked.
function replaceChildrenStatements(db: D1Database, recipeId: string, input: NormalizedRecipeInput, now: number) {
  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM recipe_tags WHERE recipe_id = ?1').bind(recipeId),
    db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?1').bind(recipeId),
  ]

  for (const tag of input.tags) {
    stmts.push(db.prepare('INSERT INTO recipe_tags (recipe_id, tag) VALUES (?1, ?2)').bind(recipeId, tag))
  }

  const lines = input.ingredients

  for (const name of new Set(lines.map((l) => l.name).filter(Boolean))) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO ingredients (name, created_at)
           SELECT ?1, ?2
           WHERE NOT EXISTS (
             SELECT 1 FROM ingredients i, json_each(i.aliases) a WHERE a.value = ?1
           )
           ON CONFLICT(name) DO NOTHING`,
        )
        .bind(name, now),
    )
  }

  lines.forEach((line, position) => {
    stmts.push(
      db
        .prepare(
          `INSERT INTO recipe_ingredients
             (recipe_id, position, raw_text, ingredient_id, quantity, unit, note, optional)
           VALUES (?1, ?2, ?3,
             coalesce(
               (SELECT id FROM ingredients WHERE name = ?4),
               (SELECT i.id FROM ingredients i, json_each(i.aliases) a WHERE a.value = ?4 ORDER BY i.id LIMIT 1)
             ),
             ?5, ?6, ?7, ?8)`,
        )
        .bind(recipeId, position, line.rawText, line.name, line.quantity, line.unit, line.note, line.optional ? 1 : 0),
    )
  })

  return stmts
}

// Titles are unique, ignoring case, among non-archived recipes (also enforced
// by an index in migration 0002). Returns the id holding `title`, if any.
export async function findActiveRecipeByTitle(db: D1Database, title: string, exceptId = ''): Promise<string | null> {
  const row = await db
    .prepare('SELECT id FROM recipes WHERE lower(title) = lower(?1) AND archived_at IS NULL AND id != ?2')
    .bind(title, exceptId)
    .first<{ id: string }>()
  return row?.id ?? null
}

export type SaveResult = Recipe | { conflict: string } | null

// Returns { conflict: existingId } when another active recipe has the title.
export async function createRecipe(
  db: D1Database,
  userId: string,
  input: NormalizedRecipeInput,
  now = Date.now(),
): Promise<Recipe | { conflict: string }> {
  const existing = await findActiveRecipeByTitle(db, input.title)
  if (existing) return { conflict: existing }
  const id = crypto.randomUUID()
  await db.batch([
    db
      .prepare(
        `INSERT INTO recipes
           (id, title, description, source_url, image_url, icon, servings, prep_minutes,
            cook_minutes, instructions, notes, created_by, created_at, updated_at, notion_page_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, ?14)`,
      )
      .bind(
        id,
        input.title,
        input.description,
        input.sourceUrl,
        input.imageUrl,
        input.icon,
        input.servings,
        input.prepMinutes,
        input.cookMinutes,
        JSON.stringify(input.instructions),
        input.notes,
        userId,
        now,
        input.notionPageId,
      ),
    ...replaceChildrenStatements(db, id, input, now),
  ])
  const created = await getRecipe(db, id)
  if (!created) throw new Error(`recipe ${id} vanished after insert`)
  return created
}

// Full replace. Returns null when no recipe has this id, and { conflict }
// as createRecipe does. Updating an archived recipe leaves it archived.
export async function updateRecipe(
  db: D1Database,
  id: string,
  input: NormalizedRecipeInput,
  now = Date.now(),
): Promise<SaveResult> {
  const exists = await db.prepare('SELECT 1 AS x FROM recipes WHERE id = ?1').bind(id).first()
  if (!exists) return null
  const existing = await findActiveRecipeByTitle(db, input.title, id)
  if (existing) return { conflict: existing }
  await db.batch([
    db
      .prepare(
        `UPDATE recipes SET
           title = ?2, description = ?3, source_url = ?4, image_url = ?5, icon = ?6,
           servings = ?7, prep_minutes = ?8, cook_minutes = ?9, instructions = ?10,
           notes = ?11, notion_page_id = ?12, updated_at = ?13
         WHERE id = ?1`,
      )
      .bind(
        id,
        input.title,
        input.description,
        input.sourceUrl,
        input.imageUrl,
        input.icon,
        input.servings,
        input.prepMinutes,
        input.cookMinutes,
        JSON.stringify(input.instructions),
        input.notes,
        input.notionPageId,
        now,
      ),
    ...replaceChildrenStatements(db, id, input, now),
  ])
  return getRecipe(db, id)
}

// Soft delete. Returns false when no recipe has this id. Archiving twice keeps
// the first archived_at.
export async function archiveRecipe(db: D1Database, id: string, now = Date.now()): Promise<boolean> {
  const res = await db
    .prepare('UPDATE recipes SET archived_at = coalesce(archived_at, ?2), updated_at = ?2 WHERE id = ?1')
    .bind(id, now)
    .run()
  return res.meta.changes > 0
}

// ---------------------------------------------------------------------------
// Ingredients

// Autocomplete: names (or aliases) containing q, prefix matches first. With
// no q, the first `limit` names alphabetically.
export async function searchIngredients(db: D1Database, q: string | undefined, limit = 20): Promise<Ingredient[]> {
  const norm = q ? cleanText(q).toLowerCase() : ''
  if (!norm) {
    const { results } = await db
      .prepare('SELECT * FROM ingredients ORDER BY name LIMIT ?1')
      .bind(limit)
      .all<IngredientRow>()
    return results.map(toIngredient)
  }
  const { results } = await db
    .prepare(
      `SELECT * FROM ingredients
       WHERE name LIKE ?1 ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM json_each(aliases) a WHERE a.value LIKE ?1 ESCAPE '\\')
       ORDER BY CASE WHEN name LIKE ?2 ESCAPE '\\' THEN 0 ELSE 1 END, name
       LIMIT ?3`,
    )
    .bind(likeContains(norm), likePrefix(norm), limit)
    .all<IngredientRow>()
  return results.map(toIngredient)
}

// ---------------------------------------------------------------------------
// Stores

export async function listStores(db: D1Database): Promise<Store[]> {
  const { results } = await db
    .prepare('SELECT id, name, section_order, is_default FROM stores ORDER BY is_default DESC, name')
    .all<StoreRow>()
  return results.map(toStore)
}
