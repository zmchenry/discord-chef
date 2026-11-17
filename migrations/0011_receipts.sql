-- Real prices from grocery receipts (feature prices-receipts).
--
-- 1. ingredient_prices gains source 'receipt'. SQLite cannot alter a CHECK,
--    so the table is rebuilt with the same columns and rows. Nothing
--    references ingredient_prices, so dropping the old table is safe.
-- 2. receipts and receipt_lines keep what was read from each receipt (never
--    the photo itself) and which catalog ingredient each line matched.

CREATE TABLE ingredient_prices_new (
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  store_id      INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cents         INTEGER NOT NULL CHECK (cents >= 0),
  unit          TEXT,
  source        TEXT NOT NULL CHECK (source IN ('estimate', 'manual', 'receipt')),
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (ingredient_id, store_id)
) WITHOUT ROWID;

INSERT INTO ingredient_prices_new (ingredient_id, store_id, cents, unit, source, updated_at)
  SELECT ingredient_id, store_id, cents, unit, source, updated_at FROM ingredient_prices;

DROP TABLE ingredient_prices;

ALTER TABLE ingredient_prices_new RENAME TO ingredient_prices;

CREATE INDEX ingredient_prices_store ON ingredient_prices(store_id);

-- status: 'review' until the matches are checked and the prices saved.
-- purchased_on is the date printed on the receipt (YYYY-MM-DD), when read.
CREATE TABLE receipts (
  id           INTEGER PRIMARY KEY,
  store_id     INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  purchased_on TEXT,
  status       TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'saved')),
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  saved_at     INTEGER
);

-- One purchased line as printed. price_cents is the line total; weight and
-- unit_price_cents are set for weighed items ("2.31 lb @ 0.58/lb"), size when
-- the package size is printed ("16 oz"). match is how ingredient_id was set:
-- 'name' (fuzzy name match), 'claude', 'user', or NULL for no match.
CREATE TABLE receipt_lines (
  id               INTEGER PRIMARY KEY,
  receipt_id       INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,
  text             TEXT NOT NULL,
  price_cents      INTEGER NOT NULL CHECK (price_cents >= 0),
  quantity         REAL NOT NULL DEFAULT 1,
  unit_price_cents INTEGER,
  weight           TEXT,
  size             TEXT,
  ingredient_id    INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
  match            TEXT CHECK (match IN ('name', 'claude', 'user'))
);

CREATE INDEX receipt_lines_receipt ON receipt_lines(receipt_id, position);
