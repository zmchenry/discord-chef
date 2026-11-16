import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useDeferredValue, useId, useState, type FormEvent } from "react";

import { displayIngredientName } from "../../../../shared/normalize";
import type { Ingredient } from "../../../../shared/schema";
import { cx } from "../../lib/cx";
import { shoppingApi } from "./api";

// "Add an item" with autocomplete. Staples come first (filtered locally, so
// they appear as you type), then catalog matches. Focusing the empty field
// lists the staples, so household things are two taps away.
export function AddItem({ onAdd }: { onAdd: (item: { name: string; ingredientId?: number; section?: string | null }) => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const q = text.trim().toLowerCase();
  const deferred = useDeferredValue(q);

  const staples = useQuery({ queryKey: ["staples"], queryFn: ({ signal }) => shoppingApi.staples(signal), staleTime: 5 * 60_000 });
  const catalog = useQuery({
    queryKey: ["ingredients", "shopping", deferred],
    queryFn: ({ signal }) => shoppingApi.searchIngredients(deferred, signal),
    enabled: deferred.length >= 2,
    placeholderData: (prev) => prev,
  });

  const stapleHits = (staples.data ?? []).filter((s) => !q || s.name.includes(q));
  const seen = new Set(stapleHits.map((s) => s.id));
  const suggestions: Ingredient[] = [
    ...stapleHits,
    ...(q.length >= 2 ? (catalog.data ?? []).filter((i) => !seen.has(i.id)) : []),
  ].slice(0, 8);

  const add = (item: { name: string; ingredientId?: number; section?: string | null }) => {
    onAdd(item);
    setText("");
    setOpen(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!q) return;
    const exact = suggestions.find((s) => s.name === q);
    add(exact ? { name: exact.name, ingredientId: exact.id, section: exact.section } : { name: text.trim() });
  };

  const showList = open && suggestions.length > 0;

  return (
    <form onSubmit={submit} className="relative">
      <label htmlFor={id} className="sr-only">
        Add an item
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          autoComplete="off"
          enterKeyHint="done"
          placeholder="Add an item or staple"
          value={text}
          role="combobox"
          aria-expanded={showList}
          aria-controls={`${id}-list`}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className="block min-h-11 min-w-0 flex-1 rounded-full border border-border bg-surface px-4 py-2 text-base text-text placeholder:text-muted"
        />
        <button
          type="submit"
          aria-label="Add"
          disabled={!q}
          className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-primary text-on-primary disabled:opacity-50"
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      </div>
      {showList && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="Suggestions"
          className="absolute inset-x-0 top-full z-20 m-0 mt-1 max-h-80 list-none overflow-auto rounded-card bg-surface p-1 shadow-card"
        >
          {suggestions.map((s) => (
            <li key={s.id} role="option" aria-selected={false}>
              <button
                type="button"
                // Keep focus in the field so the list doesn't close before the tap lands.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => add({ name: s.name, ingredientId: s.id, section: s.section })}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm px-3 text-left text-text hover:bg-surface-2"
              >
                <span className="truncate">{displayIngredientName(s.name)}</span>
                <span className={cx("shrink-0 text-xs font-bold", s.isStaple ? "text-accent" : "text-muted")}>
                  {s.isStaple ? "Staple" : (s.section ?? "")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
