-- Store pins: an ingredient that is always bought at one store (turkey
-- from Publix). NULL means any store, so it goes with the trip's store.
-- A trip still goes to one store, and pinned items are listed apart.
--
-- Same rules as 0001_init.sql: no semicolons inside comments or string
-- literals, and no double dashes inside string literals.

ALTER TABLE ingredients ADD COLUMN store_id INTEGER REFERENCES stores(id);
