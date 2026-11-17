import { ZodError } from "zod";

// Keeps an open (installed) app on the latest deploy. A PWA left open keeps
// running the JavaScript it started with, while the API moves on; when the
// two disagree a response fails its schema. So: compare our own bundle with
// the one the server now serves, and reload when they differ, at a moment
// that loses nothing (coming back to the app, or moving to another page).

const mine = (): string | null =>
  document.querySelector<HTMLScriptElement>('script[type="module"][src^="/assets/"]')?.getAttribute("src") ?? null;

let stale = false;

export const isStale = () => stale;

export async function checkForUpdate(): Promise<boolean> {
  const current = mine();
  if (!current || stale) return stale; // dev server, or already known
  try {
    // "fresh" makes the service worker pass this straight to the network.
    const res = await fetch("/?fresh=1", { cache: "no-store" });
    const html = await res.text();
    const served = html.match(/<script[^>]*type="module"[^>]*src="(\/assets\/[^"]+\.js)"/)?.[1];
    stale = !!served && served !== current;
  } catch {
    // Offline: nothing to compare against.
  }
  return stale;
}

// Reload, but never in a loop: at most once a minute.
export function reloadForUpdate(): void {
  try {
    const last = Number(sessionStorage.getItem("chef-reloaded-at") ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem("chef-reloaded-at", String(Date.now()));
  } catch {
    // No storage: reload anyway.
  }
  window.location.reload();
}

// A response that fails its schema is almost always an old app against a new
// API. If a newer app is out, load it now: this screen is broken anyway.
export async function onContractError(err: unknown): Promise<void> {
  if (err instanceof ZodError && (await checkForUpdate())) reloadForUpdate();
}

export function startFreshnessChecks(): void {
  if (!mine()) return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForUpdate().then((s) => s && reloadForUpdate());
  });
  setInterval(() => void checkForUpdate(), 30 * 60_000);
  void checkForUpdate();
}

// Screens show error.message as is. In production, a schema failure reads in
// plain words instead of the raw validation dump (the issues stay on the error
// for the console).
export function installFriendlyContractErrors(): void {
  if (!import.meta.env.PROD) return;
  Object.defineProperty(ZodError.prototype, "message", {
    configurable: true,
    get() {
      return "Chef was just updated. Close and reopen the app to load the new version.";
    },
  });
}
