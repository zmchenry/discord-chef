import type { z } from "zod";

import {
  notificationPrefsResponseSchema,
  pushPublicKeyResponseSchema,
  pushSendResultSchema,
  type NotificationPref,
  type PushSubscribeInput,
} from "../../../../shared/notifications";
import { errorResponseSchema } from "../../../../shared/schema";
import { ApiError } from "../../lib/api";

// API calls for this feature, plus the browser side of Web Push.

async function call<T extends z.ZodTypeAny>(schema: T | null, path: string, method = "GET", body?: unknown) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(await res.json().catch(() => null));
    throw new ApiError(res.status, parsed.success ? parsed.data.error : `${res.status} ${res.statusText}`);
  }
  return (schema === null || res.status === 204 ? undefined : schema.parse(await res.json())) as z.infer<T>;
}

export const notificationsApi = {
  getPrefs: () => call(notificationPrefsResponseSchema, "/notifications/prefs").then((r) => r.prefs),
  putPrefs: (prefs: NotificationPref[]) =>
    call(notificationPrefsResponseSchema, "/notifications/prefs", "PUT", { prefs }).then((r) => r.prefs),
  publicKey: () => call(pushPublicKeyResponseSchema, "/push/public-key").then((r) => r.publicKey),
  subscribe: (sub: PushSubscribeInput) => call(null, "/push/subscribe", "POST", sub),
  unsubscribe: (endpoint: string) => call(null, "/push/subscribe", "DELETE", { endpoint }),
  test: () => call(pushSendResultSchema, "/push/test", "POST", {}),
};

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function registration(): Promise<ServiceWorkerRegistration> {
  // main.tsx registers sw.js in production builds only.
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error("The app's service worker isn't running yet. Reload the page and try again.");
  return reg;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

function toInput(sub: PushSubscription): PushSubscribeInput {
  const json = sub.toJSON();
  return { endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth } };
}

function b64urlToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Asks for permission, subscribes this browser and registers it with the
// Worker. Returns the resulting permission.
export async function enablePush(): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlToBytes(await notificationsApi.publicKey()),
    }));
  await notificationsApi.subscribe(toInput(sub));
  return permission;
}

// Re-sends an existing subscription, in case the Worker dropped it.
export async function syncSubscription(sub: PushSubscription): Promise<void> {
  await notificationsApi.subscribe(toInput(sub));
}

export async function disablePush(sub: PushSubscription): Promise<void> {
  await notificationsApi.unsubscribe(sub.endpoint);
  await sub.unsubscribe();
}
