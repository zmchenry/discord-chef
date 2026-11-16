-- Chef: initial schema. Implements the data model in project-plans/chef.md.
--
-- Conventions
--   * Timestamps are INTEGER milliseconds since the epoch (Date.now()).
--   * Booleans are INTEGER 0/1 with a CHECK.
--   * JSON columns are TEXT with a json_valid CHECK and a non-null default.
--   * Enums are TEXT with a CHECK listing the allowed values. Keep these in
--     step with shared/schema.ts.
--   * D1 enforces foreign keys, so every REFERENCES below is live.
--   * Recipe ids are TEXT (UUIDs minted by the Worker, stable across imports).
--     Weeks are keyed by the ISO date of their first day. Everything else
--     uses INTEGER rowid keys.
--
-- No semicolons inside comments or string literals, and no double dashes
-- inside string literals, in this file: the test
-- harness (api/test/setup/testDb.ts) splits statements on them, the same way
-- wrangler applies a migration.

CREATE TABLE users (
  id           TEXT PRIMARY KEY CHECK (id = lower(id) AND length(id) > 0),
  display_name TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE recipes (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description    TEXT,
  source_url     TEXT,
  image_url      TEXT,
  icon           TEXT,
  servings       INTEGER CHECK (servings IS NULL OR servings > 0),
  prep_minutes   INTEGER CHECK (prep_minutes IS NULL OR prep_minutes >= 0),
  cook_minutes   INTEGER CHECK (cook_minutes IS NULL OR cook_minutes >= 0),
  instructions   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(instructions) AND json_type(instructions) = 'array'),
  notes          TEXT,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  archived_at    INTEGER,
  notion_page_id TEXT UNIQUE
);

CREATE INDEX recipes_active_title ON recipes(title COLLATE NOCASE) WHERE archived_at IS NULL;

-- Meal types (breakfast, lunch, dinner) are ordinary tags.
CREATE TABLE recipe_tags (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag       TEXT NOT NULL CHECK (tag = lower(trim(tag)) AND length(tag) > 0),
  PRIMARY KEY (recipe_id, tag)
) WITHOUT ROWID;

CREATE INDEX recipe_tags_tag ON recipe_tags(tag, recipe_id);

-- The ingredient catalog. name is canonical: trimmed, lowercase, single
-- spaces (see shared/normalize.ts). section is a store section name such as
-- 'Produce', or NULL while unclassified.
CREATE TABLE ingredients (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE CHECK (name = lower(trim(name)) AND length(name) > 0),
  section    TEXT,
  perishable INTEGER NOT NULL DEFAULT 0 CHECK (perishable IN (0, 1)),
  is_staple  INTEGER NOT NULL DEFAULT 0 CHECK (is_staple IN (0, 1)),
  aliases    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases) AND json_type(aliases) = 'array'),
  created_at INTEGER NOT NULL
);

CREATE INDEX ingredients_staple ON ingredients(is_staple) WHERE is_staple = 1;

-- quantity and unit are nullable: the Notion import has names only.
-- ingredient_id is nullable so a line can exist before it is matched.
CREATE TABLE recipe_ingredients (
  id            INTEGER PRIMARY KEY,
  recipe_id     TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL CHECK (position >= 0),
  raw_text      TEXT NOT NULL,
  ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
  quantity      REAL CHECK (quantity IS NULL OR quantity > 0),
  unit          TEXT,
  note          TEXT,
  optional      INTEGER NOT NULL DEFAULT 0 CHECK (optional IN (0, 1)),
  UNIQUE (recipe_id, position)
);

CREATE INDEX recipe_ingredients_ingredient ON recipe_ingredients(ingredient_id);

CREATE TABLE weeks (
  id         TEXT PRIMARY KEY CHECK (id GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' AND date(id) = id),
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'planned')),
  notes      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One row per (week, day, meal). day is the offset from the week's first
-- day (0-6). A slot holds a recipe exactly when kind = 'recipe'.
CREATE TABLE plan_slots (
  id         INTEGER PRIMARY KEY,
  week_id    TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  day        INTEGER NOT NULL CHECK (day BETWEEN 0 AND 6),
  meal       TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner')),
  kind       TEXT NOT NULL CHECK (kind IN ('recipe', 'leftovers', 'eat_out', 'skip')),
  recipe_id  TEXT REFERENCES recipes(id),
  servings   INTEGER CHECK (servings IS NULL OR servings > 0),
  source     TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto', 'suggested')),
  locked     INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (week_id, day, meal),
  CHECK ((kind = 'recipe') = (recipe_id IS NOT NULL))
);

-- "Not cooked in the last N weeks" looks slots up by recipe.
CREATE INDEX plan_slots_recipe ON plan_slots(recipe_id, week_id) WHERE recipe_id IS NOT NULL;

CREATE TABLE stores (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  section_order TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(section_order) AND json_type(section_order) = 'array'),
  is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at    INTEGER NOT NULL
);

-- At most one default store.
CREATE UNIQUE INDEX stores_one_default ON stores(is_default) WHERE is_default = 1;

-- trip is NULL for a single list for the week, or 'midweek' / 'weekend'
-- when the week is split into two trips.
CREATE TABLE shopping_lists (
  id           INTEGER PRIMARY KEY,
  week_id      TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  trip         TEXT CHECK (trip IS NULL OR trip IN ('midweek', 'weekend')),
  store_id     INTEGER NOT NULL REFERENCES stores(id),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  generated_at INTEGER,
  created_at   INTEGER NOT NULL
);

-- One list per (week, trip). NULLs are distinct in a plain UNIQUE, so the
-- expression folds NULL trip into ''.
CREATE UNIQUE INDEX shopping_lists_week_trip ON shopping_lists(week_id, coalesce(trip, ''));

CREATE TABLE shopping_items (
  id            INTEGER PRIMARY KEY,
  list_id       INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
  name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
  quantity      REAL CHECK (quantity IS NULL OR quantity > 0),
  unit          TEXT,
  section       TEXT,
  recipe_ids    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recipe_ids) AND json_type(recipe_ids) = 'array'),
  source        TEXT NOT NULL CHECK (source IN ('generated', 'manual', 'staple')),
  manual_rank   REAL,
  checked_at    INTEGER,
  checked_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX shopping_items_list ON shopping_items(list_id);
CREATE INDEX shopping_items_ingredient ON shopping_items(ingredient_id) WHERE ingredient_id IS NOT NULL;

-- Append-only log of check-offs, from which the per-store walking order is
-- learned.
CREATE TABLE check_events (
  id            INTEGER PRIMARY KEY,
  store_id      INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE CASCADE,
  section       TEXT,
  checked_at    INTEGER NOT NULL,
  list_id       INTEGER REFERENCES shopping_lists(id) ON DELETE SET NULL
);

CREATE INDEX check_events_store ON check_events(store_id, checked_at);
CREATE INDEX check_events_list ON check_events(list_id, checked_at);

CREATE TABLE push_subscriptions (
  id         INTEGER PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);

-- local_time is 'HH:MM' in the household timezone.
CREATE TABLE notification_prefs (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('plan_week', 'daily_cooking', 'list_ready')),
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  local_time TEXT CHECK (local_time IS NULL OR local_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  PRIMARY KEY (user_id, kind)
) WITHOUT ROWID;

-- Seed stores. All three share one default section order until each is
-- tuned to its real layout.
INSERT INTO stores (name, section_order, is_default, created_at) VALUES
  ('Walmart', '["Produce","Bakery","Deli","Meat & Seafood","Dairy & Eggs","Frozen","Pantry","Snacks","Beverages","Household","Health"]', 1, unixepoch() * 1000),
  ('Publix', '["Produce","Bakery","Deli","Meat & Seafood","Dairy & Eggs","Frozen","Pantry","Snacks","Beverages","Household","Health"]', 0, unixepoch() * 1000),
  ('Aldi', '["Produce","Bakery","Deli","Meat & Seafood","Dairy & Eggs","Frozen","Pantry","Snacks","Beverages","Household","Health"]', 0, unixepoch() * 1000);
