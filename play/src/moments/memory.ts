//! The moments engine's memory (wave 13, the moments lane): what a
//! provider keeps across a remount of the same sign-in — the guest app swaps
//! its cutscene and main roots, each with its own `MomentsProvider`, and the
//! queue, the processed seqs, the beats and the screen times must survive
//! that — plus the two per-sign-in lists it persists in the host's storage:
//! the loud objectives already announced and the seqs settled above the mark.

import type { SessionStorage } from "../host.ts";
import type { ObjectiveView } from "../types.ts";
import { EMPTY_MOMENTS, loudObjectives, type Moment, type MomentsState } from "./model.ts";

type Role = "guest" | "booth";

/** What the engine keeps across a remount of the same sign-in. */
export interface EngineMemory {
  state: MomentsState;
  /** The sign-in and story epoch it belongs to (`undefined` = not started). */
  session: string | null | undefined;
  epoch: number | undefined;
  processed: Set<number>;
  processedMax: number;
  /** Each beat's last line (story clock), for the blue screen. */
  beats: Map<string, number>;
  lastHoldEnd: number;
  /** The history count last processed: a new one means the messages are a reconnect's backlog. */
  historiesSeen: number;
  /** When each moment on screen first showed (wall clock): a glance < 1 s is missed. */
  shownAt: Map<string, number>;
  /** The done list last persisted (`doneAbove`). */
  savedDone: string;
  /** Readouts waiting out `READOUT_WAIT_MS`. */
  pending: Set<number>;
  /** Moments dispatched to the queue but not yet in a rendered state: never settled past. */
  inflight: Set<number>;
  /** Wave 18: what this sign-in remembers (acked bigs, seen, deleted rows, the read mark). */
  signIn: SignInMemory;
  /** Wave 18: client-made moments that reached the queue (a loud objective, a beat's blue screen) — Notifications rows too. */
  extras: Moment[];
  /** Wave 18: the blue screen that carries the boilerplate (the sign-in's first). */
  firstBsod: string | null;
  /** Wave 18 fix (GN-F7 / NM-F3): the sign-in whose first backlog was swept
   *  for its unacknowledged big moments (once per page load). */
  swept?: string;
  /** Wave 18 recheck (N3): when the NOW objective on screen began (story
   *  clock), as far as this sign-in knows; a house banner older than it is
   *  not news on a load or a wake. Null = unknown (a brand-new phone). */
  nowSince?: number | null;
}

/** The memories by role + sign-in, newest last (a test seam too). Several
 *  sign-ins live at once in Run → Players (one embedded app per person). */
export const MOMENTS_MEMORY = new Map<string, EngineMemory>();
/** How many sign-ins' memories a page keeps. */
export const MEMORY_MAX = 16;

export function memoryKey(role: Role, session: string): string {
  return `${role}\u0000${session}`;
}

export function freshMemory(): EngineMemory {
  return {
    state: EMPTY_MOMENTS,
    session: undefined,
    epoch: undefined,
    processed: new Set(),
    processedMax: -1,
    beats: new Map(),
    lastHoldEnd: Number.NEGATIVE_INFINITY,
    historiesSeen: 0,
    shownAt: new Map(),
    savedDone: "",
    pending: new Set(),
    inflight: new Set(),
    signIn: emptySignIn(),
    extras: [],
    firstBsod: null,
  };
}

/** The memory a provider mounting for this sign-in starts from: the last one's, when it was the same sign-in. */
export function recallMoments(role: Role, session: string | null): EngineMemory {
  const kept = session !== null ? MOMENTS_MEMORY.get(memoryKey(role, session)) : undefined;
  return kept !== undefined && kept.session === session ? kept : freshMemory();
}

/** Keep `mem` for this sign-in (signed out → nothing kept). */
export function rememberMoments(role: Role, session: string | null, mem: EngineMemory): void {
  if (session === null) return;
  const key = memoryKey(role, session);
  MOMENTS_MEMORY.delete(key);
  MOMENTS_MEMORY.set(key, mem);
  while (MOMENTS_MEMORY.size > MEMORY_MAX) MOMENTS_MEMORY.delete(MOMENTS_MEMORY.keys().next().value!);
}

export function loudKey(role: Role): string {
  return `loom.moments.loud.${role}`;
}

/** Where the seqs settled above the mark persist (`doneAbove`). */
export function doneKey(role: Role): string {
  return `loom.moments.done.${role}`;
}

/** The loud objectives that just went live and were never announced to this sign-in; marks them announced. */
export function announceLoud(storage: SessionStorage, role: Role, session: string, objectives: readonly ObjectiveView[], at: number, phase: string | null): Moment[] {
  const stored = storage.load<{ session: string; ids: string[] }>(loudKey(role));
  const ids = stored !== null && stored.session === session && Array.isArray(stored.ids) ? stored.ids : [];
  const fresh = loudObjectives(objectives, new Set(ids), at, phase);
  if (fresh.length === 0) return fresh;
  try {
    storage.save(loudKey(role), { session, ids: [...ids, ...fresh.map((m) => m.key.slice(2))] });
  } catch {
    /* storage blocked — at worst it announces again after a reload */
  }
  return fresh;
}

/** A sign-in picks up the seqs it had settled above its mark (a reload). */
export function loadDone(storage: SessionStorage, role: Role, session: string, mark: number, mem: EngineMemory): void {
  const stored = storage.load<{ session: string; seqs: number[] }>(doneKey(role));
  if (stored === null || stored.session !== session || !Array.isArray(stored.seqs)) return;
  for (const seq of stored.seqs) if (typeof seq === "number" && seq > mark) mem.processed.add(seq);
  mem.savedDone = stored.seqs.join(",");
}

export function saveDoneList(storage: SessionStorage, role: Role, session: string, seqs: number[]): void {
  try {
    storage.save(doneKey(role), { session, seqs });
  } catch {
    /* storage blocked — at worst a reload replays a read moment */
  }
}

// --- wave 18: what a sign-in remembers about its big moments and its Notifications

/** How many keys a per-sign-in list keeps (the newest). */
export const KEYS_MAX = 400;

/** Where the acknowledged big moments persist (a reload never replays one). */
export function ackedKey(session: string): string {
  return `loom.moments.acked.${session}`;
}
/** Where "the first blue screen of this sign-in has shown" persists. */
export function bsodKey(session: string): string {
  return `loom.moments.bsod.${session}`;
}
/** Where the deleted Notifications rows persist (GUEST-SPEC §4.1). */
export function deletedKey(session: string): string {
  return `loom.notif.deleted.${session}`;
}
/** Where the moments seen on screen (≥ 1 s, or acted on) persist: read in Notifications. */
export function seenKey(session: string): string {
  return `loom.notif.seen.${session}`;
}
/** Where the seq the Notifications window was last read up to persists. */
export function readMarkKey(session: string): string {
  return `loom.notif.read.${session}`;
}

/** Where the NOW objective this sign-in last saw persists (N3). */
export function nowKey(session: string): string {
  return `loom.moments.now.${session}`;
}

/** The NOW objective last seen: its id, when it began (null = before this
 *  phone first looked), and the story time the phone last looked. */
export interface NowRecord {
  id: string | null;
  since: number | null;
  seen: number;
}

export function loadNow(storage: SessionStorage, session: string): NowRecord | null {
  try {
    const v = storage.load<unknown>(nowKey(session));
    if (v === null || typeof v !== "object") return null;
    const r = v as Record<string, unknown>;
    if (typeof r["seen"] !== "number" || !(typeof r["id"] === "string" || r["id"] === null) || !(typeof r["since"] === "number" || r["since"] === null)) return null;
    return { id: r["id"] as string | null, since: r["since"] as number | null, seen: r["seen"] };
  } catch {
    return null;
  }
}

export function saveNow(storage: SessionStorage, session: string, r: NowRecord): void {
  try {
    storage.save(nowKey(session), r);
  } catch {
    /* storage blocked — at worst an old house banner shows once */
  }
}

/**
 * When the NOW objective `id` began, on a page load: the stored start when
 * it is the one this phone last saw; when it has changed since, the last
 * time the phone looked (it changed after that); unknown on a new phone.
 */
export function nowSinceOnLoad(stored: NowRecord | null, id: string | null): number | null {
  if (stored === null) return null;
  return stored.id === id ? stored.since : stored.seen;
}

/** A per-sign-in key list (empty when blocked or absent). */
export function loadKeys(storage: SessionStorage, key: string): string[] {
  try {
    const v = storage.load<unknown>(key);
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

/** Save a key list, the newest `KEYS_MAX`. */
export function saveKeys(storage: SessionStorage, key: string, keys: Iterable<string>): void {
  const list = [...keys];
  try {
    storage.save(key, list.length > KEYS_MAX ? list.slice(-KEYS_MAX) : list);
  } catch {
    /* storage blocked — at worst a reload asks again */
  }
}

/** A per-sign-in number (null when blocked or absent). */
export function loadNumber(storage: SessionStorage, key: string): number | null {
  try {
    const v = storage.load<unknown>(key);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveNumber(storage: SessionStorage, key: string, n: number): void {
  try {
    storage.save(key, n);
  } catch {
    /* storage blocked */
  }
}

/** What a sign-in remembers for wave 18 (loaded once per sign-in). */
export interface SignInMemory {
  acked: Set<string>;
  /** The first blue screen of this sign-in has shown (later ones skip the boilerplate). */
  bsodShown: boolean;
  deleted: Set<string>;
  seen: Set<string>;
  /** Notifications read up to this seq (the window was open and closed). */
  readMark: number;
  /** Wave 37 (C20): no read mark was stored (a new sign-in): `seedReadMark`
   *  sets it under the first backlog. */
  unmarked?: true;
}

export function loadSignIn(storage: SessionStorage, session: string): SignInMemory {
  const mark = loadNumber(storage, readMarkKey(session));
  return {
    acked: new Set(loadKeys(storage, ackedKey(session))),
    bsodShown: loadNumber(storage, bsodKey(session)) === 1,
    deleted: new Set(loadKeys(storage, deletedKey(session))),
    seen: new Set(loadKeys(storage, seenKey(session))),
    readMark: mark ?? -1,
    ...(mark === null ? { unmarked: true as const } : {}),
  };
}

/**
 * Wave 37 (C20): a late arrival's bin starts quiet. A sign-in with no read
 * mark, once its first backlog is in, has read every row from before it
 * existed: the mark moves to the newest seq there (the rows stay listed).
 * True when the mark moved (save it).
 */
export function seedReadMark(sign: SignInMemory, messages: Iterable<{ seq: number }>): boolean {
  if (sign.unmarked !== true) return false;
  delete sign.unmarked;
  let max = -1;
  for (const m of messages) if (Number.isInteger(m.seq) && m.seq > max) max = m.seq;
  if (max <= sign.readMark) return false;
  sign.readMark = max;
  return true;
}

export function emptySignIn(): SignInMemory {
  return { acked: new Set(), bsodShown: false, deleted: new Set(), seen: new Set(), readMark: -1 };
}
