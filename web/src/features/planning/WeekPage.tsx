import { RotateCcw, CalendarOff, Check, Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { Meal } from "../../../../shared/schema";
import { addDays, sundayOf, todayIn, weekIdSchema, type WeekSlot, type WeekView } from "../../../../shared/planningApi";
import { Button, PageHeader, StateMessage } from "../../components/ui";
import { cx } from "../../lib/cx";
import { CalendarFreshness } from "../calendarRefresh/CalendarFreshness";
import { ClashBanner } from "../calendarRefresh/ClashBanner";
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
  const closeReplan = useCallback(() => setReplanOpen(false), []);
  const apply = useCallback((changes: SlotChange[]) => slotMutation.mutate(changes), [slotMutation]);
  const close = useCallback(() => setOpen(null), []);

  const choose = (id: string) => {
    setReviewing(false);
    setParams(id === thisWeek ? {} : { week: id }, { replace: true });
  };

  if (reviewing && week.data) {
    return <ReviewView week={week.data} onBack={() => setReviewing(false)} />;
  }

  return (
    <>
      <PageHeader
        title={weekId === nextWeek ? "Next week" : weekId === thisWeek ? "This week" : `Week of ${shortDate(weekId)}`}
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

      {week.isPending ? (
        <StateMessage title="Loading the week…" />
      ) : week.isError ? (
        <StateMessage title="Couldn't load this week">{week.error.message}</StateMessage>
      ) : (
        <WeekBody
          week={week.data}
          onOpen={(date, meal) => setOpen({ date, meal })}
          onApply={apply}
          onAutofill={() => autofill.mutate()}
          onReplan={() => setReplanOpen(true)}
          replanning={replan.isPending}
          autofilling={autofill.isPending}
          onReview={() => setReviewing(true)}
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

function WeekBody({
  week,
  onOpen,
  onApply,
  onAutofill,
  autofilling,
  onReplan,
  replanning,
  onReview,
}: {
  week: WeekView;
  onOpen: (date: string, meal: Meal) => void;
  onApply: (changes: SlotChange[]) => void;
  onAutofill: () => void;
  autofilling: boolean;
  onReplan: () => void;
  replanning: boolean;
  onReview: () => void;
}) {
  const toggleLock = (slot: WeekSlot) =>
    onApply([
      { date: slot.date, meal: slot.meal, set: { kind: slot.kind, recipeId: slot.recipeId, locked: !slot.locked } },
    ]);
  const { summary } = week;
  const open = summary.total - summary.filled;

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
        <ClashBanner weekId={week.id} clashes={week.clashes} onApply={onApply} onOpen={onOpen} />
        <RecommendationCard weekId={week.id} days={week.days} onAccept={onApply} />
        {summary.filled > 0 && (
          <button
            type="button"
            onClick={onReplan}
            disabled={replanning}
            className="pressable flex min-h-11 items-center gap-2 self-start rounded-full px-1 text-sm font-semibold text-primary"
          >
            <RotateCcw size={16} aria-hidden="true" />
            {replanning ? "Replanning…" : "Replan week"}
          </button>
        )}
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
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[5] mt-3 flex gap-2 bg-bg px-4 py-3 lg:bottom-0 lg:justify-end lg:py-4">
        <Button variant="secondary" className="flex-1 lg:flex-none lg:px-6" onClick={onAutofill} disabled={autofilling || open === 0}>
          <Sparkles size={18} aria-hidden="true" />
          {autofilling ? (
            "Filling…"
          ) : (
            <span className="whitespace-nowrap">
              Auto-fill<span className="max-[379px]:hidden"> the rest</span>
            </span>
          )}
        </Button>
        <Button className="flex-1 lg:flex-none lg:px-8" onClick={onReview}>
          Finish week
        </Button>
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
