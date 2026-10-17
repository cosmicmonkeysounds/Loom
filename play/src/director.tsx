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
import { cueRows, cueValueArgs, filterCues, nightPhase, type CueInteraction, type CueMarks, type CueRow, type WorldLine } from "../../core/src/cue-sheet.ts";
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

// --- arm, then fire --------------------------------------------------------------

/** How long an armed cue waits for the second tap. */
export const ARM_MS = 4000;

/** The cue waiting for its second tap (and its person, for a subject cue). */
export interface Armed {
  id: string;
  subject: string | null;
  at: number;
  /** The award's optional value box, as typed (T2-09): lies accepted, the
   *  duck time, quests done — or a fixed award's number overridden. */
  value?: string;
}

export type Tap =
  /** First tap: the row is armed — tap again to fire. */
  | { kind: "arm"; armed: Armed }
  /** A cue that needs a person, with none picked yet: open the picker. */
  | { kind: "pick"; id: string }
  /** Second tap on an armed row in time: fire it. */
  | { kind: "fire"; id: string; subject: string | null; value?: string };

/** What a tap on `row` does, given what is armed now. */
export function tapCue(armed: Armed | null, row: CueRow, now: number): Tap {
  const live = armed !== null && armed.id === row.id && now - armed.at < ARM_MS;
  if (live) return { kind: "fire", id: row.id, subject: armed.subject, ...(armed.value !== undefined ? { value: armed.value } : {}) };
  if (row.subject) return { kind: "pick", id: row.id };
  return { kind: "arm", armed: { id: row.id, subject: null, at: now } };
}

/** The picker answered: the subject cue is armed for that person (and the
 *  value box's text, when one was typed). */
export function armFor(id: string, subject: string, now: number, value?: string): Armed {
  const v = value?.trim() ?? "";
  return { id, subject, at: now, ...(v !== "" ? { value: v } : {}) };
}

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

export type FireOutcome = { ok: true } | { ok: false; status: number; message: string };

/** The toast after a fire. No HTTP answer (status 0: a timeout, a dropped
 *  connection) may still have fired — say so, never "failed". */
export function fireToast(row: Pick<CueRow, "code" | "title">, outcome: FireOutcome): string {
  const what = row.code ?? row.title;
  if (outcome.ok) return `✓ Fired ${what}`;
  if (outcome.status === 409) return `Not fired — ${outcome.message}`;
  if (outcome.status === 0) return `Not sure ${what} fired — check the sheet before firing again`;
  return `${what} failed: ${outcome.message}`;
}

/** How long a fire waits for the server before giving up on the answer. */
export const FIRE_TIMEOUT_MS = 8000;

/** One fire's POST; rejects with `{status, message}` on an HTTP refusal and
 *  anything else (an abort, a dropped connection) on no answer. */
export type FirePost = (body: ReturnType<typeof signalBody>, signal: AbortSignal) => Promise<void>;

/**
 * Fire a cue: post it with a timeout, and re-poll at once whatever the
 * outcome, so the marks are fresh before the director can tap again.
 */
export async function fireCue(post: FirePost, body: ReturnType<typeof signalBody>, repoll: () => void, timeoutMs = FIRE_TIMEOUT_MS): Promise<FireOutcome> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    await post(body, ctl.signal);
    return { ok: true };
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
}

/**
 * Poll `load` until stopped: never while the page is hidden (the poll
 * parks and resumes the moment it is visible again), backing off on
 * failures. `now()` polls at once (after a fire) — or, with a poll already
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
  tick();
  return {
    stop() {
      stopped = true;
      clear();
      off();
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
  };
}

function useDirectorSession() {
  const { storage } = usePlayHost();
  const [auth, setAuth] = useState<DirectorAuth | null>(() => storage.load<DirectorAuth>(DIRECTOR_KEY));
  const [view, setView] = useState<DirectorView | null>(null);
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
        if (res.ok) return;
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new ApiError((data["error"] as string) || `HTTP ${res.status}`, res.status);
      };
      const out = await fireCue(post, signalBody(id, subject, auth.name, value), () => poll.current?.now());
      if (!out.ok && eventGone(out.status, out.message)) drop("That event has ended.");
      return out;
    },
    [auth, base, drop],
  );

  return { auth, view, connected, notice, login, fire, leave: () => drop(null) };
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

function CueButton({ row, armed, pending, onTap }: { row: CueRow; armed: Armed | null; pending: boolean; onTap: () => void }) {
  const isArmed = armed !== null && armed.id === row.id;
  return (
    <li>
      <button
        type="button"
        className={`choice cue-row ${row.last ? "last" : ""} ${row.next ? "next" : ""} ${isArmed ? "armed" : ""}`}
        data-next={row.next ? "true" : undefined}
        disabled={pending}
        onClick={onTap}
      >
        <span className="cue-n">{row.n}</span>
        <span className="cue-body">
          <span className="cue-title">
            {row.code !== null && <span className="cue-code">{row.code}</span>} {row.title}
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
  const phase = nightPhase(s.view?.world ?? []);
  const lastId = s.view?.cues?.last ?? null;

  // An armed cue disarms itself if the second tap never comes.
  useEffect(() => {
    if (armed === null) return;
    const t = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  // Keep the next cue in view as the night moves down the sheet.
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[data-next="true"]')?.scrollIntoView({ block: "nearest" });
  }, [lastId]);

  if (s.auth === null) return <DirectorLogin notice={s.notice} onLogin={s.login} onBack={onLeave} />;

  const tap = (row: CueRow) => {
    const t = tapCue(armed, row, Date.now());
    if (t.kind === "arm") setArmed(t.armed);
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
                <span>{phase !== null ? `phase: ${phase}` : "no phase yet"}</span>
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
        <div className="station">
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
          ) : (
            <ol className="cue-list" ref={listRef}>
              {shown.map((r) => (
                <CueButton key={r.id} row={r} armed={armed} pending={pending === r.id} onTap={() => tap(r)} />
              ))}
            </ol>
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
          onPick={(id) => setArmed(armFor(pickingRow.id, id, Date.now(), value))}
          onClose={() => {
            setPicking(null);
            setValue("");
          }}
          empty="Nobody has joined yet."
          lead={
            <label className="cue-value">
              <span>Value (optional) — lies accepted, the duck time, quests done</span>
              <input value={value} maxLength={20} placeholder="e.g. 3 or 2:41" onChange={(e) => setValue(e.target.value)} />
            </label>
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
