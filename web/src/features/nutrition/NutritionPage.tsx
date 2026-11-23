import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, Target } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { MACROS, type Macro } from "../../../../shared/nutrition/goals";
import { isoDateSchema } from "../../../../shared/schema";
import { sundayOf, todayIn, weekIdSchema } from "../../../../shared/planningApi";
import { OverflowMenu } from "../../components/OverflowMenu";
import { PageHeader } from "../../components/ui";
import { nutritionApi } from "./api";
import { DayView } from "./DayView";
import { Segmented } from "./parts";
import { TrendsView } from "./TrendsView";
import { WeekView } from "./WeekView";

type View = "day" | "week" | "trends";
const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "trends", label: "Trends" },
];

// /week/nutrition?view=day|week|trends&date=&week=&m=: estimated calories and
// macros per person against their goals. Reached from the Today card and
// the ⋯ menu on the Week page, the bar on each day card, and More.
export function NutritionPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = todayIn();
  // An old link with only ?week= opens the Week view.
  const view: View =
    (["day", "week", "trends"] as const).find((v) => v === params.get("view")) ?? (params.get("week") ? "week" : "day");
  const date = isoDateSchema.safeParse(params.get("date")).success ? params.get("date")! : today;
  const week = weekIdSchema.safeParse(params.get("week")).success ? params.get("week")! : sundayOf(date);
  const macro: Macro = MACROS.find((m) => m === params.get("m")) ?? "kcal";

  const set = (next: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(next)) {
          if (v === null) p.delete(k);
          else p.set(k, v);
        }
        return p;
      },
      { replace: true },
    );

  const refresh = useMutation({
    mutationFn: () => nutritionApi.refresh(view === "trends" ? {} : { weekId: view === "day" ? sundayOf(date) : week }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["nutrition"] }),
  });

  // Back to wherever they came from (Week, More), else the Week page.
  const back = () => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate("/week"));

  return (
    <div className="mx-auto w-full lg:max-w-5xl">
      <button
        type="button"
        onClick={back}
        className="pressable ml-2 mt-3 inline-flex min-h-11 items-center gap-1 rounded-full bg-transparent pr-3 font-semibold text-text"
      >
        <ArrowLeft size={20} aria-hidden="true" /> Back
      </button>
      <PageHeader
        title="Nutrition"
        action={
          <OverflowMenu
            title="Nutrition"
            items={[
              { label: "Goals", icon: Target, onSelect: () => navigate("/more/goals") },
              {
                label: refresh.isPending ? "Estimating…" : "Estimate missing ingredients",
                icon: RefreshCw,
                onSelect: () => refresh.mutate(),
                disabled: refresh.isPending,
              },
            ]}
          />
        }
      />
      <div className="grid gap-3 px-4 pb-6">
        <Segmented label="View" options={VIEWS} value={view} onChange={(v) => set({ view: v })} className="lg:max-w-md" />
        {refresh.data && (
          <p className="m-0 text-sm text-muted" role="status">
            {refresh.data.estimated ? `Estimated ${refresh.data.estimated} ingredients.` : "Nothing new to estimate."}
            {refresh.data.missing ? ` ${refresh.data.missing} still missing.` : ""}
          </p>
        )}
        {view === "day" ? (
          <DayView date={date} onDate={(d) => set({ date: d === today ? null : d, week: null })} />
        ) : view === "week" ? (
          <WeekView
            weekId={week}
            onWeek={(w) => set({ week: w, date: null })}
            macro={macro}
            onMacro={(m) => set({ m: m === "kcal" ? null : m })}
            onOpenDay={(d) => set({ view: "day", date: d === today ? null : d, week: null })}
          />
        ) : (
          <TrendsView
            macro={macro}
            onMacro={(m) => set({ m: m === "kcal" ? null : m })}
            onOpenWeek={(w) => set({ view: "week", week: w, date: null })}
          />
        )}
      </div>
    </div>
  );
}

