-- Recipe titles are unique among non-archived recipes, ignoring case. The
-- Worker checks first and answers 409 with the existing recipe's id, and
-- this index closes the race between two concurrent writes. Titles are
-- already normalised (shared/normalize.ts) before they reach this table.
CREATE UNIQUE INDEX recipes_title_unique_active ON recipes(lower(title)) WHERE archived_at IS NULL;
