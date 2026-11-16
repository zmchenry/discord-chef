import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import type { CalendarSettings } from "../../../../shared/planningApi";
import { Button, Card, PageHeader, StateMessage, TextField } from "../../components/ui";
import { useCalendarRefresh } from "../calendarRefresh/api";
import { ago } from "../calendarRefresh/CalendarFreshness";
import { planningApi } from "./api";
import { planningKeys } from "./queries";
import { BackToMore } from "./SettingsLink";

// Google's public address (.../public/basic.ics) only works for a public
// calendar; the secret one has /private-.../ in its path.
function isPublicAddress(url: string): boolean {
  try {
    return new URL(url.trim().replace(/^webcal:\/\//i, "https://")).pathname.includes("/public/");
  } catch {
    return false;
  }
}

// The family calendar's secret iCal address (write-only: the API only says
// whether one is set, and how the last fetch went) and the household's
// people, which the calendar rules use for "someone's away".
export function CalendarPage() {
  const qc = useQueryClient();
  const calendar = useQuery({ queryKey: planningKeys.calendar, queryFn: ({ signal }) => planningApi.calendar(signal) });
  const household = useQuery({ queryKey: planningKeys.household, queryFn: ({ signal }) => planningApi.household(signal) });
  const [url, setUrl] = useState("");
  const [publicOk, setPublicOk] = useState(false);
  const refresh = useCalendarRefresh();
  // Fetch now, then show how it went.
  const check = () =>
    refresh.mutate(undefined, { onSettled: () => qc.invalidateQueries({ queryKey: planningKeys.calendar }) });
  const warnPublic = isPublicAddress(url) && !publicOk;
  const [people, setPeople] = useState<string | null>(null);
  useEffect(() => {
    if (household.data && people === null) setPeople(household.data.people.join(", "));
  }, [household.data, people]);

  const saveCalendar = useMutation({
    mutationFn: (icalUrl: string | null) => planningApi.saveCalendar(icalUrl),
    onSuccess: (data) => {
      qc.setQueryData(planningKeys.calendar, data);
      setUrl("");
      setPublicOk(false);
      if (data.configured) check();
      else void qc.invalidateQueries({ queryKey: ["week"] });
    },
  });
  const savePeople = useMutation({
    mutationFn: (list: string[]) => planningApi.saveHousehold({ people: list }),
    onSuccess: (data) => {
      qc.setQueryData(planningKeys.household, data);
      setPeople(data.people.join(", "));
    },
  });

  return (
    <>
      <BackToMore />
      <PageHeader title="Calendar" />
      <div className="grid gap-3 px-4 pb-6">
        <Card className="grid gap-3 p-4">
          <h2 className="m-0 text-lg">Family calendar</h2>
          {calendar.isPending ? (
            <StateMessage title="Loading…" />
          ) : calendar.data?.configured ? (
            <div className="grid gap-1">
              <p className="m-0 flex items-center gap-2 font-semibold text-accent">
                <CalendarCheck size={18} aria-hidden="true" /> Connected{calendar.data.host ? ` (${calendar.data.host})` : ""}
              </p>
              <FeedStatus status={calendar.data} checking={refresh.isPending} onCheck={check} />
            </div>
          ) : (
            <p className="m-0 text-muted">
              Not connected. In Google Calendar, open the calendar's settings and copy its “Secret address in iCal
              format”.
            </p>
          )}
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim() && !warnPublic) saveCalendar.mutate(url.trim());
            }}
          >
            <TextField
              label={calendar.data?.configured ? "Replace the iCal address" : "Secret iCal address"}
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://calendar.google.com/…/basic.ics"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setPublicOk(false);
              }}
              error={saveCalendar.isError ? "That doesn't look like an https or webcal address." : undefined}
            />
            {warnPublic && (
              <div role="alert" className="grid gap-2 rounded-sm bg-surface-2 p-3 text-sm">
                <p className="m-0 flex gap-2 font-semibold text-danger">
                  <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
                  That's the public address. Google refuses it unless the calendar is public.
                </p>
                <p className="m-0 text-muted">
                  In Google Calendar, open Settings, pick the calendar, and copy “Secret address in iCal format”
                  under Integrate calendar.
                </p>
                <Button variant="secondary" onClick={() => setPublicOk(true)}>
                  Use it anyway
                </Button>
              </div>
            )}
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={!url.trim() || warnPublic || saveCalendar.isPending}>
                Save
              </Button>
              {calendar.data?.configured && (
                <Button variant="danger" onClick={() => saveCalendar.mutate(null)} disabled={saveCalendar.isPending}>
                  Disconnect
                </Button>
              )}
            </div>
          </form>
        </Card>

        <Card className="p-4">
          <h2 className="m-0 mb-3 text-lg">Household</h2>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const list = (people ?? "").split(",").map((p) => p.trim()).filter(Boolean);
              if (list.length) savePeople.mutate(list);
            }}
          >
            <TextField
              label="People"
              hint="Comma separated. Used to spot when someone's away."
              value={people ?? ""}
              onChange={(e) => setPeople(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={savePeople.isPending}>
              {savePeople.isSuccess ? "Saved" : "Save people"}
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}

// "Fetched 5 min ago · 12 events in the next 4 weeks", or why it failed.
function FeedStatus({ status, checking, onCheck }: { status: CalendarSettings; checking: boolean; onCheck: () => void }) {
  const count =
    status.eventCount !== null
      ? ` · ${status.eventCount} event${status.eventCount === 1 ? "" : "s"} in the next 4 weeks`
      : "";
  const fetched =
    status.fetchedAt === null
      ? "Not fetched yet"
      : `${status.error ? "Last good copy" : "Fetched"} ${ago(status.fetchedAt, Date.now())}${count}`;
  return (
    <div className="grid gap-1 text-sm" aria-live="polite">
      {status.error && (
        <p className="m-0 flex gap-2 font-semibold text-danger">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {status.error}
        </p>
      )}
      <p className="m-0 flex flex-wrap items-center gap-x-1 text-muted">
        <span>{fetched}</span>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={onCheck}
          disabled={checking}
          className="pressable inline-flex min-h-11 items-center gap-1.5 bg-transparent px-1 font-semibold text-primary disabled:opacity-60"
        >
          <RefreshCw size={14} aria-hidden="true" className={checking ? "animate-spin" : undefined} />
          {checking ? "Checking…" : "Check now"}
        </button>
      </p>
    </div>
  );
}
