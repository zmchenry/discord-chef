import {
  CalendarCog,
  CalendarOff,
  Check,
  ClipboardCheck,
  Gauge,
  History,
  CookingPot,
  Coffee,
  RefreshCw,
  RotateCcw,
  ShoppingBasket,
  Sparkles,
  Tag,
} from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { Meal } from "../../../../shared/schema";
import { addDays, sundayOf, todayIn, weekIdSchema, type WeekSlot, type WeekView } from "../../../../shared/planningApi";
import { OverflowMenu, type MenuItem } from "../../components/OverflowMenu";
import { Button, PageHeader, StateMessage } from "../../components/ui";
import { cx } from "../../lib/cx";
import { useCalendarRefresh } from "../calendarRefresh/api";
import { CalendarFreshness } from "../calendarRefresh/CalendarFreshness";
import { ClashBanner } from "../calendarRefresh/ClashBanner";
import { useFillBreakfastLunch } from "../guidedDinners/api";
import { PlanDinnersFlow } from "../guidedDinners/PlanDinnersFlow";
import { CheckInCard } from "../mealHistory/CheckInCard";
import { TodayCard } from "../nutrition/TodayCard";
import { DayCard } from "./DayCard";
import { money, shortDate } from "./format";
import { RecommendationCard } from "./RecommendationCard";
import { ReviewView } from "./ReviewView";
import { useReplan, useSlotMutation, useWeek, useWeekAction, type SlotChange } from "./queries";
import { ReplanDialog } from "./ReplanDialog";
import { SlotSheet } from "./SlotSheet";

export function WeekPage() {
  const thisWeek = sundayOf(todayIn());
  const nextWeek = addDays(thisWeek, 7);
  const [params, setParams] = useSearchParams();
  // ?start= is what push notifications link to.
  const requested = params.get("week") ?? params.get("start");
  const weekId = requested && weekIdSchema.safeParse(requested).success ? requested : thisWeek;

  const week = useWeek(weekId);
  const [open, setOpen] = useState<{ date: string; meal: Meal } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const slotMutation = useSlotMutation(weekId);
  const autofill = useWeekAction(weekId, "autofill");
  const replan = useReplan(weekId);
  const [replanOpen, setReplanOpen] = useState(false);
  const [planning, setPlanning] = useState(false);
  const fillBL = useFillBreakfastLunch(weekId);
  const closeReplan = useCallback(() => setReplanOpen(false), []);
  const apply = useCallback((changes: SlotChange[]) => slotMutation.mutate(changes), [slotMutation]);
  const close = useCallback(() => setOpen(null), []);
  const refresh = useCalendarRefresh();
  const navigate = useNavigate();
  const plan = week.data ? primaryFor(week.data) : null;

  // One primary action in the sticky bar, chosen by the week's state; the
  // rest sit behind the header's more-actions button.
  const run = (a: Action) =>
    a === "plan"
      ? setPlanning(true)
      : a === "fillBL"
        ? fillBL.mutate(false)
        : a === "autofill"
          ? autofill.mutate()
          : a === "review"
            ? setReviewing(true)
            : navigate(`/shop?week=${weekId}`);
  const menu: MenuItem[] = [];
  if (week.data && plan) {
    if (week.data.summary.filled > 0)
      menu.push({ label: "Replan week", icon: RotateCcw, onSelect: () => setReplanOpen(true), disabled: replan.isPending });
    if (plan.primary !== "plan") menu.push({ label: "Plan dinners", icon: CookingPot, onSelect: () => run("plan") });
    if (plan.primary !== "fillBL" && plan.openBL > 0)
      menu.push({ label: "Fill breakfasts & lunches", icon: Coffee, onSelect: () => run("fillBL"), disabled: fillBL.isPending });
    if (plan.primary !== "autofill" && plan.open > 0)
      menu.push({ label: autofillLabel(plan.open), icon: Sparkles, onSelect: () => run("autofill") });
    if (plan.primary !== "review")
      menu.push({
        label: week.data.status === "planned" ? "Save changes" : "Finish week",
        icon: ClipboardCheck,
        onSelect: () => run("review"),
      });
    if (plan.primary !== "shop" && week.data.status === "planned")
      menu.push({ label: "Shopping list", icon: ShoppingBasket, onSelect: () => run("shop") });
    if (week.data.calendar !== "none")
      menu.push({ label: "Refresh calendar", icon: RefreshCw, onSelect: () => refresh.mutate(), disabled: refresh.isPending });
    menu.push({ label: "Meal history", icon: History, onSelect: () => navigate("/history") });
    menu.push({ label: "Nutrition", icon: Gauge, onSelect: () => navigate(`/week/nutrition?view=week&week=${weekId}`) });
    menu.push({ label: "Day themes", icon: Tag, onSelect: () => navigate("/more/themes") });
    menu.push({ label: "Calendar settings", icon: CalendarCog, onSelect: () => navigate("/more/calendar") });
  }

  const choose = (id: string) => {
    setReviewing(false);
    setParams(id === thisWeek ? {} : { week: id }, { replace: true });
  };

  if (reviewing && week.data) {
    return <ReviewView week={week.data} onBack={() => setReviewing(false)} />;
  }

  const primaryButton = (
            plan && (
              <Button
                className="w-full lg:w-auto lg:px-6"
                onClick={() => run(plan.primary)}
                disabled={(plan.primary === "autofill" && autofill.isPending) || (plan.primary === "fillBL" && fillBL.isPending)}
              >
                {plan.primary === "plan" ? (
                  <>
                    <CookingPot size={18} aria-hidden="true" />
                    Plan dinners
                  </>
                ) : plan.primary === "fillBL" ? (
                  <>
                    <Coffee size={18} aria-hidden="true" />
                    {fillBL.isPending ? "Filling…" : "Fill breakfasts & lunches"}
                  </>
                ) : plan.primary === "autofill" ? (
                  <>
                    <Sparkles size={18} aria-hidden="true" />
                    {autofill.isPending ? "Filling…" : autofillLabel(plan.open)}
                  </>
                ) : plan.primary === "review" ? (
                  week.data?.status === "planned" ? "Save changes" : "Finish week"
                ) : (
                  <>
                    <ShoppingBasket size={18} aria-hidden="true" />
                    Shopping list
                  </>
                )}
              </Button>
            )
  );

  return (
    <>
      <PageHeader
        title={weekId === nextWeek ? "Next week" : weekId === thisWeek ? "This week" : `Week of ${shortDate(weekId)}`}
        action={
          <div className="flex items-center gap-2">
            {/* Desktop: the primary action lives in the header; phones use the sticky bar. */}
            {primaryButton && <div className="hidden lg:block">{primaryButton}</div>}
            {menu.length > 0 && <OverflowMenu items={menu} title="Week" />}
          </div>
        }
      />
      <div className="px-4 pb-3">
        <div role="group" aria-label="Week" className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1 lg:max-w-md">
          {[
            { id: thisWeek, label: "This week" },
            { id: nextWeek, label: "Next week" },
          ].map((w) => (
            <button
              key={w.id}
              type="button"
              aria-pressed={weekId === w.id}
              onClick={() => choose(w.id)}
              className={cx(
                "pressable min-h-11 rounded-full text-sm font-bold",
                weekId === w.id ? "bg-surface text-text shadow-card" : "bg-transparent text-muted",
              )}
            >
              {w.label}
              <span className="block text-xs font-semibold text-muted">
                {shortDate(w.id)} – {shortDate(addDays(w.id, 6))}
              </span>
            </button>
          ))}
        </div>
      </div>
      {weekId === thisWeek && <TodayCard className="mx-4 mb-3" />}

      {week.isPending ? (
        <StateMessage title="Loading the week…" />
      ) : week.isError ? (
        <StateMessage title="Couldn't load this week">{week.error.message}</StateMessage>
      ) : (
        <WeekBody
          week={week.data}
          onOpen={(date, meal) => setOpen({ date, meal })}
          onApply={apply}
          primary={primaryButton}
        />
      )}

      {open && week.data && (
        <SlotSheet
          weekId={weekId}
          day={week.data.days.find((d) => d.date === open.date)!}
          days={week.data.days}
          meal={open.meal}
          slot={week.data.slots.find((s) => s.date === open.date && s.meal === open.meal)}
          onApply={apply}
          onClose={close}
        />
      )}

      {planning && week.data && <PlanDinnersFlow weekId={weekId} onClose={() => setPlanning(false)} />}

      {replanOpen && (
        <ReplanDialog
          busy={replan.isPending}
          onClose={closeReplan}
          onReplan={(keep) => replan.mutate(keep, { onSuccess: closeReplan })}
        />
      )}
    </>
  );
}

type Action = "plan" | "fillBL" | "autofill" | "review" | "shop";

// Dinners missing: plan them (the guided flow). Dinners done but breakfasts
// or lunches open: fill those by the household rules. Anything else still
// empty: auto-fill. All filled but still a draft: finish it. Planned: go
// shopping (changes after finishing are saved from the menu).
function primaryFor(week: WeekView): { primary: Action; open: number; openBL: number } {
  const open = week.summary.total - week.summary.filled;
  const openDinners = week.days.filter((d) => !week.slots.some((s) => s.date === d.date && s.meal === "dinner")).length;
  const openBL = 14 - week.slots.filter((s) => s.meal !== "dinner").length;
  const primary: Action =
    openDinners > 0 ? "plan" : openBL > 0 ? "fillBL" : open > 0 ? "autofill" : week.status === "draft" || week.changedSinceFinish ? "review" : "shop";
  return { open, openBL, primary };
}

const autofillLabel = (n: number) => `Auto-fill ${n} meal${n === 1 ? "" : "s"}`;

function WeekBody({
  week,
  onOpen,
  onApply,
  primary,
}: {
  week: WeekView;
  onOpen: (date: string, meal: Meal) => void;
  onApply: (changes: SlotChange[]) => void;
  primary: ReactNode;
}) {
  const toggleLock = (slot: WeekSlot) =>
    onApply([
      { date: slot.date, meal: slot.meal, set: { kind: slot.kind, recipeId: slot.recipeId, locked: !slot.locked } },
    ]);

  return (
    <>
      <SummaryBar week={week} />
      <div className="grid grid-cols-1 gap-3 px-4 pt-3">
        {week.status === "planned" && (
          <p className="m-0 flex items-center gap-2 rounded-sm bg-accent-soft px-3 py-2 text-sm font-semibold text-accent">
            <Check size={16} aria-hidden="true" /> Planned. You can still change anything.
          </p>
        )}
        {week.calendar !== "none" && <CalendarFreshness fetchedAt={week.calendarFetchedAt} />}
        {week.calendar === "error" && (
          <p className="m-0 flex items-center gap-2 text-sm text-muted">
            <CalendarOff size={16} aria-hidden="true" /> Couldn't read the calendar this time.
          </p>
        )}
        {week.days.some((d) => d.date === todayIn()) && <CheckInCard />}
        <ClashBanner weekId={week.id} clashes={week.clashes} onApply={onApply} onOpen={onOpen} />
        <RecommendationCard weekId={week.id} days={week.days} onAccept={onApply} />
      </div>
      {/* Phone: one column. Desktop: a board, several days side by side. */}
      <div className="grid grid-cols-1 gap-3 px-4 pt-3 lg:grid-cols-[repeat(auto-fill,minmax(300px,1fr))] lg:items-start lg:gap-4">
        {week.days.map((day) => (
          <DayCard
            key={day.date}
            day={day}
            slots={week.slots.filter((s) => s.date === day.date)}
            onOpen={(meal) => onOpen(day.date, meal)}
            onToggleLock={toggleLock}
          />
        ))}
      </div>
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[5] mt-3 flex bg-bg px-4 py-3 lg:hidden">
        {primary}
      </div>
    </>
  );
}

function SummaryBar({ week }: { week: WeekView }) {
  const { filled, total, shared, estCostCents } = week.summary;
  return (
    <div className="sticky top-0 z-[5] border-b border-border bg-bg px-4 py-2 lg:top-16" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-bold">
          {filled}/{total} planned
        </span>
        <span className="text-muted">
          {shared.length} shared ingredient{shared.length === 1 ? "" : "s"}
          {estCostCents !== null && ` · ${money(estCostCents)} est.`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(filled / total) * 100}%` }} />
      </div>
    </div>
  );
}
