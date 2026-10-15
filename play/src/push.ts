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
//!   Push API (iPhone Safari outside the Home Screen — that is K-31b), or an
//!   insecure origin (plain-http LAN) → no card, nothing registered.
//!
//! Pure helpers first (unit-tested in `test/push.test.ts`), then the hook.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./client.ts";
import { usePlayHost } from "./host.ts";

/** Where push stands on this phone. */
export type PushState =
  | "unsupported" // no Push API here (or embedded) — say nothing
  | "off" // the server has no keys, or we're still asking it
  | "ask" // ready: one tap turns it on
  | "working" // asking permission / subscribing
  | "on"
  | "denied" // the person (or the browser) said no
  | "error";

/** The browser surface `pushSupported` reads (injectable for tests). */
export interface PushEnv {
  isSecureContext?: boolean;
  navigator?: { serviceWorker?: unknown };
  PushManager?: unknown;
  Notification?: unknown;
}

/** Can this page get pushes at all? Needs a secure origin, a service
 *  worker, the Push API and notifications (iPhone Safari has no
 *  `PushManager` outside a Home Screen app). */
export function pushSupported(env: PushEnv | undefined = typeof window === "undefined" ? undefined : (window as unknown as PushEnv)): boolean {
  if (env === undefined) return false;
  return env.isSecureContext === true && env.navigator?.serviceWorker != null && env.PushManager != null && env.Notification != null;
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

/** Show the 🔔 card? Only when one tap would turn push on, and the person
 *  hasn't waved it away on this phone. */
export function showPushCard(state: PushState, dismissed: boolean): boolean {
  return state === "ask" && !dismissed;
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
}

/** Push for one signed-in session (`base` = `/e/<eventId>`, the session's
 *  capability token), or nothing while signed out. */
export function usePush(target: { base: string; token: string } | null): Push {
  const host = usePlayHost();
  const supported = !host.embedded && pushSupported();
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
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
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

  return { state, enable, dismiss, dismissed };
}
