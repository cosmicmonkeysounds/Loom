//! The Desk window's 🎚 Mixer rules (wave 40, docs/loom-w40-contract.md C5),
//! pure so the tests can drive them: the poll's outcome, the view merge
//! (the mix never steps back to an older seq), the optimistic layer and the
//! per-fader throttle (one structure per key: the level this phone shows,
//! the change waiting to go, whether a post for it is out, the seq its last
//! answer carried), and the words the panel draws.
//!
//! The optimistic layer: a moved fader shows its own value until a view
//! arrives whose `mix.seq` is at least the seq of the post that carried it,
//! and nothing more is waiting or out for that key. The throttle: at most
//! one post per key every `MIX_SEND_MS` (≤ 10 a second), never two out at
//! once for one key (so they land in order), and the last value always
//! goes. Due changes of every key travel in one post (≤ `MIX_CHANGES_MAX`).

import {
  MIX_CHANGES_MAX,
  MIX_DB_MIN,
  applyMixChanges,
  clampMixDb,
  formatMixDb,
  levelOf,
  meterFill,
  scopeStrips,
  type AudioMix,
  type MixChange,
  type MixLevel,
  type MixScope,
  type MixerMusic,
  type MixerStrip,
  type MixerView,
  type MusicCommand,
} from "../../../core/src/house-mixer.ts";

/** The mixer GET's path (on the host read list). */
export const MIXER_PATH = "/api/mod/audio/mixer";
/** The panel polls this often while it is open and the page is visible (ms). */
export const MIXER_POLL_MS = 1_000;
/** A poll that hasn't answered in this long is given up (ms). */
export const MIXER_TIMEOUT_MS = 5_000;
/** One fader's posts are at least this far apart (ms): ≤ 10 a second. */
export const MIX_SEND_MS = 100;

export const NO_MIXER = "This server has no mixer yet";
export const NOT_A_MIXER = "Only hosts and directors can mix";
export const ROUTER_OFFLINE = "No router listening: the mix is kept and applies when it connects";
export const NO_SOUNDTRACK = "No soundtrack reported yet";
export const HAND_NOTE = "By hand — the story's music cues are held";

// -- the poll -------------------------------------------------------------------

export type MixerPoll = { kind: "view"; view: MixerView } | { kind: "error"; message: string };

/** What one mixer GET's answer means. */
export function mixerPollOutcome(status: number, body: unknown): MixerPoll {
  if (status === 404) return { kind: "error", message: NO_MIXER };
  if (status === 403) return { kind: "error", message: NOT_A_MIXER };
  const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (status >= 200 && status < 300) {
    const mix = b["mix"] as Record<string, unknown> | undefined;
    if (typeof mix === "object" && mix !== null && typeof mix["seq"] === "number" && Array.isArray(b["sources"]) && Array.isArray(b["rooms"])) {
      return { kind: "view", view: b as unknown as MixerView };
    }
    return { kind: "error", message: "The mixer's answer didn't make sense" };
  }
  return { kind: "error", message: typeof b["error"] === "string" ? b["error"] : `HTTP ${status}` };
}

/** A fresh view over the last one: everything new, but the mix is the
 *  newer of the two (a poll that left before a post landed must not step
 *  the faders back; the seq persists across a restart, so it never reruns). */
export function mergeMixerView(prev: MixerView | null, next: MixerView): MixerView {
  if (prev === null || next.mix.seq >= prev.mix.seq) return next;
  return { ...next, mix: prev.mix };
}

/** A post's answer's mix over the view (the newer seq wins). */
export function withAnsweredMix(view: MixerView | null, mix: AudioMix | null): MixerView | null {
  if (view === null || mix === null || mix.seq < view.mix.seq) return view;
  return { ...view, mix };
}

/** The `{ok, mix}` of a mix post, or null when it carries none. */
export function answeredMix(answer: unknown): AudioMix | null {
  if (typeof answer !== "object" || answer === null) return null;
  const mix = (answer as Record<string, unknown>)["mix"];
  if (typeof mix !== "object" || mix === null) return null;
  const m = mix as Record<string, unknown>;
  if (typeof m["seq"] !== "number" || typeof m["levels"] !== "object" || m["levels"] === null) return null;
  return { seq: m["seq"], levels: m["levels"] as AudioMix["levels"] };
}

// -- the optimistic layer and the throttle --------------------------------------

/** One key the panel has moved and the server has not yet shown back. */
export interface PendingKey {
  /** What this phone shows for the key. */
  level: MixLevel;
  /** The change waiting for the throttle (merged), or null. */
  queued: MixChange | null;
  /** A post carrying this key is out. */
  inFlight: boolean;
  /** When this key last went out (phone ms); −∞ before. */
  lastSent: number;
  /** The highest seq an answer for this key carried (null: none yet). */
  seq: number | null;
}

export type MixPending = Readonly<Record<string, PendingKey>>;

export const NO_PENDING: MixPending = {};

/** Two changes to one key as one: the later wins field by field; after a
 *  reset, an unset field is unity's (the reset has not gone yet). */
export function mergeChange(was: MixChange | null, next: MixChange): MixChange {
  if (was === null || next.reset === true) return next;
  if (was.reset === true) return { key: next.key, db: next.db ?? 0, mute: next.mute ?? false };
  const out: MixChange = { key: next.key };
  const db = next.db ?? was.db;
  const mute = next.mute ?? was.mute;
  if (db !== undefined) out.db = db;
  if (mute !== undefined) out.mute = mute;
  return out;
}

/** The levels the panel draws: the server's, with every pending key's own. */
export function layeredLevels(server: Readonly<Record<string, MixLevel>>, pending: MixPending): Record<string, MixLevel> {
  const keys = Object.keys(pending);
  if (keys.length === 0) return { ...server };
  return applyMixChanges(
    server,
    keys.map((key) => ({ key, db: pending[key]!.level.db, mute: pending[key]!.level.mute })),
  );
}

/** A change from this phone: shown at once, queued for the throttle. */
export function offerChange(pending: MixPending, server: Readonly<Record<string, MixLevel>>, change: MixChange): MixPending {
  const was = pending[change.key];
  const shown = was !== undefined ? was.level : levelOf(server, change.key);
  const level = change.reset === true ? { db: 0, mute: false } : { db: change.db !== undefined ? clampMixDb(change.db) : shown.db, mute: change.mute ?? shown.mute };
  const queued = mergeChange(was?.queued ?? null, change.db !== undefined ? { ...change, db: clampMixDb(change.db) } : change);
  return { ...pending, [change.key]: { level, queued, inFlight: was?.inFlight ?? false, lastSent: was?.lastSent ?? Number.NEGATIVE_INFINITY, seq: was?.seq ?? null } };
}

export interface DueChanges {
  pending: MixPending;
  /** What to post now (empty: nothing is due). */
  changes: MixChange[];
  /** When to look again for a change still waiting (phone ms), or null. */
  wakeAt: number | null;
}

/** The changes due now: queued, not out, last sent ≥ `gap` ago. They are
 *  marked out; the rest say when they are due. */
export function takeDue(pending: MixPending, now: number, gap = MIX_SEND_MS): DueChanges {
  const next: Record<string, PendingKey> = { ...pending };
  const changes: MixChange[] = [];
  let wakeAt: number | null = null;
  for (const [key, p] of Object.entries(pending)) {
    if (p.queued === null || p.inFlight) continue;
    const due = p.lastSent + gap;
    if (due <= now && changes.length < MIX_CHANGES_MAX) {
      changes.push(p.queued);
      next[key] = { ...p, queued: null, inFlight: true, lastSent: now };
    } else {
      const at = Math.max(due, now);
      wakeAt = wakeAt === null ? at : Math.min(wakeAt, at);
    }
  }
  return { pending: changes.length > 0 ? next : pending, changes, wakeAt };
}

/** A post for `keys` came back: with the mix's seq, or null when it failed
 *  (the key then lets go at the next view, unless more is waiting). */
export function answered(pending: MixPending, keys: readonly string[], seq: number | null): MixPending {
  const next: Record<string, PendingKey> = { ...pending };
  for (const key of keys) {
    const p = next[key];
    if (p === undefined) continue;
    next[key] = { ...p, inFlight: false, seq: seq === null ? p.seq : Math.max(p.seq ?? seq, seq) };
  }
  return next;
}

/** Let go of every key the server now shows: nothing waiting or out, and
 *  the view's seq has reached its answer's (a failed key, with no answer,
 *  lets go at once and the server's value shows again). */
export function releaseSeen(pending: MixPending, serverSeq: number): MixPending {
  let changed = false;
  const next: Record<string, PendingKey> = {};
  for (const [key, p] of Object.entries(pending)) {
    if (p.queued === null && !p.inFlight && (p.seq === null || p.seq <= serverSeq)) {
      changed = true;
      continue;
    }
    next[key] = p;
  }
  return changed ? next : pending;
}

/** Is anything still waiting to go or out? */
export function sending(pending: MixPending): boolean {
  return Object.values(pending).some((p) => p.queued !== null || p.inFlight);
}

// -- which post each control makes ----------------------------------------------

/** A fader moved to `db`. */
export function faderChange(key: string, db: number): MixChange {
  return { key, db: clampMixDb(db) };
}

/** The mute button: the other way from what the strip shows. */
export function muteChange(key: string, level: MixLevel): MixChange {
  return { key, mute: !level.mute };
}

/** A scope's Reset: every strip key of the scope that holds a level, on
 *  the server or on this phone (`levels`, the layered copy). */
export function resetChanges(view: MixerView, scope: MixScope, levels: Readonly<Record<string, MixLevel>>): MixChange[] {
  return scopeStrips(view, scope, levels)
    .map((s) => s.key)
    .filter((k): k is string => k !== null && (levels[k] !== undefined || view.mix.levels[k] !== undefined))
    .map((key) => ({ key, reset: true as const }));
}

/** The music buttons' bodies. */
export const musicCalls = {
  scene: (scene: string): MusicCommand => ({ action: "scene", scene }),
  next: (playlist?: string): MusicCommand => (playlist !== undefined ? { action: "next", playlist } : { action: "next" }),
  stop: (): MusicCommand => ({ action: "stop" }),
  story: (): MusicCommand => ({ action: "story" }),
};

/** The line after a music post (`{ok, seq, router}`). */
export function musicDone(cmd: MusicCommand, answer: unknown): string {
  const router = typeof answer === "object" && answer !== null ? (answer as Record<string, unknown>)["router"] : undefined;
  const what = cmd.action === "scene" ? `▶ Scene ${cmd.scene}` : cmd.action === "next" ? (cmd.playlist !== undefined ? `⏭ Skipped ${cmd.playlist}` : "⏭ Skipped every bed") : cmd.action === "stop" ? "■ Music stopped" : "↺ Following the story";
  // The server answers the router's presence (`{online, lastSeen, name}`); a bare false is accepted too.
  const offline = router === false || (typeof router === "object" && router !== null && (router as Record<string, unknown>)["online"] === false);
  return offline ? `${what} — sent, but no router is listening (it waits a minute)` : what;
}

// -- what the panel draws -------------------------------------------------------

/** `m:ss` for a track position. */
export function trackClock(s: number): string {
  const t = Math.max(0, Math.floor(Number.isFinite(s) ? s : 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export interface BedRow {
  playlist: string;
  track: string;
  /** 0..1, null when the length is unknown. */
  progress: number | null;
  time: string;
}

export interface NowPlaying {
  scene: string | null;
  /** The scene picker's options (the scene in force first if it is not listed). */
  scenes: string[];
  hand: boolean;
  beds: BedRow[];
  warnings: string[];
}

/** Now playing, or null before the router reports a soundtrack. */
export function nowPlaying(music: MixerMusic | null): NowPlaying | null {
  if (music === null) return null;
  const scenes = [...(music.scenes ?? [])];
  if (music.scene !== null && !scenes.includes(music.scene)) scenes.unshift(music.scene);
  const beds = music.beds.map((b) => {
    const dur = typeof b.durS === "number" && b.durS > 0 ? b.durS : null;
    return {
      playlist: b.playlist,
      track: b.track ?? "—",
      progress: dur !== null ? Math.min(1, Math.max(0, b.posS / dur)) : null,
      time: dur !== null ? `${trackClock(b.posS)} / ${trackClock(dur)}` : trackClock(b.posS),
    };
  });
  return { scene: music.scene, scenes, hand: music.hand === true, beds, warnings: music.missing.map((p) => `${p}: no tracks found`) };
}

/** The router banner, or null while it listens. */
export function routerBanner(view: Pick<MixerView, "router">): string | null {
  return view.router.online ? null : ROUTER_OFFLINE;
}

export interface StripRow {
  key: string | null;
  label: string;
  /** A fader and a mute (false: a meter strip, with its note). */
  fader: boolean;
  db: number;
  dbText: string;
  muted: boolean;
  /** "plays at X dB" / "silent", or null when it plays at its own level. */
  hint: string | null;
  /** 0..1, the meter's fill. */
  fill: number;
  /** A meter with nothing to read (no live meters). */
  dark: boolean;
  note: string | null;
  kind: MixerStrip["kind"];
}

/** A strip as a row. */
export function stripRow(s: MixerStrip): StripRow {
  const own = s.level;
  const silentHere = own.mute || own.db <= MIX_DB_MIN;
  let hint: string | null = null;
  if (s.kind !== "meter") {
    if (s.effective === null) hint = silentHere ? null : "silent";
    else if (s.effective !== own.db) hint = `plays at ${formatMixDb(s.effective)} dB`;
  }
  return {
    key: s.key,
    label: s.label,
    fader: s.kind !== "meter" && s.key !== null,
    db: own.db,
    dbText: `${formatMixDb(own.db)} dB`,
    muted: own.mute,
    hint,
    fill: meterFill(s.meterDb),
    dark: s.meterDb === null,
    note: s.note ?? null,
    kind: s.kind,
  };
}

/** The scope a picker shows: the one picked while it exists, else Everywhere. */
export function pickedScope<T extends { scope: MixScope; id: string }>(scopes: readonly T[], id: string): T {
  const found = scopes.find((s) => s.id === id) ?? scopes[0];
  if (found === undefined) throw new Error("mixerScopes always lists Everywhere");
  return found;
}

/** How many levels a scope's strips hold away from unity (Reset's count). */
export function movedCount(view: MixerView, scope: MixScope, levels: Readonly<Record<string, MixLevel>>): number {
  return resetChanges(view, scope, levels).filter((c) => levels[c.key] !== undefined).length;
}
