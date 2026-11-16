import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { createTestDb, type TestDb } from './setup/testDb'

// Runs scripts/import-notion.ts as a CLI on a tiny synthetic export (never
// real data: the repo is public), then applies its SQL to a fresh database.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FIXTURE = path.join(ROOT, 'api/test/fixtures/notion-import')

function runImport(decisionsDir: string, out: string) {
  return spawnSync(
    process.execPath,
    [
      '--experimental-transform-types',
      '--no-warnings',
      path.join(ROOT, 'scripts/import-notion.ts'),
      ...['--export', path.join(FIXTURE, 'export')],
      ...['--proposal', path.join(FIXTURE, 'proposal.json')],
      ...['--decisions', decisionsDir],
      ...['--out', out],
    ],
    { encoding: 'utf-8' },
  )
}

describe('notion import', () => {
  let tmp: string
  let t: TestDb | undefined
  afterEach(async () => {
    await t?.dispose()
    t = undefined
    rmSync(tmp, { recursive: true, force: true })
  })

  it('applies merges, drops, staples and parsed bodies', async () => {
    tmp = mkdtempSync(path.join(tmpdir(), 'notion-import-'))
    const out = path.join(tmp, 'import.sql')
    const run = runImport(path.join(FIXTURE, 'decisions'), out)
    expect(run.status, run.stderr).toBe(0)

    t = await createTestDb()
    const statements = readFileSync(out, 'utf-8')
      .split('\n')
      .filter((l) => l.startsWith('INSERT'))
    await t.db.batch(statements.map((s) => t!.db.prepare(s)))

    const all = async (sql: string) => (await t!.db.prepare(sql).all()).results
    // Two copies of the toast merged into one; the diner became an eat-out spot.
    expect(await all('SELECT title, source_url, notes FROM recipes ORDER BY title')).toEqual([
      { title: 'Fixture Pancakes', source_url: null, notes: null },
      {
        title: 'Fixture Toast',
        source_url: 'https://example.com/toast',
        notes: 'Re-import from link to fill in steps.',
      },
    ])
    expect(await all("SELECT tag FROM recipe_tags WHERE recipe_id LIKE '%1' ORDER BY tag")).toEqual([
      { tag: 'breakfast' },
      { tag: 'fast' },
      { tag: 'makes-leftovers' },
    ])
    // Both Notion bread rows map to one ingredient; the dead link is gone.
    expect(
      await all(`SELECT r.title, i.name, ri.quantity, ri.unit, ri.note FROM recipe_ingredients ri
                 JOIN recipes r ON r.id = ri.recipe_id JOIN ingredients i ON i.id = ri.ingredient_id
                 ORDER BY r.title, ri.position`),
    ).toEqual([
      { title: 'Fixture Pancakes', name: 'flour', quantity: 2, unit: 'cup', note: null },
      { title: 'Fixture Pancakes', name: 'butter', quantity: 1, unit: 'tbsp', note: 'melted' },
      { title: 'Fixture Toast', name: 'wheat bread', quantity: null, unit: null, note: null },
      { title: 'Fixture Toast', name: 'butter', quantity: null, unit: null, note: null },
    ])
    expect(await all('SELECT name, section, is_staple FROM ingredients ORDER BY name')).toEqual([
      { name: 'butter', section: 'Dairy & Eggs', is_staple: 0 },
      { name: 'flour', section: null, is_staple: 0 },
      { name: 'paper towels', section: 'Household', is_staple: 1 },
      { name: 'wheat bread', section: 'Bakery', is_staple: 0 },
    ])
    expect(await all('SELECT name, meals FROM eat_out_spots')).toEqual([{ name: 'Fixture Diner', meals: '["lunch"]' }])
  })

  it('fails, naming the item, on a decision it cannot apply', () => {
    tmp = mkdtempSync(path.join(tmpdir(), 'notion-import-'))
    const decisions = path.join(tmp, 'decisions')
    cpSync(path.join(FIXTURE, 'decisions'), decisions, { recursive: true })
    const file = path.join(decisions, 'A-dup.json')
    writeFileSync(file, readFileSync(file, 'utf-8').replace('"merge",', '"something_else",'))
    const out = path.join(tmp, 'import.sql')

    const run = runImport(decisions, out)
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('A-dup: unsupported action "something_else"')
  })
})
