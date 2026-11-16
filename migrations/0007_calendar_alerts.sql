-- Calendar clashes: one row per clash fingerprint already pushed, so the
-- hourly calendar refresh never notifies about the same clash twice. A
-- fingerprint is date|meal|kind|recipeId|reason (shared/planning/clashes.ts).
-- The cron claims a row with INSERT OR IGNORE before sending and prunes rows
-- older than 30 days.
--
-- No semicolons inside comments or string literals in this file (see 0001).

CREATE TABLE calendar_alert_log (
  fingerprint TEXT PRIMARY KEY,
  sent_at     INTEGER NOT NULL
) WITHOUT ROWID;
