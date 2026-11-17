# Chef

A private meal-planning web app for a two-person household, served from
`chef.zmchenry.com` behind Cloudflare Access and installable on Android as a PWA.

What it does:
- **Recipes**: add them by hand, from a web link (including Android share), or by voice
  or text; ingredients are parsed into amount, unit and name, under one set of naming
  rules.
- **Week**: breakfast, lunch and dinner for 7 days, with day themes (Taco Tuesday …).
  Use auto-fill when anything will do, or the step-by-step **Plan dinners** flow.
  Breakfasts come from a rotation, lunches from leftovers or a staple. Suggestions
  explain their ranking (theme, family calendar, shared ingredients, how recently you
  had it, cost).
- **Family calendar**: the secret iCal feed, refreshed every 15 minutes. Busy evenings,
  trips and dinners out shape the plan, and clashes with what's already planned get a
  banner and a push.
- **Shop**: the week's list, with aisle, A–Z, your own order and learned "smart"
  order, two trips, one store per trip with price estimates, items pinned to a store
  ("Also at Publix") and check-off on both phones.
- **Notifications**: plan-the-week reminder, the morning "what's cooking" with thaw
  reminders, list ready, calendar clashes.

One Cloudflare Worker serves both `/api/*` (Hono, D1) and the React SPA as static
assets. Product decisions, the data model and status live in
[`project-plans/chef.md`](project-plans/chef.md); v1 in
[`project-plans/v1.md`](project-plans/v1.md); ideas for later in
[`project-plans/future.md`](project-plans/future.md).

The old Discord bot (Python + Notion) is retired. It lives in git history (last
version: commit `8442785`), and Notion is a read-only archive since the one-time import.

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
| `make e2e` | Builds, then Playwright smoke tests at Pixel 7 size against `vite preview`, with `/api` mocked in the browser (`web/e2e/mockApi.ts`) |
| `make lint` | ESLint |
| `make db-migrate` | Applies `migrations/` to the local D1 under `.wrangler/` |
| `make db-migrate-remote` | Applies `migrations/` to the real D1 database |
| `make dry-run` | Bundles and validates the Worker without uploading |
| `make deploy` | Builds and deploys from this machine (normally Workers Builds does it) |

### Local development

```sh
make install
echo 'ENVIRONMENT=development' > .dev.vars   # gitignored
make db-migrate
make build && make dev-api                   # http://localhost:8787
# or, for HMR, run `make dev-api` and `make dev` side by side
```

With `ENVIRONMENT=development` the Worker skips Cloudflare Access and signs
every request in as `dev@example.com` (tests act as other users with an
`x-dev-user-id` header). Production never sets `ENVIRONMENT`, so it defaults
closed.

Only `wrangler dev` reads `.dev.vars`. Every other wrangler command in the
Makefile passes `--env-file /dev/null`, so local secrets never end up in the
generated `Env` type or near a deploy.

## Naming

Every name is normalised by `shared/normalize.ts` before it is stored. The
Worker applies it on every recipe write (`shared/recipeInput.ts`), and the
Notion import should use the same functions. All of them are idempotent.

- **Recipe titles**: HTML stripped, straight quotes, single spaces, trailing
  punctuation dropped (except `!` and `)`), `&` becomes "and", then Title Case
  with small words (a, and, of, with, ...) lower case unless first or last.
  Hyphenated parts are each capitalised ("Stir-Fry"); 2-4 letter all-caps
  words stay ("BLT"). Titles are unique, ignoring case, among non-archived
  recipes: a duplicate gets 409 with `existingId`.
- **Ingredients** (and staples): a lower-case canonical key, unique in the
  catalog. `parseIngredientLine` splits "1 1/2 cups flour, sifted" into
  quantity 1.5, unit `cup`, name "flour", note "sifted" (unicode fractions,
  ranges, package sizes in parentheses). Units come from a fixed set (tsp,
  tbsp, cup, oz, fl oz, lb, g, kg, ml, l, clove, can, jar, package, bunch,
  head, slice, piece, pinch, stick). `displayIngredientName` gives the
  sentence-case form for display ("Sour cream").
- **Tags**: lower case, hyphens for spaces, `[a-z0-9-]` only. `TAGS` is the
  controlled vocabulary with display labels; other tags are allowed.
- **Stores and people**: Title Case. **Sections** must be one of `SECTIONS`
  (Produce ... Health); Notion's names map onto them ("Fruit/Veg" is
  Produce) and anything unknown is an error.

## Auth

Cloudflare Access protects the whole host (Google login, two allowed emails).
The Worker verifies the Access JWT itself (`api/src/session.ts`) against
`TEAM_DOMAIN` and `POLICY_AUD` in `wrangler.jsonc`, then checks the email
against `ALLOWED_EMAILS`.

`ALLOWED_EMAILS` is a Worker **secret**, not a var, because this repo is
public. Set it once (comma-separated):

```sh
npx wrangler secret put ALLOWED_EMAILS
```

If it is unset, every authenticated route answers 401.

## Notifications

Web Push is sent by the Worker itself (`api/src/notifications/`, no
dependency), from a cron every 15 minutes evaluated in America/New_York, and
when a shopping list is generated. It needs a VAPID key pair, made once:

```sh
node scripts/gen-vapid.mjs                 # prints VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT      # a contact URL, e.g. mailto:you@your-domain or https://chef.zmchenry.com
```

For local use put the same three lines in `.dev.vars`. Without them the
settings screen reports push as not configured and the cron sends nothing.
Changing the key pair invalidates every phone's subscription (turn
notifications off and on again on each). Each person turns notifications on
per phone under More, Notifications.

## Deploys

Production deploys run on **Cloudflare Workers Builds** (the Git integration
in the Cloudflare dashboard), on push to `main`:

| Setting | Value |
|---|---|
| Build command | `npm ci && (cd web && npm ci)` |
| Deploy command | `npm run deploy:ci` |

`deploy:ci` builds the SPA, applies D1 migrations remotely, then runs
`wrangler deploy`. GitHub Actions (`.github/workflows/ci.yml`) only runs tests,
typecheck, build and the smoke tests, on pull requests and `claude/**`
branches. It never deploys and needs no Cloudflare credentials.

## Layout

```
api/         Hono Worker: src/index.ts (routes, cron), session.ts (Access JWT), db.ts
api/test/    vitest suites; setup/testDb.ts gives each test a fresh miniflare D1
shared/      zod schemas and types (the API contract web/ and api/ both import)
migrations/  D1 SQL migrations
web/         Vite + React 18 + Tailwind 4 SPA
  src/styles/tokens.css   the design tokens; components use nothing else
  public/                 manifest, service worker (sw.js), icons
  scripts/make-icons.mjs  regenerates the PNG icons from the SVG mark
  e2e/                    Playwright smoke tests
.github/     ci.yml
```
