//! K-31a — push routes (Android + booths). The hub and the send rule live in
//! `../push.ts`; this module is only the HTTP surface:
//!
//! - `GET  /e/:id/api/push/config` → `{enabled, publicKey, homescreen}` (no
//!   auth: the public key is public; `enabled: false` = no VAPID keys, no 🔔
//!   card; `homescreen` = K-31b's `LOOM_HOMESCREEN`, so an iPhone's card and
//!   the editor's door poster know whether "Add to Home Screen" is the path).
//! - `POST /e/:id/api/push/subscribe {subscription}` — bind this device to
//!   the caller (a guest token → the guest, a performer token → the booth's
//!   character). A director's play-as session (Run → Players) is refused:
//!   the embedded app never registers a service worker anyway. A guest is
//!   refused (409) while the doors are closed; a full event (`MAX_DEVICES`)
//!   answers 503.
//! - `POST /e/:id/api/push/unsubscribe {endpoint}`.
//! - `POST /e/:id/api/push/visible {endpoint, hidden}` — the page's
//!   `visibilitychange`, sent with `navigator.sendBeacon` (so the token rides
//!   the body: a beacon can't set headers).
//! - `POST /e/:id/api/mod/push/status` → who is subscribed (moderators).

import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, str, tokenOf } from "../http-util.ts";
import { parseSubscription, type PushHub } from "../push.ts";
import { RateLimiter } from "../rate-limit.ts";
import { homescreenEnabled } from "./k31b.ts";

export const PUSH_CONFIG_ROUTE = "/api/push/config";
export const PUSH_STATUS_ROUTE = "/api/mod/push/status";

export interface PushRoutesHost {
  push: PushHub;
  /** The push owner a token stands for (`guest:<id>` / `prime:<character>`),
   *  or null — unknown, or a director's play-as session. */
  ownerOf(token: string | undefined): string | null;
  /** A guest's display name (the status listing). */
  nameOf(id: string): string | null;
  /** Are the doors open? A guest can't subscribe while they're closed. */
  open(): boolean;
  /** Is K-31b on? Defaults to `LOOM_HOMESCREEN` (read per call). */
  homescreen?: () => boolean;
}

/** Subscribes per owner per minute (a real phone subscribes once a load). */
export const SUBSCRIBE_PER_MINUTE = 10;

export class PushRoutes {
  private readonly subscribeLimit = new RateLimiter(SUBSCRIBE_PER_MINUTE, 60_000);

  constructor(private readonly host: PushRoutesHost) {}

  /** `GET /api/push/config`; false when `path` isn't it. */
  handleGet(method: string, path: string, res: ServerResponse): boolean {
    if (method !== "GET" || path !== PUSH_CONFIG_ROUTE) return false;
    const { push } = this.host;
    sendJson(res, 200, { enabled: push.enabled, publicKey: push.publicKey, homescreen: (this.host.homescreen ?? homescreenEnabled)() });
    return true;
  }

  /** The participant POSTs under `/api/push/`; false when `path` isn't ours. */
  handlePost(req: IncomingMessage, res: ServerResponse, path: string, body: Record<string, unknown>): boolean {
    if (!path.startsWith("/api/push/")) return false;
    const { push } = this.host;
    const owner = this.host.ownerOf(tokenOf(req, body));
    if (owner === null) {
      sendJson(res, 401, { error: "not signed in" });
      return true;
    }
    switch (path) {
      case "/api/push/subscribe": {
        if (!push.enabled) {
          sendJson(res, 503, { error: "push is not configured on this server" });
          return true;
        }
        if (owner.startsWith("guest:") && !this.host.open()) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (!this.subscribeLimit.take(owner)) {
          sendJson(res, 429, { error: "too many subscribe calls — try again in a minute" });
          return true;
        }
        const sub = parseSubscription(body["subscription"]);
        if (sub === null) {
          sendJson(res, 400, { error: "bad subscription" });
          return true;
        }
        if (!push.subscribe(owner, sub)) {
          sendJson(res, 503, { error: "too many devices subscribed tonight" });
          return true;
        }
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/push/unsubscribe":
        sendJson(res, 200, { ok: true, removed: push.unsubscribe(owner, str(body, "endpoint")) });
        return true;
      case "/api/push/visible":
        sendJson(res, 200, { ok: true, devices: push.setHidden(owner, str(body, "endpoint"), body["hidden"] === true) });
        return true;
      default:
        sendJson(res, 404, { error: "not found" });
        return true;
    }
  }

  /** Mod routes (already authorized by the caller); false when not ours. */
  handleMod(path: string, res: ServerResponse): boolean {
    if (path !== PUSH_STATUS_ROUTE) return false;
    const status = this.host.push.status();
    sendJson(res, 200, { ...status, guests: status.guests.map((g) => ({ ...g, name: this.host.nameOf(g.id) })) });
    return true;
  }
}
