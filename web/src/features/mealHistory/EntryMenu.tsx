import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";

import type { HistoryEntryWire, MealStatus } from "../../../../shared/mealHistory";
import type { Meal } from "../../../../shared/schema";
import { ActionMenu, type MenuItem } from "../../components/OverflowMenu";
import { dayName, MEAL_LABEL } from "../planning/format";
import { useLogMeal } from "./api";
import { entryTitle, STATUS } from "./format";
import { SomethingElseModal } from "./SomethingElseModal";

// The row ⋯ for one meal: what happened, and a thumbs up or down.
export function EntryMenu({
  entry,
  onLogged,
}: {
  entry: Pick<HistoryEntryWire, "date" | "meal" | "status" | "confirmed" | "rating" | "recipe" | "plannedKind" | "freeText">;
  onLogged?: () => void;
}) {
  const log = useLogMeal();
  const [swapping, setSwapping] = useState(false);
  const set = (status: MealStatus, rating?: 1 | -1 | null) =>
    log.mutate({ date: entry.date, meal: entry.meal, status, ...(rating !== undefined ? { rating } : {}) }, { onSuccess: onLogged });

  const ateFood = entry.status === "eaten" || entry.status === "swapped";
  const items: MenuItem[] = (["eaten", "skipped", "ate_out"] as const).map((s) => ({
    label: STATUS[s].label,
    icon: STATUS[s].icon,
    checked: entry.confirmed && entry.status === s,
    onSelect: () => set(s),
  }));
  items.push({
    label: STATUS.swapped.label,
    icon: STATUS.swapped.icon,
    checked: entry.confirmed && entry.status === "swapped",
    hint: entry.status === "swapped" ? entryTitle(entry as HistoryEntryWire) : undefined,
    onSelect: () => setSwapping(true),
  });
  if (ateFood && (entry.recipe || entry.status === "swapped")) {
    items.push(
      { label: "Loved it", icon: ThumbsUp, checked: entry.rating === 1, onSelect: () => set(entry.status, entry.rating === 1 ? null : 1) },
      { label: "Not again", icon: ThumbsDown, checked: entry.rating === -1, onSelect: () => set(entry.status, entry.rating === -1 ? null : -1) },
    );
  }

  return (
    <>
      <ActionMenu
        items={items}
        label={`Change ${dayName(entry.date)} ${MEAL_LABEL[entry.meal as Meal].toLowerCase()}`}
        title={`${dayName(entry.date)} ${MEAL_LABEL[entry.meal as Meal].toLowerCase()}`}
        triggerClassName="pressable grid size-11 place-items-center rounded-full bg-transparent text-muted hover:bg-surface-2"
      />
      {swapping && (
        <SomethingElseModal
          date={entry.date}
          meal={entry.meal}
          onClose={() => {
            setSwapping(false);
            onLogged?.();
          }}
        />
      )}
    </>
  );
}
