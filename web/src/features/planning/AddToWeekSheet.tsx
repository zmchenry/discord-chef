import { useState } from "react";

import { MEALS, type Meal } from "../../../../shared/schema";
import { addDays, sundayOf, todayIn, type SlotRecipe } from "../../../../shared/planningApi";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/ui";
import { cx } from "../../lib/cx";
import { dayName, MARKER_LABEL, MEAL_LABEL, shortDate } from "./format";
import { useSlotMutation, useWeek } from "./queries";

const chip = "pressable min-h-11 min-w-11 rounded-full px-3 text-sm font-bold";

// From a recipe: pick this week or next, a day and a meal, and put it there.
// The same slot write as the Week screen; whatever was there is replaced.
export function AddToWeekSheet({
  recipe,
  onClose,
  onAdded,
}: {
  recipe: SlotRecipe;
  onClose: () => void;
  onAdded: (where: string, weekId: string) => void;
}) {
  const today = todayIn();
  const thisWeek = sundayOf(today);
  const [weekId, setWeekId] = useState(thisWeek);
  const [date, setDate] = useState(today);
  const [meal, setMeal] = useState<Meal>("dinner");
  const week = useWeek(weekId);
  const write = useSlotMutation(weekId);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekId, i));
  const current = week.data?.slots.find((s) => s.date === date && s.meal === meal);
  const where = `${dayName(date)} ${MEAL_LABEL[meal].toLowerCase()}`;

  const pickWeek = (id: string) => {
    setWeekId(id);
    setDate(addDays(id, (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${weekId}T00:00:00Z`)) / 86_400_000));
  };

  return (
    <Sheet labelledBy="add-to-week-title" onClose={onClose}>
      <div className="grid gap-4 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3 lg:pt-5">
        <div>
          <h2 id="add-to-week-title" className="m-0 text-2xl">
            Add to the week
          </h2>
          <p className="m-0 line-clamp-2 text-muted">{recipe.title}</p>
        </div>

        <div role="group" aria-label="Week" className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
          {[thisWeek, addDays(thisWeek, 7)].map((id, i) => (
            <button
              key={id}
              type="button"
              aria-pressed={weekId === id}
              onClick={() => pickWeek(id)}
              className={cx(
                "pressable min-h-11 rounded-full text-sm font-bold",
                weekId === id ? "bg-surface text-text shadow-card" : "bg-transparent text-muted",
              )}
            >
              {i === 0 ? "This week" : "Next week"}
            </button>
          ))}
        </div>

        <div role="group" aria-label="Day" className="grid grid-cols-7 gap-0.5 min-[400px]:gap-1">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={date === d}
              aria-label={`${dayName(d)} ${shortDate(d)}`}
              onClick={() => setDate(d)}
              className={cx(chip, "px-0", date === d ? "bg-primary text-on-primary" : "bg-surface-2 text-text")}
            >
              {dayName(d)}
            </button>
          ))}
        </div>

        <div role="group" aria-label="Meal" className="grid grid-cols-3 gap-1.5">
          {MEALS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={meal === m}
              onClick={() => setMeal(m)}
              className={cx(chip, meal === m ? "bg-primary text-on-primary" : "bg-surface-2 text-text")}
            >
              {MEAL_LABEL[m]}
            </button>
          ))}
        </div>

        <p className="m-0 text-sm text-muted" aria-live="polite">
          {current
            ? `Replaces ${current.kind === "recipe" ? (current.recipe?.title ?? "a recipe") : MARKER_LABEL[current.kind].toLowerCase()}.`
            : `${where[0]!.toUpperCase()}${where.slice(1)} is open.`}
        </p>

        <Button
          className="w-full"
          disabled={write.isPending || current?.recipeId === recipe.id}
          onClick={() =>
            write.mutate([{ date, meal, set: { kind: "recipe", recipeId: recipe.id }, recipe }], {
              onSuccess: () => onAdded(where, weekId),
            })
          }
        >
          {current?.recipeId === recipe.id ? "Already there" : write.isPending ? "Adding…" : `Add to ${where}`}
        </Button>
        {write.isError && <p className="m-0 text-sm font-semibold text-danger">{write.error.message}</p>}
      </div>
    </Sheet>
  );
}
