import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Percent } from "lucide-react";
import { useEffect, useState } from "react";

import type { GoalWire } from "../../../../shared/nutrition";
import {
  DEFAULT_SPLIT,
  gramsFromSplit,
  kcalFromGrams,
  splitFromGrams,
  type Macro,
  type Split,
  type SplitMacro,
} from "../../../../shared/nutrition/goals";
import { Button, Card, PageHeader, StateMessage, TextField } from "../../components/ui";
import { BackToMore } from "../planning/SettingsLink";
import { nutritionApi, nutritionKeys, useGoals } from "./api";
import { fmt } from "./format";
import { PersonName } from "./parts";

type Row = { person: string } & Record<Macro, string>;

const GRAMS: Array<{ key: SplitMacro; label: string; placeholder: string }> = [
  { key: "protein", label: "Protein (g)", placeholder: "150" },
  { key: "carbs", label: "Carbs (g)", placeholder: "250" },
  { key: "fat", label: "Fat (g)", placeholder: "70" },
];

const toRows = (goals: GoalWire[]): Row[] =>
  goals.map((g) => ({
    person: g.person,
    kcal: g.kcal?.toString() ?? "",
    protein: g.protein?.toString() ?? "",
    carbs: g.carbs?.toString() ?? "",
    fat: g.fat?.toString() ?? "",
    fiber: g.fiber?.toString() ?? "",
  }));

const num = (s: string) => {
  const n = Math.round(Number(s.replace(/[^\d.]/g, "")));
  return s.trim() && Number.isFinite(n) ? n : null;
};

const toGoal = (r: Row) => ({
  person: r.person,
  kcal: num(r.kcal),
  protein: num(r.protein),
  carbs: num(r.carbs),
  fat: num(r.fat),
  fiber: num(r.fiber),
});

// More → Goals: daily targets per person for calories and each macro, with
// an optional "split by %" helper. Calories also set the default portion
// split (a bigger goal, a bigger share).
export function GoalsPage() {
  const qc = useQueryClient();
  const goals = useGoals();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (goals.data && !rows) setRows(toRows(goals.data));
  }, [goals.data, rows]);

  const save = useMutation({
    mutationFn: (r: Row[]) => nutritionApi.saveGoals(r.map(toGoal)),
    onSuccess: (saved) => {
      qc.setQueryData(nutritionKeys.goals, saved);
      setRows(toRows(saved));
      void qc.invalidateQueries({ queryKey: ["nutrition"] });
    },
  });

  const update = (i: number, patch: Partial<Row>) => {
    save.reset();
    setRows(rows!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
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
            <PersonGoals key={row.person} row={row} index={i} onChange={(patch) => update(i, patch)} />
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

function PersonGoals({ row, index, onChange }: { row: Row; index: number; onChange: (patch: Partial<Row>) => void }) {
  const [splitting, setSplitting] = useState(false);
  const g = toGoal(row);
  const fromGrams = kcalFromGrams(g);
  const split = splitFromGrams(g);

  return (
    <Card className="grid gap-3 p-4">
      <PersonName name={row.person} index={index} className="text-lg" />
      <TextField
        label="Calories (kcal)"
        inputMode="numeric"
        autoComplete="off"
        placeholder="2400"
        value={row.kcal}
        onChange={(e) => onChange({ kcal: e.target.value })}
      />
      <div className="grid grid-cols-3 gap-3">
        {GRAMS.map((f) => (
          <TextField
            key={f.key}
            label={f.label}
            inputMode="numeric"
            autoComplete="off"
            placeholder={f.placeholder}
            value={row[f.key]}
            onChange={(e) => onChange({ [f.key]: e.target.value })}
          />
        ))}
      </div>
      {fromGrams !== null && (
        <p className="m-0 text-sm text-muted">
          These add up to {fmt(fromGrams)} kcal
          {split ? ` · ${split.protein}/${split.carbs}/${split.fat}% protein/carbs/fat` : ""}.
        </p>
      )}
      <TextField
        label="Fiber (g, optional)"
        inputMode="numeric"
        autoComplete="off"
        placeholder="30"
        value={row.fiber}
        onChange={(e) => onChange({ fiber: e.target.value })}
        className="max-w-[50%]"
      />
      {splitting ? (
        <SplitHelper
          kcal={g.kcal}
          initial={split ?? DEFAULT_SPLIT}
          onFill={(grams) => {
            onChange({ protein: String(grams.protein), carbs: String(grams.carbs), fat: String(grams.fat) });
            setSplitting(false);
          }}
          onCancel={() => setSplitting(false)}
        />
      ) : (
        <Button variant="ghost" className="justify-self-start px-2 text-primary" onClick={() => setSplitting(true)}>
          <Percent size={18} aria-hidden="true" /> Split calories by %
        </Button>
      )}
    </Card>
  );
}

// Percent of calories for each macro (30/40/30 to start), turned into grams.
function SplitHelper({
  kcal,
  initial,
  onFill,
  onCancel,
}: {
  kcal: number | null;
  initial: Split;
  onFill: (grams: Record<SplitMacro, number>) => void;
  onCancel: () => void;
}) {
  const [pct, setPct] = useState<Record<SplitMacro, string>>({
    protein: String(initial.protein),
    carbs: String(initial.carbs),
    fat: String(initial.fat),
  });
  const split: Split = { protein: num(pct.protein) ?? 0, carbs: num(pct.carbs) ?? 0, fat: num(pct.fat) ?? 0 };
  const total = split.protein + split.carbs + split.fat;
  const grams = kcal ? gramsFromSplit(kcal, split) : null;

  return (
    <div className="grid gap-3 rounded-sm border border-border p-3">
      <p className="m-0 text-sm font-semibold">Split {kcal ? `${fmt(kcal)} kcal` : "calories"} by percent</p>
      <div className="grid grid-cols-3 gap-3">
        {GRAMS.map((f) => (
          <TextField
            key={f.key}
            label={`${f.label.split(" ")[0]} %`}
            inputMode="numeric"
            autoComplete="off"
            value={pct[f.key]}
            onChange={(e) => setPct({ ...pct, [f.key]: e.target.value })}
            hint={grams ? `${fmt(grams[f.key])} g` : undefined}
          />
        ))}
      </div>
      <p className={total === 100 ? "m-0 text-sm text-muted" : "m-0 text-sm font-semibold text-danger"}>
        {total === 100 ? "Adds up to 100%." : `Adds up to ${total}%, not 100%.`}
        {!kcal && " Enter calories first."}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" disabled={!grams || total !== 100} onClick={() => grams && onFill(grams)}>
          Fill in grams
        </Button>
      </div>
    </div>
  );
}
