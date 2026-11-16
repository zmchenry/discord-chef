import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createTestDb, type TestDb } from './setup/testDb'

// The CHECK and foreign-key constraints in migrations/0001_init.sql are part
// of the contract other phases build on, so a few are pinned here.
let testDb: TestDb

beforeEach(async () => {
  testDb = await createTestDb()
})

afterEach(async () => {
  await testDb.dispose()
})

const run = (sql: string) => testDb.db.prepare(sql).run()

describe('migration 0001', () => {
  it('creates every table in the data model', async () => {
    const { results } = await testDb.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
      .all<{ name: string }>()
    // arrayContaining: later migrations add their own tables.
    expect(results.map((r) => r.name)).toEqual(expect.arrayContaining([
      'check_events', 'ingredients', 'notification_prefs', 'plan_slots', 'push_subscriptions',
      'recipe_ingredients', 'recipe_tags', 'recipes', 'shopping_items', 'shopping_lists',
      'stores', 'users', 'weeks',
    ]))
  })

  it('enforces plan slot enums and the recipe/kind pairing', async () => {
    await run("INSERT INTO weeks (id, created_at, updated_at) VALUES ('2026-11-16', 0, 0)")
    await expect(
      run("INSERT INTO plan_slots (week_id, day, meal, kind, updated_at) VALUES ('2026-11-16', 0, 'brunch', 'skip', 0)"),
    ).rejects.toThrow(/CHECK/)
    await expect(
      run("INSERT INTO plan_slots (week_id, day, meal, kind, updated_at) VALUES ('2026-11-16', 7, 'lunch', 'skip', 0)"),
    ).rejects.toThrow(/CHECK/)
    await expect(
      run("INSERT INTO plan_slots (week_id, day, meal, kind, updated_at) VALUES ('2026-11-16', 0, 'lunch', 'recipe', 0)"),
    ).rejects.toThrow(/CHECK/)
    await run("INSERT INTO plan_slots (week_id, day, meal, kind, updated_at) VALUES ('2026-11-16', 0, 'lunch', 'eat_out', 0)")
    await expect(
      run("INSERT INTO plan_slots (week_id, day, meal, kind, updated_at) VALUES ('2026-11-16', 0, 'lunch', 'skip', 0)"),
    ).rejects.toThrow(/UNIQUE/)
  })

  it('rejects a malformed week id', async () => {
    await expect(run("INSERT INTO weeks (id, created_at, updated_at) VALUES ('2026-13-45', 0, 0)")).rejects.toThrow(/CHECK/)
  })

  it('enforces foreign keys', async () => {
    await run("INSERT INTO weeks (id, created_at, updated_at) VALUES ('2026-11-16', 0, 0)")
    await expect(
      run(
        "INSERT INTO plan_slots (week_id, day, meal, kind, recipe_id, updated_at) VALUES ('2026-11-16', 0, 'dinner', 'recipe', 'missing', 0)",
      ),
    ).rejects.toThrow(/FOREIGN KEY/)
  })

  it('allows only one default store and one list per week and trip', async () => {
    await expect(run("INSERT INTO stores (name, is_default, created_at) VALUES ('Third', 1, 0)")).rejects.toThrow(/UNIQUE/)
    await run("INSERT INTO weeks (id, created_at, updated_at) VALUES ('2026-11-16', 0, 0)")
    await run("INSERT INTO shopping_lists (week_id, store_id, created_at) VALUES ('2026-11-16', 1, 0)")
    await expect(
      run("INSERT INTO shopping_lists (week_id, store_id, created_at) VALUES ('2026-11-16', 1, 0)"),
    ).rejects.toThrow(/UNIQUE/)
    await run("INSERT INTO shopping_lists (week_id, trip, store_id, created_at) VALUES ('2026-11-16', 'midweek', 1, 0)")
  })

  it('rejects a non-canonical ingredient name', async () => {
    await expect(run("INSERT INTO ingredients (name, created_at) VALUES ('Tomato', 0)")).rejects.toThrow(/CHECK/)
  })
})
