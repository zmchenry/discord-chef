import { useIsMutating } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { calendarRefreshKey } from "./api";

export function ago(ms: number, now: number): string {
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

// "Calendar updated 12 min ago", quiet text. Refreshing lives in the Week
// header's more-actions menu; while it runs this says so. Hidden when no
// calendar is set.
export function CalendarFreshness({ fetchedAt }: { fetchedAt: number | null }) {
  const refreshing = useIsMutating({ mutationKey: calendarRefreshKey }) > 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => setNow(Date.now()), [fetchedAt]);

  return (
    <p className="m-0 flex items-center gap-1.5 text-sm text-muted" aria-live="polite">
      {refreshing && <RefreshCw size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
      {refreshing
        ? "Refreshing the calendar…"
        : fetchedAt === null
          ? "Calendar not read yet"
          : `Calendar updated ${ago(fetchedAt, now)}`}
    </p>
  );
}
