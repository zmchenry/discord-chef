.PHONY: install dev dev-api build types typecheck test e2e lint deploy dry-run \
        db-create db-migrate db-migrate-remote db-console

install:
	npm install
	cd web && npm install
	touch .dev.vars
	npx wrangler types --env-file /dev/null

# Vite with HMR on 5173, proxying /api to the Worker from `make dev-api`.
dev:
	cd web && npm run dev

# The Worker plus static assets from web/dist on 8787, with the local D1
# under .wrangler/. No Cloudflare account and no network needed. Put
# ENVIRONMENT=development in .dev.vars to use the dev session provider.
#
# Every wrangler call passes --env-file explicitly. Without it, wrangler
# auto-loads .env/.dev.vars and merges every key into the generated Env type
# as a mandatory string, which clashes with the optional ENVIRONMENT and
# ALLOWED_EMAILS declared in api/src/session.ts. Only `wrangler dev` reads the
# real .dev.vars (local secrets). Everything else gets /dev/null, so local
# secrets never shape the types and never ride along on a deploy command.
dev-api:
	npx wrangler dev --env-file .dev.vars

build:
	cd web && npm run build

# Regenerates worker-configuration.d.ts from wrangler.jsonc, so every binding
# in the config becomes a typed field on Env. Run after editing bindings.
types:
	npx wrangler types --env-file /dev/null

typecheck: types
	npx tsc -b --noEmit
	cd web && npx tsc --noEmit

test:
	npm test

# Playwright smoke tests at Pixel 7 size against `vite preview` with /api
# mocked in the browser. Builds first.
e2e: build
	cd web && npx playwright test --trace off

lint:
	npx eslint .

deploy: build
	npx wrangler deploy --env-file /dev/null

# The closest thing to `cdk diff`: bundles and validates without uploading.
dry-run: build
	npx wrangler deploy --dry-run --outdir=.wrangler/dry-run --env-file /dev/null

# Run once, then copy the printed database_id into wrangler.jsonc.
db-create:
	npx wrangler d1 create chef --env-file /dev/null

# Applies migrations/ to a local SQLite file under .wrangler/. No Cloudflare
# account and no network needed.
db-migrate:
	npx wrangler d1 migrations apply DB --local --env-file /dev/null

# Applies migrations/ to the real, remote D1 database.
db-migrate-remote:
	npx wrangler d1 migrations apply DB --remote --env-file /dev/null

# Pass SQL="..." on the command line.
db-console:
	npx wrangler d1 execute DB --local --env-file /dev/null --command "$(SQL)"
