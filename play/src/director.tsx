//! The director's phone cue page (W-26): the K-21 cue sheet — the story's
//! `who: admin` INTERACTIONs in running order — as big buttons on a phone,
//! for the director away from the laptop. Opened by `?role=director`, a
//! stored director sign-in, or a `?code=` link that resolves to the mod code
//! (never a link on the guests' front page).
//!
//! It signs in with the mod passcode (`/api/mod/login` → a token with no
//! character), polls the director's lean `GET /api/state?cues=1` every 3 s
//! (paused while the page is hidden, backing off on errors), and fires a cue with
//! `/api/mod/signal {name, subject?, args?, label: "Phone · <name>"}` — the label
//! is what the journal records as `by`. Tap once to arm, again to fire, so a
//! phone in a pocket never fires a cue. A cue that needs a person (an award)
//! asks for one first, with an optional value box (`args: {value}` — the
//! number the award line reads). The rows are core's `cue-sheet.ts`, the same rules as
//! the editor's Director page. Lifecycle, chat and the World editor stay on
//! the laptop.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ARM_DEAD_MS,
  ARM_MS,
  armFor,
  armStillValid,
  countdownLeft,
  cueActs,
  cueRows,
  cueTitleTags,
  cueValueArgs,
  filterCues,
  focusActIndex,
  nightPhase,
  previousActIndex,
  splitCode,
  takesValue,
  tapCue,
  type Armed,
  type CueAct,
  type CueInteraction,
  type CueMarks,
  type CueRow,
  type Tap,
  type WorldLine,
} from "../../core/src/cue-sheet.ts";
import { disarmOnLeave } from "./arm.ts";
import { ApiError, api } from "./client.ts";
import { ConnDot, PickerSheet, Sheet, WakeLockToggle, type PickItem } from "./ui/primitives.tsx";
import { HelpSheet } from "./help.tsx";
import { usePlayHost } from "./host.ts";
import { eventGone } from "./lifecycle.ts";
import { codeFromUrl, useDocumentTitle, useTheme, type ResolvedCode } from "./session/shared.ts";
import { callerIsMe, callerKnown, callerLine, callerText, cueCaller } from "./host/caller.ts";
import { useFireAnyway } from "./host/fire-anyway.tsx";

// Moved to the light modules the guest's first load uses (fix round); every
// name still resolves here (frozen signatures, CONTRACTS §0).
export { DIRECTOR_KEY, directorFromSearch, initialRole, roleForBrand, type AppRole } from "./app-role.ts";
export { URGENT_S, formatLeft, storyNow } from "./clock.ts";
import { DIRECTOR_KEY } from "./app-role.ts";
import { URGENT_S, formatLeft, storyNow } from "./clock.ts";
import { clockText, showClockOf, useShowClock } from "./show-clock.ts";
import { STOP_SOUNDS_LABEL, stopSoundsLine, type StopAnswer } from "./house-sound.ts";

export interface DirectorAuth {
  token: string;
  eventId: string;
  /** Who is holding the phone — the journal reads "Phone · <name>". */
  name: string;
  title?: string;
  /** The story's `theme:` from the code's resolve, until the first poll. */
  theme?: string;
}

/** The slice of the director's `ModView` this page reads. */
export interface DirectorView {
  title?: string;
  /** The story's `theme:` — carried before the doors too, so the skin never
   *  switches when they open. */
  theme?: string;
  phase?: string;
  interactions?: CueInteraction[];
  cues?: CueMarks;
  world?: WorldLine[];
  roster?: Array<{ id: string; name: string; location: string | null; owner?: string | null }>;
  /** The story clock (ms) when the view was built: the countdowns tick
   *  down from it plus the wall time since the poll landed. */
  clock?: number;
  /** The story clock is stopped (paused, or the doors not open yet): the
   *  countdowns hold still. The lean read's flag; the full `ModView` an
   *  older server sends says the same through `phase`. */
  paused?: true;
  /** The doors have not opened yet: nothing fires until they do. */
  doorsClosed?: true;
  /** The live countdowns (`countdown:` header lines whose `while` holds
   *  and whose deadline, in story seconds, is still ahead). */
  countdowns?: Array<{ label: string; endsAt: number }>;
  /** Up to 3 `watch:` values — global ones only, never a secret one (the
   *  server's lean view never sends those). */
  watch?: Array<{ label: string; value: string }>;
  /** The show clock (wave 13 K5, `show-clock.ts`): the strip's first item. */
  showClock?: { minutes: number; running: boolean };
}

/** The device label the journal records (the server keeps 60 chars). */
export function phoneLabel(name: string): string {
  const n = name.trim();
  return (n === "" ? "Phone" : `Phone · ${n}`).slice(0, 60);
}

const NO_MARKS: CueMarks = { last: null, fired: [] };

/** The cue rows a view holds (none before the story loads). */
export function directorRows(view: DirectorView | null): CueRow[] {
  return view === null ? [] : cueRows(view.interactions ?? [], view.cues ?? NO_MARKS);
}

// --- acts --------------------------------------------------------------------------
// Display only: the acts never change NEXT / LAST (core's `cueActs`).

/** How the sheet lays out: a flat list when no row carries an act (an old
 *  server, or a story with no `act:`), else grouped by act around the focus
 *  act (the one holding NEXT, else LAST) and the act before it. */
export type SheetLayout =
  | { kind: "flat"; rows: CueRow[] }
  | { kind: "acts"; acts: CueAct[]; focus: number; previous: number };

export function sheetLayout(rows: CueRow[]): SheetLayout {
  if (rows.every((r) => r.act === null)) return { kind: "flat", rows };
  const acts = cueActs(rows);
  const focus = focusActIndex(acts);
  return { kind: "acts", acts, focus, previous: focus < 0 ? -1 : previousActIndex(acts, focus) };
}

/** The act whose fallbacks sit under the focus act as the `from B ▾` line:
 *  the previous act, unless it has none or the director unfolded it by hand
 *  (its own section already lists them — never two buttons for one cue). */
export function fromAct(layout: SheetLayout, openActs: ReadonlySet<string>): CueAct | null {
  if (layout.kind !== "acts" || layout.previous < 0) return null;
  const prev = layout.acts[layout.previous]!;
  return prev.asides.length > 0 && !openActs.has(prev.key) ? prev : null;
}

/** An act's name: `B · Act I: …`, `Anytime`, or the cues above the first
 *  `act:` line. */
export function actName(a: Pick<CueAct, "code" | "title">): string {
  if (a.code === null && a.title === null) return "Before the first act";
  return [a.code, a.title].filter((p) => p !== null && p !== "").join(" · ");
}

/** The act's short handle for the strip and a filtered row: its code, else
 *  its name. */
export function actHandle(a: Pick<CueAct, "code" | "title">): string {
  return a.code ?? actName(a);
}

/** How far through an act's spine the night is: `3/8`. */
export function actCount(a: Pick<CueAct, "firedSpine" | "spine">): string {
  return `${a.firedSpine}/${a.spine.length}`;
}

/** A folded act's line, in parts so a long act title truncates without
 *  losing the count: `mark` (✓ done, – never ran), the name, the `count`
 *  (`8/8`, `skipped`, `12 cues`) and, for an act still to come, the first
 *  cue it will ask for. */
export interface FoldedParts {
  mark: string | null;
  name: string;
  count: string;
  next: string | null;
}

export function foldedParts(a: CueAct): FoldedParts {
  const name = actName(a);
  if (a.state === "past") return { mark: "✓", name, count: actCount(a), next: null };
  if (a.state === "skipped") return { mark: "–", name, count: "skipped", next: null };
  const first = a.spine.find((r) => !r.fired);
  return { mark: null, name, count: `${a.spine.length} cue${a.spine.length === 1 ? "" : "s"}`, next: first !== undefined ? cueTitleTags(first.title).title : null };
}

/** The folded line as text (the page adds the ▸): a past act `✓ B · Act I
 *  8/8`, one that never ran `– … skipped`, one still to come with its size
 *  and the first cue it will ask for. */
export function foldedLine(a: CueAct): string {
  const p = foldedParts(a);
  if (p.mark !== null) return `${p.mark} ${p.name} ${p.count}`;
  return `${p.name} · ${p.count}${p.next !== null ? ` · next: ${p.next}` : ""}`;
}

// --- the clock, the NEXT bar and the strip -------------------------------------------

/** Does the story clock run? Not while the event is paused or before the
 *  doors open (the server's ticker stops: `paused` on the lean read, a
 *  `phase` other than `open` on a full view). A view that says neither runs. */
export function clockRuns(view: Pick<DirectorView, "paused" | "phase"> | null): boolean {
  if (view === null) return false;
  if (view.paused === true) return false;
  return view.phase === undefined || view.phase === "open";
}

/** The story clock now (ms): the view's `clock` plus the wall time since the
 *  poll landed — or just the `clock` while it is stopped (`runs` false), so a
 *  paused countdown holds still between polls, and through a failing poll.
 *  Null when the view carries no clock (an old server). */
/** Before the doors: the sheet is the story's, but nothing fires yet. */
export const DOORS_CLOSED = "The doors aren't open yet — the cues fire once they are.";

/** What the page says with no cue rows: the doors (an older server lists
 *  no cues before them), else a story with no `who: admin` interactions. */
export function noCuesText(view: Pick<DirectorView, "doorsClosed" | "phase"> | null): string {
  if (view?.doorsClosed === true || view?.phase === "idle") return "The doors aren't open yet. The cue sheet appears when they open.";
  return "This story has no director cues (`who: admin` interactions).";
}

/** The strip's word for a stopped clock. */
export const STOPPED = "⏸ clock stopped";

/** The countdown due soonest at story time `nowMs`, or null. */
export function soonestCountdown(countdowns: DirectorView["countdowns"], nowMs: number | null): { label: string; left: number } | null {
  let best: { label: string; left: number } | null = null;
  for (const c of countdowns ?? []) {
    const left = countdownLeft(c.endsAt, nowMs);
    if (left !== null && (best === null || left < best.left)) best = { label: c.label, left };
  }
  return best;
}

/** The pinned bar at the top: NEXT (`again` while it is the LAST repeat
 *  cue), else the soonest countdown — why nothing is on offer — else none. */
export type NextBar =
  | { kind: "next"; row: CueRow; again: boolean }
  /** `held`: the story clock is stopped (paused), so the countdown is too. */
  | { kind: "countdown"; label: string; left: number; held?: true }
  | { kind: "none" };

export function nextBar(rows: CueRow[], countdowns: DirectorView["countdowns"], nowMs: number | null, runs = true): NextBar {
  const next = rows.find((r) => r.next);
  if (next !== undefined) return { kind: "next", row: next, again: next.last };
  const soon = soonestCountdown(countdowns, nowMs);
  if (soon === null) return { kind: "none" };
  return runs ? { kind: "countdown", ...soon } : { kind: "countdown", ...soon, held: true };
}

/** What the bar says when nothing is on offer: never a bare `NEXT —` in
 *  front of a countdown, which reads as "NEXT: Midnight". */
export const NOTHING_TO_PRESS = "NEXT — nothing to press";
export const STORY_RUNS = "The story runs.";
/** …and while the clock is stopped, never "The story runs." under a
 *  strip that says ⏸. */
export const CLOCK_HELD = "⏸ Paused: the clock is stopped.";

/** The bar as text: `NEXT 📊 Trust Chart`, `AGAIN 📋 Results…`,
 *  `NEXT — nothing to press. The story runs. ⏱ Midnight in 37:52`, or
 *  `NEXT — nothing to press`. */
export function nextBarText(bar: NextBar): string {
  if (bar.kind === "next") return `${bar.again ? "AGAIN" : "NEXT"} ${cueTitleTags(bar.row.title).title}`;
  if (bar.kind === "countdown") return `${NOTHING_TO_PRESS}. ${bar.held === true ? CLOCK_HELD : STORY_RUNS} ${countdownText(bar)}`;
  return NOTHING_TO_PRESS;
}

/** A countdown on the NEXT bar: `⏱ Midnight in 37:52`. */
export function countdownText(c: { label: string; left: number }): string {
  return `⏱ ${c.label} in ${formatLeft(c.left)}`;
}

/** A watched value for the strip: quotes stripped, booleans ● / ○, unset —. */
export function formatWatchValue(v: string): string {
  const t = v.trim().replace(/^"(.*)"$/u, "$1");
  if (t === "" || t === "null" || t === "none" || t === "undefined") return "—";
  if (t === "true") return "●";
  if (t === "false") return "○";
  return t;
}

export interface StripItem {
  text: string;
  /** The show clock (the strip's first item). */
  clock?: true;
  /** A countdown under a minute. */
  urgent?: true;
  /** Who is calling the show (`📣 …`). */
  caller?: true;
}

/** The strip under the header: the focus act's code · the phase · the
 *  soonest countdown · up to 3 watched values (whatever the view carries:
 *  the server's lean view holds only global, non-secret ones). */
export function stripItems(view: DirectorView | null, layout: SheetLayout, nowMs: number | null, show: { minutes: number; running: boolean } | null = null, caller: string | null = null): StripItem[] {
  const out: StripItem[] = [];
  // The show clock first (wave 13 K5): the party's time of day, ⏸ while it holds.
  if (show !== null) out.push({ text: `${show.running ? "🕐" : "⏸"} ${clockText(show.minutes)}`, clock: true });
  // Who is calling the show (wave 18 B8): `📣 Task Manager`, `📣 You`.
  if (caller !== null) out.push({ text: caller, caller: true });
  if (layout.kind === "acts" && layout.focus >= 0) out.push({ text: actHandle(layout.acts[layout.focus]!) });
  const phase = nightPhase(view?.world ?? []);
  if (phase !== null) out.push({ text: phase });
  if (view !== null && !clockRuns(view)) out.push({ text: view.doorsClosed === true ? "🚪 doors closed" : STOPPED });
  const soon = soonestCountdown(view?.countdowns, nowMs);
  if (soon !== null) out.push({ text: `⏱ ${soon.label} ${formatLeft(soon.left)}`, ...(soon.left < URGENT_S ? { urgent: true as const } : {}) });
  for (const w of (view?.watch ?? []).filter((w) => typeof w.value === "string").slice(0, 3)) out.push({ text: `${w.label} ${formatWatchValue(w.value)}` });
  return out;
}

// --- arm, then fire --------------------------------------------------------------
// One arm model with the laptop's Director page (core's `cue-sheet.ts`): a
// first tap arms, a second one ≥ `ARM_DEAD_MS` and < `ARM_MS` later fires,
// and an arm bound to the cue state is dropped once that state moves.

export { ARM_DEAD_MS, ARM_MS, armFor, armStillValid, takesValue, tapCue, type Armed, type Tap };

/** What a tap does on the phone: core's `tapCue`, except that a second tap
 *  on an arm the cue state has since moved past (another director, or the
 *  story, fired) is `stale` — never fired; the page drops the arm and says
 *  "Cues moved — tap again". */
export type PhoneTap = Tap | { kind: "stale"; id: string };

export function phoneTap(armed: Armed | null, row: CueRow, now: number, marks: CueMarks): PhoneTap {
  if (armed !== null && armed.id === row.id) {
    const age = now - armed.at;
    if (age >= ARM_DEAD_MS && age < ARM_MS && !armStillValid(armed, marks, now)) return { kind: "stale", id: row.id };
  }
  return tapCue(armed, row, now, marks);
}

/** The armed row's second line: a press out of turn is warned about, never
 *  blocked (a `while:` never stops a press). A `live: false` cue — off
 *  tonight's branch, or not yet — "may be refused"; a spine cue outside the
 *  focus act (an act unfolded by hand, a filter hit) names both acts. */
export function armWarnings(row: Pick<CueRow, "id" | "live" | "sequence">, layout: SheetLayout): string[] {
  const out: string[] = [];
  if (!row.live) out.push("⚠ Not on offer now: the story may refuse it");
  if (layout.kind === "acts" && layout.focus >= 0 && row.sequence) {
    const focus = layout.acts[layout.focus]!;
    const own = layout.acts.find((a) => a.rows.some((r) => r.id === row.id));
    if (own !== undefined && own !== focus && own.state !== "anytime") out.push(`⚠ This is a ${actHandle(own)} cue; the night is in ${actHandle(focus)}`);
  }
  return out;
}

export { disarmOnLeave };

/** The toast when a stale arm is dropped. */
export const STALE_TOAST = "Cues moved — tap again";

/** The `/api/mod/signal` body for a cue; an award's value rides as
 *  `args: {value}` (core's `cueValueArgs`, the editor's rule). */
export function signalBody(
  id: string,
  subject: string | null,
  name: string,
  value?: string,
  presses?: number,
): { name: string; subject?: string; label: string; args?: { value: string | number }; presses?: number } {
  const args = value !== undefined ? cueValueArgs(value) : null;
  // `presses`: the press count the arm was bound to — the server refuses the
  // press (409 `moved`) when another director's landed in between, even
  // before this phone's next poll could show it.
  return { name: id, ...(subject !== null ? { subject } : {}), label: phoneLabel(name), ...(args !== null ? { args } : {}), ...(presses !== undefined ? { presses } : {}) };
}

/** The people a subject cue can name: real guests first, personas tagged. */
export function subjectChoices(roster: DirectorView["roster"]): PickItem[] {
  return [...(roster ?? [])]
    .sort((a, b) => Number(typeof a.owner === "string") - Number(typeof b.owner === "string") || a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, label: p.name, sub: [p.location, typeof p.owner === "string" ? "persona" : null].filter((s) => s !== null).join(" · ") || undefined, avatar: true }));
}

/** `refused`: the server took the press but the story turned it down
 *  (out of turn; its `# hosts` line says why) — not ticked on the sheet. */
export type FireOutcome = { ok: true; refused?: true; said?: string[]; staff?: string[] } | { ok: false; status: number; message: string; moved?: true };

/** The server's 409 for a press with no sim yet (the doors not open). */
const NO_SIM = "no scenario loaded";

/** A press before the doors open — the page already says the doors are
 *  shut, so the toast does too (not the server's "no scenario loaded"). */
export const DOORS_NOT_OPEN_TOAST = "Not fired — the doors aren't open yet";

/** The toast after a fire. No HTTP answer (status 0: a timeout, a dropped
 *  connection) may still have fired — say so, never "failed". */
export function fireToast(row: Pick<CueRow, "code" | "title">, outcome: FireOutcome): string {
  const what = row.code ?? row.title;
  if (!outcome.ok && outcome.moved === true) return STALE_TOAST;
  if (outcome.ok && outcome.refused === true) return `Not taken — ${what} doesn't apply right now (# hosts says why)`;
  if (outcome.ok) return `✓ Fired ${what}`;
  if (outcome.status === 409 && outcome.message === NO_SIM) return DOORS_NOT_OPEN_TOAST;
  if (outcome.status === 409) return `Not fired — ${outcome.message}`;
  if (outcome.status === 0) return `Not sure ${what} fired — check the sheet before firing again`;
  return `${what} failed: ${outcome.message}`;
}

/** How long a fire waits for the server before giving up on the answer. */
export const FIRE_TIMEOUT_MS = 8000;

/** One fire's POST; resolves with the server's answer (`refused` when the
 *  story turned the press down), rejects with `{status, message}` on an HTTP
 *  refusal and anything else (an abort, a dropped connection) on no answer. */
export type FirePost = (body: ReturnType<typeof signalBody>, signal: AbortSignal) => Promise<{ refused?: boolean; moved?: boolean; said?: unknown; staff?: unknown } | void>;

/** A press's lines (`/api/mod/signal`'s 200 `said` / `staff`, wave 18 C8):
 *  strings only, empty dropped; absent from an older server. */
export function pressLines(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  return out.length > 0 ? out : undefined;
}

/**
 * Fire a cue: post it with a timeout, and re-poll at once whatever the
 * outcome, so the marks are fresh before the director can tap again.
 */
export async function fireCue(post: FirePost, body: ReturnType<typeof signalBody>, repoll: () => void, timeoutMs = FIRE_TIMEOUT_MS): Promise<FireOutcome> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const answer = await post(body, ctl.signal);
    if (answer?.moved === true) return { ok: false, status: 409, message: "the cues moved", moved: true };
    if (answer?.refused === true) return { ok: true, refused: true };
    const said = pressLines(answer?.said);
    const staff = pressLines(answer?.staff);
    return { ok: true, ...(said !== undefined ? { said } : {}), ...(staff !== undefined ? { staff } : {}) };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, status: e.status, message: e.message };
    return { ok: false, status: 0, message: ctl.signal.aborted ? "no answer" : e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
    repoll();
  }
}

/** What a poll's answer means for the session. */
export type PollOutcome = { kind: "view"; view: DirectorView } | { kind: "drop"; notice: string } | { kind: "retry"; message: string };

export function pollOutcome(status: number, body: Record<string, unknown>): PollOutcome {
  if (status >= 200 && status < 300) return { kind: "view", view: body as DirectorView };
  const message = typeof body["error"] === "string" ? body["error"] : `HTTP ${status}`;
  if (eventGone(status, message)) return { kind: "drop", notice: "That event has ended." };
  if (status === 403) return { kind: "drop", notice: "This phone is no longer signed in as a director — sign in again." };
  return { kind: "retry", message };
}

// --- one press at a time ---------------------------------------------------------
// While a press is in flight every cue is locked, and the lock holds until
// the poll that follows it has landed: an arm made before then would be bound
// to the cue state before this phone's own press, and be dropped as "Cues
// moved" the moment that press shows up. NEXT then waits a second more, so
// the cue that just became NEXT is never armed by a tap meant for the last one.

/** How long NEXT stays locked after a press lands. */
export const NEXT_COOLDOWN_MS = 1000;
/** How long a press waits for the poll after it before letting go anyway
 *  (the page went hidden, the poll is failing). */
export const REPOLL_WAIT_MS = 3000;

/** Is this row locked: a press in flight (any row), or NEXT cooling down? */
export function cueLocked(row: Pick<CueRow, "next">, pending: string | null, cooling: boolean): boolean {
  return pending !== null || (cooling && row.next);
}

/**
 * Counts the polls and lets a press wait for one that *started* after it:
 * `begin()` on every load, `landed(seq)` when its view is in, and
 * `after(seq, ms)` resolves once a load numbered above `seq` has landed (or
 * after `ms`, whichever is first).
 */
export function viewLatch(setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms), clearTimer: (t: unknown) => void = (t) => clearTimeout(t as ReturnType<typeof setTimeout>)) {
  let started = 0;
  let waiters: Array<{ after: number; done: () => void }> = [];
  return {
    /** The loads started so far. */
    get started() {
      return started;
    },
    begin(): number {
      return ++started;
    },
    landed(seq: number): void {
      const due = waiters.filter((w) => w.after < seq);
      waiters = waiters.filter((w) => w.after >= seq);
      for (const w of due) w.done();
    },
    after(seq: number, ms: number): Promise<void> {
      return new Promise<void>((resolve) => {
        const w = {
          after: seq,
          done: () => {
            clearTimer(t);
            resolve();
          },
        };
        const t = setTimer(() => {
          waiters = waiters.filter((x) => x !== w);
          resolve();
        }, ms);
        waiters.push(w);
      });
    },
  };
}

// --- the poll --------------------------------------------------------------------

export const POLL_MS = 3000;
const POLL_MAX_MS = 30_000;

/** The wait before the next poll: every 3 s, doubling per failure up to 30 s. */
export function pollDelay(failures: number, every = POLL_MS): number {
  return failures <= 0 ? every : Math.min(every * 2 ** failures, POLL_MAX_MS);
}

export interface PollDeps {
  /** One poll; rejects on failure. */
  load: () => Promise<void>;
  hidden: () => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  /** Subscribe to visibility changes; returns the unsubscribe. */
  onVisibility: (fn: () => void) => () => void;
  /** Subscribe to the network coming back (`online`); returns the
   *  unsubscribe. A poll backing off after an outage goes at once. */
  onOnline?: (fn: () => void) => () => void;
}

/**
 * Poll `load` until stopped: never while the page is hidden (the poll
 * parks and resumes the moment it is visible again), backing off on
 * failures — and straight away when the network comes back. `now()` polls at once (after a fire) — or, with a poll already
 * in flight (it may predate the fire), straight after that one lands.
 */
export function startPoll(deps: PollDeps, every = POLL_MS): { stop(): void; now(): void } {
  let timer: unknown = null;
  let inFlight = false;
  let stopped = false;
  let failures = 0;
  let wantNow = false;
  const clear = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };
  const schedule = () => {
    clear();
    if (stopped || deps.hidden()) return; // parked until visible
    timer = deps.setTimer(() => {
      timer = null;
      tick();
    }, pollDelay(failures, every));
  };
  const tick = () => {
    if (stopped || inFlight) return;
    if (deps.hidden()) return;
    inFlight = true;
    deps.load().then(
      () => {
        failures = 0;
      },
      () => {
        failures++;
      },
    ).finally(() => {
      inFlight = false;
      if (wantNow) {
        wantNow = false;
        clear();
        tick();
      } else schedule();
    });
  };
  const off = deps.onVisibility(() => {
    if (!deps.hidden() && timer === null && !inFlight) tick();
    else if (deps.hidden()) clear();
  });
  const offOnline =
    deps.onOnline?.(() => {
      if (failures === 0 || inFlight) return; // healthy, or already asking
      clear();
      tick();
    }) ?? (() => {});
  tick();
  return {
    stop() {
      stopped = true;
      clear();
      off();
      offOnline();
    },
    now() {
      if (inFlight) {
        wantNow = true;
        return;
      }
      clear();
      tick();
    },
  };
}

// --- the session -----------------------------------------------------------------

function browserPollDeps(load: () => Promise<void>): PollDeps {
  return {
    load,
    hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    onVisibility: (fn) => {
      document.addEventListener("visibilitychange", fn);
      return () => document.removeEventListener("visibilitychange", fn);
    },
    onOnline: (fn) => {
      window.addEventListener("online", fn);
      return () => window.removeEventListener("online", fn);
    },
  };
}

function useDirectorSession() {
  const { storage } = usePlayHost();
  const [auth, setAuth] = useState<DirectorAuth | null>(() => storage.load<DirectorAuth>(DIRECTOR_KEY));
  const [view, setView] = useState<DirectorView | null>(null);
  // When the last view landed (wall ms): the countdowns tick on from it.
  const [receivedAt, setReceivedAt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const poll = useRef<{ stop(): void; now(): void } | null>(null);
  const [latch] = useState(viewLatch);
  const base = auth ? `/e/${encodeURIComponent(auth.eventId)}` : "";

  const drop = useCallback(
    (why: string | null) => {
      storage.drop(DIRECTOR_KEY);
      setAuth(null);
      setView(null);
      setNotice(why);
    },
    [storage],
  );

  useEffect(() => {
    if (auth === null) return;
    const load = async () => {
      const seq = latch.begin();
      // `cues=1`: the lean read (an older server ignores it and sends the
      // full ModView, which carries the same fields).
      const res = await fetch(`${base}/api/state?role=mod&cues=1`, { headers: { "x-loom-token": auth.token } });
      const out = pollOutcome(res.status, (await res.json().catch(() => ({}))) as Record<string, unknown>);
      if (out.kind === "view") {
        setView(out.view);
        setReceivedAt(Date.now());
        setConnected(true);
        latch.landed(seq);
        return;
      }
      setConnected(false);
      if (out.kind === "drop") {
        drop(out.notice);
        throw new Error(out.notice);
      }
      throw new Error(out.message);
    };
    const p = startPoll(browserPollDeps(() => load().catch((e: unknown) => {
      setConnected(false);
      throw e;
    })));
    poll.current = p;
    return () => {
      p.stop();
      poll.current = null;
    };
  }, [auth, base, drop, latch]);

  const login = useCallback(
    async (passcode: string, name: string) => {
      const code = passcode.trim();
      const r = await api<ResolvedCode>("/api/resolve-code", { code });
      if (r.role !== "mod") throw new Error("That isn't the director code. Check it with the stage manager.");
      const { token } = await api<{ token: string }>(`/e/${encodeURIComponent(r.eventId)}/api/mod/login`, { passcode: code });
      const a: DirectorAuth = { token, eventId: r.eventId, name: name.trim(), ...(r.title !== undefined ? { title: r.title } : {}), ...(typeof r.theme === "string" ? { theme: r.theme } : {}) };
      storage.save(DIRECTOR_KEY, a);
      setNotice(null);
      setAuth(a);
    },
    [storage],
  );

  const fire = useCallback(
    async (id: string, subject: string | null, value?: string, presses?: number): Promise<FireOutcome> => {
      if (auth === null) return { ok: false, status: -1, message: "not signed in" };
      const post: FirePost = async (body, signal) => {
        const res = await fetch(`${base}/api/mod/signal`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-loom-token": auth.token },
          body: JSON.stringify(body),
          signal,
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.ok) return { refused: data["refused"] === true, said: data["said"], staff: data["staff"] };
        if (res.status === 409 && data["moved"] === true) return { moved: true };
        throw new ApiError((data["error"] as string) || `HTTP ${res.status}`, res.status);
      };
      // Hold the answer until the poll after the press is in, so the page
      // lets go of its lock on fresh marks (see `cueLocked`).
      let fresh: Promise<void> = Promise.resolve();
      const out = await fireCue(post, signalBody(id, subject, auth.name, value, presses), () => {
        fresh = latch.after(latch.started, REPOLL_WAIT_MS);
        poll.current?.now();
      });
      if (!out.ok && eventGone(out.status, out.message)) drop("That event has ended.");
      else await fresh;
      return out;
    },
    [auth, base, drop, latch],
  );

  /** 📣 I'll call / Stop calling (`POST /api/mod/caller {on}`). Rejects
   *  with the server's refusal (an older server: 404). */
  const claim = useCallback(
    async (on: boolean): Promise<void> => {
      if (auth === null) return;
      const res = await fetch(`${base}/api/mod/caller`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-loom-token": auth.token },
        body: JSON.stringify({ on, label: phoneLabel(auth.name) }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      poll.current?.now();
      if (!res.ok) throw new ApiError((data["error"] as string) || `HTTP ${res.status}`, res.status);
    },
    [auth, base],
  );

  /** 🔇 Stop all house sounds (wave 18b Q7, `POST /api/mod/audio/stop`).
   *  Resolves to the line to show; rejects with the server's refusal. */
  const stopSounds = useCallback(
    async (announce: boolean): Promise<string> => {
      if (auth === null) return "";
      const res = await fetch(`${base}/api/mod/audio/stop`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-loom-token": auth.token },
        body: JSON.stringify({ announce }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new ApiError((data["error"] as string) || `HTTP ${res.status}`, res.status);
      return stopSoundsLine(data as StopAnswer, announce);
    },
    [auth, base],
  );

  return { auth, view, receivedAt, connected, notice, login, fire, claim, stopSounds, leave: () => drop(null) };
}

// --- the screens -----------------------------------------------------------------

function DirectorLogin({ notice, onLogin, onBack }: { notice: string | null; onLogin: (code: string, name: string) => Promise<void>; onBack: () => void }) {
  const [code, setCode] = useState(codeFromUrl);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    if (busy || code.trim() === "") return;
    setBusy(true);
    setErr("");
    try {
      await onLogin(code, name);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="hero">
      <div className="glyph">🎬</div>
      <h1>Director cues</h1>
      {notice && <p className="notice">{notice}</p>}
      <p className="sub">The cue sheet on your phone. Tap a cue once to arm it, again to fire.</p>
      <input
        type="password"
        placeholder="Director (mod) passcode"
        value={code}
        autoFocus={code === ""}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setCode(e.target.value)}
      />
      <input placeholder="Your name (the log says who fired)" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void go()} />
      <button className="choice primary" onClick={() => void go()} disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {err && <div className="err">{err}</div>}
      <button className="link" onClick={onBack}>
        ← Not a director
      </button>
    </div>
  );
}

/** A cue row's classes. A fired row is muted (flat, grey) unless it is
 *  LAST, NEXT (a repeat cue) or armed, so what is still to go stands out;
 *  `off` (a `while:` that is false: dimmed) is a different look on purpose. */
export function cueRowClass(row: Pick<CueRow, "last" | "next" | "fired" | "live"> & Partial<Pick<CueRow, "sequence">>, armed: boolean, warn: boolean): string {
  return [
    "choice",
    "cue-row",
    row.last ? "last" : null,
    row.next ? "next" : null,
    row.fired && !row.last && !row.next && !armed ? "fired" : null,
    armed ? "armed" : null,
    warn ? "warn" : null,
    row.live ? null : "off",
    compactCue(row, armed) ? "host-compact" : null,
  ]
    .filter((c) => c !== null)
    .join(" ");
}

/** Does a cue row fold to one line? An aside (`sequence: false`) or a cue
 *  not on offer now, unless it is NEXT, LAST or armed: an act of fallbacks
 *  was a wall of 120 px cards. Arming one opens it back up (the full title,
 *  "Tap again to fire", the drain). */
export function compactCue(row: Pick<CueRow, "last" | "next" | "live"> & Partial<Pick<CueRow, "sequence">>, armed: boolean): boolean {
  if (armed || row.next || row.last) return false;
  return row.sequence === false || !row.live;
}

/** The FIRE window's segments (Win95's progress blocks): one drops every
 *  `ARM_MS / DRAIN_SEGMENTS`. */
export const DRAIN_SEGMENTS = 8;

/** Whole seconds left in the FIRE window armed at `at` (the reduced-motion
 *  countdown: "4 s", "3 s" … "1 s"; 0 once it has lapsed). */
export function drainSeconds(at: number, now: number, ms: number = ARM_MS): number {
  const left = at + ms - now;
  return left <= 0 ? 0 : Math.ceil(left / 1000);
}

/** The FIRE window draining (finish review #6): a segmented Win95 progress
 *  bar that empties over `ARM_MS` from the arm's own moment (`at`), so a
 *  re-render or the bar's twin in the Cues tab never restarts it. Reduced
 *  motion: no bar, a "4 s" countdown in text. A screen reader already
 *  hears "Tap FIRE within 4 s". */
export function ArmDrain({ at, className }: { at: number; className?: string }) {
  const [start] = useState(() => Math.max(0, Math.min(ARM_MS, Date.now() - at)));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [at]);
  return (
    <span className={`host-drain ${className ?? ""}`.trim()} aria-hidden="true">
      <span className="host-drain-track">
        <span className="host-drain-fill" style={{ animationDuration: `${ARM_MS}ms`, animationDelay: `-${start}ms`, animationTimingFunction: `steps(${DRAIN_SEGMENTS}, end)` }} />
      </span>
      <span className="host-drain-secs">{drainSeconds(at, now)} s</span>
    </span>
  );
}

/** Does an arm bring its row into view? Only one this row's own tap made
 *  (a compact row grows from 44 px and its "Tap again to fire" and the
 *  drain would sit under the bar below the list); an arm from the NEXT bar
 *  leaves the list's scroll where the host left it. */
export function revealOnArm(armedHere: boolean, tappedHere: boolean): boolean {
  return armedHere && tappedHere;
}

/** An armed row's call to action: a subject cue names who it goes to on
 *  the row itself (the hint at the top of the list may be scrolled away). */
export function armLine(armed: Pick<Armed, "subject" | "value">, subjectName: string | null): string {
  if (armed.subject === null) return "Tap again to fire";
  return `Tap again to fire → ${subjectName ?? armed.subject}${armed.value !== undefined ? ` (${armed.value})` : ""}`;
}

export function CueButton({ row, armed, locked, sending, warnings, actCode, subjectName, onTap }: { row: CueRow; armed: Armed | null; locked: boolean; sending: boolean; warnings: string[]; actCode?: string | null; subjectName?: string | null; onTap: () => void }) {
  const isArmed = armed !== null && armed.id === row.id;
  const warn = isArmed && warnings.length > 0;
  const { title, tags } = cueTitleTags(row.title);
  // A row armed by its own tap grows (a compact one from 44 px) and keeps
  // its "Tap again to fire" and the drain in view, never under the bar
  // below the list. An arm made elsewhere (the NEXT bar) leaves the scroll.
  const btn = useRef<HTMLButtonElement>(null);
  const tapped = useRef(false);
  useEffect(() => {
    if (revealOnArm(isArmed, tapped.current)) btn.current?.scrollIntoView?.({ block: "nearest" });
    tapped.current = false;
  }, [isArmed]);
  return (
    <li>
      <button
        type="button"
        ref={btn}
        className={cueRowClass(row, isArmed, warn)}
        data-next={row.next ? "true" : undefined}
        data-last={row.last ? "true" : undefined}
        disabled={locked}
        aria-busy={sending || undefined}
        onClick={() => {
          tapped.current = true;
          onTap();
        }}
      >
        <span className="cue-n">{row.n}</span>
        <span className="cue-body">
          <span className="cue-title">
            {actCode != null && <span className="cue-code act">{actCode}</span>}
            {row.code !== null && <span className="cue-code">{row.code}</span>} {title}
          </span>
          {sending ? (
            <span className="cue-arm">Sending…</span>
          ) : isArmed ? (
            <>
              <span className="cue-arm">{armLine(armed!, subjectName ?? null)}</span>
              <ArmDrain key={armed!.at} at={armed!.at} />
              {warnings.map((w) => (
                <span key={w} className="cue-warn" data-testid="cue-warn">
                  {w}
                </span>
              ))}
            </>
          ) : (
            <span className="cue-tags">
              {row.last && <span className="cue-tag last">LAST</span>}
              {row.next && <span className="cue-tag next">NEXT</span>}
              {row.fired && <span className="cue-tag">✓ fired</span>}
              {!row.sequence && <span className="cue-tag host-aside">aside</span>}
              {row.subject && <span className="cue-tag">👤 picks a person</span>}
              {!row.live && <span className="cue-tag">not on offer</span>}
              {tags.map((t) => (
                <span key={t} className="cue-tag muted">
                  {t}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

// --- the desk: arm, fire, one press at a time (shared with the host booth) ---------

/** What a fire does: post the cue, resolve with the outcome. */
export type DeskFire = (id: string, subject: string | null, value: string | undefined, presses: number | undefined) => Promise<FireOutcome>;

/** The arm-then-fire state one cue sheet holds — the director phone's and
 *  a host booth's (its NEXT bar and its Cues tab share one desk, so an arm
 *  made on one is the arm the other fires). */
export interface CueDesk {
  armed: Armed | null;
  /** The cue whose fire is in flight: every cue waits for it. */
  pending: string | null;
  /** NEXT's second after a press lands. */
  cooling: boolean;
  toast: string | null;
  setToast: (t: string | null) => void;
  /** The subject cue waiting for its person (the picker is open). */
  picking: CueRow | null;
  /** The picker's value box (an award's number), carried by the arm. */
  value: string;
  setValue: (v: string) => void;
  /** The person an armed subject cue goes to, by name. */
  subjectName: string | null;
  tap: (row: CueRow) => void;
  /** The picker answered: arm the subject cue for that person. */
  pick: (subject: string) => void;
  closePicker: () => void;
  locked: (row: CueRow) => boolean;
  /** A FIRE waiting on the desk's `confirm` (someone else is calling):
   *  every cue waits for the answer. */
  confirming?: string | null;
}

/** The desk's options (wave 18): `confirm` asks before a FIRE goes (the
 *  host dock's *Fire anyway?* while someone else calls the show). It sees
 *  the cue; true sends the press at once (the arm is spent, no second ARM),
 *  false drops it. Without it every FIRE goes, as before. */
export interface CueDeskOptions {
  confirm?: (row: CueRow) => Promise<boolean>;
}

/**
 * The desk: a first tap arms (core's `tapCue`), a second one fires; a stale
 * arm (the cue state moved under it) is dropped with "Cues moved"; an arm
 * lapses after `ARM_MS` and when the page is left; one press at a time.
 * `onOutcome` sees every fire's answer (the host keeps a refused press).
 */
export function useCueDesk(rows: CueRow[], marks: CueMarks, roster: ReadonlyArray<{ id: string; name: string }> | undefined, fire: DeskFire, onOutcome?: (row: CueRow, outcome: FireOutcome) => void, opts?: CueDeskOptions): CueDesk {
  const [armed, setArmed] = useState<Armed | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const confirm = useRef(opts?.confirm);
  confirm.current = opts?.confirm;
  const [pickingId, setPicking] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [cooling, setCooling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!cooling) return;
    const t = setTimeout(() => setCooling(false), NEXT_COOLDOWN_MS);
    return () => clearTimeout(t);
  }, [cooling]);
  // An armed cue disarms itself if the second tap never comes.
  useEffect(() => {
    if (armed === null) return;
    const t = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  // Looking away drops the arm.
  useEffect(() => {
    if (armed === null) return;
    return disarmOnLeave(document, window, () => setArmed(null));
  }, [armed]);
  // The cue state moved under an arm (another director, or the story,
  // fired): drop it rather than fire into a night that has moved on.
  useEffect(() => {
    // At `armed.at` the clock always passes: only the bound marks decide
    // (the 4 s lapse is the timer's job, and says nothing).
    if (armed === null || armStillValid(armed, marks, armed.at)) return;
    setArmed(null);
    setToast(STALE_TOAST);
  }, [marks, armed]);
  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const outcome = useRef(onOutcome);
  outcome.current = onOutcome;
  const tap = (row: CueRow) => {
    if (cueLocked(row, pending, cooling) || confirming !== null) return; // one press at a time
    const t = phoneTap(armed, row, Date.now(), marks);
    if (t.kind === "ignore") return; // a fast double tap only arms
    if (t.kind === "stale") {
      setArmed(null);
      setToast(STALE_TOAST);
    } else if (t.kind === "arm") setArmed(t.armed);
    else if (t.kind === "pick") setPicking(t.id);
    else {
      setArmed(null);
      const send = () => {
        setPending(t.id);
        void fire(t.id, t.subject, t.value, t.presses).then((out) => {
          setToast(fireToast(row, out));
          outcome.current?.(row, out);
          setPending((p) => (p === t.id ? null : p));
          setCooling(true);
        });
      };
      const ask = confirm.current;
      if (ask === undefined) return send();
      setConfirming(t.id);
      void ask(row).then(
        (ok) => {
          setConfirming(null);
          if (ok) send();
        },
        () => setConfirming(null),
      );
    }
  };
  const picking = pickingId !== null ? rows.find((r) => r.id === pickingId) ?? null : null;
  const subjectName = armed?.subject != null ? roster?.find((p) => p.id === armed.subject)?.name ?? null : null;
  return {
    armed,
    pending,
    cooling,
    toast,
    setToast,
    picking,
    value,
    setValue,
    subjectName,
    tap,
    pick: (subject) => {
      if (picking !== null) setArmed(armFor(picking.id, subject, Date.now(), value, marks));
    },
    closePicker: () => {
      setPicking(null);
      setValue("");
    },
    locked: (row) => cueLocked(row, pending, cooling) || confirming !== null,
    confirming,
  };
}

/**
 * The running order: grouped by act around the focus act (the act before
 * it folds into a `from B ▾` fallbacks line; past and future acts fold to
 * one line each, Anytime last), or a flat list for a story with no `act:`
 * or while a filter is typed.
 */
export function CueActList({ rows, layout, query, desk }: { rows: CueRow[]; layout: SheetLayout; query: string; desk: CueDesk }) {
  // Acts the director unfolded by hand (the focus act is always open).
  const [openActs, setOpenActs] = useState<ReadonlySet<string>>(() => new Set());
  // The previous act's fallbacks under the focus act: open by default.
  const [fromOpen, setFromOpen] = useState(true);
  const shown = useMemo(() => filterCues(rows, query), [rows, query]);
  const button = (r: CueRow, actCode?: string | null) => (
    <CueButton key={r.id} row={r} armed={desk.armed} locked={desk.locked(r)} sending={desk.pending === r.id} warnings={armWarnings(r, layout)} subjectName={desk.subjectName} actCode={actCode} onTap={() => desk.tap(r)} />
  );
  const rowList = (list: CueRow[]) => <ol className="cue-list">{list.map((r) => button(r))}</ol>;
  const toggleAct = (key: string) =>
    setOpenActs((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  if (query.trim() !== "" || layout.kind === "flat") {
    return (
      <ol className="cue-list">
        {shown.map((r) => button(r, layout.kind === "acts" && r.act !== null ? splitCode(r.act).code ?? null : null))}
        {shown.length === 0 && <li className="muted pad">No cue matches.</li>}
      </ol>
    );
  }
  return (
    <div className="cue-acts">
      {layout.acts.map((a, k) => {
        if (a.state === "anytime") return null;
        const isFocus = k === layout.focus;
        const open = isFocus || openActs.has(a.key);
        if (!open) {
          const f = foldedParts(a);
          return (
            <section key={a.key} className={`cue-act ${a.state}`} data-act={a.key}>
              <button type="button" className="cue-act-fold" aria-label={foldedLine(a)} onClick={() => toggleAct(a.key)}>
                <span className="cue-act-fold-line">
                  <span className="cue-act-fold-text">
                    {f.mark !== null && `${f.mark} `}
                    {f.name}
                  </span>
                  <span className="cue-act-count">{f.count}</span>
                  <span aria-hidden="true">▸</span>
                </span>
                {f.next !== null && <span className="cue-act-fold-next">next: {f.next}</span>}
              </button>
            </section>
          );
        }
        const prev = isFocus ? fromAct(layout, openActs) : null;
        return (
          <section key={a.key} className={`cue-act ${a.state}`} data-act={a.key}>
            <h3 className="cue-act-head">
              <button type="button" disabled={isFocus} onClick={() => toggleAct(a.key)}>
                <span className="cue-act-name">{actName(a)}</span>
                <span className="cue-act-count">{actCount(a)}</span>
                {isFocus && a.starting && <span className="cue-act-badge">starting</span>}
                {!isFocus && <span aria-hidden="true">▾</span>}
              </button>
            </h3>
            {rowList(a.spine)}
            {a.asides.length > 0 && (
              <>
                <div className="cue-divider">fallbacks</div>
                {rowList(a.asides)}
              </>
            )}
            {prev !== null && (
              <>
                <button type="button" className="cue-from" aria-expanded={fromOpen} onClick={() => setFromOpen((o) => !o)}>
                  from {actHandle(prev)} {fromOpen ? "▾" : "▸"} <span className="muted">{prev.asides.length} fallbacks</span>
                </button>
                {fromOpen && rowList(prev.asides)}
              </>
            )}
          </section>
        );
      })}
      {layout.acts
        .filter((a) => a.state === "anytime")
        .map((a) => (
          <section key={a.key} className="cue-act anytime" data-act={a.key}>
            <h3 className="cue-act-head">
              <button type="button" disabled>
                <span className="cue-act-name">⚡ {actName(a)}</span>
              </button>
            </h3>
            {rowList(a.rows)}
          </section>
        ))}
    </div>
  );
}

/** The subject cue's person picker (and an award's value box). `suggest`:
 *  the recap's winner for an award, offered first. */
export function CuePicker({ desk, roster, suggest }: { desk: CueDesk; roster: DirectorView["roster"]; suggest?: { id: string; hint: string } | null }) {
  const row = desk.picking;
  if (row === null) return null;
  const items = subjectChoices(roster);
  const first = suggest != null ? items.find((i) => i.id === suggest.id) : undefined;
  // The suggestion's reason (and any tie) gets its own line above the list:
  // as the row's sub it squeezed the winner's name to nothing on a phone.
  const ordered = first !== undefined ? [{ ...first, sub: "suggested" }, ...items.filter((i) => i !== first)] : items;
  return (
    <PickerSheet
      title={`Who for ${row.code ?? row.title}?`}
      items={ordered}
      onPick={(id) => desk.pick(id)}
      onClose={desk.closePicker}
      empty="Nobody has joined yet."
      lead={
        first !== undefined || takesValue(row.id) ? (
          <>
            {first !== undefined && <p className="pick-hint cue-suggest">{suggest!.hint}</p>}
            {takesValue(row.id) && (
              <label className="cue-value">
                <span>Value (optional) — lies accepted, the duck time, quests done</span>
                <input value={desk.value} maxLength={20} placeholder="e.g. 3 or 2:41" onChange={(e) => desk.setValue(e.target.value)} />
              </label>
            )}
          </>
        ) : undefined
      }
    />
  );
}

/** The phone's skin: the story's own (the poll, else the sign-in's resolve),
 *  else the landing's until someone signs in. */
export function directorTheme(view: Pick<DirectorView, "theme"> | null, auth: Pick<DirectorAuth, "theme"> | null, brand: string | null): string | null {
  return view?.theme ?? auth?.theme ?? brand;
}

export function DirectorApp({ onLeave, brandTheme = null }: { onLeave: () => void; brandTheme?: string | null }) {
  const s = useDirectorSession();
  const title = s.view?.title ?? s.auth?.title ?? null;
  useDocumentTitle(title !== null ? `🎬 ${title}` : null);
  useTheme(directorTheme(s.view, s.auth, brandTheme));
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const rows = useMemo(() => directorRows(s.view), [s.view]);
  const layout = useMemo(() => sheetLayout(rows), [rows]);
  const marks = s.view?.cues ?? NO_MARKS;
  const lastId = marks.last;
  // Who is calling (wave 18 B8): a FIRE while someone else calls asks once.
  const me = s.auth !== null ? [s.auth.name, phoneLabel(s.auth.name)] : [];
  const caller = cueCaller(s.view?.cues);
  const anyway = useFireAnyway(caller, me);
  const desk = useCueDesk(rows, marks, s.view?.roster, (id, subject, value, presses) => s.fire(id, subject, value, presses), undefined, { confirm: anyway.confirm });
  const [claimNote, setClaimNote] = useState<string | null>(null);
  const [soundNote, setSoundNote] = useState<string | null>(null);
  // The countdowns tick once a second between polls (story clock + the
  // wall time since the view landed).
  const runs = clockRuns(s.view);
  const ticking = runs && (s.view?.countdowns?.length ?? 0) > 0;
  const [wall, setWall] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setWall(Date.now());
    const t = setInterval(() => setWall(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking, s.receivedAt]);
  const nowMs = storyNow(s.view?.clock, s.receivedAt, Math.max(wall, s.receivedAt), runs);
  const bar = nextBar(rows, s.view?.countdowns, nowMs, runs);
  const show = useShowClock(showClockOf(s.view));
  // An older server sends no caller: the strip says nothing about it.
  const strip = stripItems(s.view, layout, nowMs, show, s.view !== null && callerKnown(s.view.cues) ? callerText(caller, me) : null);
  // Keep the next cue in view as the night moves down the sheet.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[data-next="true"]')?.scrollIntoView({ block: "nearest" });
  }, [lastId]);

  if (s.auth === null) return <DirectorLogin notice={s.notice} onLogin={s.login} onBack={onLeave} />;

  // The NEXT bar scrolls to its row (arming still happens on the row); with
  // no NEXT, to LAST. A filter that hides the row is cleared first.
  const toNext = () => {
    setQuery("");
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector('[data-next="true"]') ?? listRef.current?.querySelector('[data-last="true"]');
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };
  const armed = desk.armed;

  return (
    <div className="root">
      <div className="screen director">
        <header className="inbox-head">
          <div className="me">
            <div className="me-body">
              <div className="who">
                <strong>🎬 {title ?? "Cue sheet"}</strong>
              </div>
              <div className="me-sub">
                <span>{s.auth.name !== "" ? phoneLabel(s.auth.name) : "Director phone"}</span>
                <ConnDot connected={s.connected} label={s.connected ? "live" : "reconnecting"} />
              </div>
            </div>
          </div>
          <div className="hud">
            <button className="icon-btn" title="Help" onClick={() => setHelp(true)}>
              ?
            </button>
            <button className="icon-btn" title="Settings" onClick={() => setMenu(true)}>
              ☰
            </button>
          </div>
        </header>
        {s.view !== null && rows.length > 0 && (
          <div className="cue-pinned">
            {strip.length > 0 && (
              <div className="cue-strip" data-testid="cue-strip">
                {strip.map((it, k) => (
                  <span key={k} className={it.urgent ? "urgent" : it.clock ? "cue-strip-clock" : it.caller ? "cue-strip-caller" : undefined}>
                    {it.text}
                  </span>
                ))}
              </div>
            )}
            <button type="button" className={`cue-nextbar ${bar.kind}`} data-testid="cue-nextbar" onClick={toNext}>
              {bar.kind === "next" ? (
                <>
                  <span className="cue-nextbar-tag">{bar.again ? "AGAIN" : "NEXT"}</span>
                  {bar.row.code !== null && <span className="cue-code">{bar.row.code}</span>}
                  <span className="cue-nextbar-title">{cueTitleTags(bar.row.title).title}</span>
                </>
              ) : bar.kind === "countdown" ? (
                <span className="cue-nextbar-stack">
                  <span className="cue-nextbar-tag">
                    {NOTHING_TO_PRESS}. <span className="cue-nextbar-runs">{bar.held === true ? CLOCK_HELD : STORY_RUNS}</span>
                  </span>
                  <span className={`cue-nextbar-title ${bar.left < URGENT_S ? "urgent" : ""}`}>{countdownText(bar)}</span>
                </span>
              ) : (
                <span className="cue-nextbar-tag">{NOTHING_TO_PRESS}</span>
              )}
            </button>
          </div>
        )}
        <div className="station" ref={listRef}>
          <input className="cue-filter" type="search" placeholder="Filter cues (code or words)" value={query} onChange={(e) => setQuery(e.target.value)} />
          {s.view?.doorsClosed === true && rows.length > 0 && <p className="pick-hint">{DOORS_CLOSED}</p>}
          {armed !== null && desk.subjectName !== null && (
            <p className="pick-hint">
              Armed for {desk.subjectName}
              {armed.value !== undefined ? ` (value ${armed.value})` : ""} — tap the cue again to fire.
            </p>
          )}
          {s.view === null ? (
            <div className="muted pad">Loading the cue sheet…</div>
          ) : rows.length === 0 ? (
            <div className="muted pad">{noCuesText(s.view)}</div>
          ) : (
            <CueActList rows={rows} layout={layout} query={query} desk={desk} />
          )}
        </div>
      </div>
      {desk.toast !== null && (
        <div className="cue-toast" role="status">
          {desk.toast}
        </div>
      )}
      <CuePicker desk={desk} roster={s.view?.roster} />
      {anyway.dialog}
      {menu && (
        <Sheet title="🎬 Director phone" onClose={() => setMenu(false)}>
          <p className="muted pad">
            Signed in{s.auth.name !== "" ? ` as ${s.auth.name}` : ""}. The log records your cues as “{phoneLabel(s.auth.name)}”.
          </p>
          {s.view !== null && callerKnown(s.view.cues) && (
            <div className="pad">
              <p className="muted" data-testid="director-caller">
                {callerLine(caller, me)}
              </p>
              <button
                className="choice"
                onClick={() => {
                  const on = !callerIsMe(caller, me);
                  setClaimNote(null);
                  void s.claim(on).catch((e: unknown) => setClaimNote(`Not done — ${e instanceof Error ? e.message : String(e)}`));
                }}
              >
                {callerIsMe(caller, me) ? "Stop calling" : "📣 I'll call"}
              </button>
              {claimNote !== null && <p className="muted">{claimNote}</p>}
            </div>
          )}
          <div className="pad">
            <button
              className="choice"
              data-testid="director-stop-sounds"
              onClick={() => {
                setSoundNote(null);
                void s.stopSounds(false).then(setSoundNote, (e: unknown) => setSoundNote(`Not done — ${e instanceof Error ? e.message : String(e)}`));
              }}
            >
              {STOP_SOUNDS_LABEL}
            </button>
            {soundNote !== null && (
              <p className="muted" role="status">
                {soundNote}
              </p>
            )}
          </div>
          <WakeLockToggle />
          <button
            className="choice danger"
            onClick={() => {
              s.leave();
              onLeave();
            }}
          >
            Sign out of the cue sheet
          </button>
        </Sheet>
      )}
      {help && <HelpSheet role="performer" onClose={() => setHelp(false)} />}
    </div>
  );
}
