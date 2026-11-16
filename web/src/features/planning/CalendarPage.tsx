import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { Button, Card, PageHeader, StateMessage, TextField } from "../../components/ui";
import { planningApi } from "./api";
import { planningKeys } from "./queries";
import { BackToMore } from "./SettingsLink";

// The family calendar's secret iCal address (write-only: the API only says
// whether one is set) and the household's people, which the calendar rules
// use for "someone's away".
export function CalendarPage() {
  const qc = useQueryClient();
  const calendar = useQuery({ queryKey: planningKeys.calendar, queryFn: ({ signal }) => planningApi.calendar(signal) });
  const household = useQuery({ queryKey: planningKeys.household, queryFn: ({ signal }) => planningApi.household(signal) });
  const [url, setUrl] = useState("");
  const [people, setPeople] = useState<string | null>(null);
  useEffect(() => {
    if (household.data && people === null) setPeople(household.data.people.join(", "));
  }, [household.data, people]);

  const saveCalendar = useMutation({
    mutationFn: (icalUrl: string | null) => planningApi.saveCalendar(icalUrl),
    onSuccess: (data) => {
      qc.setQueryData(planningKeys.calendar, data);
      setUrl("");
      void qc.invalidateQueries({ queryKey: ["week"] });
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
            <p className="m-0 flex items-center gap-2 font-semibold text-accent">
              <CalendarCheck size={18} aria-hidden="true" /> Connected{calendar.data.host ? ` (${calendar.data.host})` : ""}
            </p>
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
              if (url.trim()) saveCalendar.mutate(url.trim());
            }}
          >
            <TextField
              label={calendar.data?.configured ? "Replace the iCal address" : "Secret iCal address"}
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://calendar.google.com/…/basic.ics"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              error={saveCalendar.isError ? "That doesn't look like an https or webcal address." : undefined}
            />
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={!url.trim() || saveCalendar.isPending}>
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
