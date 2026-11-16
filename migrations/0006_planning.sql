-- Weekly planning: household settings, the cached family calendar, and day
-- themes. Same conventions as 0001_init.sql (no semicolons in comments).

-- Small key/value settings, e.g. calendar_ical_url and household (JSON).
CREATE TABLE household_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The raw iCal text, refetched when older than six hours.
CREATE TABLE calendar_cache (
  id         TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  body       TEXT NOT NULL
);

-- weekday is 0 (Sunday) to 6 (Saturday). tags and meals are JSON arrays.
CREATE TABLE day_themes (
  weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  label   TEXT NOT NULL CHECK (length(trim(label)) > 0),
  tags    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  meals   TEXT NOT NULL DEFAULT '["dinner"]' CHECK (json_valid(meals) AND json_type(meals) = 'array')
);
