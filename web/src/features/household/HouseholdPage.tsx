import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { DEFAULT_PORTION, HOME_MEALS, KID_PORTIONS, type HomeMeal, type Member } from "../../../../shared/household";
import { eatersFor, servesText } from "../../../../shared/household/servings";
import { OverflowMenu } from "../../components/OverflowMenu";
import { Button, Card, PageHeader, StateMessage, TextField } from "../../components/ui";
import { cx } from "../../lib/cx";
import { BackToMore } from "../planning/SettingsLink";
import { useMembers, useSaveMembers } from "./api";

const MEAL_LABEL: Record<HomeMeal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };
const PORTION_LABEL: Record<number, string> = { 0.25: "Small ¼", 0.5: "Half ½", 1: "Full 1" };

const chip = (on: boolean) =>
  cx(
    "pressable min-h-11 rounded-full px-3.5 text-sm font-bold",
    on ? "bg-primary text-on-primary" : "bg-surface-2 text-text",
  );

// More → Household: who eats at home. Adults are the household's people
// (set on the Calendar page); kids are added here with a portion size.
// Recipes stay as written: each planned meal scales to who's home for it.
export function HouseholdPage() {
  const members = useMembers();
  const save = useSaveMembers();
  const [draft, setDraft] = useState<Member[] | null>(null);
  useEffect(() => {
    if (members.data && !draft) setDraft(members.data);
  }, [members.data, draft]);

  const edit = (next: Member[]) => {
    save.reset();
    setDraft(next);
  };
  const update = (i: number, patch: Partial<Member>) => edit(draft!.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const kidsBefore = (i: number) => draft!.slice(0, i).filter((m) => m.kind === "kid").length;
  const dinner = draft ? eatersFor(draft, "dinner", []) : [];
  const serves = servesText({
    adults: dinner.filter((m) => m.kind === "adult").length,
    kids: dinner.filter((m) => m.kind === "kid").length,
    total: dinner.reduce((a, m) => a + m.portion, 0),
  });

  return (
    <div className="mx-auto w-full lg:max-w-[720px]">
      <BackToMore />
      <PageHeader title="Household" />
      <p className="m-0 px-4 pb-3 text-muted">
        Recipes stay as written. Each planned meal is scaled to who's home for it, and so is the shopping list.
      </p>
      {!draft ? (
        members.isError ? (
          <StateMessage title="Couldn't load the household">{members.error.message}</StateMessage>
        ) : (
          <StateMessage title="Loading…" />
        )
      ) : (
        <form
          className="grid gap-3 px-4 pb-6"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(draft);
          }}
        >
          {draft.map((m, i) => {
            const placeholder = `Kid ${kidsBefore(i) + 1}`;
            return (
              <Card key={i} className="grid gap-3 p-4">
                {m.kind === "adult" ? (
                  <div>
                    <h2 className="m-0 text-lg">{m.name}</h2>
                    <p className="m-0 text-sm text-muted">Adult · portions follow your Goals</p>
                  </div>
                ) : (
                  <div className="flex items-end gap-1">
                    <TextField
                      className="min-w-0 flex-1"
                      label="Name (optional)"
                      placeholder={placeholder}
                      autoComplete="off"
                      maxLength={40}
                      value={m.name}
                      onChange={(e) => update(i, { name: e.target.value })}
                    />
                    <OverflowMenu
                      title={m.name.trim() || placeholder}
                      items={[
                        {
                          label: "Remove",
                          icon: Trash2,
                          destructive: true,
                          onSelect: () => edit(draft.filter((_, j) => j !== i)),
                        },
                      ]}
                    />
                  </div>
                )}

                {m.kind === "kid" && (
                  <fieldset className="m-0 grid gap-1.5 border-0 p-0">
                    <legend className="mb-1.5 p-0 text-sm font-semibold">Portion</legend>
                    <div className="grid grid-cols-3 gap-1.5">
                      {KID_PORTIONS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          aria-pressed={m.portion === p}
                          onClick={() => update(i, { portion: p })}
                          className={chip(m.portion === p)}
                        >
                          {PORTION_LABEL[p]}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}

                <fieldset className="m-0 grid gap-1.5 border-0 p-0">
                  <legend className="mb-1.5 p-0 text-sm font-semibold">Usually home for</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {HOME_MEALS.map((meal) => {
                      const on = m.meals.includes(meal);
                      return (
                        <button
                          key={meal}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            update(i, { meals: on ? m.meals.filter((x) => x !== meal) : HOME_MEALS.filter((x) => x === meal || m.meals.includes(x)) })
                          }
                          className={chip(on)}
                        >
                          {MEAL_LABEL[meal]}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </Card>
            );
          })}

          <Button
            variant="secondary"
            className="justify-self-start"
            disabled={draft.length >= 12}
            onClick={() => edit([...draft, { name: "", kind: "kid", portion: DEFAULT_PORTION.kid, meals: [...HOME_MEALS] }])}
          >
            <Plus size={18} aria-hidden="true" /> Add a kid
          </Button>

          <p className="m-0 text-sm text-muted">
            A dinner at home {serves.replace("Serves", "serves")}. Change one meal in the week's slot sheet.
          </p>
          {save.isError && <p className="m-0 font-semibold text-danger">{save.error.message}</p>}
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : save.isSuccess ? "Saved" : "Save household"}
          </Button>
        </form>
      )}
    </div>
  );
}
