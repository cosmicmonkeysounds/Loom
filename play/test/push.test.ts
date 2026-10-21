//! K-31a — the phone's half of push: feature detection, the key + beacon
//! helpers, when the 🔔 card shows, and the push-only service worker
//! (`public/sw.js`) run against a fake worker global: it shows the server's
//! notification, skips it while a play window is in the foreground (no
//! duplicate of the in-page banner) except on Apple's WebKit, and a tap focuses
//! the open app on the push's room (SW-PLAY-20).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { STATIC_MANIFEST_HREF, homescreenManifestHref, initialState, iosCanPush, iosInfo, iosState, pointManifest, pushSupported, sameKey, showPushCard, urlBase64ToUint8Array, visibilityBeacon } from "../src/push.ts";

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

describe("iPhones (K-31b)", () => {
  const IPHONE_17 = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const IPHONE_16_3 = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 Version/16.3 Mobile/15E148 Safari/604.1";
  const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15";
  const PIXEL = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36";
  const env = (userAgent: string, more: { maxTouchPoints?: number; standalone?: boolean; displayStandalone?: boolean } = {}) => ({
    navigator: { userAgent, maxTouchPoints: more.maxTouchPoints ?? 0, ...(more.standalone !== undefined ? { standalone: more.standalone } : {}) },
    matchMedia: () => ({ matches: more.displayStandalone === true }),
  });

  it("reads the iOS version and Home Screen mode; Android and a real Mac are not iOS", () => {
    expect(iosInfo(env(IPHONE_17))).toEqual({ major: 17, minor: 5, standalone: false });
    expect(iosInfo(env(IPHONE_16_3, { standalone: true }))).toEqual({ major: 16, minor: 3, standalone: true });
    expect(iosInfo(env(IPHONE_17, { displayStandalone: true }))!.standalone).toBe(true);
    expect(iosInfo(env(IPAD_AS_MAC, { maxTouchPoints: 5 }))).toEqual({ major: 16, minor: 4, standalone: false });
    expect(iosInfo(env(IPAD_AS_MAC))).toBeNull(); // a Mac: no touch screen
    expect(iosInfo(env(PIXEL))).toBeNull();
    expect(iosInfo(undefined)).toBeNull();
  });

  it("Push reached iOS in 16.4", () => {
    expect(iosCanPush({ major: 16, minor: 4, standalone: false })).toBe(true);
    expect(iosCanPush({ major: 18, minor: 0, standalone: false })).toBe(true);
    expect(iosCanPush({ major: 16, minor: 3, standalone: false })).toBe(false);
    expect(iosCanPush({ major: 0, minor: 0, standalone: false })).toBe(false); // version hidden
  });

  it("the install steps only when they'd work; else keep the app open", () => {
    const tab = { major: 17, minor: 5, standalone: false };
    expect(iosState(tab, true, true)).toBe("ios-install");
    expect(iosState(tab, true, false)).toBe("ios-keep-open"); // LOOM_HOMESCREEN off
    expect(iosState(tab, false, true)).toBe("ios-keep-open"); // no VAPID keys
    expect(iosState({ ...tab, major: 16, minor: 3 }, true, true)).toBe("ios-keep-open");
    expect(iosState({ ...tab, standalone: true }, true, true)).toBe("ios-keep-open"); // an icon with no Push API
    expect(showPushCard("ios-install", false)).toBe(true);
    expect(showPushCard("ios-keep-open", false)).toBe(true);
    expect(showPushCard("ios-install", true)).toBe(false);
  });

  it("Android is untouched: a full Push API still means the one-tap card", () => {
    const android = { isSecureContext: true, navigator: { serviceWorker: {}, userAgent: PIXEL }, PushManager: {}, Notification: {} };
    expect(pushSupported(android)).toBe(true);
    expect(iosInfo(android)).toBeNull();
    expect(showPushCard("ask", false)).toBe(true);
  });

  it("points the manifest at the nonce, labelled with the event", () => {
    expect(homescreenManifestHref("EVT1", "n_1", "Trapped in the Internet")).toBe("/manifest.webmanifest?code=EVT1&pair=n_1&name=Trapped+in+the+Internet");
    expect(homescreenManifestHref("EVT1", "n_1", null)).toBe("/manifest.webmanifest?code=EVT1&pair=n_1");
  });

  it("a guest's nonce link goes back to the static manifest (Leave, then a booth on the same tab)", () => {
    const attrs = new Map<string, string>([["href", homescreenManifestHref("EVT1", "n_1", "Trapped")]]);
    const link = { getAttribute: (k: string) => attrs.get(k) ?? null, setAttribute: (k: string, v: string) => void attrs.set(k, v) };
    const doc = { querySelector: () => link } as unknown as Pick<Document, "querySelector">;
    pointManifest(doc, STATIC_MANIFEST_HREF);
    expect(attrs.get("href")).toBe("/manifest.webmanifest"); // start_url "/" → signs in afresh
    expect(() => pointManifest({ querySelector: () => null } as unknown as Pick<Document, "querySelector">, STATIC_MANIFEST_HREF)).not.toThrow();
    expect(() => pointManifest(undefined, STATIC_MANIFEST_HREF)).not.toThrow();
  });
});

// --- the service worker --------------------------------------------------------

interface FakeClient {
  url: string;
  visibilityState: "visible" | "hidden";
  focused: boolean;
  focus: () => Promise<FakeClient>;
  posted?: unknown[];
  postMessage?: (m: unknown) => void;
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
  const posted: unknown[] = [];
  const c: FakeClient = { url, visibilityState, focused, focus: async () => (focusLog?.push(url), c), posted, postMessage: (m) => void posted.push(m) };
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

  it("an iPad posing as a Mac (Safari's \"Macintosh\" UA) always shows one too; Chrome on a Mac doesn't", async () => {
    const fg = () => [client("https://app.mapsandducks.com/", "visible", true)];
    const pad = loadWorker({ ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", clients: fg() });
    await pad.push({ kind: "dm", title: "Trabolta", body: "hi" });
    expect(pad.shown).toHaveLength(1);
    const chrome = loadWorker({ ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", clients: fg() });
    await chrome.push({ kind: "dm", title: "Trabolta", body: "hi" });
    expect(chrome.shown).toEqual([]);
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

  it("SW-PLAY-20: a tap opens the push's room — told to the open window (focused first), else in the link", async () => {
    const focused: string[] = [];
    const back = client("https://app.mapsandducks.com/?code=X", "hidden", false, focused);
    const front = client("https://app.mapsandducks.com/", "visible", true, focused);
    const w = loadWorker({ clients: [back, front] });
    await w.click({ url: "/?room=dm%3ATrabolta" });
    expect(front.posted).toEqual([{ type: "open-room", room: "dm:Trabolta", link: "?room=dm%3ATrabolta" }]);
    expect(back.posted).toEqual([]);
    expect(focused).toEqual(["https://app.mapsandducks.com/"]);
    expect(w.opened).toEqual([]); // never a second window, never a navigate
    const none = loadWorker();
    await none.click({ url: "/?room=wallet" });
    expect(none.opened).toEqual(["https://app.mapsandducks.com/?room=wallet"]);
  });

  it("a moment's screen link (`?go=pass`) reaches the open window whole (NM-F5)", async () => {
    const focused: string[] = [];
    const front = client("https://app.mapsandducks.com/", "visible", true, focused);
    const w = loadWorker({ clients: [front] });
    await w.click({ url: "/?go=pass" });
    expect(front.posted).toEqual([{ type: "open-room", room: "", link: "?go=pass" }]);
  });
});
