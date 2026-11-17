-- Nutrition: estimated nutrients per canonical ingredient, and how each
-- planned meal is split between the people at home.
--
-- Same rules as 0001_init.sql: no semicolons inside comments or string
-- literals, and no double dashes inside string literals.

-- Per 100 g. unit_grams maps count and volume units to grams for this
-- ingredient, e.g. {"each": 50, "cup": 120, "clove": 5}. typical_grams is
-- what a recipe line with no amount usually means. source 'estimate' rows
-- come from Claude and are never written over a 'manual' one.
CREATE TABLE ingredient_nutrition (
  ingredient_id INTEGER PRIMARY KEY REFERENCES ingredients(id) ON DELETE CASCADE,
  kcal          REAL NOT NULL CHECK (kcal >= 0),
  protein       REAL NOT NULL CHECK (protein >= 0),
  carbs         REAL NOT NULL CHECK (carbs >= 0),
  fat           REAL NOT NULL CHECK (fat >= 0),
  fiber         REAL NOT NULL CHECK (fiber >= 0),
  unit_grams    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(unit_grams) AND json_type(unit_grams) = 'object'),
  typical_grams REAL CHECK (typical_grams IS NULL OR typical_grams > 0),
  source        TEXT NOT NULL CHECK (source IN ('estimate', 'manual')),
  confidence    TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  updated_at    INTEGER NOT NULL
);

-- A chosen split for one planned meal: {"Zach": 1.5, "Liz": 1} in
-- servings. Absent means the default split. slot_key is what the slot held
-- when the split was chosen (the recipe id, or the kind for leftovers), so a
-- split stops applying once the slot holds something else. Deleting the
-- slot deletes the split.
CREATE TABLE plan_slot_portions (
  slot_id    INTEGER PRIMARY KEY REFERENCES plan_slots(id) ON DELETE CASCADE,
  slot_key   TEXT NOT NULL,
  portions   TEXT NOT NULL CHECK (json_valid(portions) AND json_type(portions) = 'object'),
  total      REAL NOT NULL CHECK (total >= 0),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);
