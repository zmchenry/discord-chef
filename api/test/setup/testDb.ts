import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Miniflare } from 'miniflare'

// Copied from fire-calculator's approach. `miniflare`, the library wrangler
// itself uses for `wrangler dev` and `--local` d1 commands, hands back a real
// D1Database (in-memory SQLite inside a workerd instance) reachable from plain
// Node code. That is the real engine with real constraint enforcement
// (foreign keys, CHECKs), without moving the suite into vitest-pool-workers.
// Each test gets its own fresh instance so tests cannot see each other's rows.
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations')

async function readMigrationStatements(): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  const statements: string[] = []
  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf-8')
    // D1Database#exec only accepts one statement per line, so multi-line
    // statements need real splitting. Line comments are stripped first so a
    // comment-only chunk is never prepared. Migrations must not contain ';'
    // inside comments or string literals, nor '--' inside string literals
    // (0001_init.sql says so at the top).
    const code = sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n')
    for (const stmt of code.split(';').map((s) => s.trim())) {
      if (stmt) statements.push(stmt)
    }
  }
  return statements
}

export interface TestDb {
  db: D1Database
  dispose(): Promise<void>
}

export async function createTestDb(): Promise<TestDb> {
  // The `miniflare` devDependency is pinned to the build fire-calculator
  // uses, separately from the newer one wrangler bundles: later 5.x betas
  // replaced this single-worker options shape with a different config model.
  // Tests only need a D1 binding, which is unaffected by the compat date.
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('unused') } }",
    d1Databases: { DB: 'test-db' },
  })

  const db = await mf.getD1Database('DB')
  for (const stmt of await readMigrationStatements()) {
    await db.prepare(stmt).run()
  }

  return { db, dispose: () => mf.dispose() }
}
