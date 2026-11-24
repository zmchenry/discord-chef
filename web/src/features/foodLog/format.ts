import { defaultMealAt, type FoodItemFields, type FoodMeal } from "../../../../shared/foodLog";
import { itemName } from "../../../../shared/foodLog/insights";

// Minutes after midnight at home (America/New_York), for the default meal.
const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" });
export function homeMinutes(at = new Date()): number {
  const p = Object.fromEntries(clock.formatToParts(at).map((x) => [x.type, x.value]));
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}

export const mealNow = (): FoodMeal => defaultMealAt(homeMinutes());

export { itemName };

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const fmtKcal = (n: number) => `${int.format(n)} kcal`;
export const kcalText = (i: Pick<FoodItemFields, "kcal">) => (i.kcal == null ? "No estimate" : `${int.format(i.kcal)} kcal`);

// "P 12 · C 30 · F 8 g", or "" when unknown.
export const macroText = (i: Pick<FoodItemFields, "kcal" | "protein" | "carbs" | "fat">) =>
  i.kcal == null ? "" : `P ${Math.round(i.protein ?? 0)} · C ${Math.round(i.carbs ?? 0)} · F ${Math.round(i.fat ?? 0)} g`;

export const sumKcal = (items: ReadonlyArray<Pick<FoodItemFields, "kcal">>) => items.reduce((a, i) => a + (i.kcal ?? 0), 0);

// Who a log is for: the signed-in person, the other one, or everyone.
export type Who = string | "both";
export const peopleFor = (who: Who, people: readonly string[]) => (who === "both" ? [...people] : [who]);
