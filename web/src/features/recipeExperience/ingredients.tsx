import { AlertTriangle, Check, Minus, Plus } from "lucide-react";

import { displayIngredientName } from "../../../../shared/normalize";
import { formatAmount, groupIngredients } from "../../../../shared/recipeStructure";
import type { RecipeIngredient } from "../../../../shared/schema";
import { cx } from "../../lib/cx";
import {
  clampServings,
  formatServings,
  MAX_SERVINGS,
  MIN_SERVINGS,
  overPlanned,
  SERVINGS_STEP,
} from "../../../../shared/household/servings";
import { formatAmountText, scaleIngredientText } from "./cookText";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Ingredient rows for cooking mode: the name on the left, the amount (scaled)
// on the right with an optional conversion under it, grouped under headers
// when the recipe has groups.

// `group` arrives with the recipe-structure work; until then it's absent.
const groupOf = (i: RecipeIngredient) => (i as RecipeIngredient & { group?: string | null }).group ?? null;

function ingredientName(i: RecipeIngredient, factor = 1): string {
  // Unparsed lines keep their own wording, with any leading number scaled.
  if (i.quantity === null && i.unit === null) return capitalize(scaleIngredientText(i.rawText, factor));
  const name = i.ingredientName ? displayIngredientName(i.ingredientName) : i.rawText;
  return i.note ? `${name}, ${i.note}` : name;
}

// formatAmount gives the conversion; the amount itself is always shown with
// nice fractions ("1⅓ cups", never 1.33), scaled or not.
function amountOf(i: RecipeIngredient, factor: number) {
  const q = i.quantity === null ? null : i.quantity * factor;
  const written = formatAmount(q, i.unit);
  return q === null ? written : { primary: formatAmountText(q, i.unit), secondary: written.secondary };
}

export function IngredientRows({
  items,
  factor,
  checked,
  onToggle,
}: {
  items: RecipeIngredient[];
  factor: number;
  /** With these two, each row is a check-off button. */
  checked?: number[];
  onToggle?: (id: number) => void;
}) {
  const groups = groupIngredients(items.map((i) => ({ ...i, group: groupOf(i) })));
  return (
    <div className="grid gap-3">
      {groups.map((g) => (
        <div key={g.group ?? ""} className="grid">
          {g.group && <h4 className="m-0 pb-1 pt-1 font-body text-sm font-bold uppercase tracking-wide text-muted">{g.group}</h4>}
          <ul className="m-0 list-none divide-y divide-border p-0">
            {g.items.map((i) => {
              const amount = amountOf(i, factor);
              const done = checked?.includes(i.id) ?? false;
              const body = (
                <>
                  {onToggle && (
                    <span
                      aria-hidden="true"
                      className={cx(
                        "grid size-6 shrink-0 place-items-center rounded-full border-2",
                        done ? "border-primary bg-primary text-on-primary" : "border-border",
                      )}
                    >
                      {done && <Check size={14} strokeWidth={3} />}
                    </span>
                  )}
                  <span className={cx("min-w-0 flex-1 text-left text-lg text-muted", done && "line-through")}>
                    {ingredientName(i, factor)}
                    {i.optional && " (optional)"}
                  </span>
                  {amount.primary && (
                    <span className="grid shrink-0 text-right">
                      <span className={cx("text-lg font-bold text-text", done && "text-muted line-through")}>
                        {amount.primary}
                      </span>
                      {amount.secondary && <span className="text-sm text-muted">{amount.secondary}</span>}
                    </span>
                  )}
                </>
              );
              return (
                <li key={i.id}>
                  {onToggle ? (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={done}
                      onClick={() => onToggle(i.id)}
                      className="flex min-h-14 w-full items-center gap-3 py-2"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex min-h-12 items-center gap-3 py-2">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// The servings stepper: half servings, from ½ to 12. Cooking more than was
// planned shows a note that the groceries may not cover it.
export function ServingsStepper({
  servings,
  planned,
  onChange,
}: {
  servings: number;
  planned: number | null;
  onChange: (servings: number) => void;
}) {
  const btn = "pressable grid size-12 place-items-center rounded-full bg-surface-2 text-text disabled:opacity-40";
  const step = (d: number) => onChange(clampServings(servings + d));
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 rounded-card border border-border p-2 pl-4">
        <span className="font-semibold">Servings</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={btn}
            aria-label="Fewer servings"
            disabled={servings <= MIN_SERVINGS}
            onClick={() => step(-SERVINGS_STEP)}
          >
            <Minus size={20} aria-hidden="true" />
          </button>
          <output aria-live="polite" className="min-w-24 text-center text-lg font-bold">
            {formatServings(servings)} serving{servings === 1 ? "" : "s"}
          </output>
          <button
            type="button"
            className={btn}
            aria-label="More servings"
            disabled={servings >= MAX_SERVINGS}
            onClick={() => step(SERVINGS_STEP)}
          >
            <Plus size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
      {overPlanned(planned, servings) && (
        <p role="status" className="m-0 flex gap-2 rounded-sm bg-surface-2 p-3 text-sm font-semibold text-danger">
          <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
          You planned for {formatServings(planned!)}. Your groceries may not cover {formatServings(servings)}.
        </p>
      )}
    </div>
  );
}
