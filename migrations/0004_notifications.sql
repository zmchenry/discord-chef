-- Notifications: one row per notification actually sent, so a cron run that
-- repeats (retries, or the doubled 01:00 hour when DST ends) never sends the
-- same reminder twice. local_date is the America/New_York date it was sent for.
-- The cron claims a row with INSERT OR IGNORE before sending.
--
-- No semicolons inside comments or string literals in this file (see 0001).

CREATE TABLE notification_sent_log (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('plan_week', 'daily_cooking', 'list_ready')),
  local_date TEXT NOT NULL CHECK (date(local_date) = local_date),
  sent_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, local_date)
) WITHOUT ROWID;
