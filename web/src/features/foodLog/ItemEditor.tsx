import { X } from "lucide-react";
import { useId } from "react";

import { FOOD_MEAL_LABEL, FOOD_MEALS, type FoodItemFields, type FoodMeal } from "../../../../shared/foodLog";
import { cx } from "../../lib/cx";
import { CONFIDENCE_LABEL } from "../nutrition/format";

export type EditableItem = FoodItemFields & { recipeTitle?: string | null };

const input = "block w-full min-h-11 rounded-sm border border-border bg-surface px-2 text-base text-text placeholder:text-muted";

const NUMBERS = [
  { key: "kcal", label: "kcal" },
  { key: "protein", label: "Protein g" },
  { key: "carbs", label: "Carbs g" },
  { key: "fat", label: "Fat g" },
] as const;

// Where the numbers came from, in a few words.
function sourceLine(item: EditableItem): string {
  if (item.source === "recipe" && item.recipeTitle)
    return `Our recipe: ${item.recipeTitle}${item.servings && item.servings !== 1 ? ` · ${item.servings} servings` : ""}`;
  const bits = [item.brand, item.kcal == null ? "No estimate: add numbers or leave it" : item.source === "manual" ? "Your numbers" : item.confidence ? CONFIDENCE_LABEL[item.confidence] : "Estimate"];
  return bits.filter(Boolean).join(" · ");
}

// One item's editable fields: name, amount, meal and the numbers. Editing
// a number makes them the person's own (source manual).
export function ItemEditor({
  item,
  onChange,
  onRemove,
  compact = false,
}: {
  item: EditableItem;
  onChange: (next: EditableItem) => void;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const id = useId();
  const setNumber = (key: (typeof NUMBERS)[number]["key"], raw: string) => {
    const n = raw.trim() === "" ? null : Number(raw);
    if (n !== null && (!Number.isFinite(n) || n < 0)) return;
    onChange({ ...item, [key]: n, source: "manual" });
  };

  return (
    <div className={cx("grid gap-2", !compact && "rounded-card bg-surface p-3 shadow-card")}>
      <div className="flex items-end gap-2">
        <div className="grid min-w-0 flex-1 gap-1">
          <label htmlFor={`${id}-label`} className="sr-only">
            Food
          </label>
          <input
            id={`${id}-label`}
            value={item.label}
            onChange={(e) => onChange({ ...item, label: e.target.value })}
            className={cx(input, "font-semibold")}
          />
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${item.label}`}
            className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-transparent text-muted"
          >
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
        <div className="grid gap-1">
          <label htmlFor={`${id}-qty`} className="text-xs font-semibold text-muted">
            Amount
          </label>
          <input
            id={`${id}-qty`}
            value={item.quantity ?? ""}
            placeholder="1"
            onChange={(e) => onChange({ ...item, quantity: e.target.value || null })}
            className={input}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${id}-meal`} className="text-xs font-semibold text-muted">
            Meal
          </label>
          <select
            id={`${id}-meal`}
            value={item.meal}
            onChange={(e) => onChange({ ...item, meal: e.target.value as FoodMeal })}
            className={input}
          >
            {FOOD_MEALS.map((m) => (
              <option key={m} value={m}>
                {FOOD_MEAL_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {NUMBERS.map((n) => (
          <div key={n.key} className="grid gap-1">
            <label htmlFor={`${id}-${n.key}`} className="truncate text-xs font-semibold text-muted">
              {n.label}
            </label>
            <input
              id={`${id}-${n.key}`}
              inputMode="decimal"
              value={item[n.key] == null ? "" : String(item[n.key])}
              placeholder="?"
              onChange={(e) => setNumber(n.key, e.target.value)}
              className={cx(input, "text-right tabular-nums", n.key === "kcal" && "font-bold")}
            />
          </div>
        ))}
      </div>
      <p className="m-0 text-xs text-muted">{sourceLine(item)}</p>
    </div>
  );
}
