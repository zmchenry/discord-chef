import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing } from "lucide-react";
import { useEffect, useId, useState } from "react";

import type { NotificationPref } from "../../../../shared/notifications";
import type { NotificationKind } from "../../../../shared/schema";
import { Button, Card, PageHeader, StateMessage, TextField } from "../../components/ui";
import { BackToMore } from "../planning/SettingsLink";
import { cx } from "../../lib/cx";
import {
  currentSubscription,
  disablePush,
  enablePush,
  notificationsApi,
  pushSupported,
  syncSubscription,
} from "./push";

const COPY: Record<NotificationKind, { title: string; detail: string }> = {
  plan_week: { title: "Plan the week", detail: "Saturdays, when next week still has empty dinners." },
  daily_cooking: { title: "What's cooking", detail: "Each morning: today's meals and anything to thaw tonight." },
  list_ready: { title: "Shopping list ready", detail: "When the week's list has been made." },
};

const prefsKey = ["notifications", "prefs"] as const;

export function NotificationsPage() {
  return (
    <>
      <BackToMore />
      <PageHeader title="Notifications" />
      <div className="grid gap-4 px-4 pb-6">
        <DeviceCard />
        <PrefsList />
      </div>
    </>
  );
}

// --- This phone -----------------------------------------------------------------

function DeviceCard() {
  const supported = pushSupported();
  const [permission, setPermission] = useState<NotificationPermission>(supported ? Notification.permission : "default");
  const [sub, setSub] = useState<PushSubscription | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    currentSubscription().then(
      (s) => {
        setSub(s);
        // Keep the Worker's copy current (it drops subscriptions that expired).
        if (s && Notification.permission === "granted") void syncSubscription(s).catch(() => {});
      },
      // e.g. Chrome incognito, which has no Push API at all.
      () => setSub(null),
    );
  }, []);

  const enable = useMutation({
    mutationFn: async () => {
      const result = await enablePush();
      setPermission(result);
      if (result === "granted") setSub(await currentSubscription());
    },
    onMutate: () => setMessage(null),
    onError: (err) => setMessage(err instanceof Error ? err.message : String(err)),
  });

  const disable = useMutation({
    mutationFn: async () => {
      if (sub) await disablePush(sub);
      setSub(null);
    },
    onMutate: () => setMessage(null),
    onError: (err) => setMessage(err instanceof Error ? err.message : String(err)),
  });

  const test = useMutation({
    mutationFn: notificationsApi.test,
    onMutate: () => setMessage(null),
    onSuccess: (r) =>
      setMessage(
        r.sent > 0
          ? `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}. It should arrive in a few seconds.`
          : "No device took it. Try turning notifications off and on again.",
      ),
    onError: (err) => setMessage(err instanceof Error ? err.message : String(err)),
  });

  let body;
  if (!supported) {
    body = <p className="m-0 text-muted">This browser can't show notifications. Open Chef in Chrome on your phone.</p>;
  } else if (permission === "denied") {
    body = (
      <div className="grid gap-2">
        <p className="m-0 flex items-center gap-2 font-semibold text-danger">
          <BellOff size={18} aria-hidden="true" /> Notifications are blocked for Chef
        </p>
        <p className="m-0 text-muted">
          In Chrome, tap the icon left of the address bar, then Permissions, then Notifications, and choose Allow.
          Then reload this page.
        </p>
      </div>
    );
  } else if (sub === undefined) {
    body = <p className="m-0 text-muted">Checking…</p>;
  } else if (sub && permission === "granted") {
    body = (
      <div className="grid gap-3">
        <p className="m-0 flex items-center gap-2 font-semibold text-accent">
          <BellRing size={18} aria-hidden="true" /> On for this phone
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => test.mutate()} disabled={test.isPending}>
            {test.isPending ? "Sending…" : "Send a test"}
          </Button>
          <Button variant="ghost" onClick={() => disable.mutate()} disabled={disable.isPending}>
            Turn off here
          </Button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="grid gap-3">
        <p className="m-0 text-muted">Get reminders on this phone. Each phone is turned on separately.</p>
        <Button className="justify-self-start" onClick={() => enable.mutate()} disabled={enable.isPending}>
          {enable.isPending ? "Turning on…" : "Turn on notifications"}
        </Button>
      </div>
    );
  }

  return (
    <Card className="grid gap-3 p-4">
      <h2 className="m-0 text-lg">This phone</h2>
      {body}
      {message && (
        <p className="m-0 text-sm" role="status">
          {message}
        </p>
      )}
    </Card>
  );
}

// --- Per-kind settings ------------------------------------------------------------

function PrefsList() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: prefsKey, queryFn: notificationsApi.getPrefs });
  const save = useMutation({
    mutationFn: (p: NotificationPref) => notificationsApi.putPrefs([p]),
    onMutate: (p) => {
      // Optimistic: the switch and time move immediately.
      qc.setQueryData<NotificationPref[]>(prefsKey, (old) => old?.map((o) => (o.kind === p.kind ? p : o)));
    },
    onSuccess: (next) => qc.setQueryData(prefsKey, next),
    onError: () => void qc.invalidateQueries({ queryKey: prefsKey }),
  });

  if (prefs.isPending) return <StateMessage title="Loading…" />;
  if (prefs.isError) return <StateMessage title="Couldn't load settings">{prefs.error.message}</StateMessage>;

  return (
    <section className="grid gap-3" aria-label="What to send">
      {prefs.data.map((p) => (
        <PrefCard key={p.kind} pref={p} onChange={(next) => save.mutate(next)} />
      ))}
      {save.isError && (
        <p className="m-0 text-sm font-semibold text-danger" role="alert">
          Couldn't save: {save.error.message}
        </p>
      )}
      <p className="m-0 text-sm text-muted">Times are Eastern time. Settings apply to every phone you've turned on.</p>
    </section>
  );
}

function PrefCard({ pref, onChange }: { pref: NotificationPref; onChange: (p: NotificationPref) => void }) {
  const labelId = useId();
  const copy = COPY[pref.kind];

  return (
    <Card className="grid gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={labelId} className="m-0 text-base">
            {copy.title}
          </h3>
          <p className="m-0 mt-0.5 text-sm text-muted">{copy.detail}</p>
        </div>
        <Switch labelledBy={labelId} checked={pref.enabled} onChange={(enabled) => onChange({ ...pref, enabled })} />
      </div>
      {pref.localTime !== null && (
        <TextField
          label="Time"
          type="time"
          value={pref.localTime}
          disabled={!pref.enabled}
          className="max-w-44"
          onChange={(e) => {
            // A time input only reports complete values (or "" when cleared).
            if (/^\d\d:\d\d$/.test(e.target.value)) onChange({ ...pref, localTime: e.target.value });
          }}
        />
      )}
    </Card>
  );
}

function Switch({ checked, onChange, labelledBy }: { checked: boolean; onChange: (v: boolean) => void; labelledBy: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
      className="pressable -m-1 flex min-h-11 min-w-11 shrink-0 items-center justify-center p-1"
    >
      <span
        aria-hidden="true"
        className={cx(
          "relative inline-block h-7 w-12 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-border",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-6 w-6 rounded-full bg-surface shadow-card transition-[left]",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}
