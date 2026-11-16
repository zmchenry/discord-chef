import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { useCalendarRefresh } from "./api";

export function ago(ms: number, now: number): string {
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

// "Calendar updated 12 min ago · Refresh". Hidden when no calendar is set.
export function CalendarFreshness({ fetchedAt }: { fetchedAt: number | null }) {
  const refresh = useCalendarRefresh();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => setNow(Date.now()), [fetchedAt]);

  return (
    <p className="m-0 flex flex-wrap items-center gap-x-1 text-sm text-muted" aria-live="polite">
      <span>{fetchedAt === null ? "Calendar not read yet" : `Calendar updated ${ago(fetchedAt, now)}`}</span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={() => refresh.mutate()}
        disabled={refresh.isPending}
        className="pressable inline-flex min-h-11 items-center gap-1.5 px-1 font-semibold text-primary disabled:opacity-60"
      >
        <RefreshCw size={14} aria-hidden="true" className={refresh.isPending ? "animate-spin" : undefined} />
        {refresh.isPending ? "Refreshing…" : "Refresh"}
      </button>
      {refresh.data?.status === "error" && <span>Couldn't reach it, showing the last copy.</span>}
      {refresh.isError && <span>Refresh failed.</span>}
    </p>
  );
}
