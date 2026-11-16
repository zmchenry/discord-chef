-- Eat-out spots: restaurants and takeout places, kept apart from recipes.
-- The Notion import fills this from the entries the cleanup marked as
-- eat-out spots. meals is a JSON array of meal tags the spot is good for
-- (for example breakfast or dinner). Same comment rules as 0001_init.sql.

CREATE TABLE eat_out_spots (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  meals          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(meals) AND json_type(meals) = 'array'),
  notes          TEXT,
  notion_page_id TEXT UNIQUE,
  created_at     INTEGER NOT NULL
);
