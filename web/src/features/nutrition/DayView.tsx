import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Link } from "react-router-dom";

import type { DayNutritionWire, MealNutritionWire, WeekNutritionWire } from "../../../../shared/nutrition";
import { hasAnyGoal, MACRO_SHORT } from "../../../../shared/nutrition/goals";
import { formatServings } from "../../../../shared/household/servings";
import { addDays, sundayOf } from "../../../../shared/planningApi";
import { Card, StateMessage } from "../../components/ui";
import { MARKER_LABEL, MEAL_LABEL } from "../planning/format";
import { useWeek } from "../planning/queries";
import { useWeekNutrition } from "./api";
import { CONFIDENCE_LABEL, dayTitle, fmt, goalFor, longDate, shownMacros } from "./format";
import { Est, GoalsPrompt, MacroMeter, PersonName } from "./parts";

// Day: each person's totals against every goal, then which meals they came from.
export function DayView({ date, onDate }: { date: string; onDate: (d: string) => void }) {
  const weekId = sundayOf(date);
  const q = useWeekNutrition(weekId);
  const day = q.data?.days.find((d) => d.date === date);

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Previous day"
          onClick={() => onDate(addDays(date, -1))}
          className="pressable grid min-h-11 min-w-11 place-items-center rounded-full bg-transparent text-text"
        >
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <div className="grid text-center">
          <span className="font-display text-xl font-semibold">{dayTitle(date)}</span>
          {dayTitle(date) !== longDate(date) && (
            <span className="text-xs text-muted">{longDate(date)}</span>
          )}
        </div>
        <button
          type="button"
          aria-label="Next day"
          onClick={() => onDate(addDays(date, 1))}
          className="pressable grid min-h-11 min-w-11 place-items-center rounded-full bg-transparent text-text"
        >
          <ChevronRight size={22} aria-hidden="true" />
        </button>
      </div>

      {q.isPending ? (
        <StateMessage title="Adding it up…" />
      ) : q.isError ? (
        <StateMessage title="Couldn't load nutrition">{q.error.message}</StateMessage>
      ) : !day ? null : (
        <DayBody data={q.data} day={day} weekId={weekId} />
      )}
    </div>
  );
}

function DayBody({ data, day, weekId }: { data: WeekNutritionWire; day: DayNutritionWire; weekId: string }) {
  const macros = shownMacros(data.goals);
  return (
    <>
      {data.filling && (
        <p className="m-0 text-sm text-muted" role="status">
          Estimating new ingredients…
        </p>
      )}
      {!hasAnyGoal(data.goals) && <GoalsPrompt />}
      <div className="grid gap-3 lg:grid-cols-2">
        {data.people.map((name, i) => {
          const p = day.people[name]!;
          const g = goalFor(data.goals, name);
          return (
            <Card key={name} className="grid gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <PersonName name={name} index={i} className="text-lg" />
                {p.home && p.known > 0 && <Est />}
              </div>
              {!p.home ? (
                <p className="m-0 text-muted">Away today, so nothing planned counts.</p>
              ) : p.known === 0 ? (
                <p className="m-0 text-muted">
                  Nothing with an estimate {p.gaps ? "planned" : "yet"}. Unknown meals are left out, not counted as zero.
                </p>
              ) : (
                <>
                  {macros.map((m) => (
                    <MacroMeter key={m} macro={m} value={p.totals[m]} goal={g?.[m] ?? null} index={i} />
                  ))}
                  {p.gaps > 0 && (
                    <p className="m-0 flex items-start gap-1.5 text-sm text-muted">
                      <Info size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
                      {p.gaps} meal{p.gaps === 1 ? "" : "s"} unknown, so the real total is higher.
                    </p>
                  )}
                </>
              )}
            </Card>
          );
        })}
      </div>
      <MealsBreakdown data={data} day={day} weekId={weekId} />
    </>
  );
}

// Which meals the totals came from, and what each person got from each.
function MealsBreakdown({ data, day, weekId }: { data: WeekNutritionWire; day: DayNutritionWire; weekId: string }) {
  const week = useWeek(weekId);
  const slotTitle = (m: MealNutritionWire) =>
    week.data?.slots.find((s) => s.date === day.date && s.meal === m.meal)?.recipe?.title ?? null;
  const home = data.people.map((name, i) => ({ name, i })).filter((p) => day.people[p.name]!.home);

  return (
    <section aria-labelledby="meals-title" className="grid gap-2">
      <h2 id="meals-title" className="m-0 mt-2 font-body text-xs font-bold uppercase tracking-wider text-muted">
        By meal
      </h2>
      <Card className="divide-y divide-border">
        {day.meals.map((m) => {
          const title = m.title ?? slotTitle(m);
          const linkId = m.recipeId ?? m.serves.sourceId;
          const why =
            m.history === "ate_out"
              ? "Ate out · not counted"
              : m.history === "skipped"
                ? "Skipped · not counted"
                : m.history === "swapped"
                  ? m.status === "known"
                    ? "Swapped in"
                    : "Swapped · not counted"
                  : m.status === "empty"
              ? "Nothing planned · not counted"
              : m.status === "gap"
                ? m.kind && m.kind !== "recipe"
                  ? `${MARKER_LABEL[m.kind]} · not counted`
                  : "No estimate yet · not counted"
                : m.confidence
                  ? CONFIDENCE_LABEL[m.confidence]
                  : null;
          return (
            <div key={m.meal} className="grid gap-2 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-muted">{MEAL_LABEL[m.meal]}</span>
                {why && <span className="text-xs text-muted">{why}</span>}
              </div>
              {title &&
                (linkId ? (
                  <Link to={`/recipes/${linkId}`} className="font-semibold text-text">
                    {m.kind === "leftovers" && m.history !== "swapped" ? `Leftovers: ${title}` : title}
                  </Link>
                ) : (
                  <span className="font-semibold">{title}</span>
                ))}
              {m.status === "known" && m.perServing && (
                <ul className="m-0 grid list-none gap-1 p-0">
                  {home.map(({ name, i }) => {
                    const portion = m.portions[name] ?? 0;
                    const n = (k: keyof typeof m.perServing) => Math.round(m.perServing![k] * portion);
                    return (
                      <li key={name} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                        <PersonName name={name} index={i} className="font-semibold" />
                        <span className="tabular-nums">
                          <span className="font-bold">{fmt(n("kcal"))}</span>
                          <span className="text-muted">
                            {" "}
                            kcal · {MACRO_SHORT.protein} {n("protein")} · {MACRO_SHORT.carbs} {n("carbs")} · {MACRO_SHORT.fat} {n("fat")} g ·{" "}
                            {formatServings(portion)} serving{portion === 1 ? "" : "s"}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </Card>
    </section>
  );
}
