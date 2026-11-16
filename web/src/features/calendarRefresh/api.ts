import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  calendarRefreshResponseSchema,
  dismissClashResponseSchema,
} from "../../../../shared/calendarRefresh";
import { errorResponseSchema } from "../../../../shared/schema";
import { ApiError } from "../../lib/api";

async function post<T>(path: string, body: unknown, parse: (x: unknown) => T): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(await res.json().catch(() => null));
    throw new ApiError(res.status, parsed.success ? parsed.data.error : `${res.status} ${res.statusText}`);
  }
  return parse(await res.json());
}

// Refetch the family calendar, then every week view (constraints and clashes
// come from it).
export const calendarRefreshKey = ["calendar-refresh"];

export function useCalendarRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: calendarRefreshKey,
    mutationFn: () => post("/calendar/refresh", {}, (x) => calendarRefreshResponseSchema.parse(x)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["week"] }),
  });
}

// "Keep it": the server stops returning this clash.
export function useDismissClash(weekId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fingerprint: string) =>
      post("/calendar/clashes/dismiss", { fingerprint }, (x) => dismissClashResponseSchema.parse(x)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["week", weekId], exact: true }),
  });
}
