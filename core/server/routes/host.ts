//! The **host allowlist** (wave 13, CONTRACTS §2.7): what a booth signed in
//! as a part the story marks `admin: true` (Task Manager, Adobe Acrobat,
//! Recycling Bin) may call on the moderator surface — exactly what the
//! Play app's host panel needs (cues, judging, announcements, the alert
//! dial, wallet holds, the King, terminals, codes, parts, answering as an
//! agent, the talk panel (wave 32), the house mixer (wave 40), and the doors: open them, pause, resume), never the god view (the
//! full mod stream and `ModView`, the log, the Mind trace and control,
//! arbitrary world writes, guest edits, maps, impersonation) and never the
//! rest of the lifecycle (restart, load / push draft, go live, end, resync).
//!
//! A token with `canHost` but not `canModerate` (and no author session) is
//! a **host-only** caller. Every moderator route asks `isHostRoute` for a
//! host-only caller; a route it does not allow answers 403 `{error: "not
//! from a booth"}`. Pure (no I/O), so the table is unit-tested route by
//! route.

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
  // Wave 23: approve / deny a guest's ask to get back in (routes/rejoin.ts).
  "/api/mod/guest/rejoin",
  "/api/mod/prime/release",
  // Wave 59: sign a guest's phone out, so their badge signs in again.
  "/api/mod/guest/release",
  "/api/mod/scan",
  // The doors (fix round, C2): open them (`/api/mod/start` — also the resume
  // after a pause) and pause (`/api/mod/stop`), for a fire alarm or the night
  // run from Play. Never `/api/mod/reset` / `load` / `resync`, and the
  // control plane's go live / end take an author session, never a token.
  "/api/mod/start",
  "/api/mod/stop",
  // The show clock (wave 13 K3): set it or nudge it, from the More tab.
  "/api/mod/clock",
  // Upgrades the token with the mod passcode (the full capability, as today).
  "/api/mod/login",
  // Wave 18 (C8): "I'm calling the show" — the visible caller claim.
  "/api/mod/caller",
  // Wave 18 fix (M3): a guest-founded crew's name, or the crew itself.
  "/api/mod/crew/rename",
  "/api/mod/crew/dissolve",
  // Wave 18b (Q7): "stop all house sounds" from the host dock. Only the
  // stop: the speakers' saves and tests stay a director's.
  "/api/mod/audio/stop",
  // Wave 25 (the house desk): GO / standby / stop and walking the checks
  // from the host's Desk, and the tests and plays a check makes. Never the
  // desk's save / Save to project / mark reset, the lights' pairing or the
  // router's report.
  "/api/mod/desk/go",
  "/api/mod/desk/standby",
  "/api/mod/desk/stop",
  "/api/mod/desk/check",
  "/api/mod/audio/play",
  "/api/mod/audio/test",
  "/api/mod/lights/test",
  // Wave 32 (C3): the talk panel — speak for Clippy in the Desktop (Trabolta
  // answers aloud) or fire one of his canned lines, only while a talk scene
  // is on (the route's own 409s).
  "/api/mod/talk",
  // Wave 59: ▶ his lines may play, ✓ Done the teleprompter's scene is over.
  "/api/mod/aloud",
  // Wave 40 (the house mixer): balance the house sound and drive the
  // soundtrack from the host's Desk. Never the router's meters post.
  "/api/mod/audio/mix",
  "/api/mod/audio/music",
]);

/** The facts judge's mode path (wave 18, C8: hosts switch auto ⇄ review). */
const JUDGE_MODE_PATH = "Night.judge_mode";

/** A string field of a body, or "". */
function field(body: Readonly<Record<string, unknown>> | null, key: string): string {
  const v = body?.[key];
  return typeof v === "string" ? v : "";
}

/**
 * May a host-only caller make this moderator request? `body` is the JSON
 * body for a POST, or the query parameters for a GET. The limits: `var`
 * only writes the story's alert path with a ladder level (or, wave 18,
 * `Night.judge_mode` with `auto` / `review`), `say` only
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
    // Wave 25: the house desk's view (the host's Desk window); wave 40: the
    // house mixer's (never the router's own `/api/mod/audio`).
    return path === "/api/mod/recap" || path === "/api/mod/desk" || path === "/api/mod/audio/mixer";
  }
  if (method !== "POST") return false;
  if (HOST_POSTS.has(path)) return true;
  switch (path) {
    case "/api/mod/var": {
      const level = field(body, "value").trim().replace(/^["'`]+|["'`]+$/gu, "").trim().toLowerCase();
      const v = body?.["value"];
      // The exact path: `/api/mod/var` writes the spelling it is given, so a
      // folded match (`night.ALERTS`) would answer 200, write a junk var and
      // leave the level where it was.
      if (typeof v !== "string") return false;
      if (field(body, "path").trim() === JUDGE_MODE_PATH) return level === "auto" || level === "review";
      return field(body, "path").trim() === ctx.alertsPath && (ALERT_LEVELS as readonly string[]).includes(level);
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
