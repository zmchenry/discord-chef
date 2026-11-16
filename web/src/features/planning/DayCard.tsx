import { Ban, CalendarClock, Lock, LockOpen, Plus, Repeat, Tag, Utensils, type LucideIcon } from "lucide-react";

import { MEALS, type Meal, type SlotKind } from "../../../../shared/schema";
import type { WeekDay, WeekSlot } from "../../../../shared/planningApi";
import { Card } from "../../components/ui";
import { ReasonText } from "../../components/ReasonText";
import { cx } from "../../lib/cx";
import { dayName, MARKER_LABEL, MEAL_LABEL, shortDate } from "./format";

const MARKER_ICON: Record<Exclude<SlotKind, "recipe">, LucideIcon> = {
  leftovers: Repeat,
  eat_out: Utensils,
  skip: Ban,
};

export function DayCard({
  day,
  slots,
  onOpen,
  onToggleLock,
}: {
  day: WeekDay;
  slots: WeekSlot[];
  onOpen: (meal: Meal) => void;
  onToggleLock: (slot: WeekSlot) => void;
}) {
  return (
    <Card className="min-w-0 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
        <h2 className="m-0 text-xl">
          {dayName(day.date)} <span className="font-body text-sm font-semibold text-muted">{shortDate(day.date)}</span>
        </h2>
        {day.theme && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-sm font-semibold text-primary">
            <Tag size={14} aria-hidden="true" />
            {day.theme.label}
          </span>
        )}
      </div>
      {day.constraints.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0 px-1 pb-2">
          {day.constraints.map((c, i) => (
            <li
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-sm font-semibold text-accent"
            >
              <CalendarClock size={14} aria-hidden="true" />
              <ReasonText text={c.reason} />
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-2">
        {MEALS.map((meal) => (
          <SlotRow
            key={meal}
            meal={meal}
            slot={slots.find((s) => s.meal === meal)}
            onOpen={() => onOpen(meal)}
            onToggleLock={onToggleLock}
          />
        ))}
      </div>
    </Card>
  );
}

function SlotRow({
  meal,
  slot,
  onOpen,
  onToggleLock,
}: {
  meal: Meal;
  slot: WeekSlot | undefined;
  onOpen: () => void;
  onToggleLock: (slot: WeekSlot) => void;
}) {
  const letter = (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-bold text-muted"
    >
      {MEAL_LABEL[meal][0]}
    </span>
  );

  if (!slot) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="pressable flex min-h-14 w-full items-center gap-3 rounded-sm border border-dashed border-border bg-transparent px-2 text-left text-muted"
      >
        {letter}
        <span className="flex-1">Add {MEAL_LABEL[meal].toLowerCase()}</span>
        <Plus size={20} className="text-primary" aria-hidden="true" />
      </button>
    );
  }

  const auto = slot.source === "auto" && !slot.locked;
  const MarkerIcon = slot.kind !== "recipe" ? MARKER_ICON[slot.kind] : null;
  const title = slot.kind === "recipe" ? (slot.recipe?.title ?? "Recipe") : MARKER_LABEL[slot.kind];
  return (
    <div
      className={cx(
        "flex min-h-14 items-center rounded-sm",
        auto ? "border border-dashed border-primary" : "border border-transparent bg-bg",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${MEAL_LABEL[meal]}: ${title}. Change`}
        className="pressable flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-sm bg-transparent px-2 text-left text-text"
      >
        {letter}
        <span className="min-w-0 flex-1">
          <span className={cx("flex items-center gap-1.5 font-semibold", slot.kind === "skip" && "text-muted")}>
            {MarkerIcon && <MarkerIcon size={16} aria-hidden="true" />}
            <span className="truncate">
              {slot.recipe?.icon && slot.kind === "recipe" ? `${slot.recipe.icon} ` : ""}
              {title}
            </span>
          </span>
          {slot.kind === "recipe" && slot.recipe?.totalMinutes != null && (
            <span className="block text-sm text-muted">{slot.recipe.totalMinutes} min</span>
          )}
        </span>
        {auto && (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-primary">
            auto
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onToggleLock(slot)}
        aria-pressed={slot.locked}
        aria-label={slot.locked ? `Unlock ${MEAL_LABEL[meal].toLowerCase()}` : `Lock ${MEAL_LABEL[meal].toLowerCase()}`}
        className={cx(
          "pressable grid h-11 w-11 shrink-0 place-items-center rounded-full bg-transparent",
          slot.locked ? "text-primary" : "text-muted",
        )}
      >
        {slot.locked ? <Lock size={18} /> : <LockOpen size={18} />}
      </button>
    </div>
  );
}
