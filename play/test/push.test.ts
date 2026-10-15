//! K-31a — the phone's half of push: feature detection, the key + beacon
//! helpers, when the 🔔 card shows, and the push-only service worker
//! (`public/sw.js`) run against a fake worker global: it shows the server's
//! notification, skips it while a play window is in the foreground (no
//! duplicate of the in-page banner) except on an iPhone, and a tap focuses
//! the open app.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { initialState, pushSupported, sameKey, showPushCard, urlBase64ToUint8Array, visibilityBeacon } from "../src/push.ts";

describe("push helpers", () => {
  it("needs a secure origin, a service worker, the Push API and notifications", () => {
    const full = { isSecureContext: true, navigator: { serviceWorker: {} }, PushManager: {}, Notification: {} };
    expect(pushSupported(full)).toBe(true);
    expect(pushSupported({ ...full, isSecureContext: false })).toBe(false); // plain-http LAN
    expect(pushSupported({ ...full, PushManager: undefined })).toBe(false); // iPhone Safari tab
    expect(pushSupported({ ...full, navigator: {} })).toBe(false);
    expect(pushSupported(undefined)).toBe(false);
  });

  it("decodes a URL-safe VAPID key and compares it to a subscription's", () => {
    const key = urlBase64ToUint8Array("AQID-_8");
    expect([...key]).toEqual([1, 2, 3, 251, 255]);
    expect(sameKey(new Uint8Array([1, 2, 3, 251, 255]).buffer, key)).toBe(true);
    expect(sameKey(new Uint8Array([1, 2, 3]).buffer, key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
  });

  it("starts from the server's config + the permission; the card only offers a one-tap yes", () => {
    expect(initialState(false, "granted")).toBe("off");
    expect(initialState(true, "granted")).toBe("working");
    expect(initialState(true, "denied")).toBe("denied");
    expect(initialState(true, "default")).toBe("ask");
    expect(showPushCard("ask", false)).toBe(true);
    expect(showPushCard("ask", true)).toBe(false);
    for (const s of ["on", "off", "denied", "unsupported", "working", "error"] as const) expect(showPushCard(s, false)).toBe(false);
  });

  it("the beacon carries the token (a beacon can't set headers)", () => {
    expect(JSON.parse(visibilityBeacon("tok", "https://fcm/x", true))).toEqual({ token: "tok", endpoint: "https://fcm/x", hidden: true });
  });
});

// --- the service worker --------------------------------------------------------

interface FakeClient {
  url: string;
  visibilityState: "visible" | "hidden";
  focused: boolean;
  focus: () => Promise<FakeClient>;
}

function loadWorker(opts: { ua?: string; clients?: FakeClient[] } = {}) {
  const listeners = new Map<string, (e: unknown) => void>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const self = {
    navigator: { userAgent: opts.ua ?? "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/129" },
    registration: {
      scope: "https://app.mapsandducks.com/",
      showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }),
    },
    clients: {
      matchAll: async () => opts.clients ?? [],
      claim: async () => {},
      openWindow: async (url: string) => void opened.push(url),
    },
    skipWaiting: () => {},
    addEventListener: (type: string, fn: (e: unknown) => void) => void listeners.set(type, fn),
  };
  const code = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  new Function("self", code)(self);
  const fire = async (type: string, extra: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ ...extra, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  };
  return {
    listeners,
    shown,
    opened,
    push: (payload: unknown) => fire("push", { data: { json: () => payload, text: () => JSON.stringify(payload) } }),
    click: (data: unknown) => {
      let closed = false;
      return fire("notificationclick", { notification: { data, close: () => (closed = true) } }).then(() => closed);
    },
  };
}

const client = (url: string, visibilityState: "visible" | "hidden", focused: boolean, focusLog?: string[]): FakeClient => {
  const c: FakeClient = { url, visibilityState, focused, focus: async () => (focusLog?.push(url), c) };
  return c;
};

describe("sw.js (push-only)", () => {
  it("has no fetch handler — nothing is ever cached or proxied", () => {
    const w = loadWorker();
    expect([...w.listeners.keys()].sort()).toEqual(["activate", "install", "notificationclick", "push"]);
  });

  it("shows the server's notification on a locked phone", async () => {
    const w = loadWorker({ clients: [client("https://app.mapsandducks.com/?code=X", "hidden", false)] });
    await w.push({ kind: "alert", title: "🚨 Trapped", body: "Come to the Desktop.", tag: "alert-4", url: "/" });
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]).toMatchObject({ title: "🚨 Trapped", options: { body: "Come to the Desktop.", tag: "alert-4", renotify: true, requireInteraction: true } });
  });

  it("no duplicate while the app is in the foreground — but other same-origin pages don't count", async () => {
    const fg = loadWorker({ clients: [client("https://app.mapsandducks.com/", "visible", true)] });
    await fg.push({ kind: "dm", title: "Trabolta", body: "hi", tag: "dm:Trabolta" });
    expect(fg.shown).toEqual([]);
    const editor = loadWorker({ clients: [client("https://app.mapsandducks.com/edit/", "visible", true)] });
    await editor.push({ kind: "dm", title: "Trabolta", body: "hi", tag: "dm:Trabolta" });
    expect(editor.shown).toHaveLength(1);
  });

  it("an iPhone always shows one (a silent push gets the subscription revoked)", async () => {
    const w = loadWorker({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)", clients: [client("https://app.mapsandducks.com/", "visible", true)] });
    await w.push({ kind: "dm", title: "Trabolta", body: "hi" });
    expect(w.shown).toHaveLength(1);
  });

  it("a tap focuses the open play window, else opens the app", async () => {
    const focused: string[] = [];
    const open = loadWorker({ clients: [client("https://app.mapsandducks.com/terminal/", "hidden", false, focused), client("https://app.mapsandducks.com/", "hidden", false, focused)] });
    expect(await open.click({ url: "/" })).toBe(true);
    expect(focused).toEqual(["https://app.mapsandducks.com/"]);
    const none = loadWorker();
    await none.click({ url: "/" });
    expect(none.opened).toEqual(["https://app.mapsandducks.com/"]);
  });
});
