//! The **host allowlist** (wave 13, CONTRACTS §2.7): what a booth signed in
//! as a part the story marks `admin: true` (Task Manager, Adobe Acrobat,
//! Recycling Bin) may call on the moderator surface — exactly what the
//! Play app's host panel needs (cues, judging, announcements, the alert
//! dial, wallet holds, the King, terminals, codes, parts, answering as an
//! agent), never the god view (the full mod stream and `ModView`, the log,
//! the Mind trace and control, arbitrary world writes, guest edits,
//! lifecycle, maps, impersonation).
//!
//! A token with `canHost` but not `canModerate` (and no author session) is
//! a **host-only** caller. Every moderator route asks `isHostRoute` for a
//! host-only caller; a route it does not allow answers 403 `{error: "not
//! from a booth"}`. Pure (no I/O), so the table is unit-tested route by
//! route.

import { foldKey } from "../../src/parser/names.ts";
import { ALERT_LEVELS } from "../../src/delivery.ts";

/** The refusal a host-only caller gets off the allowlist. */
export const NOT_FROM_A_BOOTH = "not from a booth";

/** What the per-route limits need from the story. */
export interface HostRouteContext {
  /** The story's interrupt-level world path (`SimModel.alerts`). */
  alertsPath: string;
  /** Is this character voiced by an agent (`mind: external`)? */
  isAgent(character: string): boolean;
}

/** The POST routes a host may call with no further limit. */
const HOST_POSTS: ReadonlySet<string> = new Set([
  "/api/mod/signal",
  "/api/mod/broadcast",
  "/api/mod/wallet/approve",
  "/api/mod/wallet/deny",
  "/api/mod/wallet/approve-held",
  "/api/mod/wallet/unfreeze",
  "/api/mod/wallet/stimulus",
  "/api/mod/spatial/king",
  "/api/mod/screen/voice",
  "/api/mod/screen/identify",
  "/api/mod/codes",
  "/api/mod/claim/unlock",
  "/api/mod/guest/gone",
  "/api/mod/guest/pair",
  "/api/mod/prime/release",
  "/api/mod/scan",
  // Upgrades the token with the mod passcode (the full capability, as today).
  "/api/mod/login",
]);

/** A string field of a body, or "". */
function field(body: Readonly<Record<string, unknown>> | null, key: string): string {
  const v = body?.[key];
  return typeof v === "string" ? v : "";
}

/**
 * May a host-only caller make this moderator request? `body` is the JSON
 * body for a POST, or the query parameters for a GET. The limits: `var`
 * only writes the story's alert path with a ladder level, `say` only
 * answers one guest (`channel: "guest:<id>"`) as an agent-voiced character,
 * `act` only restricts / unrestricts.
 */
export function isHostRoute(
  method: string,
  path: string,
  body: Readonly<Record<string, unknown>> | null,
  ctx: HostRouteContext,
): boolean {
  if (method === "GET") {
    if (path === "/api/state") return (field(body, "role") || "mod") === "mod" && field(body, "host") === "1" && field(body, "as") === "" && field(body, "cues") !== "1";
    return path === "/api/mod/recap";
  }
  if (method !== "POST") return false;
  if (HOST_POSTS.has(path)) return true;
  switch (path) {
    case "/api/mod/var": {
      const level = field(body, "value").trim().replace(/^["'`]+|["'`]+$/gu, "").trim().toLowerCase();
      const v = body?.["value"];
      return typeof v === "string" && foldKey(field(body, "path").trim()) === foldKey(ctx.alertsPath) && (ALERT_LEVELS as readonly string[]).includes(level);
    }
    case "/api/mod/say": {
      const channel = field(body, "channel");
      const as = field(body, "as");
      return channel.startsWith("guest:") && channel.length > "guest:".length && as !== "" && ctx.isAgent(as);
    }
    case "/api/mod/act": {
      const action = field(body, "action");
      return action === "restrict" || action === "unrestrict";
    }
    default:
      return false;
  }
}

/**
 * Is this request on the moderator surface — a route that today needs the
 * mod capability? A host-only caller reaching one is checked against
 * `isHostRoute`. (`/api/state` as a guest or a booth with no `as=`, and
 * `/api/history` for a guest's own token, are not.)
 */
export function isModSurface(method: string, path: string, query: Readonly<Record<string, unknown>> | null): boolean {
  if (path.startsWith("/api/mod/") || path.startsWith("/api/agent/")) return true;
  if (method !== "GET") return false;
  if (path === "/events") return (field(query, "role") || "mod") === "mod";
  if (path === "/api/state") return (field(query, "role") || "mod") === "mod" || field(query, "as") !== "";
  return path === "/api/history";
}
