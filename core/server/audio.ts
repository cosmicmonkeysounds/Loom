//! The house speakers' config (wave 17): the server half of `audio.json`.
//!
//! `@loom/house` (`house/src/audio.ts`) owns the schema, `validateAudio` and
//! `resolveTargets`; this module holds the config an event plays and its
//! routes. The file belongs to the project like the house maps do, but it
//! is its own file: a speaker edit or a re-patch mid-show never bumps the
//! map version, and both map variants share it. What is in force:
//!
//! 1. a director's save (`POST /api/mod/audio`, the map editor) — kept in
//!    the event's state dir, it wins until a Save to project replaces it;
//! 2. the project's `audio.json`, snapshotted at launch / reload beside the
//!    maps (the event row's `house_maps` record, key `audio.json`);
//! 3. `LOOM_AUDIO` — the LAN fallback file (re-read on mtime, last good kept);
//! 4. `defaultAudio()` (a 16 / 16 interface, nothing placed).
//!
//! Routes (a mod token or the author's session):
//! - `GET /api/mod/audio[?after=<version>&tests=<seq>&wait=<s>]` →
//!   `{audio, version, source, sounds, locations, tests, problems, warnings}`;
//!   with `after` it is a long poll (stagehand's router): it answers at once
//!   when the version moved on or a test newer than `tests` is pending, else
//!   after the first change or `wait` seconds (default 25, at most 30);
//! - `POST /api/mod/audio {audio, base?}` → the director's save (400
//!   `problems`, 409 on a stale `base`);
//! - `POST /api/mod/audio/project` → the config in force becomes the
//!   project's `audio.json`;
//! - `POST /api/mod/audio/announce {spot, on, base?}` → `{ok, version,
//!   terminals}` (wave 18b, Q8): puts one map terminal spot on (or off) the
//!   house list of tablets that also say the announcements, **without**
//!   pinning the rest of the config as a director's save: the list is laid
//!   over whatever is in force (the project's `audio.json`, a director's
//!   save, …) and kept in the event's state dir (`announceSaved` on the
//!   GET) until a Save to project writes it into the file or a whole save
//!   replaces it (409 on a stale `base`, 404 for a spot the map in force
//!   doesn't have when turning it on);
//! - `POST /api/mod/audio/test {speaker} | {out}` → `{ok, seq}`: the router
//!   plays an identifying tone + label there (the last `AUDIO_TESTS`, memory
//!   only, `AUDIO_TEST_MS` old at most, ride every GET);
//! - `POST /api/mod/audio/stop {announce?}` → `{ok, seq, router}` (wave 18b,
//!   Q7): "stop all house sounds" — the router fades out every sfx voice and
//!   speaker test (with `announce`, the announcement too, and empties its
//!   queue). One-shot, memory only, never journaled; the last `AUDIO_STOPS`
//!   ride every GET as `stops` with the server's `now`, and a long poll
//!   given `stops=<seq>` wakes on a newer one. A host's booth may stop them
//!   too (the host allowlist).
//! - `POST /api/mod/audio/play {sound, to?, gain?} | {say, to?, chime?}` →
//!   `{ok, seq, router}` (wave 25, the house desk): play one sound file, or
//!   say one house announcement, now. One-shot, memory only, never
//!   journaled; the last `AUDIO_PLAYS` (≤ `AUDIO_PLAY_MS` old) ride every GET
//!   as `plays`, and a long poll given `plays=<seq>` wakes on a newer one.
//!   Hosts may (the host allowlist), like `/api/mod/audio/test`.
//! - `POST /api/mod/audio/report {health?, acks?}` → `{ok}` (wave 25): the
//!   router's answers (each play's / test's result and length) and its
//!   health. Memory only; the house desk reads both (`AudioHub.onAck`,
//!   `health()`). An older router never posts it.
//!
//! Transport-light: `AudioHub` takes an injected clock and store; the
//! handlers take the runtime's context.

import { readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

import { AUDIO_FILE, audioHash, defaultAudio, validateAudio, type AudioConfig, type HouseMap } from "@loom/house";

import type { SimModel } from "../src/runtime/sim/model.ts";
import { queryTokenOf, sendJson } from "./http-util.ts";
import type { Store } from "./store.ts";

export { AUDIO_FILE } from "@loom/house";

/** Where the config in force comes from. */
export type AudioSource = "director" | "project" | "env" | "default";

/** One speaker / output test: the router plays a tone + its label there. */
export interface AudioTest {
  seq: number;
  /** Server epoch ms. */
  at: number;
  speaker: string | null;
  out: number | null;
}

/** (wave 18b, Q7) A director's "stop all house sounds": the router fades
 *  out every sfx voice and speaker test (0.3 s); with `announce` it also
 *  cuts the announcement playing and empties its queue. One-shot, memory
 *  only, never journaled (no story effect). */
export interface AudioStop {
  seq: number;
  /** Server epoch ms. */
  at: number;
  /** Who stopped them (a director's name, a host's character). */
  by: string;
  announce: boolean;
}

/** `POST /api/mod/audio/stop` body. */
export interface AudioStopRequest {
  announce?: boolean;
}

/** `POST /api/mod/audio/stop` answer: the stop's seq and whether a router
 *  is listening to play it (else "no router listening"). */
export interface AudioStopAnswer {
  ok: true;
  seq: number;
  router: AudioRouterPresence;
}

/** (wave 25) One house-desk play: a sound file, or a house announcement
 *  in the router's voice — exactly one of `sound` / `say`. `to` null = as
 *  the story routes it (`cues[sound].to`, else everywhere; a say:
 *  `announce.to`). One-shot, memory only, never journaled. */
export interface AudioPlay {
  seq: number;
  /** Server epoch ms. */
  at: number;
  by: string;
  sound?: string;
  say?: string;
  to: string[] | null;
  /** dB added to each speaker's gain (a sound only), or null. */
  gain: number | null;
  /** A say only: ring the chime first (default true). */
  chime?: boolean;
}

/** `POST /api/mod/audio/play` body, checked (`audioPlayOf`). */
export type AudioPlayRequest = { sound: string; to?: string[]; gain?: number } | { say: string; to?: string[]; chime?: boolean };

/** How many plays ride a GET, and for how long (§4: the last 16, ≤ 60 s). */
export const AUDIO_PLAYS = 16;
export const AUDIO_PLAY_MS = 60_000;
/** A sound name, as `sound X` writes it (`house-desk.ts` `DESK_SOUND_RE`). */
export const AUDIO_SOUND_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;
/** The longest house announcement a play may say (`DESK_SAY_MAX`). */
export const AUDIO_SAY_MAX = 280;
/** At most this many `to` names on a play, each at most `AUDIO_NAME_MAX` long. */
export const AUDIO_TO_MAX = 32;
export const AUDIO_NAME_MAX = 64;

/** What the router says about one play or test (`/api/mod/audio/report`). */
export const AUDIO_ACK_RESULTS = ["played", "closed", "nowhere", "no-file", "error"] as const;
export type AudioAckResult = (typeof AUDIO_ACK_RESULTS)[number];
export interface AudioAck {
  seq: number;
  kind: "play" | "test";
  result: AudioAckResult;
  /** The sound's / the rendered speech's length (ms), when known. */
  ms?: number;
}
/** At most this many acks in one report. */
export const AUDIO_ACKS_MAX = 64;

/** The router's last health report (§4), as the server keeps it. */
export interface AudioHealth {
  /** Server epoch ms it arrived. */
  at: number;
  ok: boolean;
  device: string | null;
  layout: "ok" | "moved" | null;
  voices: number;
  xruns: number;
  peakDb: number | null;
  announce: "on" | "off" | "blocked" | null;
  missing: string[];
  placeholders: string[];
  /** Each sound file the router has, by name → its length (ms). */
  sounds: Record<string, number>;
}
/** At most this many sounds in a health report's `sounds`. */
export const AUDIO_HEALTH_SOUNDS_MAX = 1000;

/** A play request off an untrusted body, or the 400's error text. */
export function audioPlayOf(body: Record<string, unknown>): AudioPlayRequest | string {
  const hasSound = body["sound"] !== undefined;
  const hasSay = body["say"] !== undefined;
  if (hasSound === hasSay) return "play exactly one of sound or say";
  const to = body["to"];
  let names: string[] | undefined;
  if (to !== undefined) {
    if (!Array.isArray(to) || to.length === 0 || to.length > AUDIO_TO_MAX || to.some((t) => typeof t !== "string" || t.trim() === "" || t.length > AUDIO_NAME_MAX)) return `to must be a list of 1 to ${AUDIO_TO_MAX} speaker, zone or room names`;
    names = (to as string[]).map((t) => t.trim());
  }
  if (hasSound) {
    const sound = body["sound"];
    if (typeof sound !== "string" || !AUDIO_SOUND_RE.test(sound) || sound.length > AUDIO_NAME_MAX) return "sound must be a sound name";
    if (body["chime"] !== undefined) return "chime is for a say";
    const gain = body["gain"];
    if (gain !== undefined && (typeof gain !== "number" || !Number.isFinite(gain) || gain < AUDIO_GAIN_MIN_DB || gain > AUDIO_GAIN_MAX_DB)) return `gain must be ${AUDIO_GAIN_MIN_DB} to ${AUDIO_GAIN_MAX_DB} dB`;
    return { sound, ...(names !== undefined ? { to: names } : {}), ...(typeof gain === "number" ? { gain } : {}) };
  }
  const say = body["say"];
  if (typeof say !== "string" || say.trim() === "") return "say must be what to say";
  if (say.length > AUDIO_SAY_MAX) return `say is at most ${AUDIO_SAY_MAX} characters`;
  if (body["gain"] !== undefined) return "gain is for a sound";
  const chime = body["chime"];
  if (chime !== undefined && typeof chime !== "boolean") return "chime must be true or false";
  return { say: say.trim(), ...(names !== undefined ? { to: names } : {}), ...(typeof chime === "boolean" ? { chime } : {}) };
}

const AUDIO_GAIN_MIN_DB = -60;
const AUDIO_GAIN_MAX_DB = 12;

/** One ack off untrusted JSON, or null. */
export function audioAckOf(raw: unknown): AudioAck | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  const seq = a["seq"];
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) return null;
  if (a["kind"] !== "play" && a["kind"] !== "test") return null;
  if (!(AUDIO_ACK_RESULTS as readonly unknown[]).includes(a["result"])) return null;
  const ms = a["ms"];
  if (ms !== undefined && ms !== null && (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0 || ms > 24 * 3_600_000)) return null;
  return { seq, kind: a["kind"], result: a["result"] as AudioAckResult, ...(typeof ms === "number" ? { ms: Math.round(ms) } : {}) };
}

/** A health report off untrusted JSON (stamped `at`), or null. Long lists are cut. */
export function audioHealthOf(raw: unknown, at: number): AudioHealth | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const h = raw as Record<string, unknown>;
  if (typeof h["ok"] !== "boolean") return null;
  const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "").slice(0, AUDIO_HEALTH_SOUNDS_MAX).map((x) => x.slice(0, AUDIO_NAME_MAX)) : []);
  const sounds: Record<string, number> = {};
  const rawSounds = h["sounds"];
  if (typeof rawSounds === "object" && rawSounds !== null && !Array.isArray(rawSounds)) {
    for (const [k, v] of Object.entries(rawSounds as Record<string, unknown>).slice(0, AUDIO_HEALTH_SOUNDS_MAX)) if (typeof v === "number" && Number.isFinite(v) && v >= 0) sounds[k.slice(0, AUDIO_NAME_MAX)] = Math.round(v);
  }
  const layout = h["layout"];
  const announce = h["announce"];
  const peak = h["peakDb"];
  return {
    at,
    ok: h["ok"],
    device: typeof h["device"] === "string" && h["device"] !== "" ? h["device"].slice(0, 128) : null,
    layout: layout === "ok" || layout === "moved" ? layout : null,
    voices: Math.max(0, Math.round(num(h["voices"]))),
    xruns: Math.max(0, Math.round(num(h["xruns"]))),
    peakDb: typeof peak === "number" && Number.isFinite(peak) ? peak : null,
    announce: announce === "on" || announce === "off" || announce === "blocked" ? announce : null,
    missing: names(h["missing"]),
    placeholders: names(h["placeholders"]),
    sounds,
  };
}

/** How many stops ride a GET, and for how long. */
export const AUDIO_STOPS = 8;
export const AUDIO_STOP_MS = 60_000;

/** How many tests ride a GET, and for how long. */
export const AUDIO_TESTS = 8;
export const AUDIO_TEST_MS = 60_000;
/** The long poll's default and longest wait (seconds). */
export const AUDIO_WAIT_S = 25;
/** The router counts as online this long after its last poll (ms): a long
 *  poll is 25 s, so a live router is never seen as gone between two (LA-4). */
export const AUDIO_ROUTER_ONLINE_MS = 40_000;

/** Is the house Mac's router listening (`GET /api/mod/audio?router=1`)? */
export interface AudioRouterPresence {
  online: boolean;
  /** Its last poll (server ms), null = none since this server started. */
  lastSeen: number | null;
  /** The worker's `name=`, when it gave one. */
  name: string | null;
}
export const AUDIO_WAIT_MAX_S = 30;

/** Is `path` the project's audio file (at the project's root)? */
export function isAudioFile(path: string): boolean {
  return path === AUDIO_FILE;
}

/** The `audio.json` text among a project's files, or null (an empty file —
 *  just created — counts as none). */
export function audioFileOf(files: Iterable<{ path: string; content: string }>): string | null {
  for (const f of files) if (isAudioFile(f.path)) return f.content.trim() === "" ? null : f.content;
  return null;
}

/** The `audio.json` string inside an untrusted data-file record (the event
 *  row's `house_maps` jsonb, a `/api/mod/load` body). */
export function audioOf(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>)[AUDIO_FILE];
  return typeof v === "string" ? v : null;
}

/** Parse + shape-check an `audio.json` text (no house: a room the map lost
 *  must not silently drop the whole config mid-show). */
export function parseAudioText(text: string): { audio: AudioConfig | null; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { audio: null, problems: [`not JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const v = validateAudio(raw);
  return v.ok ? { audio: raw as AudioConfig, problems: [] } : { audio: null, problems: v.problems };
}

/** The problems a project `audio.json` write would be refused for ([] = fine). */
export function audioProblems(text: string): string[] {
  return parseAudioText(text).problems;
}

/** An `audio.json` as a project file: pretty, one trailing newline. */
export function audioFileText(audio: AudioConfig): string {
  return `${JSON.stringify(audio, null, 2)}\n`;
}

/** Every `sound X` (`sfx`) name the story uses, sorted — the map editor's
 *  cue list. Read off the compiled model's directive text. */
export function storySounds(model: SimModel | null): string[] {
  if (model === null) return [];
  let text = "";
  try {
    text = JSON.stringify([model.rules, [...model.roles.values()].map((r) => r.hooks), [...model.characters.values()].map((c) => c.hooks), [...model.beats.values()]]);
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^A-Za-z0-9_])sfx:\s*([A-Za-z_][A-Za-z0-9_.-]*)/gu)) out.add(m[1]!);
  return [...out].sort();
}

/** The story's LOCATION names (declared order). */
export function storyLocations(model: SimModel | null): string[] {
  return model === null ? [] : [...model.locations.keys()];
}

export interface AudioHubInit {
  store: Store;
  /** The project's `audio.json` text as the row snapshotted it: null = the
   *  project has none; absent = no row snapshot (the state dir's copy). */
  projectText?: string | null;
  /** `LOOM_AUDIO`: the LAN fallback file. */
  envFile?: string | null;
  now?: () => number;
}

/** `audio` with its tablets list set to exactly `list` (wave 18b): an
 *  `audio.json` with no `announce` block gets the router's default one
 *  (`to: ["everywhere"]`, the chime on), so the list never moves the house
 *  speakers; an empty list drops the key. */
export function withAnnounceTerminals(audio: AudioConfig, list: readonly string[]): AudioConfig {
  const next = JSON.parse(JSON.stringify(audio)) as AudioConfig;
  const block = next.announce ?? { to: ["everywhere"] };
  if (list.length > 0) block.terminals = [...list];
  else delete block.terminals;
  next.announce = block;
  return next;
}

/** The config an event plays, its tests, and the long poll's waiters. */
export class AudioHub {
  private readonly store: Store;
  private projectText: string | null;
  private projectMemo: { text: string; audio: AudioConfig | null } | null = null;
  private director: AudioConfig | null;
  /** Wave 18b (Q8): the tablets list laid over the config in force (null =
   *  none set this event: the config's own `announce.terminals`). */
  private announceList: string[] | null;
  private readonly envFile: string | null;
  private envMemo: { mtimeMs: number; audio: AudioConfig | null } | null = null;
  private readonly now: () => number;
  private testLog: AudioTest[] = [];
  private testSeq = 0;
  /** The recent stops (wave 18b) and their own counter: a router's `tests=`
   *  cursor never sees a stop, so an old router never spins on one. */
  private stopLog: AudioStop[] = [];
  private stopSeq = 0;
  /** (wave 25) The house desk's plays and their own counter (`plays=`). */
  private playLog: AudioPlay[] = [];
  private playSeq = 0;
  /** (wave 25) The router's last health report (memory only). */
  private lastHealth: AudioHealth | null = null;
  /** (wave 25) Who hears the router's acks (the house desk). */
  private readonly ackListeners = new Set<(ack: AudioAck) => void>();
  private waiters = new Set<() => void>();
  private routerSeenAt: number | null = null;
  private routerName: string | null = null;
  private routerParked = 0;
  /** A problem logged once per text, not per request. */
  private readonly warned = new Set<string>();

  constructor(init: AudioHubInit) {
    this.store = init.store;
    this.now = init.now ?? Date.now;
    this.envFile = init.envFile ?? null;
    this.projectText = init.projectText !== undefined ? init.projectText : init.store.loadAudio();
    if (init.projectText !== undefined) init.store.saveAudio(init.projectText);
    const saved = init.store.loadAudioSave();
    this.director = saved !== null && validateAudio(saved).ok ? (saved as AudioConfig) : null;
    this.announceList = init.store.loadAudioAnnounce();
  }

  /** Is the tablets list this event's own (`setAnnounceTerminal`), laid over
   *  the config in force rather than read from it? */
  get announceSaved(): boolean {
    return this.announceList !== null;
  }

  /** The project's `audio.json` text as this event holds it. */
  get project(): string | null {
    return this.projectText;
  }

  /** A reload's (or `/api/mod/load`'s) fresh project snapshot. */
  setProjectText(text: string | null): void {
    const was = this.current().version;
    this.projectText = text;
    this.store.saveAudio(text);
    if (this.current().version !== was) this.wake();
  }

  /** The config in force, its version (content hash) and where it is from. */
  current(): { audio: AudioConfig; version: string; source: AudioSource } {
    const list = this.announceList;
    const pick = (base: AudioConfig, source: AudioSource) => {
      const audio = list === null ? base : withAnnounceTerminals(base, list);
      return { audio, version: audioHash(audio), source };
    };
    if (this.director !== null) return pick(this.director, "director");
    const project = this.projectAudio();
    if (project !== null) return pick(project, "project");
    const env = this.envAudio();
    if (env !== null) return pick(env, "env");
    return pick(defaultAudio(), "default");
  }

  private projectAudio(): AudioConfig | null {
    const text = this.projectText;
    if (text === null || text.trim() === "") return null;
    if (this.projectMemo === null || this.projectMemo.text !== text) {
      const p = parseAudioText(text);
      if (p.audio === null) this.warn(`the project's ${AUDIO_FILE} is ignored (${p.problems[0] ?? "invalid"})`);
      this.projectMemo = { text, audio: p.audio };
    }
    return this.projectMemo.audio;
  }

  private envAudio(): AudioConfig | null {
    if (this.envFile === null) return null;
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.envFile).mtimeMs;
    } catch {
      return this.envMemo?.audio ?? null;
    }
    if (this.envMemo === null || this.envMemo.mtimeMs !== mtimeMs) {
      let p: { audio: AudioConfig | null; problems: string[] };
      try {
        p = parseAudioText(readFileSync(this.envFile, "utf8"));
      } catch (err) {
        p = { audio: null, problems: [`unreadable: ${err instanceof Error ? err.message : String(err)}`] };
      }
      if (p.audio === null) this.warn(`${this.envFile}: ${p.problems[0] ?? "invalid"} — keeping the last good config`);
      this.envMemo = { mtimeMs, audio: p.audio ?? this.envMemo?.audio ?? null };
    }
    return this.envMemo.audio;
  }

  private warn(line: string): void {
    if (this.warned.has(line)) return;
    this.warned.add(line);
    process.stderr.write(`  ⚠️  audio: ${line}\n`);
  }

  /** A director's save: validated against the house in force; refused on a
   *  stale `base`. */
  save(raw: unknown, base: unknown, house: HouseMap | null): { status: 200; version: string; warnings: string[] } | { status: 400 | 409; body: Record<string, unknown> } {
    const cur = this.current();
    if (typeof base === "string" && base !== "" && base !== cur.version) {
      return { status: 409, body: { error: "the speakers changed since you loaded them", version: cur.version, source: cur.source } };
    }
    const v = validateAudio(raw, house);
    if (!v.ok) return { status: 400, body: { error: `invalid ${AUDIO_FILE}`, problems: v.problems, warnings: v.warnings } };
    const audio = JSON.parse(JSON.stringify(raw)) as AudioConfig;
    this.director = audio;
    this.store.saveAudioSave(audio);
    // A whole save carries its own tablets list.
    this.announceList = null;
    this.store.saveAudioAnnounce(null);
    this.wake();
    return { status: 200, version: audioHash(audio), warnings: v.warnings };
  }

  /** The config in force became the project's `audio.json`: the snapshot
   *  follows and the director's save is dropped (it is the project's now). */
  savedToProject(text: string): void {
    this.projectText = text;
    this.store.saveAudio(text);
    this.director = null;
    this.store.clearAudioSave();
    this.announceList = null;
    this.store.saveAudioAnnounce(null);
    this.wake();
  }

  /** Put one terminal spot on (or off) the tablets list (wave 18b, Q8),
   *  laid over the config in force: never a whole save, so a newer project
   *  `audio.json` still plays here. Refused on a stale `base`; a spot the
   *  map in force has no terminal for can only be turned off. */
  setAnnounceTerminal(spot: unknown, on: unknown, base: unknown, house: HouseMap | null): { status: 200; version: string; terminals: string[] } | { status: 400 | 404 | 409; body: Record<string, unknown> } {
    if (typeof spot !== "string" || spot.trim() === "" || typeof on !== "boolean") return { status: 400, body: { error: "send {spot, on}" } };
    const cur = this.current();
    if (typeof base === "string" && base !== "" && base !== cur.version) {
      return { status: 409, body: { error: "the speakers changed since you loaded them", version: cur.version, source: cur.source } };
    }
    if (on && house !== null && !house.terminals.some((t) => t.id === spot)) return { status: 404, body: { error: "no such terminal spot on the house map" } };
    const had = cur.audio.announce?.terminals ?? [];
    const list = on ? (had.includes(spot) ? [...had] : [...had, spot]) : had.filter((t) => t !== spot);
    this.announceList = list;
    this.store.saveAudioAnnounce(list);
    this.wake();
    return { status: 200, version: this.current().version, terminals: list };
  }

  /** The router polled (or answered a long poll): it is listening. */
  noteRouter(name: string | null): void {
    this.routerSeenAt = this.now();
    if (name !== null && name.trim() !== "") this.routerName = name.trim().slice(0, 64);
  }

  /** A router long poll parked (+1) or let go (−1). */
  routerWaiting(delta: 1 | -1): void {
    this.routerParked = Math.max(0, this.routerParked + delta);
  }

  /** Is a router listening? Parked on a long poll, or polled lately. */
  router(): AudioRouterPresence {
    const seen = this.routerSeenAt;
    return { online: this.routerParked > 0 || (seen !== null && this.now() - seen < AUDIO_ROUTER_ONLINE_MS), lastSeen: seen, name: this.routerName };
  }

  /** Queue a test (exactly one of speaker / output, already checked). */
  test(target: { speaker: string } | { out: number }): AudioTest {
    const t: AudioTest = { seq: ++this.testSeq, at: this.now(), speaker: "speaker" in target ? target.speaker : null, out: "out" in target ? target.out : null };
    this.testLog.push(t);
    if (this.testLog.length > AUDIO_TESTS) this.testLog.shift();
    this.wake();
    return t;
  }

  /** The recent tests (≤ `AUDIO_TESTS`, ≤ `AUDIO_TEST_MS` old), oldest first. */
  tests(): AudioTest[] {
    const since = this.now() - AUDIO_TEST_MS;
    this.testLog = this.testLog.filter((t) => t.at >= since);
    return [...this.testLog];
  }

  /** Stop every house sound now (wave 18b, Q7): queued for the router. */
  stop(o: { announce?: boolean }, by: string): AudioStop {
    const s: AudioStop = { seq: ++this.stopSeq, at: this.now(), by: by.slice(0, 64), announce: o.announce === true };
    this.stopLog.push(s);
    if (this.stopLog.length > AUDIO_STOPS) this.stopLog.shift();
    this.wake();
    return s;
  }

  /** The recent stops (≤ `AUDIO_STOPS`, ≤ `AUDIO_STOP_MS` old), oldest first. */
  stops(): AudioStop[] {
    const since = this.now() - AUDIO_STOP_MS;
    this.stopLog = this.stopLog.filter((s) => s.at >= since);
    return [...this.stopLog];
  }

  /** (wave 25) Play one sound or say one announcement now: queued for the router. */
  play(p: AudioPlayRequest, by: string): AudioPlay {
    const play: AudioPlay =
      "sound" in p
        ? { seq: ++this.playSeq, at: this.now(), by: by.slice(0, 64), sound: p.sound, to: p.to !== undefined ? [...p.to] : null, gain: p.gain ?? null }
        : { seq: ++this.playSeq, at: this.now(), by: by.slice(0, 64), say: p.say, to: p.to !== undefined ? [...p.to] : null, gain: null, chime: p.chime !== false };
    this.playLog.push(play);
    if (this.playLog.length > AUDIO_PLAYS) this.playLog.shift();
    this.wake();
    return play;
  }

  /** The recent plays (≤ `AUDIO_PLAYS`, ≤ `AUDIO_PLAY_MS` old), oldest first. */
  plays(): AudioPlay[] {
    const since = this.now() - AUDIO_PLAY_MS;
    this.playLog = this.playLog.filter((p) => p.at >= since);
    return [...this.playLog];
  }

  /** (wave 25) The router's report: its acks go to the listeners, its
   *  health is kept (memory only). A report is the router being there. */
  report(o: { health?: AudioHealth | null; acks?: readonly AudioAck[] }): void {
    if (o.health !== undefined && o.health !== null) this.lastHealth = o.health;
    this.routerSeenAt = this.now();
    for (const ack of o.acks ?? []) for (const l of [...this.ackListeners]) l(ack);
  }

  /** The router's last health report, or null (never reported). */
  health(): AudioHealth | null {
    return this.lastHealth;
  }

  /** Hear every ack the router reports; the returned function stops it. */
  onAck(listener: (ack: AudioAck) => void): () => void {
    this.ackListeners.add(listener);
    return () => this.ackListeners.delete(listener);
  }

  /** The hub's clock (server epoch ms). */
  clock(): number {
    return this.now();
  }

  /** Is anything newer than the poller's view? A cursor past this hub's
   *  own counter was issued by an earlier process (a server restart counts
   *  from 1 again): stale, so the poll answers at once with today's list
   *  instead of holding a stop for the whole long poll. */
  moved(after: string, testsAfter: number | null, stopsAfter: number | null = null, playsAfter: number | null = null): boolean {
    if (this.current().version !== after) return true;
    if (testsAfter !== null && (testsAfter > this.testSeq || this.tests().some((t) => t.seq > testsAfter))) return true;
    if (playsAfter !== null && (playsAfter > this.playSeq || this.plays().some((p) => p.seq > playsAfter))) return true;
    return stopsAfter !== null && (stopsAfter > this.stopSeq || this.stops().some((s) => s.seq > stopsAfter));
  }

  /** Resolve on the next change (a save, a project snapshot, a test) or
   *  after `ms`; the returned `cancel` drops the waiter. */
  waitChange(ms: number): { done: Promise<void>; cancel: () => void } {
    let wake!: () => void;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = new Promise<void>((resolve) => {
      wake = () => {
        if (timer !== undefined) clearTimeout(timer);
        this.waiters.delete(wake);
        resolve();
      };
      this.waiters.add(wake);
      timer = setTimeout(wake, Math.max(0, ms));
    });
    return { done, cancel: wake };
  }

  /** Waiters parked right now (tests). */
  get waiting(): number {
    return this.waiters.size;
  }

  private wake(): void {
    for (const w of [...this.waiters]) w();
  }
}

/** What the audio routes need from the event runtime. */
export interface AudioContext {
  /** The house map in force (speaker rooms are checked against it). */
  house: () => HouseMap | null;
  /** The story's model (its sound names and LOCATIONs). */
  model: () => SimModel | null;
}

/** The GET answer. */
export interface AudioView {
  audio: AudioConfig;
  version: string;
  source: AudioSource;
  sounds: string[];
  locations: string[];
  tests: AudioTest[];
  /** (wave 18b) The recent stops (≤ `AUDIO_STOPS`, ≤ `AUDIO_STOP_MS` old,
   *  oldest first); the router keeps its own `stops=` cursor. */
  stops: AudioStop[];
  /** (wave 25) The house desk's recent plays (≤ `AUDIO_PLAYS`, ≤
   *  `AUDIO_PLAY_MS` old, oldest first); the router keeps its own `plays=`
   *  cursor and drops a play more than 10 s old by `now`. */
  plays: AudioPlay[];
  /** (wave 18b) Server epoch ms, so the router can drop a stale stop. */
  now: number;
  /** Is the router on the house Mac listening (a Test is played only then)? */
  router: AudioRouterPresence;
  /** (wave 18b, Q8) The tablets list is this event's own (Run's House sound
   *  card), laid over `source`; Save to project writes it into the file. */
  announceSaved: boolean;
  /** The config in force checked against the house in force (a map edit
   *  can leave a speaker outside its room) — advice, never a refusal here. */
  problems: string[];
  warnings: string[];
}

export function audioView(hub: AudioHub, ctx: AudioContext): AudioView {
  const cur = hub.current();
  const model = ctx.model();
  const v = validateAudio(cur.audio, ctx.house());
  return { ...cur, sounds: storySounds(model), locations: storyLocations(model), tests: hub.tests(), stops: hub.stops(), plays: hub.plays(), now: hub.clock(), router: hub.router(), announceSaved: hub.announceSaved, problems: v.problems, warnings: v.warnings };
}

/**
 * `GET /api/mod/audio[?after=&tests=&stops=&plays=&wait=]` — the config + the long poll.
 * Returns true when it answered (or will: a parked long poll).
 */
export async function handleAudioGet(hub: AudioHub, ctx: AudioContext, req: IncomingMessage, res: ServerResponse, url: URL, authorized: (token: string | undefined) => boolean): Promise<boolean> {
  if (!authorized(queryTokenOf(req, url))) {
    sendJson(res, 403, { error: "moderators only" });
    return true;
  }
  res.setHeader?.("cache-control", "no-store");
  const after = url.searchParams.get("after");
  const testsRaw = url.searchParams.get("tests") ?? "";
  const testsAfter = /^\d+$/u.test(testsRaw) ? Number(testsRaw) : null;
  const stopsRaw = url.searchParams.get("stops") ?? "";
  const stopsAfter = /^\d+$/u.test(stopsRaw) ? Number(stopsRaw) : null;
  const playsRaw = url.searchParams.get("plays") ?? "";
  const playsAfter = /^\d+$/u.test(playsRaw) ? Number(playsRaw) : null;
  const waitRaw = Number(url.searchParams.get("wait") ?? AUDIO_WAIT_S);
  const waitS = Number.isFinite(waitRaw) ? Math.min(AUDIO_WAIT_MAX_S, Math.max(0, waitRaw)) : AUDIO_WAIT_S;
  // The house Mac's router says who it is (`router=1`); the map editor's own
  // long poll does not, so it never passes for one.
  const router = url.searchParams.get("router") === "1";
  if (router) hub.noteRouter(url.searchParams.get("name"));
  if (after !== null && after !== "" && !hub.moved(after, testsAfter, stopsAfter, playsAfter) && waitS > 0) {
    const w = hub.waitChange(waitS * 1000);
    // A caller that hangs up frees its waiter at once.
    req.on?.("close", w.cancel);
    if (router) hub.routerWaiting(1);
    try {
      await w.done;
    } finally {
      if (router) hub.routerWaiting(-1);
    }
  }
  if (router) hub.noteRouter(url.searchParams.get("name"));
  sendJson(res, 200, audioView(hub, ctx));
  return true;
}

/** The project link the save needs (`ProjectLink.writeFile` + the row snapshot). */
export interface AudioProjectLink {
  writeFile(path: string, content: string): Promise<void>;
  /** Record the event row's data snapshot (maps + facts + audio). */
  saveSnapshot(): Promise<void>;
}

/**
 * `POST /api/mod/audio`, `/api/mod/audio/project`, `/api/mod/audio/test` —
 * already authorized by the runtime's mod gate. Returns false for any other path.
 */
export async function handleAudioPost(hub: AudioHub, ctx: AudioContext, path: string, body: Record<string, unknown>, res: ServerResponse, project: AudioProjectLink | null, by: string): Promise<boolean> {
  switch (path) {
    case "/api/mod/audio": {
      const r = hub.save(body["audio"], body["base"], ctx.house());
      if (r.status !== 200) sendJson(res, r.status, r.body);
      else {
        process.stdout.write(`  🔊 audio: ${by} saved the speakers (${r.version})\n`);
        sendJson(res, 200, { ok: true, version: r.version, source: "director", warnings: r.warnings });
      }
      return true;
    }
    case "/api/mod/audio/project": {
      if (project === null) {
        sendJson(res, 409, { error: "this event has no project — download the JSON instead" });
        return true;
      }
      const cur = hub.current();
      const text = audioFileText(cur.audio);
      try {
        await project.writeFile(AUDIO_FILE, text);
      } catch (err) {
        process.stderr.write(`  ⚠️  audio: saving ${AUDIO_FILE} to the project failed (${err instanceof Error ? err.message : String(err)})\n`);
        sendJson(res, 502, { error: "could not write the project file" });
        return true;
      }
      hub.savedToProject(text);
      try {
        await project.saveSnapshot();
      } catch (err) {
        process.stderr.write(`  ⚠️  audio: recording the snapshot failed (${err instanceof Error ? err.message : String(err)})\n`);
      }
      process.stdout.write(`  🔊 audio: ${by} saved the speakers to the project as ${AUDIO_FILE}\n`);
      sendJson(res, 200, { ok: true, file: AUDIO_FILE, version: hub.current().version, source: "project" });
      return true;
    }
    case "/api/mod/audio/announce": {
      const r = hub.setAnnounceTerminal(body["spot"], body["on"], body["base"], ctx.house());
      if (r.status !== 200) sendJson(res, r.status, r.body);
      else {
        process.stdout.write(`  📢 audio: ${by} set the tablets that say the announcements: ${r.terminals.join(", ") || "none"}\n`);
        sendJson(res, 200, { ok: true, version: r.version, terminals: r.terminals });
      }
      return true;
    }
    case "/api/mod/audio/test": {
      const hasSpeaker = body["speaker"] !== undefined;
      const hasOut = body["out"] !== undefined;
      if (body["input"] !== undefined || hasSpeaker === hasOut) {
        sendJson(res, 400, { error: "test exactly one of speaker or out" });
        return true;
      }
      const { audio } = hub.current();
      if (hasSpeaker) {
        const id = body["speaker"];
        if (typeof id !== "string" || !audio.speakers.some((s) => s.id === id)) {
          sendJson(res, 404, { error: "no such speaker" });
          return true;
        }
        sendJson(res, 200, { ok: true, seq: hub.test({ speaker: id }).seq, router: hub.router() });
        return true;
      }
      const out = body["out"];
      if (typeof out !== "number" || !Number.isInteger(out) || out < 1 || out > audio.device.outputs) {
        sendJson(res, 400, { error: `out must be an output from 1 to ${audio.device.outputs}` });
        return true;
      }
      sendJson(res, 200, { ok: true, seq: hub.test({ out }).seq, router: hub.router() });
      return true;
    }
    case "/api/mod/audio/play": {
      const p = audioPlayOf(body);
      if (typeof p === "string") {
        sendJson(res, 400, { error: p });
        return true;
      }
      const play = hub.play(p, by);
      process.stdout.write(`  🔊 audio: ${by} played ${play.sound !== undefined ? play.sound : "an announcement"}\n`);
      sendJson(res, 200, { ok: true, seq: play.seq, router: hub.router() });
      return true;
    }
    case "/api/mod/audio/report": {
      const rawAcks = body["acks"];
      if (rawAcks !== undefined && (!Array.isArray(rawAcks) || rawAcks.length > AUDIO_ACKS_MAX)) {
        sendJson(res, 400, { error: `acks must be a list of at most ${AUDIO_ACKS_MAX}` });
        return true;
      }
      const acks: AudioAck[] = [];
      for (const [i, a] of (rawAcks ?? []).entries()) {
        const ack = audioAckOf(a);
        if (ack === null) {
          sendJson(res, 400, { error: `acks[${i}] is not {seq, kind: play | test, result, ms?}` });
          return true;
        }
        acks.push(ack);
      }
      let health: AudioHealth | null = null;
      if (body["health"] !== undefined && body["health"] !== null) {
        health = audioHealthOf(body["health"], hub.clock());
        if (health === null) {
          sendJson(res, 400, { error: "health is not {ok, device, layout, voices, xruns, peakDb, announce, missing, placeholders, sounds}" });
          return true;
        }
      }
      hub.report({ health, acks });
      sendJson(res, 200, { ok: true });
      return true;
    }
    case "/api/mod/audio/stop": {
      const announce = body["announce"];
      if (announce !== undefined && typeof announce !== "boolean") {
        sendJson(res, 400, { error: "announce must be true or false" });
        return true;
      }
      const stop = hub.stop({ announce: announce === true }, by);
      process.stdout.write(`  🔇 audio: ${by} stopped the house sounds${stop.announce ? " (and the announcements)" : ""}\n`);
      const answer: AudioStopAnswer = { ok: true, seq: stop.seq, router: hub.router() };
      sendJson(res, 200, answer);
      return true;
    }
    default:
      return false;
  }
}
