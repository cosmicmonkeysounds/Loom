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
import { ApiError, api } from "./client.ts";
import { ConnDot, PickerSheet, Sheet, WakeLockToggle, type PickItem } from "./chat.tsx";
import { HelpSheet } from "./help.tsx";
import { usePlayHost } from "./host.ts";
import { eventGone } from "./lifecycle.ts";
import { codeFromUrl, useDocumentTitle, type ResolvedCode } from "./session.ts";

/** Where the phone keeps its director sign-in. */
export const DIRECTOR_KEY = "loom.director";

export interface DirectorAuth {
  token: string;
  eventId: string;
  /** Who is holding the phone — the journal reads "Phone · <name>". */
  name: string;
  title?: string;
}

/** The slice of the director's `ModView` this page reads. */
export interface DirectorView {
  title?: string;
  phase?: string;
  interactions?: CueInteraction[];
  cues?: CueMarks;
  world?: WorldLine[];
  roster?: Array<{ id: string; name: string; location: string | null; owner?: string | null }>;
  /** The story clock (ms) when the view was built: the countdowns tick
   *  down from it plus the wall time since the poll landed. */
  clock?: number;
  /** The live countdowns (`countdown:` header lines whose `while` holds
   *  and whose deadline, in story seconds, is still ahead). */
  countdowns?: Array<{ label: string; endsAt: number }>;
  /** Up to 3 `watch:` values — global ones only, never a secret one (the
   *  server's lean view never sends those). */
  watch?: Array<{ label: string; value: string }>;
}

/** `?role=director` opens this page. */
export function directorFromSearch(search: string): boolean {
  try {
    return new URLSearchParams(search).get("role") === "director";
  } catch {
    return false;
  }
}

export type AppRole = "none" | "guest" | "prime" | "director";

/** The role a fresh page opens on: `?role=director` whatever the phone
 *  holds, else the stored session (guest, performer, then director). */
export function initialRole(search: string, stored: (key: string) => string | null): AppRole {
  if (directorFromSearch(search)) return "director";
  if (stored("loom.guest")) return "guest";
  if (stored("loom.prime")) return "prime";
  if (stored(DIRECTOR_KEY)) return "director";
  return "none";
}

/** A `?code=` link opens what its code is for — the mod code the cue sheet,
 *  a performer code the performer sign-in (the cast card's QR) — but only
 *  from the chooser, never over a signed-in guest or performer. A guest
 *  code stays on the chooser. */
export function roleForBrand(role: AppRole, brandRole: string | null | undefined): AppRole {
  if (role !== "none") return role;
  if (brandRole === "mod") return "director";
  if (brandRole === "prime") return "prime";
  return role;
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

/** A folded act's one line (the page adds the ▸): a past act `✓ B · Act I
 *  8/8`, one that never ran `– … skipped`, one still to come with its size
 *  and the first cue it will ask for. */
export function foldedLine(a: CueAct): string {
  if (a.state === "past") return `✓ ${actName(a)} ${actCount(a)}`;
  if (a.state === "skipped") return `– ${actName(a)} skipped`;
  const first = a.spine.find((r) => !r.fired);
  const size = `${a.spine.length} cue${a.spine.length === 1 ? "" : "s"}`;
  return `${actName(a)} · ${size}${first !== undefined ? ` · next: ${cueTitleTags(first.title).title}` : ""}`;
}

// --- the clock, the NEXT bar and the strip -------------------------------------------

/** The story clock now (ms): the view's `clock` plus the wall time since the
 *  poll landed. Null when the view carries no clock (an old server). */
export function storyNow(clock: number | undefined, receivedAt: number, now: number): number | null {
  if (clock === undefined || !Number.isFinite(clock)) return null;
  return clock + Math.max(0, now - receivedAt);
}

/** Seconds as `37:52`, or `1:02:03` past the hour. */
export function formatLeft(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Under this many seconds a countdown reads red. */
export const URGENT_S = 60;

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
  | { kind: "countdown"; label: string; left: number }
  | { kind: "none" };

export function nextBar(rows: CueRow[], countdowns: DirectorView["countdowns"], nowMs: number | null): NextBar {
  const next = rows.find((r) => r.next);
  if (next !== undefined) return { kind: "next", row: next, again: next.last };
  const soon = soonestCountdown(countdowns, nowMs);
  return soon !== null ? { kind: "countdown", ...soon } : { kind: "none" };
}

/** The bar as text: `NEXT 📊 Trust Chart`, `AGAIN 📋 Results…`,
 *  `⏱ Midnight 37:52`, or `NEXT —`. */
export function nextBarText(bar: NextBar): string {
  if (bar.kind === "next") return `${bar.again ? "AGAIN" : "NEXT"} ${cueTitleTags(bar.row.title).title}`;
  if (bar.kind === "countdown") return `⏱ ${bar.label} ${formatLeft(bar.left)}`;
  return "NEXT —";
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
  /** A countdown under a minute. */
  urgent?: true;
}

/** The strip under the header: the focus act's code · the phase · the
 *  soonest countdown · up to 3 watched values (whatever the view carries:
 *  the server's lean view holds only global, non-secret ones). */
export function stripItems(view: DirectorView | null, layout: SheetLayout, nowMs: number | null): StripItem[] {
  const out: StripItem[] = [];
  if (layout.kind === "acts" && layout.focus >= 0) out.push({ text: actHandle(layout.acts[layout.focus]!) });
  const phase = nightPhase(view?.world ?? []);
  if (phase !== null) out.push({ text: phase });
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

/** The toast when a stale arm is dropped. */
export const STALE_TOAST = "Cues moved — tap again";

/** The `/api/mod/signal` body for a cue; an award's value rides as
 *  `args: {value}` (core's `cueValueArgs`, the editor's rule). */
export function signalBody(
  id: string,
  subject: string | null,
  name: string,
  value?: string,
): { name: string; subject?: string; label: string; args?: { value: string | number } } {
  const args = value !== undefined ? cueValueArgs(value) : null;
  return { name: id, ...(subject !== null ? { subject } : {}), label: phoneLabel(name), ...(args !== null ? { args } : {}) };
}

/** The people a subject cue can name: real guests first, personas tagged. */
export function subjectChoices(roster: DirectorView["roster"]): PickItem[] {
  return [...(roster ?? [])]
    .sort((a, b) => Number(typeof a.owner === "string") - Number(typeof b.owner === "string") || a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, label: p.name, sub: [p.location, typeof p.owner === "string" ? "persona" : null].filter((s) => s !== null).join(" · ") || undefined, avatar: true }));
}

/** `refused`: the server took the press but the story turned it down
 *  (out of turn; its `# hosts` line says why) — not ticked on the sheet. */
export type FireOutcome = { ok: true; refused?: true } | { ok: false; status: number; message: string };

/** The toast after a fire. No HTTP answer (status 0: a timeout, a dropped
 *  connection) may still have fired — say so, never "failed". */
export function fireToast(row: Pick<CueRow, "code" | "title">, outcome: FireOutcome): string {
  const what = row.code ?? row.title;
  if (outcome.ok && outcome.refused === true) return `Not taken — ${what} doesn't apply right now (# hosts says why)`;
  if (outcome.ok) return `✓ Fired ${what}`;
  if (outcome.status === 409) return `Not fired — ${outcome.message}`;
  if (outcome.status === 0) return `Not sure ${what} fired — check the sheet before firing again`;
  return `${what} failed: ${outcome.message}`;
}

/** How long a fire waits for the server before giving up on the answer. */
export const FIRE_TIMEOUT_MS = 8000;

/** One fire's POST; resolves with the server's answer (`refused` when the
 *  story turned the press down), rejects with `{status, message}` on an HTTP
 *  refusal and anything else (an abort, a dropped connection) on no answer. */
export type FirePost = (body: ReturnType<typeof signalBody>, signal: AbortSignal) => Promise<{ refused?: boolean } | void>;

/**
 * Fire a cue: post it with a timeout, and re-poll at once whatever the
 * outcome, so the marks are fresh before the director can tap again.
 */
export async function fireCue(post: FirePost, body: ReturnType<typeof signalBody>, repoll: () => void, timeoutMs = FIRE_TIMEOUT_MS): Promise<FireOutcome> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const answer = await post(body, ctl.signal);
    return answer?.refused === true ? { ok: true, refused: true } : { ok: true };
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
      // `cues=1`: the lean read (an older server ignores it and sends the
      // full ModView, which carries the same fields).
      const res = await fetch(`${base}/api/state?role=mod&cues=1`, { headers: { "x-loom-token": auth.token } });
      const out = pollOutcome(res.status, (await res.json().catch(() => ({}))) as Record<string, unknown>);
      if (out.kind === "view") {
        setView(out.view);
        setReceivedAt(Date.now());
        setConnected(true);
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
  }, [auth, base, drop]);

  const login = useCallback(
    async (passcode: string, name: string) => {
      const code = passcode.trim();
      const r = await api<ResolvedCode>("/api/resolve-code", { code });
      if (r.role !== "mod") throw new Error("That isn't the director code. Check it with the stage manager.");
      const { token } = await api<{ token: string }>(`/e/${encodeURIComponent(r.eventId)}/api/mod/login`, { passcode: code });
      const a: DirectorAuth = { token, eventId: r.eventId, name: name.trim(), ...(r.title !== undefined ? { title: r.title } : {}) };
      storage.save(DIRECTOR_KEY, a);
      setNotice(null);
      setAuth(a);
    },
    [storage],
  );

  const fire = useCallback(
    async (id: string, subject: string | null, value?: string): Promise<FireOutcome> => {
      if (auth === null) return { ok: false, status: -1, message: "not signed in" };
      const post: FirePost = async (body, signal) => {
        const res = await fetch(`${base}/api/mod/signal`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-loom-token": auth.token },
          body: JSON.stringify(body),
          signal,
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.ok) return { refused: data["refused"] === true };
        throw new ApiError((data["error"] as string) || `HTTP ${res.status}`, res.status);
      };
      const out = await fireCue(post, signalBody(id, subject, auth.name, value), () => poll.current?.now());
      if (!out.ok && eventGone(out.status, out.message)) drop("That event has ended.");
      return out;
    },
    [auth, base, drop],
  );

  return { auth, view, receivedAt, connected, notice, login, fire, leave: () => drop(null) };
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

function CueButton({ row, armed, pending, actCode, onTap }: { row: CueRow; armed: Armed | null; pending: boolean; actCode?: string | null; onTap: () => void }) {
  const isArmed = armed !== null && armed.id === row.id;
  const { title, tags } = cueTitleTags(row.title);
  return (
    <li>
      <button
        type="button"
        className={`choice cue-row ${row.last ? "last" : ""} ${row.next ? "next" : ""} ${isArmed ? "armed" : ""} ${row.live ? "" : "off"}`}
        data-next={row.next ? "true" : undefined}
        data-last={row.last ? "true" : undefined}
        disabled={pending}
        onClick={onTap}
      >
        <span className="cue-n">{row.n}</span>
        <span className="cue-body">
          <span className="cue-title">
            {actCode != null && <span className="cue-code act">{actCode}</span>}
            {row.code !== null && <span className="cue-code">{row.code}</span>} {title}
          </span>
          {isArmed ? (
            <span className="cue-arm">Tap again to fire</span>
          ) : (
            <span className="cue-tags">
              {row.last && <span className="cue-tag last">LAST</span>}
              {row.next && <span className="cue-tag next">NEXT</span>}
              {row.fired && <span className="cue-tag">✓ fired</span>}
              {!row.sequence && <span className="cue-tag">aside</span>}
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

export function DirectorApp({ onLeave }: { onLeave: () => void }) {
  const s = useDirectorSession();
  const title = s.view?.title ?? s.auth?.title ?? null;
  useDocumentTitle(title !== null ? `🎬 ${title}` : null);
  const [query, setQuery] = useState("");
  const [armed, setArmed] = useState<Armed | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  // The picker's value box: an award's number, carried by the arm.
  const [value, setValue] = useState("");
  // The cue whose fire is in flight: only its row waits (≤ FIRE_TIMEOUT_MS).
  const [pending, setPending] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const rows = useMemo(() => directorRows(s.view), [s.view]);
  const shown = useMemo(() => filterCues(rows, query), [rows, query]);
  const layout = useMemo(() => sheetLayout(rows), [rows]);
  // Acts the director unfolded by hand (the focus act is always open).
  const [openActs, setOpenActs] = useState<ReadonlySet<string>>(() => new Set());
  // The previous act's fallbacks under the focus act: open by default.
  const [fromOpen, setFromOpen] = useState(true);
  const marks = s.view?.cues ?? NO_MARKS;
  const lastId = marks.last;
  // The countdowns tick once a second between polls (story clock + the
  // wall time since the view landed).
  const ticking = (s.view?.countdowns?.length ?? 0) > 0;
  const [wall, setWall] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setWall(Date.now());
    const t = setInterval(() => setWall(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking, s.receivedAt]);
  const nowMs = storyNow(s.view?.clock, s.receivedAt, Math.max(wall, s.receivedAt));
  const bar = nextBar(rows, s.view?.countdowns, nowMs);
  const strip = stripItems(s.view, layout, nowMs);

  // An armed cue disarms itself if the second tap never comes.
  useEffect(() => {
    if (armed === null) return;
    const t = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(t);
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
  // Keep the next cue in view as the night moves down the sheet.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[data-next="true"]')?.scrollIntoView({ block: "nearest" });
  }, [lastId]);

  if (s.auth === null) return <DirectorLogin notice={s.notice} onLogin={s.login} onBack={onLeave} />;

  const tap = (row: CueRow) => {
    const t = phoneTap(armed, row, Date.now(), marks);
    if (t.kind === "ignore") return; // a fast double tap only arms
    if (t.kind === "stale") {
      setArmed(null);
      setToast(STALE_TOAST);
    } else if (t.kind === "arm") setArmed(t.armed);
    else if (t.kind === "pick") setPicking(t.id);
    else {
      setArmed(null);
      setPending(t.id);
      void s.fire(t.id, t.subject, t.value).then((outcome) => {
        setToast(fireToast(row, outcome));
        setPending((p) => (p === t.id ? null : p));
      });
    }
  };
  const rowList = (list: CueRow[]) => (
    <ol className="cue-list">
      {list.map((r) => (
        <CueButton key={r.id} row={r} armed={armed} pending={pending === r.id} onTap={() => tap(r)} />
      ))}
    </ol>
  );
  const toggleAct = (key: string) =>
    setOpenActs((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  // The NEXT bar scrolls to its row (arming still happens on the row); with
  // no NEXT, to LAST. A filter that hides the row is cleared first.
  const toNext = () => {
    setQuery("");
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector('[data-next="true"]') ?? listRef.current?.querySelector('[data-last="true"]');
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };
  const pickingRow = picking !== null ? rows.find((r) => r.id === picking) ?? null : null;
  const subjectName = armed?.subject != null ? s.view?.roster?.find((p) => p.id === armed.subject)?.name ?? null : null;

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
                  <span key={k} className={it.urgent ? "urgent" : undefined}>
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
                <>
                  <span className="cue-nextbar-tag">NEXT —</span>
                  <span className={`cue-nextbar-title ${bar.left < URGENT_S ? "urgent" : ""}`}>
                    ⏱ {bar.label} {formatLeft(bar.left)}
                  </span>
                </>
              ) : (
                <span className="cue-nextbar-tag">NEXT — nothing to press</span>
              )}
            </button>
          </div>
        )}
        <div className="station" ref={listRef}>
          <input className="cue-filter" type="search" placeholder="Filter cues (code or words)" value={query} onChange={(e) => setQuery(e.target.value)} />
          {armed !== null && subjectName !== null && (
            <p className="pick-hint">
              Armed for {subjectName}
              {armed.value !== undefined ? ` (value ${armed.value})` : ""} — tap the cue again to fire.
            </p>
          )}
          {s.view === null ? (
            <div className="muted pad">Loading the cue sheet…</div>
          ) : rows.length === 0 ? (
            <div className="muted pad">This story has no director cues (`who: admin` interactions).</div>
          ) : query.trim() !== "" || layout.kind === "flat" ? (
            <ol className="cue-list">
              {shown.map((r) => (
                <CueButton key={r.id} row={r} armed={armed} pending={pending === r.id} actCode={layout.kind === "acts" && r.act !== null ? splitCode(r.act).code ?? null : null} onTap={() => tap(r)} />
              ))}
              {shown.length === 0 && <li className="muted pad">No cue matches.</li>}
            </ol>
          ) : (
            <div className="cue-acts">
              {layout.acts.map((a, k) => {
                if (a.state === "anytime") return null;
                const isFocus = k === layout.focus;
                const open = isFocus || openActs.has(a.key);
                if (!open)
                  return (
                    <section key={a.key} className={`cue-act ${a.state}`} data-act={a.key}>
                      <button type="button" className="cue-act-fold" onClick={() => toggleAct(a.key)}>
                        <span className="cue-act-fold-text">{foldedLine(a)}</span> ▸
                      </button>
                    </section>
                  );
                const prev = isFocus && layout.previous >= 0 ? layout.acts[layout.previous]! : null;
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
                    {prev !== null && prev.asides.length > 0 && (
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
          )}
        </div>
      </div>
      {toast !== null && (
        <div className="cue-toast" role="status">
          {toast}
        </div>
      )}
      {pickingRow !== null && (
        <PickerSheet
          title={`Who for ${pickingRow.code ?? pickingRow.title}?`}
          items={subjectChoices(s.view?.roster)}
          onPick={(id) => setArmed(armFor(pickingRow.id, id, Date.now(), value, marks))}
          onClose={() => {
            setPicking(null);
            setValue("");
          }}
          empty="Nobody has joined yet."
          lead={
            takesValue(pickingRow.id) ? (
              <label className="cue-value">
                <span>Value (optional) — lies accepted, the duck time, quests done</span>
                <input value={value} maxLength={20} placeholder="e.g. 3 or 2:41" onChange={(e) => setValue(e.target.value)} />
              </label>
            ) : undefined
          }
        />
      )}
      {menu && (
        <Sheet title="🎬 Director phone" onClose={() => setMenu(false)}>
          <p className="muted pad">
            Signed in{s.auth.name !== "" ? ` as ${s.auth.name}` : ""}. The log records your cues as “{phoneLabel(s.auth.name)}”.
          </p>
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
