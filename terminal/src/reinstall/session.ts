//! The tent laptop's station, screen by screen (wave 18b, `view=reinstall`)
//! — pure: a reducer fed events and timestamps. `ReinstallTerminal.tsx`
//! owns the timers, the sounds, the polls and the network.
//!
//!   idle     — the idle show, the scan box, the quick picks (only the
//!              programs in the Internet now, never the marked: the
//!              Antivirus' Wanted list is not a public screen, D8), and the
//!              wizard card a `tablet_*` cue puts up for `CARD_MS`;
//!   checking — a pass was read: who is it, may they play?
//!   refused  — not marked (healthy, or held by a director): the NOT
//!              MARKED card for `REFUSED_MS`, then idle. Nothing reaches the
//!              story (no `/api/mod/scan`, no Trabolta line: O6 / D8);
//!   confirm  — already reinstalling on another device (a headset): play
//!              here instead? (a begin here ends that run as `replaced`);
//!   flow     — the reinstall app's own flow (`@loom/reinstall/flow.tsx`)
//!              full screen: Play here at once, or the choose card when a
//!              headset is online. Busy: slides and cutscenes stand aside.
//!
//! The gate is the server's (wave 16, R16): this screen only spares a
//! program a begin the server would refuse, and its begin never sends
//! `force`.

import { NOT_MARKED, programState, programStatus, quickPicks, type Program } from "@loom/reinstall/program.ts";
import { findFlash } from "@loom/reinstall/game/hud.ts";
import type { FlowExit } from "@loom/reinstall/flow.tsx";
import type { SfxName } from "../sound/library.ts";
import { parseScan } from "../scan.ts";

/** A flash (a refused scan, how a walk ended) stays up this long. */
export const NOTICE_MS = 6_000;
/** The NOT MARKED card stays up this long, then idle. */
export const REFUSED_MS = 8_000;
/** "Already reinstalling — play here instead?" waits this long for a tap. */
export const CONFIRM_MS = 15_000;
/** The wizard card a `tablet_*` cue puts up stays this long. */
export const CARD_MS = 12_000;
/** The quick picks are re-read this often while idle (ms). */
export const PICKS_POLL_MS = 5_000;
/** At most this many quick picks. */
export const PICKS_MAX = 8;

export interface Notice {
  text: string;
  tone: "good" | "bad";
  until: number;
}

export type Step =
  | { kind: "idle" }
  | { kind: "checking"; id: string }
  | { kind: "refused"; program: Program; until: number }
  | { kind: "confirm"; program: Program; device: string; until: number }
  /** `run` counts walks, so a new one mounts a fresh flow. */
  | { kind: "flow"; program: Program; run: number };

export interface StationSession {
  step: Step;
  notice: Notice | null;
  /** The wizard card is up until then (local ms), else null. */
  card: number | null;
  /** The `tablet_*` cue's last seq this screen has seen: `undefined` before
   *  the first answer (the boot's own is never shown), null = none yet. */
  cueSeen: number | null | undefined;
  runs: number;
}

export type StationEvent =
  | { type: "scan"; text: string; now: number }
  /** The typed fallback or a quick pick named a program. */
  | { type: "pick"; id: string }
  /** The lookup answered: the program (null = no such guest), whether an
   *  ending has played, and the device it is already walking on (null = none). */
  | { type: "resolved"; id: string; program: Program | null; ended: boolean; playingOn: string | null; now: number }
  /** The lookup failed: the HTTP status (null = no answer) and the error. */
  | { type: "lookupFailed"; id: string; status: number | null; message: string; now: number }
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "exit"; exit: FlowExit; now: number }
  /** A screen-state answer's `cues.tablet` seq (null: none). */
  | { type: "cue"; seq: number | null; now: number }
  | { type: "problem"; text: string; now: number }
  | { type: "tick"; now: number };

export const INITIAL: StationSession = { step: { kind: "idle" }, notice: null, card: null, cueSeen: undefined, runs: 0 };

const bad = (text: string, now: number): Notice => ({ text, tone: "bad", until: now + NOTICE_MS });

/** May this program play here? (`flow`), or the card that says why not. */
export function decide(program: Program, ended: boolean): "flow" | "refused" {
  const s = programState(program, ended);
  return s === "healthy" || s === "held" ? "refused" : "flow";
}

/** The refused card's words: the wizard's own heading and status, and why. */
export function refusedCopy(program: Program, ended: boolean): { icon: string; heading: string; status: string; why: string } {
  const info = programStatus(program, ended);
  return { icon: info.icon, heading: info.heading.toUpperCase(), status: info.status, why: NOT_MARKED };
}

/** A failed lookup, in the terminal's words. */
export function lookupText(status: number | null, message: string): string {
  if (status === 409) return "THE STORY ISN'T RUNNING YET";
  if (status === 401 || status === 403) return "THIS TERMINAL LOST ITS ACCESS — TELL A HOST";
  return `CAN'T CHECK YOUR PASS — ${message.toUpperCase()}`;
}

/** How a walk ended, as the station's flash (null: nothing to say — Back). */
export function exitNotice(e: FlowExit, now: number): Notice | null {
  switch (e.kind) {
    case "found": {
      const f = findFlash(e.outcome, e.name);
      return { text: f.text.toUpperCase(), tone: f.tone, until: now + NOTICE_MS };
    }
    case "sent":
      return { text: `SENT TO ${e.station.toUpperCase()} — PUT THE HEADSET ON`, tone: "good", until: now + NOTICE_MS };
    case "over":
      return bad(e.reason.toUpperCase(), now);
    case "idle":
      return bad("DISCONNECTED — NOBODY TOUCHED THE CONTROLS FOR TWO MINUTES", now);
    case "quit":
      return bad("SIMULATION ABORTED", now);
    case "failed":
      return bad(e.text.toUpperCase(), now);
    case "back":
      return null;
  }
}

/** The sound a walk's end makes here (null: none). */
export function exitSound(e: FlowExit): SfxName | null {
  switch (e.kind) {
    case "found":
      return e.outcome === "refused" ? "lose" : "win";
    case "sent":
      return "chime";
    case "failed":
      return "error";
    case "over":
    case "idle":
    case "quit":
      return "lose";
    case "back":
      return null;
  }
}

/** The quick picks: only the programs in the Internet now, by name. */
export function insideNow(roster: readonly Program[], ended: boolean): Program[] {
  return quickPicks(roster, PICKS_MAX, ended).corrupted;
}

/** The device a guest is already walking on (an unfound player in the
 *  spatial stream), else null. */
export function playingOn(players: Iterable<{ guest: string; device: string; found: boolean }>, guest: string): string | null {
  for (const p of players) if (p.guest === guest && !p.found) return p.device || "another device";
  return null;
}

/** The station is busy (the app's screen layer then counts it as piloting). */
export function isBusy(s: StationSession): boolean {
  return s.step.kind === "flow";
}

function idle(s: StationSession, notice: Notice | null = s.notice): StationSession {
  return { ...s, step: { kind: "idle" }, notice };
}

function flow(s: StationSession, program: Program): StationSession {
  const runs = s.runs + 1;
  // The wizard card and any flash give way to the walk.
  return { ...s, step: { kind: "flow", program, run: runs }, notice: null, card: null, runs };
}

export function reduce(s: StationSession, e: StationEvent): StationSession {
  switch (e.type) {
    case "scan": {
      // A pass read over the refused card starts again; mid-check or mid-walk it is ignored.
      if (s.step.kind !== "idle" && s.step.kind !== "refused") return s;
      const hit = parseScan(e.text);
      if (hit.kind === "guest") return { ...s, step: { kind: "checking", id: hit.id }, notice: null };
      return idle(s, bad(hit.kind === "wall" ? "THAT'S A WALL CODE — SHOW ME YOUR PASS" : "UNREADABLE — SHOW ME YOUR PASS", e.now));
    }
    case "pick":
      if (s.step.kind !== "idle" && s.step.kind !== "refused") return s;
      return { ...s, step: { kind: "checking", id: e.id }, notice: null };
    case "resolved": {
      if (s.step.kind !== "checking" || s.step.id !== e.id) return s;
      if (e.program === null) return idle(s, bad("UNKNOWN PROGRAM — REGISTER ON YOUR PHONE FIRST", e.now));
      if (decide(e.program, e.ended) === "refused") return { ...s, step: { kind: "refused", program: e.program, until: e.now + REFUSED_MS } };
      if (e.playingOn !== null) return { ...s, step: { kind: "confirm", program: e.program, device: e.playingOn, until: e.now + CONFIRM_MS } };
      return flow(s, e.program);
    }
    case "lookupFailed":
      if (s.step.kind !== "checking" || s.step.id !== e.id) return s;
      return idle(s, bad(lookupText(e.status, e.message), e.now));
    case "confirm":
      return s.step.kind === "confirm" ? flow(s, s.step.program) : s;
    case "cancel":
      return s.step.kind === "confirm" || s.step.kind === "refused" ? idle(s) : s;
    case "exit":
      return s.step.kind === "flow" ? idle(s, exitNotice(e.exit, e.now)) : s;
    case "cue": {
      // The first answer only says where the cue stands (a boot or a reload
      // never replays the last capture's card).
      if (s.cueSeen === undefined || e.seq === null) return { ...s, cueSeen: e.seq };
      if (e.seq === s.cueSeen) return s;
      // A new capture: the card, unless a walk (or a check) is on screen.
      return { ...s, cueSeen: e.seq, card: s.step.kind === "idle" ? e.now + CARD_MS : s.card };
    }
    case "problem":
      return s.step.kind === "idle" ? idle(s, bad(e.text, e.now)) : s;
    case "tick": {
      let next = s;
      if (next.notice !== null && e.now >= next.notice.until) next = { ...next, notice: null };
      if (next.card !== null && e.now >= next.card) next = { ...next, card: null };
      const st = next.step;
      if ((st.kind === "refused" || st.kind === "confirm") && e.now >= st.until) next = idle(next);
      return next;
    }
  }
}

/** Something on this screen counts down (the tick should run). */
export function timed(s: StationSession): boolean {
  return s.notice !== null || s.card !== null || s.step.kind === "refused" || s.step.kind === "confirm";
}
