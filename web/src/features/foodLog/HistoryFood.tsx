import { FOOD_MEAL_LABEL, type FoodMeal } from "../../../../shared/foodLog";
import { addDays, todayIn } from "../../../../shared/planningApi";
import { dayName } from "../planning/format";
import { useFoodRange } from "./api";
import { itemName, kcalText } from "./format";

const WINDOW_DAYS = 56;

// /history: what each person logged that week, as simple rows by day under
// the week's meals. One fetch for the whole page (same key everywhere).
export function WeekFood({ week, meal }: { week: string; meal?: FoodMeal }) {
  const today = todayIn();
  const q = useFoodRange(addDays(today, -WINDOW_DAYS), today);
  const end = addDays(week, 6);
  const items = (q.data ?? []).filter((i) => i.date >= week && i.date <= end && (!meal || i.meal === meal)).reverse();
  if (!items.length) return null;
  return (
    <div className="grid gap-1">
      <h3 className="m-0 px-1 font-body text-xs font-bold uppercase tracking-wider text-muted">Logged food</h3>
      <ul className="m-0 grid list-none gap-0 overflow-hidden rounded-card bg-surface p-0 shadow-card">
        {items.map((i) => (
          <li key={i.id} className="flex min-h-11 items-center justify-between gap-3 border-t border-border px-3 py-2 first:border-t-0">
            <span className="min-w-0">
              <span className="block truncate font-semibold">
                {i.quantity ? `${i.quantity} ` : ""}
                {i.recipeTitle ?? itemName(i)}
              </span>
              <span className="text-sm text-muted">
                {dayName(i.date)} · {FOOD_MEAL_LABEL[i.meal]} · {i.person}
              </span>
            </span>
            <span className="shrink-0 text-sm tabular-nums text-muted">{kcalText(i)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
