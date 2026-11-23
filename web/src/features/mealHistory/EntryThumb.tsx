import type { HistoryEntryWire } from "../../../../shared/mealHistory";
import { MEAL_LABEL } from "../planning/format";
import { entryIcon, STATUS } from "./format";

// The dish photo, else its emoji, else an icon for what happened, else the meal's letter.
export function EntryThumb({ entry }: { entry: HistoryEntryWire }) {
  const box = "grid size-12 shrink-0 place-items-center overflow-hidden rounded-sm bg-surface-2";
  if (entry.recipe?.imageUrl && (entry.status === "eaten" || entry.status === "swapped"))
    return (
      <span className={box}>
        <img src={entry.recipe.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
      </span>
    );
  if (entry.recipe?.icon && (entry.status === "eaten" || entry.status === "swapped"))
    return (
      <span className={`${box} text-2xl`} aria-hidden="true">
        {entry.recipe.icon}
      </span>
    );
  const Icon = entryIcon(entry) ?? (entry.status !== "eaten" ? STATUS[entry.status].icon : null);
  return (
    <span className={`${box} font-bold text-muted`} aria-hidden="true">
      {Icon ? <Icon size={20} /> : MEAL_LABEL[entry.meal][0]}
    </span>
  );
}
