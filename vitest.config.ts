import { defineConfig } from 'vitest/config'

// API tests only; web/vitest.config.ts covers web/src.
//
// Plain vitest in a node environment, not @cloudflare/vitest-pool-workers:
// index.ts and session.ts are pure functions over a Request (jose uses
// WebCrypto directly) and the JWKS fetch is injected, so nothing there needs
// workerd. The D1 binding does, and api/test/setup/testDb.ts gets a real one
// from miniflare (the library `wrangler dev` uses) with the migrations
// applied, one fresh in-memory database per test.
export default defineConfig({
  test: {
    include: ['api/test/**/*.test.ts'],
    environment: 'node',
    // API tests boot a local D1 each; the Workers Builds runner is several times slower than a laptop.
    testTimeout: 30_000,
  },
})
