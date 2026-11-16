/* Chef service worker. Hand-written, no build step: served as-is from
 * web/public, registered by src/main.tsx in production builds only.
 *
 * Strategy
 *   navigations     network-first, falling back to the cached app shell so
 *                   the app opens offline (the SPA then shows its own state)
 *   /assets/*       cache-first: Vite content-hashes these, so a cached copy
 *                   is never stale
 *   other static    stale-while-revalidate (icons, manifest, favicon)
 *   GET /api/*      network-first, falling back to the last good response
 *                   while offline. Only 200 JSON responses are stored.
 *   non-GET         never touched: passes straight to the network
 *
 * Cloudflare Access sits in front of everything. When its session expires,
 * a navigation is redirected to the Access login, which the browser follows
 * normally because navigations are passed through with fetch(request).
 *
 * Bump VERSION to drop every cache on the next activation.
 */
const VERSION = "v1";
const SHELL_CACHE = `chef-shell-${VERSION}`;
const ASSET_CACHE = `chef-assets-${VERSION}`;
const API_CACHE = `chef-api-${VERSION}`;
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE, API_CACHE]);

const SHELL_URLS = ["/", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => !KEEP.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
  } else if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstApi(request));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  } else {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put("/", response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match("/", { cacheName: SHELL_CACHE });
    return cached ?? Response.error();
  }
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    const type = response.headers.get("content-type") ?? "";
    if (response.status === 200 && type.includes("application/json")) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return (
      cached ??
      new Response(JSON.stringify({ error: "offline" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached ?? (await network) ?? Response.error();
}

/* Web Push (phase 6). The Worker sends a JSON payload:
 *   { "title": "...", "body": "...", "url": "/week", "tag": "daily_cooking" }
 * Every field is optional. `tag` collapses repeats of the same kind. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Chef";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      data: { url: sameOriginPath(data.url) },
    }),
  );
});

// Focus an open Chef window (navigating it to the payload's URL) or open one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(sameOriginPath(event.notification.data && event.notification.data.url), self.location.origin)
    .href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const exact = windows.find((w) => w.url === target);
      if (exact) return exact.focus();
      const any = windows[0];
      if (any) {
        await any.focus();
        return any.navigate(target);
      }
      return self.clients.openWindow(target);
    })(),
  );
});

// Only ever open paths on this origin, whatever the payload says.
function sameOriginPath(url) {
  try {
    const u = new URL(url || "/", self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : "/";
  } catch {
    return "/";
  }
}
