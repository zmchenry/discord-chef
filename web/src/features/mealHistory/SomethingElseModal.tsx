import { Check, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";

import type { Meal } from "../../../../shared/schema";
import { Modal } from "../../components/Modal";
import { cx } from "../../lib/cx";
import { useRecipes } from "../../lib/queries";
import { dayName } from "../planning/format";
import { useLogMeal } from "./api";

// "Something else": pick a recipe from the box, or just say what it was.
export function SomethingElseModal({
  date,
  meal,
  onClose,
}: {
  date: string;
  meal: Meal;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<{ id: string; title: string } | null>(null);
  const query = useDeferredValue(q.trim());
  const recipes = useRecipes({ q: query || undefined });
  const log = useLogMeal();
  const text = q.trim();

  const save = async () => {
    await log.mutateAsync(
      picked ? { date, meal, status: "swapped", recipeId: picked.id, freeText: null } : { date, meal, status: "swapped", recipeId: null, freeText: text },
    );
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="What did you have instead?"
      description={`${dayName(date)} ${meal}. Pick a recipe, or just type what it was.`}
      secondary={{ label: "Cancel", onClick: onClose }}
      primary={{ label: "Save", disabled: !picked && !text, onClick: save }}
    >
      <div className="grid gap-3">
        <label className="flex min-h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
          <Search size={18} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPicked(null);
            }}
            placeholder="Frozen pizza, Chicken Tacos…"
            aria-label="What you ate"
            className="min-h-11 w-full border-0 bg-transparent text-base text-text outline-none placeholder:text-muted"
          />
        </label>
        {query && (recipes.data ?? []).length > 0 && (
          <ul className="m-0 grid list-none gap-1 p-0" aria-label="Recipes">
            {(recipes.data ?? []).slice(0, 5).map((r) => {
              const on = picked?.id === r.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked(on ? null : { id: r.id, title: r.title })}
                    className={cx(
                      "pressable flex min-h-11 w-full items-center gap-2 rounded-sm px-3 text-left font-semibold",
                      on ? "bg-accent-soft text-accent" : "bg-surface-2 text-text",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {r.icon ? `${r.icon} ` : ""}
                      {r.title}
                    </span>
                    {on && <Check size={18} aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {text && !picked && <p className="m-0 text-sm text-muted">Saves “{text}” as what you ate.</p>}
        {log.isError && (
          <p role="alert" className="m-0 font-semibold text-danger">
            {log.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}
