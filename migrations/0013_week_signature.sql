-- A fingerprint of a week's slots, taken when the week is finished, so the
-- Week screen can tell that a finished week was edited and offer "Save
-- changes" (which rebuilds the shopping list). NULL = never finished.
ALTER TABLE weeks ADD COLUMN planned_signature TEXT;
