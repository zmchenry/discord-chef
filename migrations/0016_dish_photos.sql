-- Dish photos: one pending "take a photo" push per user and recipe, queued
-- when the cook reaches the last step of a recipe with no picture. The
-- notification cron sends it once due_at has passed and sets sent_at (also
-- set, without sending, when the recipe got a picture in the meantime).
--
-- No semicolons inside comments or string literals in this file (see 0001).

CREATE TABLE photo_reminders (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  due_at    INTEGER NOT NULL,
  sent_at   INTEGER,
  PRIMARY KEY (user_id, recipe_id)
) WITHOUT ROWID;

CREATE INDEX photo_reminders_pending ON photo_reminders(due_at) WHERE sent_at IS NULL;
