// Loom play — the push-only service worker (K-31a). Served by the event
// server at /sw.js with `Cache-Control: no-cache`.
//
// It has NO fetch handler on purpose: the app is never cached or proxied,
// so a deploy is live on the next open and nothing here can serve a stale
// page. It does two things:
//   - `push`: show the server's notification. Skipped only when a play
//     window is visible AND focused (the app already shows it in-page, the
//     K-06 banner) — and never skipped on Apple's WebKit (an iPhone, an
//     iPad posing as a Mac — a worker can't see its touch screen — or Mac
//     Safari), where a push without a notification gets the subscription
//     revoked (K-31b).
//   - `notificationclick`: open the push's room (SW-PLAY-20, `/?room=…`).
//     A play window already open is told `{type: "open-room", room}` and
//     focused (never navigated: a reload would drop what it holds in
//     memory); with none open, the link opens a new one.
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
      const ua = self.navigator.userAgent;
      const apple = /iPhone|iPad|iPod/.test(ua) || (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Android/.test(ua));
      if (!apple) {
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
      const wins = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter(isPlayWindow);
      const open = wins.find((c) => c.focused) || wins.find((c) => c.visibilityState === "visible") || wins[0];
      if (!open) return self.clients.openWindow(target);
      let room = null;
      let link = "";
      try {
        const u = new URL(target);
        room = u.searchParams.get("room");
        link = u.search;
      } catch {
        room = null;
      }
      // `link`: the whole query (wave 18: `?go=pass`, `?room=codex&entry=…`).
      if (room || link.includes("go=")) open.postMessage({ type: "open-room", room: room || "", link });
      return open.focus();
    })(),
  );
});
