-- Recipe structure (recipe-presentation). Steps keep living in
-- recipes.instructions (a JSON array of strings or step objects, read via
-- shared/recipeStructure.ts parseSteps), so only two columns are new.

-- The component an ingredient line belongs to ("egg base", "fillings and
-- garnish"). NULL = ungrouped.
ALTER TABLE recipe_ingredients ADD COLUMN group_label TEXT;

-- Flavor roles of a catalog ingredient, a JSON array of 0-2 of the FLAVORS
-- in shared/recipeStructure.ts, estimated once by Claude. NULL = not yet
-- estimated, '[]' = estimated, none fit.
ALTER TABLE ingredients ADD COLUMN flavors TEXT;
