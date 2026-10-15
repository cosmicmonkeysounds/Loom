// Loom play — the push-only service worker (K-31a). Served by the event
// server at /sw.js with `Cache-Control: no-cache`.
//
// It has NO fetch handler on purpose: the app is never cached or proxied,
// so a deploy is live on the next open and nothing here can serve a stale
// page. It does two things:
//   - `push`: show the server's notification. Skipped only when a play
//     window is visible AND focused (the app already shows it in-page, the
//     K-06 banner) — and never skipped on an iPhone, where a push without a
//     notification gets the subscription revoked (K-31b).
//   - `notificationclick`: focus the open play window, else open one.
/* eslint-disable no-restricted-globals */

const PLAY_PATHS = new Set(["/", "/index.html"]);

function isPlayWindow(client) {
  try {
    return PLAY_PATHS.has(new URL(client.url).pathname);
  } catch {
    return false;
  }
}

function readPayload(data) {
  if (!data) return {};
  try {
    return data.json();
  } catch {
    try {
      return { body: data.text() };
    } catch {
      return {};
    }
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const p = readPayload(event.data);
  event.waitUntil(
    (async () => {
      const ios = /iPhone|iPad|iPod/.test(self.navigator.userAgent);
      if (!ios) {
        const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        if (wins.some((c) => isPlayWindow(c) && c.visibilityState === "visible" && c.focused)) return;
      }
      const tag = typeof p.tag === "string" && p.tag !== "" ? p.tag : undefined;
      await self.registration.showNotification(p.title || "Loom", {
        body: p.body || "",
        tag,
        renotify: tag !== undefined,
        requireInteraction: p.kind === "alert",
        vibrate: p.kind === "alert" ? [300, 120, 300, 120, 300] : [200],
        data: { url: p.url || "/" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = wins.find(isPlayWindow);
      if (open) return open.focus();
      return self.clients.openWindow(target);
    })(),
  );
});
