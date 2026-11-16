import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { MEALS, type Meal } from "../../../../shared/schema";
import { WEEKDAY_LONG, type ThemeWire } from "../../../../shared/planningApi";
import { Button, Card, PageHeader, StateMessage, TextField } from "../../components/ui";
import { cx } from "../../lib/cx";
import { planningApi } from "./api";
import { MEAL_LABEL } from "./format";
import { planningKeys } from "./queries";
import { BackToMore } from "./SettingsLink";

interface Row {
  label: string;
  tags: string;
  meals: Meal[];
}

const toRows = (themes: ThemeWire[]): Row[] =>
  WEEKDAY_LONG.map((_, weekday) => {
    const t = themes.find((x) => x.weekday === weekday);
    return t ? { label: t.label, tags: t.tags.join(", "), meals: t.meals } : { label: "", tags: "", meals: ["dinner"] };
  });

// Day themes (Taco Tuesday): a label, the recipe tags it boosts, and which
// meals it applies to. A day with no label has no theme.
export function ThemesPage() {
  const qc = useQueryClient();
  const themes = useQuery({ queryKey: planningKeys.themes, queryFn: ({ signal }) => planningApi.themes(signal) });
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (themes.data && !rows) setRows(toRows(themes.data));
  }, [themes.data, rows]);

  const save = useMutation({
    mutationFn: (r: Row[]) =>
      planningApi.saveThemes(
        r.flatMap((row, weekday) =>
          row.label.trim()
            ? [{ weekday, label: row.label.trim(), tags: row.tags.split(",").map((t) => t.trim()).filter(Boolean), meals: row.meals }]
            : [],
        ),
      ),
    onSuccess: (saved) => {
      qc.setQueryData(planningKeys.themes, saved);
      setRows(toRows(saved));
      void qc.invalidateQueries({ queryKey: ["week"] });
    },
  });

  const update = (i: number, patch: Partial<Row>) => setRows(rows!.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <>
      <BackToMore />
      <PageHeader title="Day themes" />
      <p className="m-0 px-4 pb-3 text-muted">
        A theme puts matching recipes at the top of that day's suggestions. Everything else stays pickable.
      </p>
      {!rows ? (
        themes.isError ? <StateMessage title="Couldn't load themes">{themes.error.message}</StateMessage> : <StateMessage title="Loading…" />
      ) : (
        <form
          className="grid gap-3 px-4 pb-6"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(rows);
          }}
        >
          {rows.map((row, i) => (
            <Card key={i} className="grid gap-3 p-4">
              <h2 className="m-0 text-lg">{WEEKDAY_LONG[i]}</h2>
              <TextField label="Theme" placeholder="e.g. Taco Tuesday" value={row.label} onChange={(e) => update(i, { label: e.target.value })} />
              {row.label.trim() && (
                <>
                  <TextField
                    label="Recipe tags it boosts"
                    hint="Comma separated, e.g. mexican, tacos"
                    value={row.tags}
                    onChange={(e) => update(i, { tags: e.target.value })}
                  />
                  <div role="group" aria-label="Meals" className="flex gap-2">
                    {MEALS.map((meal) => {
                      const on = row.meals.includes(meal);
                      return (
                        <button
                          key={meal}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            const meals = on ? row.meals.filter((m) => m !== meal) : [...row.meals, meal];
                            if (meals.length) update(i, { meals });
                          }}
                          className={cx(
                            "pressable min-h-11 flex-1 rounded-full text-sm font-bold",
                            on ? "bg-primary text-on-primary" : "bg-surface-2 text-text",
                          )}
                        >
                          {MEAL_LABEL[meal]}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </Card>
          ))}
          {save.isError && <p className="m-0 font-semibold text-danger">{save.error.message}</p>}
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : save.isSuccess ? "Saved" : "Save themes"}
          </Button>
        </form>
      )}
    </>
  );
}
