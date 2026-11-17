import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { GoalWire } from "../../../../shared/nutrition";
import { Button, Card, PageHeader, StateMessage, TextField } from "../../components/ui";
import { BackToMore } from "../planning/SettingsLink";
import { nutritionApi, nutritionKeys, useGoals } from "./api";

type Field = "kcal" | "protein" | "carbs" | "fat";
type Row = { person: string } & Record<Field, string>;

const FIELDS: Array<{ key: Field; label: string; placeholder: string }> = [
  { key: "kcal", label: "Calories (kcal)", placeholder: "e.g. 2400" },
  { key: "protein", label: "Protein (g)", placeholder: "e.g. 150" },
  { key: "carbs", label: "Carbs (g)", placeholder: "Optional" },
  { key: "fat", label: "Fat (g)", placeholder: "Optional" },
];

const toRows = (goals: GoalWire[]): Row[] =>
  goals.map((g) => ({
    person: g.person,
    kcal: g.kcal?.toString() ?? "",
    protein: g.protein?.toString() ?? "",
    carbs: g.carbs?.toString() ?? "",
    fat: g.fat?.toString() ?? "",
  }));

const num = (s: string) => {
  const n = Math.round(Number(s.replace(/[^\d.]/g, "")));
  return s.trim() && Number.isFinite(n) ? n : null;
};

// More → Goals: daily targets per person. Calories also set the default
// portion split (a bigger goal, a bigger share).
export function GoalsPage() {
  const qc = useQueryClient();
  const goals = useGoals();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (goals.data && !rows) setRows(toRows(goals.data));
  }, [goals.data, rows]);

  const save = useMutation({
    mutationFn: (r: Row[]) =>
      nutritionApi.saveGoals(r.map((row) => ({ person: row.person, kcal: num(row.kcal), protein: num(row.protein), carbs: num(row.carbs), fat: num(row.fat) }))),
    onSuccess: (saved) => {
      qc.setQueryData(nutritionKeys.goals, saved);
      setRows(toRows(saved));
      void qc.invalidateQueries({ queryKey: ["nutrition", "week"] });
    },
  });

  const update = (i: number, key: Field, value: string) => {
    save.reset();
    setRows(rows!.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  };

  return (
    <div className="mx-auto w-full lg:max-w-[720px]">
      <BackToMore />
      <PageHeader title="Goals" />
      <p className="m-0 px-4 pb-3 text-muted">
        Daily targets for each of you. Leave any blank. Calorie goals also decide how meals are split between you.
      </p>
      {!rows ? (
        goals.isError ? <StateMessage title="Couldn't load goals">{goals.error.message}</StateMessage> : <StateMessage title="Loading…" />
      ) : (
        <form
          className="grid gap-3 px-4 pb-6"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(rows);
          }}
        >
          {rows.map((row, i) => (
            <Card key={row.person} className="grid gap-3 p-4">
              <h2 className="m-0 text-lg">{row.person}</h2>
              <div className="grid grid-cols-2 gap-3">
                {FIELDS.map((f) => (
                  <TextField
                    key={f.key}
                    label={f.label}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={f.placeholder}
                    value={row[f.key]}
                    onChange={(e) => update(i, f.key, e.target.value)}
                  />
                ))}
              </div>
            </Card>
          ))}
          {save.isError && <p className="m-0 font-semibold text-danger">{save.error.message}</p>}
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : save.isSuccess ? "Saved" : "Save goals"}
          </Button>
        </form>
      )}
    </div>
  );
}
