import { BellRing, Pause, Play, X } from "lucide-react";

import { cx } from "../../lib/cx";
import { formatClock } from "./cookText";
import { msLeft, type CookTimer } from "./session";

// Every timer, whichever step you're on. Tap one to pause or resume it, ✕ to
// stop it (or dismiss it once it has rung).
export function TimerBar({
  timers,
  now,
  onToggle,
  onRemove,
}: {
  timers: CookTimer[];
  now: number;
  onToggle: (t: CookTimer) => void;
  onRemove: (id: string) => void;
}) {
  if (!timers.length) return null;
  const done = timers.filter((t) => t.doneAt !== null);
  return (
    <section aria-label="Timers" className="flex flex-wrap gap-2 border-t border-border px-4 pt-3">
      {/* One announcement when something rings, not every second. */}
      <p role="status" className="sr-only">
        {done.length ? `${done.map((t) => `Step ${t.step + 1}`).join(", ")} timer done` : ""}
      </p>
      {timers.map((t) => {
        const isDone = t.doneAt !== null;
        const running = !isDone && t.endsAt !== null;
        const Icon = isDone ? BellRing : running ? Pause : Play;
        return (
          <div
            key={t.id}
            className={cx(
              "flex items-center rounded-full",
              isDone ? "bg-primary text-on-primary motion-safe:animate-pulse" : "bg-surface-2 text-text",
            )}
          >
            <button
              type="button"
              onClick={() => (isDone ? onRemove(t.id) : onToggle(t))}
              aria-label={
                isDone ? `Step ${t.step + 1} timer done. Dismiss` : `Step ${t.step + 1} timer, ${running ? "pause" : "resume"}`
              }
              className="flex min-h-12 items-center gap-2 pl-4 pr-2 font-semibold tabular-nums"
            >
              <Icon size={18} aria-hidden="true" />
              <span className="text-sm opacity-80">Step {t.step + 1}</span>
              <span className="text-lg font-bold">{isDone ? "Done" : formatClock(msLeft(t, now) / 1000)}</span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(t.id)}
              aria-label={`Stop the step ${t.step + 1} timer`}
              className="grid size-12 place-items-center rounded-full"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </section>
  );
}
