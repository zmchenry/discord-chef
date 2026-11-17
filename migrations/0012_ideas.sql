-- Recipe discovery: new recipe ideas found on the web (api/src/discovery).
--
-- Same rules as 0001_init.sql: no semicolons inside comments or string
-- literals, and no double dashes inside string literals.

-- One idea, a real recipe page that is not in the recipe box yet. theme is
-- the group it is shown under (a day theme label, or "Like <recipe>").
-- why and ingredients are JSON arrays. A url is only ever suggested once,
-- so a dismissed idea does not come back.
CREATE TABLE ideas (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL CHECK (length(trim(title)) > 0),
  url         TEXT NOT NULL UNIQUE,
  site        TEXT,
  why         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(why) AND json_type(why) = 'array'),
  minutes     INTEGER CHECK (minutes IS NULL OR minutes > 0),
  ingredients TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(ingredients) AND json_type(ingredients) = 'array'),
  theme       TEXT,
  cache_key   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'saved', 'dismissed')),
  created_at  INTEGER NOT NULL
);

CREATE INDEX ideas_status ON ideas(status, created_at);

-- When each (theme, like) search last ran, so a repeat within a day is
-- answered from the ideas table instead of a new web search.
CREATE TABLE idea_runs (
  cache_key TEXT PRIMARY KEY,
  ran_at    INTEGER NOT NULL
);
