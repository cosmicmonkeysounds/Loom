//! The chess board speaks for the story with the terminal's moderator token:
//! a game's end is `POST /api/mod/signal {name: "chess won" | "chess lost" |
//! "chess drawn", subject: <guest id>, label: "Terminal · <name>"}` (C4,
//! the label journaled as `by`). A win (any time before truth.txt or an
//! ending) hands the winner the server-room door code, so it must land — and
//! land while the guest is
//! still at the door: a network failure or a 5xx is retried (0.5 → 8 s), each
//! attempt is cut after 5 s, a 4xx is final, and the send is kept in
//! `localStorage` while it is in flight so a reload mid-retry posts it from
//! `flushPendingChess` — never once it is `PENDING_MAX_AGE_MS` (60 s) old (a
//! host fires ♟ by hand instead, and a late post would count the win twice).
//! The same pattern as the old tent tablet's `postSignal` (reinstall/web).
//! A 200 can still say the story turned the result down (`{refused: true}`:
//! it only told `# hosts`, e.g. a win after truth.txt) — that is `declined`,
//! and the board must not promise a door code for it.
//!
//! Also here: who a scanned pass is (`fetchChallenger`, the guest's own
//! view through the moderator lens: name + restricted).

import { baseOf, type TerminalConfig } from "../config.ts";

export type ChessResult = "won" | "lost" | "drawn";
export type ChessSignal = "chess won" | "chess lost" | "chess drawn";

export const SIGNAL_OF: Record<ChessResult, ChessSignal> = { won: "chess won", lost: "chess lost", drawn: "chess drawn" };

/** Retry waits: 0.5 s doubling to 8 s. */
export const RETRY_MS = [500, 1000, 2000, 4000, 8000] as const;
/** Where the terminal keeps its one pending result (the latest only). */
export const PENDING_KEY = "loom.terminal.pending-chess";
/** A pending result this old is dropped, never posted. */
export const PENDING_MAX_AGE_MS = 60_000;
/** One attempt is abandoned after this long. */
export const ATTEMPT_TIMEOUT_MS = 5_000;

type Poster = Pick<TerminalConfig, "eventId" | "token" | "name">;

/** The label every result is journaled `by` (the server keeps ≤ 60 chars). */
export function chessLabel(c: Pick<TerminalConfig, "name">): string {
  return `Terminal · ${c.name}`.slice(0, 60);
}

/** A result on its way to the event. */
export interface PendingChess {
  eventId: string;
  name: ChessSignal;
  subject: string;
  label: string;
  /** When the terminal first tried it (ms since the epoch). */
  at: number;
}

export type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface PostOptions {
  attempts?: number;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to `localStorage`; null keeps it in memory only. */
  storage?: PendingStorage | null;
  now?: () => number;
  timeoutMs?: number;
}

function pageStorage(): PendingStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const SIGNALS: readonly string[] = ["chess won", "chess lost", "chess drawn"];

/** The stored pending result, or null (none, unreadable, or not one). */
export function readPending(storage: PendingStorage | null = pageStorage()): PendingChess | null {
  try {
    const raw = storage?.getItem(PENDING_KEY);
    if (raw === null || raw === undefined) return null;
    const p = JSON.parse(raw) as Partial<PendingChess>;
    const str = (v: unknown): v is string => typeof v === "string" && v !== "";
    return str(p.eventId) && str(p.name) && SIGNALS.includes(p.name) && str(p.subject) && str(p.label) && typeof p.at === "number" && Number.isFinite(p.at)
      ? { eventId: p.eventId, name: p.name as ChessSignal, subject: p.subject, label: p.label, at: p.at }
      : null;
  } catch {
    return null;
  }
}

function writePending(storage: PendingStorage | null, p: PendingChess): void {
  try {
    storage?.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* blocked or full: in memory only */
  }
}

/** Forget the stored result — only while it is still `p` (a newer one wins); `p` null: whatever is there. */
function clearPending(storage: PendingStorage | null, p: PendingChess | null): void {
  try {
    if (p !== null) {
      const cur = readPending(storage);
      if (cur !== null && (cur.at !== p.at || cur.name !== p.name || cur.subject !== p.subject)) return;
    }
    storage?.removeItem(PENDING_KEY);
  } catch {
    /* nothing stored */
  }
}

/** How a result fared: the story took it (`sent`), the server took it but
 *  the story turned it down (`declined`: a 200 with `refused: true`), or it
 *  never landed (`failed`: every attempt failed, a 4xx, or too old). */
export type ChessPost = "sent" | "declined" | "failed";

/** The retry loop: "ok" on a 200, "declined" on a 200 the story turned down,
 *  "refused" on a 4xx (final), "failed" when every attempt failed or the
 *  result grew too old to send. */
async function send(config: Poster, p: PendingChess, o: PostOptions): Promise<"ok" | "declined" | "refused" | "failed"> {
  const attempts = Math.max(1, o.attempts ?? 1 + RETRY_MS.length);
  const fetcher = o.fetcher ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const body = JSON.stringify({ name: p.name, subject: p.subject, label: p.label });
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(RETRY_MS[Math.min(i - 1, RETRY_MS.length - 1)]!);
    const left = PENDING_MAX_AGE_MS - (now() - p.at);
    if (left <= 0) return "failed";
    // A stalled request is aborted: one that hung past the cap could still
    // land minutes after the win.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.min(o.timeoutMs ?? ATTEMPT_TIMEOUT_MS, left));
    try {
      const res = await fetcher(`${baseOf(config)}/api/mod/signal`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-loom-token": config.token },
        body,
        signal: ctl.signal,
      });
      if (res.ok) {
        const answer = (await res.json().catch(() => null)) as { refused?: unknown } | null;
        return answer !== null && typeof answer === "object" && answer.refused === true ? "declined" : "ok";
      }
      if (res.status < 500) return "refused";
    } catch {
      /* the network (or the timeout): try again */
    } finally {
      clearTimeout(timer);
    }
  }
  return "failed";
}

/**
 * Tell the story how a game ended (`ChessPost`). Kept in storage while in
 * flight; forgotten once it lands, is refused, or fails for good (the board
 * then says to get a host).
 */
export async function postChess(config: Poster, result: ChessResult, subject: string, o: PostOptions = {}): Promise<ChessPost> {
  const storage = o.storage === undefined ? pageStorage() : o.storage;
  const p: PendingChess = { eventId: config.eventId, name: SIGNAL_OF[result], subject, label: chessLabel(config), at: (o.now ?? Date.now)() };
  writePending(storage, p);
  const r = await send(config, p, o);
  clearPending(storage, p);
  return r === "ok" ? "sent" : r === "declined" ? "declined" : "failed";
}

/** On boot: post the result a previous page left unsent — once, while fresh
 *  and for this terminal's event; anything else is dropped unsent. */
export async function flushPendingChess(config: Poster, o: PostOptions = {}): Promise<"none" | "dropped" | "sent" | "declined" | "refused" | "failed"> {
  const storage = o.storage === undefined ? pageStorage() : o.storage;
  const p = readPending(storage);
  if (p === null) {
    clearPending(storage, null); // an unreadable entry
    return "none";
  }
  const age = (o.now ?? Date.now)() - p.at;
  if (p.eventId !== config.eventId || age < 0 || age >= PENDING_MAX_AGE_MS) {
    clearPending(storage, p);
    return "dropped";
  }
  const r = await send(config, p, o);
  // A failure stays stored until it ages out (the next boot drops it).
  if (r !== "failed") clearPending(storage, p);
  return r === "ok" ? "sent" : r;
}

/** Who scanned their pass: the guest's own name, and whether the story has
 *  them restricted (a marked program can't challenge the King, D5). */
export interface Challenger {
  id: string;
  name: string;
  restricted: boolean;
}

/** Why a pass can't challenge: no such guest, no story running, the
 *  terminal's access, anything else (the message). */
export class ChallengerError extends Error {
  constructor(
    message: string,
    readonly kind: "unknown" | "closed" | "access" | "other",
  ) {
    super(message);
  }
}

/** How long the lookup may take (ms). */
export const CHALLENGER_LOOKUP_MS = 6_000;

/**
 * Resolve a scanned pass: `GET /api/state?role=guest&as=<id>` with the
 * moderator token (the editor's exact lens — the guest's own `GuestView`).
 * 404 → no such guest; 401 / 403 → this terminal lost its access; 409 → no
 * story running.
 */
export async function fetchChallenger(config: Poster, id: string, o: { fetcher?: typeof fetch; timeoutMs?: number } = {}): Promise<Challenger> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? CHALLENGER_LOOKUP_MS);
  let res: Response;
  try {
    res = await (o.fetcher ?? fetch)(`${baseOf(config)}/api/state?role=guest&as=${encodeURIComponent(id)}`, { headers: { "x-loom-token": config.token }, signal: ctl.signal, cache: "no-store" });
  } catch {
    throw new ChallengerError("the house didn't answer", "other");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) throw new ChallengerError("unknown guest", "unknown");
  if (res.status === 401 || res.status === 403) throw new ChallengerError("moderators only", "access");
  if (res.status === 409) throw new ChallengerError("the doors are closed", "closed");
  if (!res.ok) throw new ChallengerError(`HTTP ${res.status}`, "other");
  const v = (await res.json().catch(() => null)) as { id?: unknown; name?: unknown; restricted?: unknown } | null;
  if (v === null || typeof v.name !== "string") throw new ChallengerError("a view this terminal can't read", "other");
  return { id: typeof v.id === "string" && v.id !== "" ? v.id : id, name: v.name, restricted: v.restricted === true };
}
