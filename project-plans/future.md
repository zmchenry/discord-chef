# Chef: future features

Things Zach wants that are **not part of v0**. Each has enough notes to scope it later.
v0 is defined in `chef.md`. When something here starts, it moves into a plan of its own.

## Weekly nutrition and macros

**What:** see what the week's plan adds up to (calories, protein, carbs, fat, and a few
key micros) before committing to it. Estimates are fine.

- Nutrition comes per ingredient from USDA FoodData Central (free, needs an API key),
  matched once per canonical ingredient and cached on the `ingredients` row. Claude
  estimates when there's no good match, and the value is marked as estimated.
- Per-serving totals come from the parsed quantity and unit on each recipe ingredient.
  v0's ingredient parser (`shared/normalize.ts`) is what makes this possible later.
  Ingredients without a quantity get a typical-portion guess, marked as low confidence.
- Weekly view: totals by day and for the week, with a confidence indicator so a number
  built mostly on guesses doesn't look precise.

## Personal goals and portioning (Zach and Liz)

**What:** each person sets goals (calories, protein, and so on), and Chef shows how the
week lands against each person's goal and how to split each meal between them.

- Per-person targets, daily or weekly.
- Portioning: for each planned meal, suggest each person's share of the recipe (e.g.
  Zach 60% / Liz 40%, or "Zach: 1.5 servings, Liz: 1") so both land near their goals, and
  scale the shopping quantities to match.
- Respects the calendar: someone who's away isn't counted that day (v0's calendar
  constraints already know who's home).
- Needs: a per-person portion on each plan slot, and goal settings per user.

## Recipe discovery: suggest new recipes

**What:** suggest recipes that aren't in the recipe box yet, based on what we already
cook and the day themes (e.g. "more like Beef Stir-Fry", "a new Taco Tuesday idea").

- Claude with web search finds candidates that resemble well-liked recipes and themes,
  and favours ones that reuse ingredients already planned for the week.
- Candidates land in an "Ideas" inbox. Accepting one runs it through the v0 link
  importer, so it gets the same parsing and naming rules.
- Signals worth adding then: thumbs up/down after cooking, and "made N times" (v0
  records what was planned, which is the basis).

## Walmart cart (was P2)

Push a trip's list into a Walmart cart. Needs a research spike first: Walmart has no
public consumer cart API, and the affiliate and partner APIs need approval.

## Already in v0 (for reference)

- **Import a recipe from a web link**: v0 Phase 5 (schema.org data first, Claude as
  fallback).
- **Suggestions during weekly planning**: v0 Phase 3. They suggest from recipes already
  in the box, using calendar, themes, shared ingredients and cost. Suggesting *new*
  recipes is the discovery feature above.
