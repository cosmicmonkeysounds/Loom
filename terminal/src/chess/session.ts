//! The chess board's session, screen by screen — pure (a reducer fed events
//! and timestamps; `ChessTerminal.tsx` owns the board, the timers and the
//! network):
//!
//!   attract  — THE KING, his shared health bar, "Scan your pass to
//!              challenge him" and the stakes line. Awake all night.
//!   checking — a pass was scanned: who is it, and may they play?
//!   playing  — one game against the King, dealt at the strength his bar
//!              has *when the board is dealt* (`stageFor(hp, max)`). No hints.
//!              The leash: `CHESS_IDLE_MS` with no touch abandons it
//!              silently, the countdown shown for the last `CHESS_WARN_MS`.
//!   over     — the final position + the result line, while the result goes
//!              to the story (`post.ts`) and `RESULT_MS` after it settled;
//!              then attract again. One game per pass scan: a guest who
//!              wants another scans again.
//!
//! A marked (restricted) program is refused at the scan (D5). Giving up and
//! the leash running out are silent: nothing reaches the story. A story
//! overlay (blackout / alarm) covers the board but never ends the game —
//! the component holds the leash while one is up.

import { STAGE_LINE, stageFor, type Stage } from "@loom/chess";
import type { ScreenKing } from "../screen.ts";
import type { Challenger, ChessResult } from "./post.ts";
import { parseScan } from "../scan.ts";

/** No touch for this long abandons a game (a player thinking at the board
 *  must never be cut off mid-thought; an abandoned board must not hold the
 *  door for long either). */
export const CHESS_IDLE_MS = 120_000;
/** The "Still there?" countdown shows for this last stretch of the leash. */
export const CHESS_WARN_MS = 20_000;
/** The result stays up this long once the story has it (or it failed). */
export const RESULT_MS = 10_000;
/** A notice on the attract screen (a refused pass) lasts this long. */
export const NOTICE_MS = 6_000;

export const MARKED_NOTICE = "⛔ Marked programs can't challenge the King.";

/** `declined`: the server took the result but the story turned it down
 *  (a win after truth.txt / an ending — no door code, whatever `armed` said). */
export type Post = "sending" | "sent" | "declined" | "failed";

export interface Notice {
  text: string;
  until: number;
}

export type ChessSession =
  | { kind: "attract"; notice: Notice | null }
  | { kind: "checking"; id: string }
  | { kind: "playing"; game: number; guest: Challenger; stage: Stage; hp: number | null; max: number | null }
  | { kind: "over"; game: number; guest: Challenger; stage: Stage; result: ChessResult; post: Post; armed: boolean | null; settledAt: number | null };

export type ChessEvent =
  | { type: "scan"; text: string; now: number }
  | { type: "typed"; id: string }
  /** `game`: a fresh id from the caller (the results of an older game never land on this one). */
  | { type: "resolved"; guest: Challenger; king: ScreenKing | null; game: number; now: number }
  | { type: "refused"; text: string; now: number }
  | { type: "ended"; game: number; result: ChessResult }
  | { type: "posted"; game: number; post: Exclude<Post, "sending">; armed: boolean | null; now: number }
  /** Give up / the leash; `notice` says why on the attract screen. */
  | { type: "abandon"; notice?: string; now?: number }
  | { type: "tick"; now: number };

export const INITIAL: ChessSession = { kind: "attract", notice: null };

function notice(text: string, now: number): ChessSession {
  return { kind: "attract", notice: { text, until: now + NOTICE_MS } };
}

/** The board's next state. Events that don't fit the current one change nothing. */
export function reduce(s: ChessSession, e: ChessEvent): ChessSession {
  switch (e.type) {
    case "scan": {
      if (s.kind !== "attract") return s;
      const hit = parseScan(e.text);
      if (hit.kind === "guest") return { kind: "checking", id: hit.id };
      return notice(hit.kind === "wall" ? "THAT'S A WALL CODE — SHOW ME YOUR PASS" : "UNREADABLE — SHOW ME YOUR PASS", e.now);
    }
    case "typed":
      return s.kind === "attract" ? { kind: "checking", id: e.id } : s;
    case "resolved": {
      if (s.kind !== "checking" || e.guest.id !== s.id) return s;
      if (e.guest.restricted) return notice(MARKED_NOTICE, e.now);
      // The bar is read now, at the deal; hits landing mid-game change nothing.
      const stage: Stage = e.king === null ? "grandmaster" : stageFor(e.king.hp, e.king.max);
      return { kind: "playing", game: e.game, guest: e.guest, stage, hp: e.king?.hp ?? null, max: e.king?.max ?? null };
    }
    case "refused":
      // A pass the house can't place (checking), or the typed fallback's own
      // problem — no such program, several match — said on attract.
      return s.kind === "checking" || s.kind === "attract" ? notice(e.text, e.now) : s;
    case "ended":
      if (s.kind !== "playing" || s.game !== e.game) return s;
      return { kind: "over", game: s.game, guest: s.guest, stage: s.stage, result: e.result, post: "sending", armed: null, settledAt: null };
    case "posted":
      if (s.kind !== "over" || s.game !== e.game || s.post !== "sending") return s;
      return { ...s, post: e.post, armed: e.armed, settledAt: e.now };
    case "abandon":
      // Give up / the leash: silent, nothing reaches the story.
      if (s.kind !== "playing" && s.kind !== "checking") return s;
      return e.notice === undefined ? INITIAL : notice(e.notice, e.now ?? 0);
    case "tick":
      if (s.kind === "attract" && s.notice !== null && e.now >= s.notice.until) return INITIAL;
      if (s.kind === "over" && s.settledAt !== null && e.now - s.settledAt >= RESULT_MS) return INITIAL;
      return s;
  }
}

/** The attract screen's stakes line, off the King's `armed`. */
export function stakesLine(armed: boolean | null | undefined): string | null {
  if (armed === true) return "Checkmate him and the server-room door code goes to your Codex.";
  if (armed === false) return "No prize now.";
  return null;
}

/** The health bar's words: `9 / 15`, or null with no shared King. */
export function healthText(king: Pick<ScreenKing, "hp" | "max"> | null): string | null {
  return king === null ? null : `${king.hp} / ${king.max}`;
}

/** The line under the board saying how strong he is (never a tip). */
export function strengthLine(stage: Stage): string {
  return STAGE_LINE[stage];
}

/** Said when a checkmate's `chess won` landed while the King was armed. */
export const WIN_CODE = "Checkmate. The door code is in your phone's Codex.";
/** Said when a win (armed, or unknown) didn't reach the house. */
export const WIN_NOT_SENT = "The win didn't reach the house: tell a host (♟).";

/**
 * The result screen's line. A win names the door code only once the post
 * landed, the story took it (not `declined`) *and* the King was armed; while the post is in flight
 * it says so; a win that never landed sends the guest to a host (unless the
 * King guards nothing now). A loss or a draw says so either way.
 */
export function resultLine(s: Extract<ChessSession, { kind: "over" }>): string {
  if (s.result === "won") {
    if (s.post === "sending") return "Checkmate. Telling the house…";
    // The story heard the win and turned it down: never promise the code.
    if (s.post === "declined") return "Checkmate. No prize now.";
    if (s.post === "failed") return s.armed === false ? "Checkmate. No prize now." : WIN_NOT_SENT;
    if (s.armed === true) return WIN_CODE;
    if (s.armed === false) return "Checkmate. No prize now.";
    return "Checkmate.";
  }
  if (s.result === "lost") return "The King wins. Scan your pass to play him again.";
  return "A draw. Scan your pass to play him again.";
}

/** Is the result screen done with the network (the timer to attract runs)? */
export function settled(s: ChessSession): boolean {
  return s.kind === "over" && s.post !== "sending";
}
