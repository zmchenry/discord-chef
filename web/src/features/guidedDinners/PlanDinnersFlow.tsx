import { RefreshCw } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { Meal } from "../../../../shared/schema";
import { WEEKDAY_LONG, WEEKDAY_SHORT, type WeekDay, type WeekView } from "../../../../shared/planningApi";
import { MultiStepModal, type ModalStep } from "../../components/Modal";
import { ReasonText } from "../../components/ReasonText";
import { StateMessage } from "../../components/ui";
import { money, shortDate } from "../planning/format";
import { useSlotMutation, useWeek, useWeekAction } from "../planning/queries";
import { SlotSheet } from "../planning/SlotSheet";
import { useFillBreakfastLunch, useLastFill } from "./api";
import { DayStep } from "./DayStep";
import { firstOpenStep } from "./logic";
import { MealGrid } from "./MealGrid";

// "Plan dinners": a step per day (Sun to Sat) to pick dinners by hand, then
// breakfasts and lunches filled by the household rules, then a review.
// Every pick is saved as it's made, so closing midway keeps progress, and it
// reopens at the first day without a dinner.
export function PlanDinnersFlow({ weekId, onClose }: { weekId: string; onClose: () => void }) {
  const week = useWeek(weekId).data;
  const slotMutation = useSlotMutation(weekId);
  const fill = useFillBreakfastLunch(weekId);
  const lastFill = useLastFill(weekId).data ?? null;
  const finish = useWeekAction(weekId, "finish");
  const navigate = useNavigate();
  const [editing, setEditing] = useState<{ date: string; meal: Meal } | null>(null);
  // Decided once when the flow opens.
  const [initialStep] = useState(() => (week ? firstOpenStep(week) : 0));

  // Fill breakfasts and lunches the first time the B & L step shows.
  const filledOnce = useRef(false);
  const onBL = () => {
    if (filledOnce.current) return;
    filledOnce.current = true;
    fill.mutate(false);
  };

  if (!week) return null;
  const dinnerOf = (date: string) => week.slots.find((s) => s.date === date && s.meal === "dinner");

  const daySteps: ModalStep[] = week.days.map((day) => ({
    id: day.date,
    label: WEEKDAY_SHORT[day.weekday]!,
    title: `${WEEKDAY_LONG[day.weekday]} dinner`,
    description: <DayDescription day={day} />,
    primary: { label: dinnerOf(day.date) ? "Next" : "Skip for now" },
    render: () => (
      <DayStep
        key={day.date}
        weekId={weekId}
        day={day}
        slot={dinnerOf(day.date)}
        onPick={(set, recipe) => slotMutation.mutate([{ date: day.date, meal: "dinner", set, recipe }])}
      />
    ),
  }));

  const steps: ModalStep[] = [
    ...daySteps,
    {
      id: "bl",
      label: "B & L",
      title: "Breakfasts and lunches",
      description: "Breakfasts from your rotation; lunches are leftovers or a staple. Tap one to change it.",
      additional: [{ label: "Refill", icon: RefreshCw, onClick: async () => void (await fill.mutateAsync(true)) }],
      render: () => (
        <BreakfastLunchBody
          week={week}
          onShow={onBL}
          busy={fill.isPending}
          error={fill.error?.message ?? null}
          rotationIsDefault={lastFill?.rotationIsDefault ?? false}
          leftoversFrom={lastFill?.leftoversFrom ?? {}}
          onOpen={(date, meal) => setEditing({ date, meal })}
        />
      ),
    },
    {
      id: "review",
      label: "Review",
      title: "Your week",
      description: `${shortDate(week.id)} – ${shortDate(week.days[6]!.date)}`,
      render: () => <ReviewBody week={week} leftoversFrom={lastFill?.leftoversFrom ?? {}} error={finish.error?.message ?? null} />,
    },
  ];

  return (
    <>
      <MultiStepModal
        open
        onClose={onClose}
        steps={steps}
        initialStep={initialStep}
        finishLabel="Finish week"
        onFinish={async () => {
          await finish.mutateAsync();
          onClose();
          navigate(`/shop?week=${weekId}`);
        }}
      />
      {editing && (
        <SlotSheet
          weekId={weekId}
          day={week.days.find((d) => d.date === editing.date)!}
          days={week.days}
          meal={editing.meal}
          slot={week.slots.find((s) => s.date === editing.date && s.meal === editing.meal)}
          onApply={(changes) => slotMutation.mutate(changes)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

// "Taco Tuesday · Soccer 5:30–7 → 25 min or less". Without dinner
// constraints, the day's events instead.
function DayDescription({ day }: { day: WeekDay }) {
  const parts: string[] = [];
  if (day.theme?.meals.includes("dinner")) parts.push(day.theme.label);
  const constraints = day.constraints.filter((c) => c.meals.includes("dinner"));
  if (constraints.length) parts.push(...constraints.map((c) => c.reason));
  else parts.push(...day.events.slice(0, 2).map((e) => (e.allDay ? e.title : `${e.title} ${e.time}`)));
  if (parts.length === 0) return <>{shortDate(day.date)} · No theme or plans</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <ReasonText text={p} />
        </Fragment>
      ))}
    </span>
  );
}

function BreakfastLunchBody({
  week,
  onShow,
  busy,
  error,
  rotationIsDefault,
  leftoversFrom,
  onOpen,
}: {
  week: WeekView;
  onShow: () => void;
  busy: boolean;
  error: string | null;
  rotationIsDefault: boolean;
  leftoversFrom: Record<string, string>;
  onOpen: (date: string, meal: Meal) => void;
}) {
  useEffect(onShow, [onShow]);
  return (
    <div className="grid gap-3">
      {rotationIsDefault && (
        <p className="m-0 rounded-sm bg-surface-2 px-3 py-2 text-sm">
          Using your most-made breakfasts.{" "}
          <Link to="/more/breakfast-lunch" className="font-semibold text-primary">
            Set your rotation
          </Link>
        </p>
      )}
      {error && <p className="m-0 font-semibold text-danger">{error}</p>}
      {busy && week.slots.every((s) => s.meal === "dinner") ? (
        <StateMessage title="Filling breakfasts and lunches…" />
      ) : (
        <MealGrid week={week} meals={["breakfast", "lunch"]} leftoversFrom={leftoversFrom} onOpen={onOpen} />
      )}
    </div>
  );
}

function ReviewBody({ week, leftoversFrom, error }: { week: WeekView; leftoversFrom: Record<string, string>; error: string | null }) {
  const { filled, total, shared, estCostCents } = week.summary;
  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm text-muted">
        {filled} of {total} meals planned · {shared.length} shared ingredient{shared.length === 1 ? "" : "s"}
        {estCostCents !== null && ` · ${money(estCostCents)} est.`}
      </p>
      <MealGrid week={week} meals={["breakfast", "lunch", "dinner"]} leftoversFrom={leftoversFrom} />
      {shared.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Shared ingredients">
          {shared.slice(0, 8).map((s) => (
            <li key={s.ingredientId} className="rounded-full bg-accent-soft px-2.5 py-1 text-sm font-semibold text-accent">
              {s.name} ×{s.uses}
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-sm text-muted">Finishing builds the shopping list and lets everyone know.</p>
      {error && <p className="m-0 font-semibold text-danger">{error}</p>}
    </div>
  );
}
