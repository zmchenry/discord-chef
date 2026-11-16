import { ChevronLeft } from "lucide-react";

import { MEALS } from "../../../../shared/schema";
import type { WeekView } from "../../../../shared/planningApi";
import { Button, Card } from "../../components/ui";
import { dayName, MARKER_LABEL, MEAL_LABEL, money, shortDate } from "./format";
import { useWeekAction } from "./queries";

// The finish step: what's planned each day and what pulls double duty.
export function ReviewView({ week, onBack }: { week: WeekView; onBack: () => void }) {
  const finish = useWeekAction(week.id, "finish");
  const { filled, total, estCostCents, shared } = week.summary;

  return (
    <>
      <div className="flex items-center gap-1 px-2 pt-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to the week"
          className="pressable grid h-11 w-11 place-items-center rounded-full bg-transparent text-text"
        >
          <ChevronLeft size={22} />
        </button>
        <span className="font-semibold">Review</span>
      </div>
      <div className="grid gap-4 px-4 pb-4">
        <div>
          <p className="m-0 text-xs font-bold uppercase tracking-wider text-muted">
            {shortDate(week.id)} – {shortDate(week.days[6]!.date)}
          </p>
          <h1 className="m-0 text-3xl">Your week</h1>
          <p className="m-0 mt-1 text-muted">
            {filled} of {total} meals planned{total - filled > 0 ? `, ${total - filled} left open` : ""}
            {estCostCents !== null ? ` · ${money(estCostCents)} est.` : ""}
          </p>
        </div>

        <Card className="px-4 py-1">
          <ul className="m-0 list-none p-0">
            {week.days.map((day) => {
              const slots = MEALS.map((meal) => ({ meal, slot: week.slots.find((s) => s.date === day.date && s.meal === meal) }))
                .filter((x) => x.slot);
              return (
                <li key={day.date} className="flex gap-3 border-b border-border py-2.5 last:border-b-0">
                  <span className="w-10 shrink-0 font-bold">{dayName(day.date)}</span>
                  {slots.length === 0 ? (
                    <span className="text-muted">Nothing planned</span>
                  ) : (
                    <ul className="m-0 grid min-w-0 list-none gap-0.5 p-0">
                      {slots.map(({ meal, slot }) => (
                        <li key={meal} className="truncate">
                          <span className="mr-2 text-xs font-bold text-muted">{MEAL_LABEL[meal][0]}</span>
                          {slot!.kind === "recipe" ? slot!.recipe?.title : MARKER_LABEL[slot!.kind]}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <section>
          <h2 className="m-0 mb-2 text-xl">Pulling double duty</h2>
          <Card className="p-4">
            {shared.length === 0 ? (
              <p className="m-0 text-muted">No shared ingredients yet.</p>
            ) : (
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {shared.map((s) => (
                  <li key={s.ingredientId} className="rounded-full bg-accent-soft px-2.5 py-1 text-sm font-semibold text-accent">
                    {s.name} ×{s.uses}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        {finish.isError && <p className="m-0 font-semibold text-danger">{finish.error.message}</p>}
        <Button
          className="w-full"
          disabled={finish.isPending}
          onClick={() => finish.mutate(undefined, { onSuccess: onBack })}
        >
          {week.status === "planned" ? "Save changes" : finish.isPending ? "Finishing…" : "Finish week"}
        </Button>
      </div>
    </>
  );
}
