# Chef: plan

## Status
Phase: 0 (decisions) and 1 (scaffold) in parallel
Branch: `claude/discord-chef-cloudflare-kjwtd4` (the Discord bot stays on `main` until cutover)
Last updated: 2026-11-15

## Problem

Meal planning lives in Notion and a Discord bot (`bot.py`) that randomly fills breakfast,
lunch and dinner for seven days. It has no shopping flow beyond Notion's relation
rollups, no phone experience, and Notion's API quota already limits it.

Chef replaces both with a private web app at `chef.zmchenry.com` for two people (Zach and
Liz), installable on their Android phones.

## Requirements

| # | Requirement | Phase |
|---|---|---|
| R1 | CRUD on recipes; a recipe has ingredients | 2 |
| R2 | One-time import of the Notion data; Notion becomes a read-only archive | 2 |
| R3 | Weekly plan: breakfast, lunch and dinner x 7 days, auto and manual selection | 3 (flow details TBD by Zach) |
| R4 | Recommendations that build on the recipes already chosen that week | 3 |
| R5 | A shopping list generated each week | 4 |
| R6 | Shopping view: aisle, A-Z, manual and intelligent sort; check-off | 4 |
| R7 | Import a recipe from a web link | 5 |
| R8 | Installable PWA + push notifications | 1 (shell), 6 (push) |
| R9 | Only Zach and Liz can reach it | 1 |
| P2 | Push the shopping list into a Walmart cart | 7 |

## Decisions (made 2026-11-15)

- **Repo**: rewrite in `discord-chef`, on a branch. Layout copies fire-calculator: `api/`
  (Hono Worker), `web/` (Vite + React + Tailwind 4), `shared/` (zod schemas, the API
  contract), `migrations/` (D1). One Worker serves `/api/*` and the SPA as static assets.
- **Auth**: a Cloudflare Access application on the whole host `chef.zmchenry.com`, Google
  login, policy allows exactly two emails, session 720h so the installed app rarely
  re-prompts. The Worker still verifies the `Cf-Access-Jwt-Assertion` JWT (session.ts
  ported from fire-calculator). Needed: Liz's Google email.
- **Meals**: breakfast, lunch, dinner slots for every day. A slot can hold a recipe or a
  marker: leftovers, eat out, skip.
- **AI**: Claude API via an `ANTHROPIC_API_KEY` Worker secret. Used for recipe import
  fallback (after schema.org JSON-LD), ingredient parsing and normalisation, and
  assigning store sections to unknown ingredients. Results are cached on the ingredient so
  each new ingredient is classified once.
- **Phones**: both Android. Chrome install prompt; Web Push works without installing.
- **Notifications**: plan-the-week reminder, daily "what's cooking" with prep reminders
  (e.g. thaw tonight), shopping list ready. No partner-activity notifications.
- **Stores**: multiple store profiles (Walmart plus at least one more), each with its
  own section order.
- **Notion**: one-time import.

### Decided 2026-11-16

- **Look**: Terracotta Kitchen (prototype #1). Fraunces + DM Sans, terracotta primary,
  sage for "good to go", cream background; dark mode in deep brown.
- **Stores**: Walmart (default), Publix, Aldi.
- **Access**: application `chef` (id 7c145f77-…) on `chef.zmchenry.com`, Google login only
  with auto-redirect, 720h session, and the two existing reusable allow policies. The repo
  is **public**, so no email address is committed: `ALLOWED_EMAILS` is a Worker secret,
  and the Worker fails closed when it's unset.
- **Deploys**: Cloudflare Workers Builds, the same setup as blocks, fried and story-swap
  (an existing GitHub connection and build token), not a GitHub Actions secret.
  Production deploys on push to `main`. GitHub Actions only runs CI.
- **D1**: `chef` (b06080e5-5419-41f3-821d-9e733a89e610, ENAM).
- **Calendar-aware planning**: suggestions take the family Google Calendar into account:
  busy nights get fast recipes, people away mean fewer servings, and evenings out become
  "eat out". The Worker reads the calendar's *secret iCal address*, pasted once into
  Chef's settings and stored in D1. It's read-only, needs no Google OAuth app, and no
  tokens expire. The events are interpreted into per-day constraints (by rules first, with
  Claude for ambiguous event titles) and cached per week.
- **Selection flow**: a weekly session where Zach and Liz pick recipes, guided by day
  themes (e.g. Taco Tuesday), with live recommendations from the calendar, ingredient
  sharing across days, and estimated cost. Prototype #2 explores it.
- **Cost**: there are no public grocery price APIs for Publix or Aldi. Walmart's API
  needs partner approval, which is the P2 work. v1 uses estimated per-ingredient
  prices per store (Claude estimate, cached, editable), refined later from real data.
  Cost also drops structurally from ingredient sharing (fewer half-used packages) and
  from staples you already have.

- **Timezone**: America/New_York.
- **Notion cleanup**: all 127 audit items decided (recipe-cleanup artifact, 2026-11-16). The
  import applies those decisions; nothing is imported raw.
- **Naming**: one set of rules in `shared/normalize.ts`, applied on every write and by the
  import. Recipe titles are Title Case with "&" written as "and". Ingredients are stored as
  lowercase canonical names with amounts, units and prep notes parsed out, and shown in
  sentence case. Tags are lowercase kebab-case from a controlled vocabulary. Store
  sections come from a fixed list. Store and person names are trimmed and Title Case.

## Open questions

1. Weekly selection flow details (prototype #2's "Decisions for you" answers).

## What the Notion data looks like

Exported on 2026-11-15 (scratchpad, not committed: it is personal data).

- **Meals** (canonical, 64 rows): title, tags (Dinner 46, Lunch 38, Breakfast 15,
  Healthy, Protein, Fast, Heavy, Weekend, Order Out, Leftovers, Treat), optional link
  (7), emoji icon (23), Unsplash cover (6), weekday relation, and a relation to Shopping
  List rows as its ingredients. Only 9 have a written recipe in the page body.
- **Shopping List** (194 rows): doubles as the ingredient catalog and the grocery list.
  Name, Shopping Sort (Fruit/Veg, Deli/Bakery, Non-Perishable/Bread, Medicine, Dairy,
  Meat, Frozen), tags (Pantry, Perishable, ...), Shopping Trip (Midweek / Weekend), Have
  checkbox. 42 rows are household items that belong to no meal (sunscreen, printer
  paper).
- Ingredients are names only, with no quantity or unit. 8 names have an amount in the
  name. 16 relation targets no longer exist. Some titles and ingredients are duplicated.
- The 2023 "Weekly Meal Planner" databases are abandoned template data; not imported.

Implications: the import gives ingredient names plus a known section, not quantities. The
schema must allow a recipe ingredient without quantity or unit. Two trips a week
(Midweek/Weekend) is a real habit, so a week's list can be split into trips. Household
items become **staples**: things you can add to any list without a recipe.

## Data model (draft, D1/SQLite)

```
users             id (email) · display_name · created_at
recipes           id · title · description · source_url · image_url · icon · servings
                  · prep_minutes · cook_minutes · instructions (json: string[])
                  · notes · created_by · created_at · updated_at · archived_at
                  · notion_page_id
recipe_tags       recipe_id · tag            (meal types are tags: breakfast/lunch/dinner)
ingredients       id · name (canonical, unique, lowercase) · section · perishable
                  · is_staple · aliases (json)
recipe_ingredients id · recipe_id · position · raw_text · ingredient_id · quantity (real,null)
                  · unit (null) · note · optional
weeks             id (ISO date of the week's first day) · status (draft|planned) · notes
plan_slots        id · week_id · day (0-6) · meal (breakfast|lunch|dinner)
                  · kind (recipe|leftovers|eat_out|skip) · recipe_id · servings
                  · source (manual|auto|suggested) · locked · updated_by · updated_at
stores            id · name · section_order (json) · is_default
shopping_lists    id · week_id · trip (null|midweek|weekend) · store_id · status
                  · generated_at
shopping_items    id · list_id · ingredient_id · name · quantity · unit · section
                  · recipe_ids (json) · source (generated|manual|staple) · manual_rank
                  · checked_at · checked_by
check_events      store_id · ingredient_id · section · checked_at · list_id   (learns aisle order)
push_subscriptions id · user_id · endpoint · p256dh · auth · created_at
notification_prefs user_id · kind · enabled · local_time
```

## How the smart parts work

- **Auto-fill week**: fills empty, unlocked slots only. Each candidate gets a score from:
  meal-type fit (tag), not cooked in the last N weeks, variety (protein and cuisine tags
  differ from neighbours), weekday constraints ("Fast" on weeknights, "Weekend" on Sat/Sun),
  and ingredient overlap with what's already chosen. Seeded per week, so re-running the
  fill is stable and "shuffle" just changes the seed. Locked slots never change.
- **Recommendations (R4)**: the same scorer, where ingredient overlap counts most:
  perishables already being bought for chosen recipes ("uses the rest of your cilantro"),
  and leftovers from a big dinner suggested for the next day's lunch. Each suggestion comes
  with a one-line reason drawn from the score's top term. Deterministic, so no LLM is
  needed in the loop.
- **Shopping list generation**: aggregates the week's recipe ingredients by canonical
  ingredient, sums quantities where the units agree (and lists them side by side where they
  don't), and records which recipes need each item. It never overwrites check marks or
  manual items on regeneration.
- **Sorts**:
  - Aisle: by the store profile's section order.
  - A-Z.
  - Manual: drag order.
  - Intelligent: aisle order refined by learned walking order. Each time items are checked
    off in a store, the order is recorded, and a per-store ranking emerges after a few trips.
- **Import from link (R7)**: fetch the page in the Worker, parse schema.org `Recipe`
  JSON-LD (most recipe sites have it), and fall back to Claude extraction on the cleaned
  HTML. Ingredient lines are then parsed into quantity, unit and ingredient, and matched to
  the catalog. The user sees an editable preview before saving.
- **Notifications (R8)**: Web Push with VAPID keys (Worker secret), sent from Cron
  Triggers. Times are evaluated in the household timezone (America/Chicago unless told
  otherwise).

## Phases

| Phase | Scope | Parallel work |
|---|---|---|
| 0 | Look-and-feel prototype, IA, selection-flow prototype | prototypes are artifacts |
| 1 | Scaffold: Worker + Hono + D1 + Access session + Vite/React/Tailwind + PWA manifest/SW + CI + tests | one agent |
| 2 | Recipes CRUD UI/API + Notion import script | API, UI and import agents in parallel against `shared/` |
| 3 | Week plan: manual + auto-fill + recommendations | scorer (pure, unit-tested) and UI in parallel |
| 4 | Shopping list generation + shopping view + store profiles | generator and view in parallel |
| 5 | Import from link | independent |
| 6 | Push notifications + cron | independent |
| 7 (P2) | Walmart cart | research spike first: there is no public consumer cart API |

## Quality floor (inherited from fire-calculator)

44px touch targets, inputs of at least 16px, labelled controls, works one-handed at 360px
wide, dark mode, and unit tests for every pure module (scorer, aggregator, ingredient
parser, sorts) plus Playwright smoke tests on phone viewport.
