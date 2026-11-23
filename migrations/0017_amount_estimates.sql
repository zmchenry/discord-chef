-- Estimated amounts for ingredient lines written with none ("salt",
-- "chicken thighs"), filled by Claude from the cron so recipe nutrition can
-- add up. One row per recipe once it has been looked at.
--
-- Same rules as 0001_init.sql: no semicolons inside comments or string
-- literals, and no double dashes inside string literals.

-- lines lists what was filled, as [{"position": 3, "quantity": 2, "unit":
-- "tbsp"}]: the recipe page marks a line "est." while it still holds that
-- amount. recipe_updated_at is the recipe's updated_at when it was looked
-- at, so an edited recipe is looked at again (only empty amounts are ever
-- filled).
CREATE TABLE recipe_amount_estimates (
  recipe_id         TEXT PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
  lines             TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(lines) AND json_type(lines) = 'array'),
  recipe_updated_at INTEGER NOT NULL,
  processed_at      INTEGER NOT NULL
);
