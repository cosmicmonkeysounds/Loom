//! Push to a locked phone (K-31a — Android + booths). The server pushes `!`
//! alerts always, and a character's DM / a booth readout only while this
//! page says it is hidden (`core/server/push.ts`). This module is the
//! phone's half:
//!
//! - **Opt-in from a tap.** Android asks for notification permission only
//!   from a gesture, so the app shows a 🔔 "Get alerts" card (and a row in
//!   the profile sheet); a phone that already granted it re-binds silently
//!   on every sign-in (a story restart unbinds every guest's device).
//! - **The service worker** is `/sw.js` (push-only, no fetch handler —
//!   `play/public/sw.js`). It is **never registered when the app is
//!   embedded** (the editor's Run → Players, `host.embedded`).
//! - **Visibility.** Every `visibilitychange` (and `pagehide`) is beaconed
//!   to `/api/push/visible` — `sendBeacon` survives the page going away,
//!   and "the SSE stream dropped" is the wrong test for "locked".
//! - **Off cleanly.** No VAPID keys on the server (`enabled: false`), no
//!   Push API, or an insecure origin (plain-http LAN) → no card, nothing
//!   registered.
//! - **iPhones (K-31b).** iOS has no Push API outside a Home Screen app, so
//!   an iPhone tab gets a card that says what to do instead: on iOS 16.4+
//!   with the server's `homescreen` switch on, the Add-to-Home-Screen steps
//!   (`ios-install` — a guest's tab first mints a one-time nonce and points
//!   `<link rel=manifest>` at it, so the icon opens signed in as them, and
//!   points it back at the static file when that session ends; a booth is
//!   told to Sign out — that frees its part — and sign in from the icon);
//!   otherwise "keep the app open, screen on" (`ios-keep-open`). Inside the Home Screen app
//!   the Push API is there and the normal flow runs.
//!
//! Pure helpers first (unit-tested in `test/push.test.ts`), then the hook.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./client.ts";
import { usePlayHost } from "./host.ts";

/** Where push stands on this phone. */
export type PushState =
  | "unsupported" // no Push API here (or embedded) — say nothing
  | "ios-install" // an iPhone tab: Add to Home Screen, then turn alerts on there
  | "ios-keep-open" // an iPhone that can't get alerts: keep the app open
  | "off" // the server has no keys, or we're still asking it
  | "ask" // ready: one tap turns it on
  | "working" // asking permission / subscribing
  | "on"
  | "denied" // the person (or the browser) said no
  | "error";

/** The browser surface `pushSupported` reads (injectable for tests). */
export interface PushEnv {
  isSecureContext?: boolean;
  navigator?: { serviceWorker?: unknown; userAgent?: string; maxTouchPoints?: number; standalone?: boolean };
  PushManager?: unknown;
  Notification?: unknown;
  matchMedia?: (query: string) => { matches: boolean };
}

/** Can this page get pushes at all? Needs a secure origin, a service
 *  worker, the Push API and notifications (iPhone Safari has no
 *  `PushManager` outside a Home Screen app). */
export function pushSupported(env: PushEnv | undefined = typeof window === "undefined" ? undefined : (window as unknown as PushEnv)): boolean {
  if (env === undefined) return false;
  return env.isSecureContext === true && env.navigator?.serviceWorker != null && env.PushManager != null && env.Notification != null;
}

/** An iPhone / iPad: its iOS version (0.0 when the UA hides it) and whether
 *  this page is a Home Screen app. */
export interface IosInfo {
  major: number;
  minor: number;
  standalone: boolean;
}

/** iOS or iPadOS (which may pose as a Mac: "Macintosh" + a touch screen),
 *  else null. */
export function iosInfo(env: PushEnv | undefined = typeof window === "undefined" ? undefined : (window as unknown as PushEnv)): IosInfo | null {
  const ua = env?.navigator?.userAgent ?? "";
  const phone = /\b(iPhone|iPad|iPod)\b/u.test(ua);
  const padAsMac = /\bMacintosh\b/u.test(ua) && (env?.navigator?.maxTouchPoints ?? 0) > 1;
  if (!phone && !padAsMac) return null;
  const v = /\bOS (\d+)[_.](\d+)/u.exec(ua) ?? /\bVersion\/(\d+)\.(\d+)/u.exec(ua);
  let standalone = env?.navigator?.standalone === true;
  try {
    standalone ||= env?.matchMedia?.("(display-mode: standalone)").matches === true;
  } catch {
    /* no matchMedia */
  }
  return { major: v ? Number(v[1]) : 0, minor: v ? Number(v[2]) : 0, standalone };
}

/** Web Push reached iOS in 16.4, inside Home Screen apps only. */
export function iosCanPush(info: IosInfo): boolean {
  return info.major > 16 || (info.major === 16 && info.minor >= 4);
}

/** The card an iPhone with no Push API gets: the install steps when they
 *  would work (16.4+, a tab, the server has keys and K-31b on), else the
 *  keep-it-open note. */
export function iosState(info: IosInfo, enabled: boolean, homescreen: boolean): PushState {
  return iosCanPush(info) && !info.standalone && enabled && homescreen ? "ios-install" : "ios-keep-open";
}

/** Where a guest's tab points `<link rel=manifest>` once it holds a nonce
 *  (`/api/guest/homescreen`); `name` labels the icon. */
export function homescreenManifestHref(code: string, pair: string, name?: string | null): string {
  const p = new URLSearchParams({ code, pair });
  if (name) p.set("name", name);
  return `/manifest.webmanifest?${p.toString()}`;
}

/** The play app's own manifest (`index.html`): its `start_url` is "/". */
export const STATIC_MANIFEST_HREF = "/manifest.webmanifest";

/** Point `<link rel=manifest>` at `href` (no-op without one). A guest's
 *  nonce link is put back to the static file when their session ends, so a
 *  booth — or the next person — on the same tab never adds an icon that
 *  opens signed in as the guest who left. */
export function pointManifest(doc: Pick<Document, "querySelector"> | undefined, href: string): void {
  const link = doc?.querySelector<HTMLLinkElement>('link[rel="manifest"]') ?? null;
  if (link !== null && link.getAttribute("href") !== href) link.setAttribute("href", href);
}

/** A VAPID public key (URL-safe base64) as the bytes `subscribe` wants. */
export function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padded = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/gu, "+").replace(/_/gu, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Was this subscription made with `key`? (A rotated server key needs a
 *  fresh subscription — the old one would be refused by the push service.) */
export function sameKey(existing: ArrayBuffer | null | undefined, key: Uint8Array): boolean {
  if (existing == null) return false;
  const a = new Uint8Array(existing);
  if (a.length !== key.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== key[i]) return false;
  return true;
}

/** The beacon body: the token rides it, since a beacon can't set headers. */
export function visibilityBeacon(token: string, endpoint: string, hidden: boolean): string {
  return JSON.stringify({ token, endpoint, hidden });
}

/** The state to start in once the server's config and the permission are
 *  known. `granted` still has to subscribe (→ `working` → `on`). */
export function initialState(enabled: boolean, permission: string): PushState {
  if (!enabled) return "off";
  if (permission === "granted") return "working";
  if (permission === "denied") return "denied";
  return "ask";
}

/** Show the 🔔 card? When one tap would turn push on — or an iPhone needs
 *  telling what to do instead — and the person hasn't waved it away on this
 *  phone. */
export function showPushCard(state: PushState, dismissed: boolean): boolean {
  return (state === "ask" || state === "ios-install" || state === "ios-keep-open") && !dismissed;
}

// --- the hook -----------------------------------------------------------------

const DISMISS_KEY = "loom.push.dismissed";

export interface Push {
  state: PushState;
  /** Ask permission + subscribe. Call it straight from a tap. */
  enable: () => void;
  /** Hide the card on this phone (the profile sheet still offers it). */
  dismiss: () => void;
  dismissed: boolean;
  /** Leaving / signing out: unbind this phone from the session on the
   *  server and drop the browser's subscription, so a handed-on or loaner
   *  phone stops getting this person's alerts. Fire-and-forget; call it
   *  *before* the session forgets its token. */
  release: () => void;
}

/** Push for one signed-in session (`base` = `/e/<eventId>`, the session's
 *  capability token), or nothing while signed out. `homescreen`: on an
 *  iPhone tab, `"guest"` mints the Home Screen nonce before showing the
 *  steps; `"booth"` shows them with no nonce (the icon signs in afresh). */
export function usePush(target: { base: string; token: string } | null, homescreen: "guest" | "booth" = "guest"): Push {
  const host = usePlayHost();
  const supported = !host.embedded && pushSupported();
  const [ios] = useState<IosInfo | null>(() => (host.embedded || supported ? null : iosInfo()));
  const [state, setState] = useState<PushState>(supported ? "off" : "unsupported");
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return host.storage.load<boolean>(DISMISS_KEY) === true;
    } catch {
      return false;
    }
  });
  const key = useRef<string | null>(null);
  const endpoint = useRef("");
  const base = target?.base ?? null;
  const token = target?.token ?? null;

  const bind = useCallback(async () => {
    if (base === null || token === null || key.current === null) return;
    setState("working");
    try {
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;
      const want = urlBase64ToUint8Array(key.current);
      let sub = await reg.pushManager.getSubscription();
      if (sub !== null && !sameKey(sub.options.applicationServerKey, want)) {
        await sub.unsubscribe().catch(() => false);
        sub = null;
      }
      // `want` owns its whole buffer (see urlBase64ToUint8Array); passing the
      // ArrayBuffer keeps both TS lib flavours happy (play's + the editor's).
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want.buffer as ArrayBuffer });
      await api(`${base}/api/push/subscribe`, { subscription: sub.toJSON() }, token);
      endpoint.current = sub.endpoint;
      setState("on");
    } catch {
      setState(typeof Notification !== "undefined" && Notification.permission === "denied" ? "denied" : "error");
    }
  }, [base, token]);

  // On sign-in: read the server's config; a phone that already said yes
  // re-binds with no prompt.
  useEffect(() => {
    if (!supported || base === null || token === null) return;
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`${base}/api/push/config`);
        const cfg = (await res.json()) as { enabled?: boolean; publicKey?: string | null };
        if (!live) return;
        const enabled = cfg.enabled === true && typeof cfg.publicKey === "string" && cfg.publicKey !== "";
        key.current = enabled ? cfg.publicKey! : null;
        const next = initialState(enabled, Notification.permission);
        setState(next);
        if (next === "working") await bind();
      } catch {
        if (live) setState("off");
      }
    })();
    return () => {
      live = false;
    };
  }, [supported, base, token, bind]);

  // An iPhone tab (K-31b): which card, from the server's switches. A guest's
  // steps wait for the nonce — an icon with no nonce would open signed out
  // and join again as a second program — so a failed mint is the note.
  useEffect(() => {
    if (ios === null || base === null || token === null) return;
    let live = true;
    // A booth never carries a nonce link (a guest who left this tab might).
    if (homescreen !== "guest") pointManifest(document, STATIC_MANIFEST_HREF);
    void (async () => {
      try {
        const cfg = (await (await fetch(`${base}/api/push/config`)).json()) as { enabled?: boolean; publicKey?: string | null; homescreen?: boolean };
        const enabled = cfg.enabled === true && typeof cfg.publicKey === "string" && cfg.publicKey !== "";
        let next = iosState(ios, enabled, cfg.homescreen === true);
        if (next === "ios-install" && homescreen === "guest") {
          try {
            const hit = await api<{ code?: string; pair?: string }>(`${base}/api/guest/homescreen`, {}, token);
            const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
            if (typeof hit.code !== "string" || typeof hit.pair !== "string" || link === null) throw new Error("no nonce");
            if (!live) return; // signed out while minting: never point at it
            link.href = homescreenManifestHref(hit.code, hit.pair, document.title);
          } catch {
            next = "ios-keep-open";
          }
        }
        if (live) setState(next);
      } catch {
        if (live) setState("ios-keep-open");
      }
    })();
    return () => {
      live = false;
      // Leave / a dropped session: the nonce link goes with the session.
      if (homescreen === "guest") pointManifest(document, STATIC_MANIFEST_HREF);
    };
  }, [ios, base, token, homescreen]);

  // Tell the server whenever this page is hidden / shown, so a character's
  // DM pushes only to a phone that isn't showing the app.
  useEffect(() => {
    if (state !== "on" || base === null || token === null) return;
    const report = (hidden: boolean) => {
      const body = visibilityBeacon(token, endpoint.current, hidden);
      const url = `${base}/api/push/visible`;
      try {
        if (navigator.sendBeacon?.(url, new Blob([body], { type: "text/plain" }))) return;
      } catch {
        /* fall through to fetch */
      }
      void fetch(url, { method: "POST", body, keepalive: true }).catch(() => {});
    };
    const onVis = () => report(document.visibilityState === "hidden");
    const onHide = () => report(true);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
    };
  }, [state, base, token]);

  const enable = useCallback(() => {
    if (!supported || key.current === null) return;
    setState("working");
    // Straight from the tap: Android only shows the prompt from a gesture.
    void Notification.requestPermission().then(
      (p) => (p === "granted" ? bind() : setState(p === "denied" ? "denied" : "ask")),
      () => setState("error"),
    );
  }, [supported, bind]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      host.storage.save(DISMISS_KEY, true);
    } catch {
      /* private mode */
    }
  }, [host.storage]);

  const release = useCallback(() => {
    const ep = endpoint.current;
    endpoint.current = "";
    if (!supported || ep === "" || base === null || token === null) return;
    void api(`${base}/api/push/unsubscribe`, { endpoint: ep }, token).catch(() => {});
    void navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => (sub !== null && sub.endpoint === ep ? sub.unsubscribe() : false))
      .catch(() => false);
    setState("ask");
  }, [supported, base, token]);

  return { state, enable, dismiss, dismissed, release };
}
