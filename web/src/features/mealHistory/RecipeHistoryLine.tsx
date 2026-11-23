import { History, ThumbsDown, ThumbsUp } from "lucide-react";
import { Link } from "react-router-dom";

import { todayIn } from "../../../../shared/planningApi";
import { useRecipeHistory } from "./api";
import { ago } from "./format";

// On the recipe page: "Last made 12 days ago · made 6 times · 👍 5", linking
// to this recipe's history. Nothing until it has been made once.
export function RecipeHistoryLine({ recipeId }: { recipeId: string }) {
  const h = useRecipeHistory(recipeId);
  if (!h.data || h.data.timesMade === 0 || !h.data.lastMade) return null;
  const { timesMade, lastMade, up, down } = h.data;
  return (
    <Link
      to={`/history?recipe=${encodeURIComponent(recipeId)}`}
      className="pressable -my-1 inline-flex min-h-11 flex-wrap items-center gap-x-2 gap-y-0.5 self-start text-[1.0625rem] text-text no-underline"
    >
      <History size={20} aria-hidden="true" className="shrink-0 text-muted" />
      <span>Last made {ago(lastMade, todayIn())}</span>
      <span className="text-muted" aria-hidden="true">·</span>
      <span>
        made {timesMade} time{timesMade === 1 ? "" : "s"}
      </span>
      {up > 0 && (
        <>
          <span className="text-muted" aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1" aria-label={`${up} thumbs up`}>
            <ThumbsUp size={16} aria-hidden="true" className="text-accent" /> {up}
          </span>
        </>
      )}
      {down > 0 && (
        <span className="inline-flex items-center gap-1" aria-label={`${down} thumbs down`}>
          <ThumbsDown size={16} aria-hidden="true" className="text-muted" /> {down}
        </span>
      )}
    </Link>
  );
}
