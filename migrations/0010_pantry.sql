-- Pantry: what is already in the house, per catalog ingredient.
--
-- No row means the default: a pantry basic (salt, olive oil, garlic powder
-- and the rest of PANTRY_BASICS in shared/pantry.ts) is assumed on hand,
-- anything else is out. A row is written the first time someone says
-- otherwise, or when an item is checked off in the store.
-- low = on hand but running out, so it still goes on the list.
--
-- Same rules as 0001_init.sql: no semicolons inside comments or string
-- literals, and no double dashes inside string literals.

CREATE TABLE pantry (
  ingredient_id INTEGER PRIMARY KEY REFERENCES ingredients(id) ON DELETE CASCADE,
  on_hand       INTEGER NOT NULL CHECK (on_hand IN (0, 1)),
  low           INTEGER NOT NULL DEFAULT 0 CHECK (low IN (0, 1)),
  updated_at    INTEGER NOT NULL,
  updated_by    TEXT REFERENCES users(id) ON DELETE SET NULL
);
