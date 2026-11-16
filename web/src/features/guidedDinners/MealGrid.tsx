import type { Meal } from "../../../../shared/schema";
import type { WeekView } from "../../../../shared/planningApi";
import { Card } from "../../components/ui";
import { cx } from "../../lib/cx";
import { dayName, MEAL_LABEL } from "../planning/format";
import { slotLabel } from "./logic";

// The week at a glance, one row per day. With onOpen every meal is a button
// (opens the slot picker).
export function MealGrid({
  week,
  meals,
  leftoversFrom,
  onOpen,
}: {
  week: WeekView;
  meals: Meal[];
  leftoversFrom: Record<string, string>;
  onOpen?: (date: string, meal: Meal) => void;
}) {
  return (
    <Card className="px-3 py-1">
      <ul className="m-0 list-none p-0">
        {week.days.map((day) => (
          <li key={day.date} className="flex gap-2 border-b border-border py-2 last:border-b-0">
            <span className="w-9 shrink-0 pt-1 font-bold">{dayName(day.date)}</span>
            <ul className={cx("m-0 grid min-w-0 flex-1 list-none gap-1 p-0", onOpen && meals.length === 2 && "grid-cols-2")}>
              {meals.map((meal) => {
                const label = slotLabel(week, week.slots.find((s) => s.date === day.date && s.meal === meal), leftoversFrom);
                const text = (
                  <>
                    <span className="block text-xs font-bold text-muted">{MEAL_LABEL[meal]}</span>
                    <span className={cx("line-clamp-2 text-sm leading-snug", !label && "text-muted")}>{label ?? "Not planned"}</span>
                  </>
                );
                return (
                  <li key={meal} className="min-w-0">
                    {onOpen ? (
                      <button
                        type="button"
                        onClick={() => onOpen(day.date, meal)}
                        aria-label={`${MEAL_LABEL[meal]} ${dayName(day.date)}: ${label ?? "not planned"}. Change`}
                        className="pressable block min-h-11 w-full rounded-sm bg-surface-2 px-2.5 py-1.5 text-left text-text"
                      >
                        {text}
                      </button>
                    ) : (
                      <div className="flex items-baseline gap-2">
                        <span className="w-3 shrink-0 text-xs font-bold text-muted">{MEAL_LABEL[meal][0]}</span>
                        <span className={cx("min-w-0 text-sm", !label && "text-muted")}>{label ?? "Not planned"}</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </Card>
  );
}
