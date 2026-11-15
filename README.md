# Chef

A private meal-planning web app for a two-person household: recipes, a weekly
breakfast/lunch/dinner plan, and the shopping list that falls out of it.
Installable on Android as a PWA. Served from `chef.zmchenry.com` behind
Cloudflare Access.

One Cloudflare Worker serves both `/api/*` (Hono, D1) and the React SPA as
static assets. The plan and the data model live in
[`project-plans/chef.md`](project-plans/chef.md).

The old Discord bot (Python + Notion) lives in git history and on `main` until
cutover.

## Make targets

| Target | What it does |
|---|---|
| `make install` | `npm install` at the root and in `web/`, then `wrangler types` |
| `make dev` | Vite on :5173 with HMR, proxying `/api` to :8787 |
| `make dev-api` | `wrangler dev` on :8787: the Worker plus `web/dist`, local D1 |
| `make build` | Builds the SPA into `web/dist` |
| `make types` | Regenerates `worker-configuration.d.ts` from `wrangler.jsonc` |
| `make typecheck` | `tsc` over api, shared, tests and web |
| `make test` | API tests (vitest + miniflare D1) and web unit tests |
| `make e2e` | Playwright smoke test at Pixel 7 size against `vite preview` with a mocked `/api` |
| `make db-migrate` | Applies `migrations/` to the local D1 under `.wrangler/` |
| `make db-migrate-remote` | Applies `migrations/` to the real D1 database |
| `make dry-run` | Bundles and validates the Worker without uploading |
| `make deploy` | Builds and deploys (CI normally does this on push to `main`) |

### Local development

```sh
make install
echo 'ENVIRONMENT=development' > .dev.vars   # gitignored
make db-migrate
make build && make dev-api                   # http://localhost:8787
# or, for HMR, run `make dev-api` and `make dev` side by side
```

With `ENVIRONMENT=development` the Worker skips Cloudflare Access and trusts an
`x-dev-user-id` header instead. The web app sends `dev@example.com` in that
header when built in dev mode. Production never sets `ENVIRONMENT`, so it
defaults closed.

## Layout

```
api/         Hono Worker: src/index.ts (routes), session.ts (Access JWT), db.ts
api/test/    vitest suites; setup/testDb.ts gives each test a fresh miniflare D1
shared/      zod schemas and types: the API contract web/ and api/ both import
migrations/  D1 SQL migrations
web/         Vite + React 18 + Tailwind 4 SPA, PWA manifest and service worker
web/e2e/     Playwright smoke tests
.github/     ci.yml (PRs and claude/** branches), deploy.yml (main + manual)
```

## Before the first deploy

1. `npx wrangler d1 create chef` and copy the id into `wrangler.jsonc`.
2. Create the Access application for `chef.zmchenry.com`, then set `POLICY_AUD`
   and `ALLOWED_EMAILS` in `wrangler.jsonc`.
3. Add a `CLOUDFLARE_API_TOKEN` secret to the GitHub repo.
