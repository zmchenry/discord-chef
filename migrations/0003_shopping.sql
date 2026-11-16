-- Shopping: prices per store, the per-list sort, a display amount on items
-- and a link from a check event back to its item.
--
-- Same rules as 0001_init.sql: no semicolons inside comments or string
-- literals, and no double dashes inside string literals.

-- A price for one ingredient at one store, in cents, for the amount you
-- would normally buy (unit says what that is, e.g. 'lb' or 'each').
-- 'estimate' rows come from estimatePrices, 'manual' rows from a person,
-- and an estimate never overwrites a manual price.
CREATE TABLE ingredient_prices (
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  store_id      INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cents         INTEGER NOT NULL CHECK (cents >= 0),
  unit          TEXT,
  source        TEXT NOT NULL CHECK (source IN ('estimate', 'manual')),
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (ingredient_id, store_id)
) WITHOUT ROWID;

CREATE INDEX ingredient_prices_store ON ingredient_prices(store_id);

-- The sort the list was last viewed in. Both phones see the same one.
ALTER TABLE shopping_lists ADD COLUMN sort TEXT NOT NULL DEFAULT 'aisle'
  CHECK (sort IN ('aisle', 'alpha', 'manual', 'smart'));

-- The amount as shown, e.g. '2 lb' or '1 cup + 2 tbsp'. quantity and unit
-- stay set only when the amount is a single quantity in one unit.
ALTER TABLE shopping_items ADD COLUMN amount_text TEXT;

-- Unchecking an item deletes the check event it wrote, found by this id.
ALTER TABLE check_events ADD COLUMN item_id INTEGER;

CREATE INDEX check_events_item ON check_events(item_id) WHERE item_id IS NOT NULL;
