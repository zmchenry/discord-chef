-- Food log (feature food-log): what one person actually ate, item by item,
-- on top of the household plan.
--
-- Same rules as 0001_init.sql: no semicolons inside comments or string
-- literals, and no double dashes inside string literals.

-- One row per item one person ate. person is a household person name as
-- nutrition uses it (household_settings 'household'). date is the
-- America/New_York date. Nutrition is for the whole item as eaten (the
-- quantity already applied), null when unknown (a gap, never zero).
--   source    estimate  Claude estimated it from the label.
--             manual    typed in or edited by hand.
--             recipe    one of our recipes: recipe_id and servings, numbers
--                       from its per-serving nutrition.
-- Logging anything for breakfast, lunch or dinner replaces the planned
-- household meal for that person and slot. Snacks always add.
CREATE TABLE food_log (
  id         TEXT PRIMARY KEY,
  person     TEXT NOT NULL CHECK (length(trim(person)) > 0),
  date       TEXT NOT NULL CHECK (date(date) = date),
  meal       TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snack')),
  label      TEXT NOT NULL CHECK (length(trim(label)) > 0),
  quantity   TEXT,
  kcal       REAL,
  protein    REAL,
  carbs      REAL,
  fat        REAL,
  fiber      REAL,
  source     TEXT NOT NULL CHECK (source IN ('estimate', 'manual', 'recipe')),
  recipe_id  TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  servings   REAL,
  confidence TEXT CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low')),
  -- Restaurant or brand when there is one ("Dunkin"), for insights.
  brand      TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX food_log_date ON food_log(date, person);
