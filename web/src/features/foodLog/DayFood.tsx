import type { FoodLogItem, FoodMeal } from "../../../../shared/foodLog";
import { FoodRow } from "./FoodRows";

// The Day view's logged items for one meal, under the planned one.
export function MealFood({ items, meal }: { items: readonly FoodLogItem[]; meal: FoodMeal }) {
  const mine = items.filter((i) => i.meal === meal);
  if (!mine.length) return null;
  return (
    <ul aria-label="Logged" className="m-0 grid list-none gap-0 border-l-2 border-border p-0 pl-3">
      {mine.map((i) => (
        <FoodRow key={i.id} item={i} />
      ))}
    </ul>
  );
}

// Snacks have no planned meal: their own block, only when there are any.
export function SnackFood({ items }: { items: readonly FoodLogItem[] }) {
  if (!items.some((i) => i.meal === "snack")) return null;
  return (
    <div className="grid gap-2 p-4">
      <span className="text-xs font-bold uppercase tracking-wider text-muted">Snacks</span>
      <MealFood items={items} meal="snack" />
    </div>
  );
}
