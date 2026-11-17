import { BellRing, Pause, Play, Timer } from "lucide-react";
import { useState, type ReactNode } from "react";

import { findTechniques, TECHNIQUES } from "../../../../shared/recipeStructure";
import { cx } from "../../lib/cx";
import { detectDurations, formatClock, formatDuration } from "./cookText";
import { msLeft, type CookTimer } from "./session";

// A step's text as paragraphs. Technique words are small outlined pills
// (tap one for a one-line definition), and each paragraph that mentions a
// duration gets tap-to-start timer chips right under it.
export function StepText({
  step,
  text,
  timers,
  now,
  onTimer,
}: {
  step: number;
  text: string;
  timers: CookTimer[];
  now: number;
  onTimer: (id: string, step: number, seconds: number) => void;
}) {
  const [term, setTerm] = useState<{ key: string; para: number } | null>(null);
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="grid gap-5">
      {paragraphs.map((p, n) => {
        const durations = detectDurations(p);
        const def = term?.para === n ? TECHNIQUES[term.key] : undefined;
        return (
          <div key={n} className="grid gap-3">
            <p className="m-0 text-2xl leading-relaxed">{withPills(p, n, term, setTerm)}</p>
            {def && (
              <p role="status" className="m-0 rounded-sm bg-surface-2 px-3 py-2 text-base">
                <strong>{def.label}:</strong> {def.definition}
              </p>
            )}
            {durations.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {durations.map((d, k) => {
                  const id = `${step}:${n}.${k}`;
                  return (
                    <TimerChip
                      key={id}
                      seconds={d.seconds}
                      timer={timers.find((t) => t.id === id)}
                      now={now}
                      onClick={() => onTimer(id, step, d.seconds)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function withPills(
  p: string,
  para: number,
  open: { key: string; para: number } | null,
  setOpen: (v: { key: string; para: number } | null) => void,
): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const span of findTechniques(p).sort((a, b) => a.start - b.start)) {
    if (span.start < at) continue;
    out.push(p.slice(at, span.start));
    const known = !!TECHNIQUES[span.key];
    const pressed = open?.key === span.key && open.para === para;
    out.push(
      known ? (
        <button
          key={span.start}
          type="button"
          aria-expanded={pressed}
          onClick={() => setOpen(pressed ? null : { key: span.key, para })}
          className="mx-0.5 inline-flex items-center rounded-full border border-current px-2 align-[0.1em] text-[0.7em] font-semibold leading-snug text-accent"
        >
          {span.term}
        </button>
      ) : (
        <span
          key={span.start}
          className="mx-0.5 inline-flex rounded-full border border-border px-2 align-[0.1em] text-[0.7em] font-semibold leading-snug"
        >
          {span.term}
        </span>
      ),
    );
    at = span.end;
  }
  out.push(p.slice(at));
  return out;
}

function TimerChip({ seconds, timer, now, onClick }: { seconds: number; timer?: CookTimer; now: number; onClick: () => void }) {
  const done = timer?.doneAt != null;
  const running = !!timer && !done && timer.endsAt !== null;
  const paused = !!timer && !done && timer.endsAt === null;
  const Icon = done ? BellRing : running ? Pause : paused ? Play : Timer;
  const label = done
    ? `Done · restart ${formatDuration(seconds)}`
    : running
      ? formatClock(msLeft(timer!, now) / 1000)
      : paused
        ? `${formatClock(msLeft(timer!, now) / 1000)} paused`
        : `Start ${formatDuration(seconds)}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        done
          ? `Timer done. Restart ${formatDuration(seconds)}`
          : running
            ? "Pause timer"
            : paused
              ? "Resume timer"
              : `Start a ${formatDuration(seconds)} timer`
      }
      className={cx(
        "pressable inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-lg font-bold tabular-nums",
        running || done ? "bg-primary text-on-primary" : "bg-transparent text-primary shadow-[inset_0_0_0_1.5px_currentColor]",
      )}
    >
      <Icon size={20} aria-hidden="true" />
      {label}
    </button>
  );
}
