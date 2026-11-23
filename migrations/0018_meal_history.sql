-- Meal history (feature meal-history): what was actually eaten, the cached
-- weekly "What we're eating" insights, and the once-a-day dinner rating push.
--
-- Same rules as 0001_init.sql: no semicolons inside comments or string
-- literals, and no double dashes inside string literals.

-- One row per (date, meal) that someone logged. No row means the default
-- (shared/mealHistory.ts resolveEntry): a past planned recipe counts as
-- eaten, eat out as ate_out, skip as skipped.
--   eaten    the planned meal. recipe_id is the planned recipe when logged.
--   skipped  nothing was eaten.
--   ate_out  ate out instead.
--   swapped  ate something else: recipe_id when it is in the box, else
--            free_text ("frozen pizza").
-- rating is 1 (thumbs up) or -1 (thumbs down).
CREATE TABLE meal_log (
  date       TEXT NOT NULL CHECK (date(date) = date),
  meal       TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner')),
  status     TEXT NOT NULL CHECK (status IN ('eaten', 'skipped', 'ate_out', 'swapped')),
  recipe_id  TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  free_text  TEXT CHECK (free_text IS NULL OR length(trim(free_text)) > 0),
  rating     INTEGER CHECK (rating IS NULL OR rating IN (-1, 1)),
  note       TEXT,
  logged_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (date, meal)
) WITHOUT ROWID;

CREATE INDEX meal_log_recipe ON meal_log(recipe_id, date) WHERE recipe_id IS NOT NULL;

-- The weekly insights card, one row per week (its Sunday). body is the JSON
-- the card shows. local_date is the America/New_York date it was made, so a
-- refresh runs at most once a day.
CREATE TABLE meal_insights (
  week_id      TEXT PRIMARY KEY CHECK (date(week_id) = week_id),
  body         TEXT NOT NULL CHECK (json_valid(body)),
  source       TEXT NOT NULL CHECK (source IN ('claude', 'facts')),
  local_date   TEXT NOT NULL CHECK (date(local_date) = local_date),
  generated_at INTEGER NOT NULL
);

-- The evening "How was dinner?" push, at most once per user and day.
CREATE TABLE meal_rating_push_log (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL CHECK (date(local_date) = local_date),
  sent_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, local_date)
) WITHOUT ROWID;
