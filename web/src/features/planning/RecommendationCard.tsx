import { Sparkles } from "lucide-react";
import { useState } from "react";

import type { WeekDay } from "../../../../shared/planningApi";
import { ReasonText } from "../../components/ReasonText";
import { cx } from "../../lib/cx";
import { dayName, MEAL_LABEL, money, pill } from "./format";
import { useRecommendations, type SlotChange } from "./queries";

// The top recommendation for the week, with Accept / Not now. "Not now" only
// hides it on this phone until the page reloads.
export function RecommendationCard({
  weekId,
  days,
  onAccept,
}: {
  weekId: string;
  days: WeekDay[];
  onAccept: (changes: SlotChange[]) => void;
}) {
  const recs = useRecommendations(weekId);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const keyOf = (r: { date: string; meal: string; recipeId: string }) => `${r.date}|${r.meal}|${r.recipeId}`;
  const rec = recs.data?.find((r) => !dismissed.includes(keyOf(r)));
  if (!rec || !days.some((d) => d.date === rec.date)) return null;

  const where = `${dayName(rec.date)} ${MEAL_LABEL[rec.meal].toLowerCase()}`;
  return (
    <section aria-label="Suggestion" className="rounded-card bg-accent-soft p-4">
      <p className="m-0 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-accent">
        <Sparkles size={14} aria-hidden="true" /> {rec.savesCents ? "Save" : "Suggestion"}
      </p>
      <p className="m-0 mt-1.5">
        {rec.replaces ? (
          <>
            Swap {where}
            {rec.replacesTitle ? ` (${rec.replacesTitle})` : ""} to <strong>{rec.title}</strong>.
          </>
        ) : (
          <>
            Add <strong>{rec.title}</strong> for {where}.
          </>
        )}{" "}
        <ReasonText text={rec.reason} />
        {rec.savesCents ? ` Saves about ${money(rec.savesCents)}.` : ""}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={cx(pill, "bg-accent text-bg")}
          onClick={() => {
            setDismissed([...dismissed, keyOf(rec)]);
            onAccept([
              {
                date: rec.date,
                meal: rec.meal,
                set: { kind: "recipe", recipeId: rec.recipeId, source: "suggested" },
                recipe: { id: rec.recipeId, title: rec.title, icon: null, totalMinutes: null },
              },
            ]);
          }}
        >
          Accept
        </button>
        <button
          type="button"
          className={cx(pill, "bg-surface text-text")}
          onClick={() => setDismissed([...dismissed, keyOf(rec)])}
        >
          Not now
        </button>
      </div>
    </section>
  );
}
