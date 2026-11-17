import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Info, RefreshCw, Target } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import type { DayNutritionWire, GoalWire, WeekNutritionWire } from "../../../../shared/nutrition";
import { sundayOf, todayIn, weekIdSchema } from "../../../../shared/planningApi";
import { OverflowMenu } from "../../components/OverflowMenu";
import { Card, LinkButton, PageHeader, StateMessage } from "../../components/ui";
import { cx } from "../../lib/cx";
import { dayName, MARKER_LABEL, MEAL_LABEL, shortDate } from "../planning/format";
import { nutritionApi, nutritionKeys, useWeekNutrition } from "./api";
import { CONFIDENCE_LABEL, fmt, personFill } from "./format";
import { GoalBar } from "./GoalBar";

// /week/nutrition?week=: the week's estimated nutrition per person, against
// their daily goals. Days as rows; unknown meals are listed as gaps, never
// counted as zero.
export function WeekNutritionPage() {
  const [params] = useSearchParams();
  const requested = params.get("week");
  const weekId = requested && weekIdSchema.safeParse(requested).success ? requested : sundayOf(todayIn());
  const q = useWeekNutrition(weekId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => nutritionApi.refresh({ weekId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: nutritionKeys.weekAll(weekId) }),
  });
  useScrollToHash(!!q.data);

  return (
    <div className="mx-auto w-full lg:max-w-5xl">
      <Link
        to={weekId === sundayOf(todayIn()) ? "/week" : `/week?week=${weekId}`}
        className="pressable ml-2 mt-3 inline-flex min-h-11 items-center gap-1 rounded-full pr-3 font-semibold text-text no-underline"
      >
        <ArrowLeft size={20} aria-hidden="true" /> Week
      </Link>
      <PageHeader
        title="Nutrition"
        action={
          <OverflowMenu
            title="Nutrition"
            items={[
              {
                label: refresh.isPending ? "Estimating…" : "Estimate missing ingredients",
                icon: RefreshCw,
                onSelect: () => refresh.mutate(),
                disabled: refresh.isPending,
              },
              { label: "Goals", icon: Target, onSelect: () => navigate("/more/goals") },
            ]}
          />
        }
      />
      <p className="m-0 px-4 pb-3 text-muted">
        Week of {shortDate(weekId)}. Estimates per person, from what's planned and how it's portioned.
      </p>
      {refresh.data && (
        <p className="m-0 px-4 pb-3 text-sm text-muted" role="status">
          {refresh.data.estimated ? `Estimated ${refresh.data.estimated} ingredients.` : "Nothing new to estimate."}
          {refresh.data.missing ? ` ${refresh.data.missing} still missing.` : ""}
        </p>
      )}

      {q.isPending ? (
        <StateMessage title="Adding it up…" />
      ) : q.isError ? (
        <StateMessage title="Couldn't load nutrition">{q.error.message}</StateMessage>
      ) : (
        <Body data={q.data} />
      )}
    </div>
  );
}

function useScrollToHash(ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (ready && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [ready, hash]);
}

const goalOf = (goals: GoalWire[], person: string) => goals.find((g) => g.person === person) ?? null;

function Body({ data }: { data: WeekNutritionWire }) {
  const noGoals = data.goals.every((g) => g.kcal === null && g.protein === null);
  return (
    <div className="grid gap-3 px-4 pb-6">
      {data.filling && (
        <p className="m-0 text-sm text-muted" role="status">
          Estimating new ingredients…
        </p>
      )}
      {noGoals && (
        <Card className="flex flex-wrap items-center justify-between gap-2 p-4">
          <p className="m-0 min-w-0 flex-1">Set daily goals to see how the week lands for each of you.</p>
          <LinkButton to="/more/goals" variant="secondary">
            <Target size={18} aria-hidden="true" /> Set goals
          </LinkButton>
        </Card>
      )}
      <WeekSummary data={data} />
      <h2 className="m-0 mt-2 font-body text-xs font-bold uppercase tracking-wider text-muted">By day</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {data.days.map((d) => (
          <DayRow key={d.date} day={d} data={data} />
        ))}
      </div>
    </div>
  );
}

function WeekSummary({ data }: { data: WeekNutritionWire }) {
  return (
    <Card className="grid gap-4 p-4">
      <h2 className="m-0 text-xl">Per day, on average</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.people.map((name, i) => {
          const w = data.week[name]!;
          const g = goalOf(data.goals, name);
          return (
            <div key={name} className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="m-0 font-body text-base font-bold">{name}</h3>
                {w.confidence && <ConfidenceBadge level={w.confidence} />}
              </div>
              <Metric label="Calories" value={w.perDay.kcal} unit="kcal" goal={g?.kcal ?? null} fallback={2500} fill={personFill(i)} />
              <Metric label="Protein" value={w.perDay.protein} unit="g" goal={g?.protein ?? null} fallback={150} fill={personFill(i)} />
              <p className="m-0 text-sm text-muted">
                {fmt(w.perDay.carbs)} g carbs · {fmt(w.perDay.fat)} g fat · {w.daysHome} day{w.daysHome === 1 ? "" : "s"} home
                {w.gaps ? ` · ${w.gaps} meal${w.gaps === 1 ? "" : "s"} unknown` : ""}
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Metric(p: { label: string; value: number; unit: string; goal: number | null; fallback: number; fill: string }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted">{p.label}</span>
        <span className="tabular-nums">
          <span className="font-semibold">{fmt(p.value)}</span>
          <span className="text-muted">
            {p.goal ? ` / ${fmt(p.goal)}` : ""} {p.unit}
          </span>
        </span>
      </div>
      <GoalBar value={p.value} goal={p.goal} fallbackMax={p.fallback} fill={p.fill} />
    </div>
  );
}

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold",
        level === "high" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted",
      )}
    >
      <span aria-hidden="true" className="flex gap-0.5">
        {[0, 1, 2].map((n) => (
          <span
            key={n}
            className={cx("h-1.5 w-1.5 rounded-full", n < { high: 3, medium: 2, low: 1 }[level] ? "bg-current" : "bg-border")}
          />
        ))}
      </span>
      {CONFIDENCE_LABEL[level]}
    </span>
  );
}

function DayRow({ day, data }: { day: DayNutritionWire; data: WeekNutritionWire }) {
  const unknown = day.meals.filter((m) => m.status !== "known");
  return (
    <Card id={`d-${day.date}`} className="grid scroll-mt-20 gap-3 p-4">
      <h3 className="m-0 text-lg">
        {dayName(day.date)} <span className="font-body text-sm font-semibold text-muted">{shortDate(day.date)}</span>
      </h3>
      {data.people.map((name, i) => {
        const p = day.people[name]!;
        const g = goalOf(data.goals, name);
        if (!p.home)
          return (
            <p key={name} className="m-0 flex justify-between text-sm">
              <span className="font-semibold">{name}</span>
              <span className="text-muted">Away</span>
            </p>
          );
        return (
          <div key={name} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-semibold">{name}</span>
              <span className="tabular-nums">
                <span className="font-semibold">{fmt(p.totals.kcal)}</span>
                <span className="text-muted">
                  {g?.kcal ? ` / ${fmt(g.kcal)}` : ""} kcal · {fmt(p.totals.protein)}
                  {g?.protein ? `/${fmt(g.protein)}` : ""} g protein
                </span>
              </span>
            </div>
            <GoalBar value={p.totals.kcal} goal={g?.kcal ?? null} fallbackMax={2500} fill={personFill(i)} />
          </div>
        );
      })}
      {unknown.length > 0 && (
        <p className="m-0 flex items-start gap-1.5 text-sm text-muted">
          <Info size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            Not counted:{" "}
            {unknown
              .map(
                (m) =>
                  `${MEAL_LABEL[m.meal].toLowerCase()} (${
                    m.status === "empty" ? "not planned" : m.kind && m.kind !== "recipe" ? MARKER_LABEL[m.kind].toLowerCase() : "no estimate"
                  })`,
              )
              .join(", ")}
          </span>
        </p>
      )}
    </Card>
  );
}
