import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";

import type { RecipeRef } from "../../../../shared/guidedDinners";
import { ROTATION_MAX } from "../../../../shared/planning/breakfastLunch";
import { Button, Card, PageHeader, StateMessage } from "../../components/ui";
import { useRecipes } from "../../lib/queries";
import { BackToMore } from "../planning/SettingsLink";
import { guidedApi, guidedKeys, useBreakfastLunchSettings } from "./api";

// More → Breakfast & lunch: the breakfast rotation (cycled in order, week
// after week) and the lunch staples (used when there are no leftovers).
export function BreakfastLunchPage() {
  const qc = useQueryClient();
  const settings = useBreakfastLunchSettings();
  const [rotation, setRotation] = useState<RecipeRef[] | null>(null);
  const [staples, setStaples] = useState<RecipeRef[] | null>(null);
  useEffect(() => {
    if (settings.data && !rotation) {
      setRotation(settings.data.breakfastRotation);
      setStaples(settings.data.lunchStaples);
    }
  }, [settings.data, rotation]);

  const save = useMutation({
    mutationFn: () =>
      guidedApi.saveSettings({ breakfastRotation: rotation!.map((r) => r.id), lunchStaples: staples!.map((r) => r.id) }),
    onSuccess: (saved) => {
      qc.setQueryData(guidedKeys.settings, saved);
      setRotation(saved.breakfastRotation);
      setStaples(saved.lunchStaples);
    },
  });

  return (
    <>
      <BackToMore />
      <PageHeader title="Breakfast & lunch" />
      <p className="m-0 px-4 pb-3 text-muted">
        "Plan dinners" fills these in for you. Breakfasts cycle through the rotation; lunch is leftovers after a big dinner,
        otherwise a staple.
      </p>
      {!rotation || !staples ? (
        settings.isError ? (
          <StateMessage title="Couldn't load settings">{settings.error.message}</StateMessage>
        ) : (
          <StateMessage title="Loading…" />
        )
      ) : (
        <form
          className="grid grid-cols-1 gap-4 px-4 pb-6 lg:max-w-2xl"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <OrderedPicker
            title="Breakfast rotation"
            hint={
              settings.data?.rotationIsDefault
                ? "Not set yet: these are your most-made breakfasts. Save to keep them, or change them."
                : `Up to ${ROTATION_MAX}, used in this order, then around again.`
            }
            tag="breakfast"
            items={rotation}
            onChange={(r) => {
              setRotation(r);
              save.reset();
            }}
          />
          <OrderedPicker
            title="Lunch staples"
            hint={
              settings.data?.staplesIsDefault
                ? "Not set yet: this is the default. Save to keep it, or change it."
                : "Taken in turn when there are no leftovers."
            }
            tag="lunch"
            items={staples}
            onChange={(s) => {
              setStaples(s);
              save.reset();
            }}
          />
          {save.isError && <p className="m-0 font-semibold text-danger">{save.error.message}</p>}
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : save.isSuccess ? "Saved" : "Save"}
          </Button>
        </form>
      )}
    </>
  );
}

function OrderedPicker({
  title,
  hint,
  tag,
  items,
  onChange,
}: {
  title: string;
  hint: string;
  tag: "breakfast" | "lunch";
  items: RecipeRef[];
  onChange: (items: RecipeRef[]) => void;
}) {
  const [q, setQ] = useState("");
  const query = useDeferredValue(q);
  const recipes = useRecipes({ tag, q: query.trim() || undefined });
  const full = items.length >= ROTATION_MAX;
  const move = (i: number, by: number) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x!);
    onChange(next);
  };
  const options = (recipes.data ?? []).filter((r) => !items.some((x) => x.id === r.id)).slice(0, 6);

  return (
    <Card className="grid grid-cols-1 gap-3 p-4">
      <div>
        <h2 className="m-0 text-lg">{title}</h2>
        <p className="m-0 text-sm text-muted">{hint}</p>
      </div>
      {items.length === 0 ? (
        <p className="m-0 text-sm text-muted">Nothing yet. Add one below.</p>
      ) : (
        <ol className="m-0 grid list-none grid-cols-1 gap-1.5 p-0">
          {items.map((r, i) => (
            <li key={r.id} className="flex items-center gap-1 rounded-sm bg-surface-2 py-0.5 pl-3">
              <span className="w-5 shrink-0 text-sm font-bold text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">
                {r.icon ? `${r.icon} ` : ""}
                {r.title}
              </span>
              <IconButton label={`Move ${r.title} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={18} />
              </IconButton>
              <IconButton label={`Move ${r.title} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown size={18} />
              </IconButton>
              <IconButton label={`Remove ${r.title}`} onClick={() => onChange(items.filter((x) => x.id !== r.id))}>
                <X size={18} />
              </IconButton>
            </li>
          ))}
        </ol>
      )}
      {full ? (
        <p className="m-0 text-sm text-muted">That's the most it holds. Remove one to add another.</p>
      ) : (
        <div className="grid grid-cols-1 gap-1.5">
          <label className="flex min-h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
            <Search size={18} className="shrink-0 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${tag} recipes`}
              aria-label={`Search ${tag} recipes`}
              className="min-h-11 w-full border-0 bg-transparent text-base text-text outline-none placeholder:text-muted"
            />
          </label>
          <ul className="m-0 grid list-none grid-cols-1 gap-1 p-0">
            {options.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onChange([...items, { id: r.id, title: r.title, icon: r.icon }])}
                  className="pressable flex min-h-11 w-full items-center gap-2 rounded-sm bg-transparent px-2 text-left text-text hover:bg-surface-2"
                >
                  <Plus size={18} className="shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">
                    {r.icon ? `${r.icon} ` : ""}
                    {r.title}
                  </span>
                </button>
              </li>
            ))}
            {recipes.data && options.length === 0 && (
              <li className="px-2 text-sm text-muted">No {query.trim() ? "matching " : "more "}{tag} recipes.</li>
            )}
          </ul>
        </div>
      )}
    </Card>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-transparent text-text disabled:opacity-30"
    >
      {children}
    </button>
  );
}
