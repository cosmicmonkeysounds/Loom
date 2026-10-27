//! Piloting: a scanned guest's own session, on the terminal. The terminal
//! holds a moderator token, so it mints a play-as session for the guest
//! through `/api/mod/impersonate` (the seam the editor's Run → Players
//! page uses) — exact (a guest's view, no more), in memory only, cut by
//! the same restarts that cut the phone's session, and every line typed
//! here is journaled `by` this terminal's name (the mod feed shows it as
//! `via`). It then opens the guest's stream (`useChatStream`, the play
//! app's own reducer) and narrows it to the one thread this is a line to:
//! `dm:<Character>` — the very thread on the guest's phone, so what is
//! said at the wall is on their screen when they walk away.
//!
//! A room terminal (wave 7, `config.roomOf` — the server-room terminal) also
//! tells the story where the line was opened: `terminal opened` when a pass
//! opens it and `terminal closed` when it ends (the leash, DISCONNECT, an
//! overlay, a restart, the page going away), each `POST /api/mod/signal`
//! with the guest as subject, `{at: <room>}` and the terminal's label.
//! Best-effort: a refused or lost signal never holds up the line. The open
//! visit is also kept in `localStorage` (`VISIT_KEY`), so a terminal that
//! crashes or reloads mid-visit posts the `terminal closed` it owes on its
//! next boot (`recoverVisit`), before it opens any other line — else the
//! guest would stay "at the heart" for the rest of the night.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, useChatStream } from "@loom/play/client.ts";
import { useTyping } from "@loom/play/typing.ts";
import type { ChatMessage, GuestView } from "@loom/play/types.ts";
import { baseOf, foldName, roomOf, type TerminalConfig } from "./config.ts";

export interface Pilot {
  /** The impersonation token (the guest's session on this terminal). */
  token: string;
  id: string;
  name: string;
}

/** Mint a play-as session for a scanned guest. */
export async function beginPilot(config: TerminalConfig, guestId: string): Promise<Pilot> {
  const r = await api<{ token: string; id: string; name: string }>(
    `${baseOf(config)}/api/mod/impersonate`,
    { role: "guest", id: guestId, label: `Terminal · ${config.name}` },
    config.token,
  );
  return { token: r.token, id: r.id, name: r.name };
}

/** End it (the leash ran out, or the guest disconnected). `keepalive`: the
 *  page is going away (pagehide) — the request outlives it. */
export async function endPilot(config: TerminalConfig, pilot: Pilot, o: { keepalive?: boolean; fetchFn?: typeof fetch } = {}): Promise<void> {
  try {
    await (o.fetchFn ?? fetch)(`${baseOf(config)}/api/mod/impersonate/end`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-loom-token": config.token },
      body: JSON.stringify({ session: pilot.token }),
      keepalive: o.keepalive === true,
    });
  } catch {
    /* the run may have restarted under us — the session is gone either way */
  }
}

/** The story's names for a line opened / closed at a room terminal (wave 7):
 *  they fold to `terminal_opened` / `terminal_closed`. */
export type VisitSignal = "terminal opened" | "terminal closed";

/** The `/api/mod/signal` body for a visit, or null when this terminal
 *  belongs to no room (only a room terminal tells the story). `at` names
 *  the room outright (a visit left behind closes in the room it opened in). */
export function visitSignalBody(config: Pick<TerminalConfig, "name" | "room" | "view">, name: VisitSignal, guestId: string, at?: string): { name: VisitSignal; subject: string; args: { at: string }; label: string } | null {
  const room = at !== undefined ? at.trim() || null : roomOf(config);
  if (room === null || guestId === "") return null;
  return { name, subject: guestId, args: { at: room }, label: `Terminal · ${config.name}`.slice(0, 60) };
}

/** Post a visit signal; true when the server took it. Never throws. */
export async function postVisit(config: TerminalConfig, name: VisitSignal, guestId: string, o: { keepalive?: boolean; fetchFn?: typeof fetch; at?: string } = {}): Promise<boolean> {
  const body = visitSignalBody(config, name, guestId, o.at);
  if (body === null) return false;
  try {
    const res = await (o.fetchFn ?? fetch)(`${baseOf(config)}/api/mod/signal`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-loom-token": config.token },
      body: JSON.stringify(body),
      keepalive: o.keepalive === true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** An open visit: the guest, and the `terminal opened` post in flight. */
export interface OpenVisit {
  guestId: string;
  opened: Promise<unknown>;
}

/** Where the open visit is kept across a crash or a reload. */
export const VISIT_KEY = "loom.terminal.visit";

/** The open visit as stored: the event, the guest and the room it opened in. */
export interface StoredVisit {
  eventId: string;
  guestId: string;
  room: string;
}

export type VisitStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The page's `localStorage`, or null where there is none (a private
 *  window, blocked site data, a test): the latch then lives in memory only. */
export function pageStorage(): VisitStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Parse a stored visit (null for anything malformed). */
export function parseStoredVisit(raw: string | null): StoredVisit | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredVisit>;
    if (typeof v.eventId !== "string" || typeof v.guestId !== "string" || typeof v.room !== "string") return null;
    if (v.eventId === "" || v.guestId === "" || v.room.trim() === "") return null;
    return { eventId: v.eventId, guestId: v.guestId, room: v.room };
  } catch {
    return null;
  }
}

/** One open visit at a time: `close` hands back the visit to close exactly
 *  once, however many ways the line ends (the leash, then the pagehide).
 *  The app holds one for the life of the page (not per mounted line pane),
 *  so a pane remounted mid-connect still closes the visit it opened.
 *
 *  It also mirrors the open visit into storage (`remember` / `forget`), and
 *  `ready` is the boot-time close of a visit a crashed page left behind:
 *  every `terminal opened` waits for it. Every storage call is guarded —
 *  a storage that throws is a storage that isn't there. */
export class VisitLatch {
  private open: OpenVisit | null = null;
  private recovered = false;
  /** The left-behind visit's close in flight (null: none owed). */
  ready: Promise<unknown> | null = null;
  constructor(private readonly storage: VisitStorage | null = pageStorage()) {}
  begin(guestId: string, opened: Promise<unknown> = Promise.resolve()): void {
    this.open = { guestId, opened };
  }
  /** Is a visit open on this page right now? */
  get busy(): boolean {
    return this.open !== null;
  }
  /** A close that did not land: the stored visit stays owed, and the next
   *  `openVisit` on this page (or the next boot) posts it again. Only while
   *  no newer visit is open (that one's record has replaced it). */
  owe(): void {
    if (this.open === null) this.recovered = false;
  }
  /** The visit to close now (null: none open, or already closed). */
  close(): OpenVisit | null {
    const v = this.open;
    this.open = null;
    return v;
  }
  /** Keep the open visit across a crash. */
  remember(v: StoredVisit): void {
    try {
      this.storage?.setItem(VISIT_KEY, JSON.stringify(v));
    } catch {
      /* no storage: the visit lives in memory only */
    }
  }
  /** The visit was closed: nothing is owed on the next boot. */
  forget(): void {
    try {
      this.storage?.removeItem(VISIT_KEY);
    } catch {
      /* nothing to forget */
    }
  }
  /** The visit a previous page left open, taken out of storage — once per
   *  latch (per page): a later call never closes this page's own visit. */
  takeLeftBehind(): StoredVisit | null {
    if (this.recovered) return null;
    this.recovered = true;
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(VISIT_KEY) ?? null;
    } catch {
      return null;
    }
    if (raw !== null) this.forget();
    return parseStoredVisit(raw);
  }
}

/** Boot: a visit the last page left open (it crashed or reloaded mid-line,
 *  and its pagehide close never landed) is closed now, in the room it
 *  opened in, before this page opens any line. A visit from another event
 *  is dropped (that guest's run is not this one). Runs once per latch;
 *  returns the close in flight, or null when nothing was owed. */
export function recoverVisit(config: TerminalConfig, latch: VisitLatch, o: { fetchFn?: typeof fetch } = {}): Promise<boolean> | null {
  const left = latch.takeLeftBehind();
  if (left === null || left.eventId !== config.eventId) return null;
  const closing = postVisit(config, "terminal closed", left.guestId, { ...o, at: left.room });
  latch.ready = closing;
  void closing.then(() => {
    if (latch.ready === closing) latch.ready = null; // owed nothing more
  });
  return closing;
}

/** A pass opened a line here: tell the story (`terminal opened`) and
 *  remember the visit (in memory and in storage). A terminal with no room
 *  does nothing. The post waits for a left-behind visit's close. */
export function openVisit(config: TerminalConfig, latch: VisitLatch, guestId: string, o: { fetchFn?: typeof fetch } = {}): void {
  const room = roomOf(config);
  if (room === null || visitSignalBody(config, "terminal opened", guestId) === null) return;
  recoverVisit(config, latch, o); // a no-op once the boot has run it
  const send = () => postVisit(config, "terminal opened", guestId, o);
  latch.remember({ eventId: config.eventId, guestId, room });
  // Straight away when nothing is owed, so a pagehide close never beats it.
  latch.begin(guestId, latch.ready === null ? send() : latch.ready.then(send, send));
}

/** The line ended: `terminal closed`, once — and never ahead of its
 *  `terminal opened` (a DISCONNECT right after the scan would otherwise
 *  race it and leave the story thinking the guest is still there). The
 *  pagehide (`keepalive`) can't wait for anything: it sends at once. The
 *  stored visit is forgotten only once the server took the close (and no
 *  newer visit has replaced it): a close lost to a Wi-Fi blip stays owed,
 *  and goes again before the next line opens here or on the next boot —
 *  otherwise the guest would stay "at his heart" all night. A pagehide
 *  close whose answer the page never sees is simply sent again (a second
 *  `terminal closed` changes nothing). */
export function closeVisit(config: TerminalConfig, latch: VisitLatch, o: { keepalive?: boolean; fetchFn?: typeof fetch } = {}): Promise<boolean> | null {
  const v = latch.close();
  if (v === null) return null;
  const send = () => postVisit(config, "terminal closed", v.guestId, o);
  const sent = o.keepalive === true ? send() : v.opened.then(send, send);
  return sent.then((ok) => {
    if (latch.busy) return ok; // a newer visit's record is the stored one now
    if (ok) latch.forget();
    else latch.owe();
    return ok;
  });
}

/** The roster (id + name) for the typed fallback — a mod-only read. */
export async function fetchRoster(config: TerminalConfig): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${baseOf(config)}/api/state?role=mod`, { headers: { "x-loom-token": config.token } });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const view = (await res.json()) as { roster?: Array<{ id: string; name: string }> };
  return (view.roster ?? []).map((r) => ({ id: r.id, name: r.name }));
}

/** How long the cast lookup may take (ms) before the caller gives up on it. */
export const CAST_LOOKUP_MS = 3_000;

/** The story's declared characters (a mod-only read; the declared cast
 *  before the doors open too, empty only with no story to compile) — the ⚙ save checks a typed character name against it. Rejects after
 *  `timeoutMs`: a server that is reachable but not answering (a stalled VPS,
 *  a lossy house Wi-Fi) must not hold the ⚙ save for a TCP timeout. */
export async function fetchCharacters(config: TerminalConfig, timeoutMs: number = CAST_LOOKUP_MS): Promise<string[]> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error("the cast lookup timed out"));
    }, timeoutMs);
  });
  const read = (async () => {
    const res = await fetch(`${baseOf(config)}/api/state?role=mod`, { headers: { "x-loom-token": config.token }, signal: abort.signal });
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
    const view = (await res.json()) as { characters?: unknown };
    return Array.isArray(view.characters) ? view.characters.filter((c): c is string => typeof c === "string") : [];
  })();
  try {
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Is the terminal's moderator token still honoured? */
export async function tokenAlive(config: TerminalConfig): Promise<boolean> {
  try {
    const res = await fetch(`${baseOf(config)}/api/mod/tts`, { headers: { "x-loom-token": config.token } });
    return res.status !== 401 && res.status !== 403;
  } catch {
    return true; // the server is away, not the token
  }
}

export interface Line extends ChatMessage {
  /** Said by the character (else by the guest / the operator). */
  theirs: boolean;
}

/**
 * The visit's floor (wave 27, B1): the newest seq of the first history the
 * stream sends after the pilot changed. A room terminal shows only what is
 * said past it — this visit, never the night's phone DMs. A reconnect's
 * history never moves it (`prev` stays); `"pin"` (the talk opened before
 * any history came) fixes it at -1: show everything rather than hide the
 * opening lines.
 */
export function floorAfter(prev: number | null, history: readonly { seq: number }[] | "pin"): number {
  if (prev !== null) return prev;
  if (history === "pin") return -1;
  return history.reduce((m, x) => Math.max(m, x.seq), -1);
}

/** This visit's lines: past the floor (null: no history yet — every line). */
export function visitLinesOf<L extends { seq: number }>(lines: readonly L[], floor: number | null): L[] {
  return floor === null ? [...lines] : lines.filter((l) => l.seq > floor);
}

export interface PilotSession {
  view: GuestView | null;
  connected: boolean;
  /** The backlog loaded — `lines` is real. */
  ready: boolean;
  /** The DM thread, oldest first. */
  lines: Line[];
  /** This visit's part of it (wave 27): `lines` past the visit's floor. */
  visitLines: Line[];
  /** The talk opened before the history came: keep every line (`floorAfter` "pin"). */
  pinFloor: () => void;
  /** The character is composing a reply. */
  typing: boolean;
  /** Character is answered by an agent that is online now (null = unknown). */
  online: boolean | null;
  /** Say something to the character, as the guest. */
  say: (text: string) => Promise<void>;
  /** Fires for every line of the character's that *arrives* (never the
   *  backlog). Returns the unsubscribe; stable across renders. */
  onNewLine: (fn: (line: Line) => void) => () => void;
  /** The run restarted / ended under us; the session is gone. */
  dead: string | null;
}

/** The character's id as the guest's own view spells it (the directory
 *  lists declared characters by id), else the configured name — which
 *  `provision` / the screen state already made canonical (B19). */
export function characterIdOf(configured: string, view: Pick<GuestView, "people"> | null): string {
  const want = foldName(configured);
  return view?.people?.find((p) => p.kind === "character" && foldName(p.id) === want)?.id ?? configured;
}

export function usePilotSession(config: TerminalConfig, pilot: Pilot | null): PilotSession {
  const base = baseOf(config);
  const url = pilot ? `${base}/events?role=guest&token=${encodeURIComponent(pilot.token)}` : null;
  const [view, setView] = useState<GuestView | null>(null);
  const character = characterIdOf(config.character, view);
  const channel = `dm:${character}`;
  // `ready` belongs to one pilot: a render with a new pilot is never ready
  // on the old one's history (the reset below runs a commit later).
  const [readyFor, setReadyFor] = useState<Pilot | null>(null);
  const ready = pilot !== null && readyFor === pilot;
  const pilotRef = useRef(pilot);
  pilotRef.current = pilot;
  const [floor, setFloor] = useState<number | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const baseline = useRef(-1);
  const listeners = useRef(new Set<(line: Line) => void>());
  const announced = useRef(new Set<number>());
  const { typing, onTyping } = useTyping(pilot !== null ? { role: "guest" } : null);

  useEffect(() => {
    setView(null);
    setReadyFor(null);
    setFloor(null);
    setDead(null);
    baseline.current = -1;
    announced.current = new Set();
  }, [pilot]);

  const { messages, connected } = useChatStream(url, {
    onSnapshot: (v) => setView(v as GuestView),
    onTyping,
    onHistory: (list) => {
      baseline.current = list.reduce((m, x) => Math.max(m, x.seq), -1);
      setFloor((prev) => floorAfter(prev, list));
      setReadyFor(pilotRef.current);
    },
    onLifecycle: (n) => {
      if (n.kind === "reset" || n.kind === "reload" || n.kind === "golive" || n.kind === "ended") setDead(n.kind);
    },
    onDead: () => setDead("closed"),
  });

  const lines = useMemo<Line[]>(
    () =>
      [...messages.values()]
        .filter((m) => m.channel === channel && !m.hidden)
        .sort((a, b) => a.seq - b.seq)
        .map((m) => ({ ...m, theirs: m.from === character })),
    [messages, channel, character],
  );

  const visitLines = useMemo(() => visitLinesOf(lines, floor), [lines, floor]);
  const pinFloor = useCallback(() => setFloor((prev) => floorAfter(prev, "pin")), []);

  // Announce each of the character's lines once, and only ones that land
  // after the backlog (a re-scan must not replay the whole conversation).
  useEffect(() => {
    for (const l of lines) {
      if (!l.theirs || l.kind !== "line" || l.seq <= baseline.current || announced.current.has(l.seq)) continue;
      announced.current.add(l.seq);
      for (const fn of listeners.current) fn(l);
    }
  }, [lines]);

  const say = useCallback(
    async (text: string) => {
      if (pilot === null) return;
      try {
        await api(`${base}/api/guest/say`, { channel, text }, pilot.token);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 404)) setDead("closed");
        throw e;
      }
    },
    [base, channel, pilot],
  );

  const onNewLine = useCallback((fn: (line: Line) => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  const online = useMemo(() => {
    const me = view?.people?.find((p) => p.kind === "character" && p.id === character);
    // A character with a `hold:` line always answers: no presence to show.
    if (me?.agent?.hold === true) return null;
    return me?.agent?.online ?? null;
  }, [view, character]);

  return { view, connected, ready, lines, visitLines, pinFloor, typing: typing.has(channel), online, say, onNewLine, dead };
}
