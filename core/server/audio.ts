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
//!   Since wave 38 the health may carry the soundtrack (`music {scene,
//!   beds, missing}`), the input meters (`inputs`), the ducking sources'
//!   activity (`sources`) and `underruns`; each is optional and a malformed
//!   one is dropped alone (`audioHealthW38Of`). The GET view (not the
//!   router's own, `router=1`) carries the last report as `health`, minus
//!   its `sounds`, for `showctl doctor`.
//! - (wave 40, the house mixer: `docs/loom-w40-contract.md` C2, the shared
//!   model `src/house-mixer.ts`) the GET also carries `mix {seq, levels}`,
//!   `music` (the recent soundtrack commands) and `mixWatch` (a mixer panel
//!   is open); the long poll takes `mix=<seq>` (moved when the seq
//!   differs), `music=<seq>` (as `plays=`) and `watch=0|1` (moved when
//!   `mixWatched()` differs). The mix is kept in the state dir
//!   (`audio-mix.json`, its seq too) and never journaled; the commands,
//!   the meters and the watch are memory only.
//! - `GET /api/mod/audio/mixer` → `MixerView` (wave 40): the mix, the
//!   sources and rooms of the config in force (named from the house map),
//!   the router's meters (null when older than `MIX_METERS_STALE_MS`), the
//!   soundtrack now (the freshest of the meters' and the health's `music`),
//!   the router and `now`; no `by`. Each read extends the watch by
//!   `MIX_WATCH_MS`. Hosts may (the host allowlist).
//! - `POST /api/mod/audio/mix {changes, resetAll?}` → `{ok, mix}` (400 a
//!   bad change with its index, more than `MIX_CHANGES_MAX`, or a result
//!   over `MIX_LEVELS_MAX` levels); `POST /api/mod/audio/music
//!   {action: next | scene | stop | story, …}` → `{ok, seq, router}`. Hosts
//!   may both.
//! - `POST /api/mod/audio/meters {outputs, inputs, sources, buses?, music?}`
//!   → `{ok, watch}` (wave 40): the router's live meters while a panel
//!   watches (clamped, lists cut, stamped with the server's clock). The
//!   router's own: never on the host allowlist.
//! - `GET /api/mod/audio/walkers` (wave 49, `docs/loom-w49-contract.md`
//!   C3.1) → the footsteps' server-sent stream of `walkers` events, each a
//!   `WalkersFrame`: one on connect, one on every change, one every
//!   `FOOTSTEPS_KEEP_MS` while anyone walks (a quiet house: `:ping`
//!   comments). The stream itself is `EventRuntime.openWalkersStream`; the
//!   frames are here (`setWalkers`, `onWalkers`). `POST
//!   /api/mod/audio/walkers/test {speaker}` → `{ok}`: a walker on that
//!   speaker alone for `FOOTSTEP_TEST_MS`, as id `test`. Memory only, both.
//!   Never on the host allowlist.
//!
//! Transport-light: `AudioHub` takes an injected clock and store; the
//! handlers take the runtime's context.

import { readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

import { AUDIO_FILE, FOOTSTEP_TEST_MS, FOOTSTEPS_KEEP_MS, audioHash, defaultAudio, validateAudio, type AudioConfig, type HouseMap, type Walker, type WalkersFrame } from "@loom/house";

import {
  MIX_CHANGES_MAX,
  MIX_LEVELS_MAX,
  MIX_METERS_STALE_MS,
  MIX_WATCH_MS,
  MUSIC_COMMAND_MS,
  MUSIC_COMMANDS,
  applyMixChanges,
  mixChangeOf,
  mixLevelsOf,
  mixerRooms,
  mixerSources,
  musicCommandOf,
  MUSIC_LIBRARY_MAX,
  MUSIC_PALS_MAX,
  TIDAL_ID_RE,
  type AudioMix,
  type MixChange,
  type MixerMeters,
  type MixerMusic,
  type MixerMusicBed,
  type MixerTidal,
  type MixerTidalPlaylist,
  type MusicDj,
  type MixerView,
  type MusicCommand,
  type MusicCommandEntry,
} from "../src/house-mixer.ts";
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
  /** (wave 38) The soundtrack (contract w38 C3): absent from an older router. */
  music?: AudioMusicHealth;
  /** (wave 38) Each metered input channel ("1"…) → its block peak (dBFS). */
  inputs?: Record<string, number>;
  /** (wave 38) Each ducking source (an input `role`, `announce`, `takeover`) → its activity, 0..1. */
  sources?: Record<string, number>;
  /** (wave 38) Stream underruns since the router started (each played silence). */
  underruns?: number;
}

/** (wave 38) One soundtrack bed: a playlist on a set of speakers, the file
 *  playing (or null between tracks), seconds into it (`posS`) and, since
 *  wave 40, its length (`durS`) when the router knows it. The house mixer's
 *  `MixerMusicBed` (`src/house-mixer.ts`) is the one shape. */
export type AudioMusicBed = MixerMusicBed;

/** (wave 38) The router's soundtrack: the scene in force, its beds, and the
 *  playlists with no file (each a silent bed); since wave 40 also every
 *  scene (`scenes`), whether one was picked by hand (`hand`) and every
 *  playlist's size (`playlists`). The house mixer's `MixerMusic`. */
export type AudioMusicHealth = MixerMusic;
/** At most this many sounds in a health report's `sounds`. */
export const AUDIO_HEALTH_SOUNDS_MAX = 1000;
/** (wave 38) At most this many beds, speakers per bed, metered inputs and sources. */
export const AUDIO_HEALTH_BEDS_MAX = 32;
export const AUDIO_HEALTH_SPEAKERS_MAX = 64;
export const AUDIO_HEALTH_INPUTS_MAX = 64;
export const AUDIO_HEALTH_SOURCES_MAX = 32;
/** (wave 38) An input peak is clamped to this range (dBFS); silence reads the floor. */
export const AUDIO_PEAK_FLOOR_DB = -120;
export const AUDIO_PEAK_CEIL_DB = 24;
/** (wave 40) At most this many scenes and playlists in a music report. */
export const AUDIO_MUSIC_SCENES_MAX = 64;
export const AUDIO_MUSIC_PLAYLISTS_MAX = 64;
/** (wave 40) At most this many output channels and buses in a meters packet. */
export const AUDIO_METER_OUTPUTS_MAX = 64;
export const AUDIO_METER_BUSES_MAX = 16;

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
  const wave38 = audioHealthW38Of(h);
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
    ...wave38,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The wave 38 fields of a health report (contract w38 C3): `music`,
 * `inputs`, `sources`, `underruns`. Each is optional and judged on its own:
 * a malformed one is dropped (never the whole report: the sounds and the
 * device matter more than a meter), a long list is cut, a number is clamped.
 * A bed's position is read as `posS` or the router's `pos_s`.
 */
export function audioHealthW38Of(h: Record<string, unknown>): Pick<AudioHealth, "music" | "inputs" | "sources" | "underruns"> {
  const out: Pick<AudioHealth, "music" | "inputs" | "sources" | "underruns"> = {};
  const music = audioMusicOf(h["music"]);
  if (music !== null) out.music = music;
  const inputs = peaksOf(h["inputs"], AUDIO_HEALTH_INPUTS_MAX);
  if (inputs !== null) out.inputs = inputs;
  const sources = activityOf(h["sources"]);
  if (sources !== null) out.sources = sources;
  const u = h["underruns"];
  if (typeof u === "number" && Number.isFinite(u)) out.underruns = Math.max(0, Math.round(u));
  return out;
}

/** Channel → peak dBFS ("1"…"99"; null reads the floor: JSON has no
 *  -Infinity), clamped to [floor, ceiling] at 0.1 dB; null when not a record. */
function peaksOf(raw: unknown, max: number): Record<string, number> | null {
  if (!isRecord(raw)) return null;
  const got: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw).slice(0, max)) {
    if (!/^[1-9]\d?$/u.test(k)) continue;
    // A silent input may come as null (JSON has no -Infinity): the floor.
    if (v === null) got[k] = AUDIO_PEAK_FLOOR_DB;
    else if (typeof v === "number" && !Number.isNaN(v)) got[k] = Math.round(clampNum(v, AUDIO_PEAK_FLOOR_DB, AUDIO_PEAK_CEIL_DB) * 10) / 10;
  }
  return got;
}

/** Each ducking source → its activity 0..1; null when not a record. */
function activityOf(raw: unknown): Record<string, number> | null {
  if (!isRecord(raw)) return null;
  const got: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw).slice(0, AUDIO_HEALTH_SOURCES_MAX)) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(k) || typeof v !== "number" || !Number.isFinite(v)) continue;
    got[k] = Math.round(clampNum(v, 0, 1) * 1000) / 1000;
  }
  return got;
}

/**
 * The router's soundtrack report (a health's `music`, wave 38; a meters
 * packet's, wave 40), or null when it is not one (no sound `scene`). The
 * scene, the beds and the missing playlists as in wave 38; since wave 40 also
 * `scenes`, `hand`, `playlists [{name, tracks, loop}]` and each bed's `durS`
 * (or the router's `dur_s`), each kept when sound and dropped alone when not
 * (a malformed playlist entry is skipped).
 */
export function audioMusicOf(m: unknown): AudioMusicHealth | null {
  if (!isRecord(m)) return null;
  const name = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.slice(0, AUDIO_NAME_MAX) : null);
  const names = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.flatMap((x) => (name(x) === null ? [] : [name(x)!])).slice(0, max) : []);
  const secs = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? clampNum(Math.round(v * 10) / 10, 0, 24 * 3600) : null);
  const scene = m["scene"] === null ? null : name(m["scene"]);
  if (scene === null && m["scene"] !== null) return null;
  const beds: AudioMusicBed[] = [];
  if (Array.isArray(m["beds"]))
    for (const b of m["beds"].slice(0, AUDIO_HEALTH_BEDS_MAX)) {
      if (!isRecord(b)) continue;
      const playlist = name(b["playlist"]);
      if (playlist === null) continue;
      const speakers = names(b["speakers"], AUDIO_HEALTH_SPEAKERS_MAX);
      const track = b["track"] === null ? null : typeof b["track"] === "string" && b["track"] !== "" ? b["track"].slice(0, 128) : null;
      const bed: AudioMusicBed = { playlist, speakers, track, posS: secs(b["posS"] ?? b["pos_s"]) ?? 0 };
      const dur = secs(b["durS"] ?? b["dur_s"]);
      if (dur !== null) bed.durS = dur;
      if (b["live"] === true) bed.live = true;
      beds.push(bed);
    }
  const out: AudioMusicHealth = { scene, beds, missing: names(m["missing"], AUDIO_HEALTH_BEDS_MAX) };
  if (Array.isArray(m["scenes"])) out.scenes = names(m["scenes"], AUDIO_MUSIC_SCENES_MAX);
  if (typeof m["hand"] === "boolean") out.hand = m["hand"];
  if (Array.isArray(m["playlists"])) {
    out.playlists = [];
    for (const p of m["playlists"].slice(0, AUDIO_MUSIC_PLAYLISTS_MAX)) {
      if (!isRecord(p)) continue;
      const pname = name(p["name"]);
      const tracks = p["tracks"];
      if (pname === null || typeof tracks !== "number" || !Number.isFinite(tracks)) continue;
      out.playlists.push({ name: pname, tracks: clampNum(Math.round(tracks), 0, 100_000), loop: p["loop"] === true });
    }
  }
  const tidal = audioTidalOf(m["tidal"]);
  if (tidal !== null) out.tidal = tidal;
  if (m["loan"] === true) out.loan = true;
  return out;
}

/** (wave 58) The TIDAL app in a music report, or null when it isn't sound. A
 *  malformed library entry is skipped. */
function audioTidalOf(t: unknown): MixerTidal | null {
  if (!isRecord(t) || typeof t["online"] !== "boolean") return null;
  const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null);
  const library: MixerTidalPlaylist[] = [];
  if (Array.isArray(t["library"]))
    for (const p of t["library"].slice(0, MUSIC_LIBRARY_MAX)) {
      if (!isRecord(p)) continue;
      const id = typeof p["id"] === "string" && TIDAL_ID_RE.test(p["id"]) ? p["id"] : null;
      const title = text(p["title"], 80);
      if (id === null || title === null) continue;
      const items = p["items"];
      library.push({ id, title, ...(typeof items === "number" && Number.isFinite(items) ? { items: clampNum(Math.round(items), 0, 100_000) } : {}) });
    }
  const playlist = typeof t["playlist"] === "string" && TIDAL_ID_RE.test(t["playlist"]) ? t["playlist"] : null;
  return { online: t["online"], playing: t["playing"] === true, paused: t["paused"] === true, track: text(t["track"], 128), problem: text(t["problem"], 200), playlist, library };
}

/**
 * (wave 40) The router's live meters packet (`POST /api/mod/audio/meters`)
 * off an untrusted body, stamped `at` (server now): output and input peaks
 * clamped to [−120, 24] dBFS, the ducking sources' activity, each bus's
 * per-output peaks; every list cut like the health's. A malformed field is
 * empty (never a refusal: a meter matters less than the next packet). The
 * packet's `music`, when sound, is returned beside it.
 */
export function mixerMetersOf(body: Record<string, unknown>, at: number): { meters: MixerMeters; music: AudioMusicHealth | null } {
  const meters: MixerMeters = {
    at,
    outputs: peaksOf(body["outputs"], AUDIO_METER_OUTPUTS_MAX) ?? {},
    inputs: peaksOf(body["inputs"], AUDIO_HEALTH_INPUTS_MAX) ?? {},
    sources: activityOf(body["sources"]) ?? {},
  };
  const buses = body["buses"];
  if (isRecord(buses)) {
    const got: Record<string, Record<string, number>> = {};
    for (const [k, v] of Object.entries(buses).slice(0, AUDIO_METER_BUSES_MAX)) {
      const per = peaksOf(v, AUDIO_METER_OUTPUTS_MAX);
      if (!/^[a-z][a-z0-9_:-]{0,63}$/u.test(k) || per === null) continue;
      got[k] = per;
    }
    meters.buses = got;
  }
  return { meters, music: audioMusicOf(body["music"]) };
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

/** (wave 49) The test walker's id in a `WalkersFrame`, and its pace (m/s). */
export const WALKER_TEST_ID = "test";
export const WALKER_TEST_MPS = 1.4;

/** (wave 49) Timers, injectable for tests. */
export interface WalkerTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_WALKER_TIMERS: WalkerTimers = {
  set: (fn, ms) => {
    const h = setTimeout(fn, ms);
    (h as { unref?: () => void }).unref?.();
    return h;
  },
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface AudioHubInit {
  store: Store;
  /** The project's `audio.json` text as the row snapshotted it: null = the
   *  project has none; absent = no row snapshot (the state dir's copy). */
  projectText?: string | null;
  /** `LOOM_AUDIO`: the LAN fallback file. */
  envFile?: string | null;
  now?: () => number;
  /** (wave 49) The walkers stream's keepalive and the test's end. */
  walkerTimers?: WalkerTimers;
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
  /** (wave 40) The house mixer's live balance: kept in the state dir
   *  (`audio-mix.json`), its seq too, so a restart never reuses one. */
  private mixState: AudioMix;
  /** (wave 40) The soundtrack's one-shot commands and their own counter
   *  (`music=`), memory only like the desk's plays. */
  private musicLog: MusicCommandEntry[] = [];
  private musicSeq = 0;
  /** (wave 40) The router's last meters packet (memory only) and the last
   *  sound `music` a packet carried, with when it arrived. */
  private lastMeters: MixerMeters | null = null;
  private metersMusic: { at: number; music: AudioMusicHealth } | null = null;
  /** (wave 40) A mixer panel is open until then (server ms): each mixer GET
   *  extends it by `MIX_WATCH_MS`. */
  private watchUntil: number | null = null;
  /** (wave 49) The programs heard walking, the test walker and the stream's
   *  subscribers. Memory only. `walkerSeq` counts the frames pushed. */
  private walkerList: Walker[] = [];
  private walkerTest: { walker: Walker; until: number } | null = null;
  private walkerSeq = 0;
  private readonly walkerSubs = new Set<(frame: WalkersFrame) => void>();
  private walkerTimer: unknown = null;
  private readonly walkerTimers: WalkerTimers;

  constructor(init: AudioHubInit) {
    this.store = init.store;
    this.now = init.now ?? Date.now;
    this.walkerTimers = init.walkerTimers ?? REAL_WALKER_TIMERS;
    this.envFile = init.envFile ?? null;
    this.projectText = init.projectText !== undefined ? init.projectText : init.store.loadAudio();
    if (init.projectText !== undefined) init.store.saveAudio(init.projectText);
    const saved = init.store.loadAudioSave();
    this.director = saved !== null && validateAudio(saved).ok ? (saved as AudioConfig) : null;
    this.announceList = init.store.loadAudioAnnounce();
    const mix = init.store.loadAudioMix();
    this.mixState = { seq: mix?.seq ?? 0, levels: mixLevelsOf(mix?.levels) };
  }

  /** (wave 40) The mix in force (a copy). */
  mix(): AudioMix {
    const levels: AudioMix["levels"] = {};
    for (const [k, l] of Object.entries(this.mixState.levels)) levels[k] = { db: l.db, mute: l.mute };
    return { seq: this.mixState.seq, levels };
  }

  /** (wave 40) Apply checked changes (after clearing every level, with
   *  `resetAll`): the new mix (seq + 1, saved), or the refusal's text when
   *  the result holds more than `MIX_LEVELS_MAX` levels. Wakes the long poll. */
  setMix(changes: readonly MixChange[], o: { resetAll?: boolean } = {}): AudioMix | string {
    const levels = applyMixChanges(o.resetAll === true ? {} : this.mixState.levels, changes);
    if (Object.keys(levels).length > MIX_LEVELS_MAX) return `the mix holds at most ${MIX_LEVELS_MAX} levels: reset a scope first`;
    this.mixState = { seq: this.mixState.seq + 1, levels };
    this.store.saveAudioMix(this.mixState);
    this.wake();
    return this.mix();
  }

  /** (wave 40) Queue one soundtrack command for the router. */
  music(cmd: MusicCommand, by: string): MusicCommandEntry {
    const entry: MusicCommandEntry = { ...cmd, seq: ++this.musicSeq, at: this.now(), by: by.slice(0, 64) };
    this.musicLog.push(entry);
    if (this.musicLog.length > MUSIC_COMMANDS) this.musicLog.shift();
    this.wake();
    return entry;
  }

  /** (wave 40) The recent music commands (≤ `MUSIC_COMMANDS`, ≤
   *  `MUSIC_COMMAND_MS` old), oldest first. */
  musicCommands(): MusicCommandEntry[] {
    const since = this.now() - MUSIC_COMMAND_MS;
    this.musicLog = this.musicLog.filter((c) => c.at >= since);
    return this.musicLog.map((c) => ({ ...c }));
  }

  /** (wave 40) The router's meters packet (already parsed, stamped): kept
   *  (memory only); its `music`, when sound, is the newest now-playing. A
   *  packet is the router being there. Answers whether a panel still watches. */
  meters(packet: { meters: MixerMeters; music: AudioMusicHealth | null }): boolean {
    this.lastMeters = packet.meters;
    if (packet.music !== null) this.metersMusic = { at: packet.meters.at, music: packet.music };
    this.routerSeenAt = this.now();
    return this.mixWatched();
  }

  /** (wave 40) The router's last meters, or null when none arrived in
   *  `MIX_METERS_STALE_MS`. */
  liveMeters(): MixerMeters | null {
    const m = this.lastMeters;
    return m !== null && this.now() - m.at <= MIX_METERS_STALE_MS ? m : null;
  }

  /** (wave 40) The soundtrack now: the freshest of the meters' music and
   *  the last health's, null with neither. */
  nowPlaying(): AudioMusicHealth | null {
    const h = this.lastHealth;
    const fromHealth = h?.music !== undefined ? { at: h.at, music: h.music } : null;
    const m = this.metersMusic;
    if (m === null) return fromHealth?.music ?? null;
    if (fromHealth === null) return m.music;
    return m.at >= fromHealth.at ? m.music : fromHealth.music;
  }

  /** (wave 40) A mixer panel looked (each mixer GET): the router keeps its
   *  meters coming for `MIX_WATCH_MS`. The first look after a quiet spell
   *  wakes the long poll, so the router hears `mixWatch` at once. */
  watchMixer(): void {
    const was = this.mixWatched();
    this.watchUntil = this.now() + MIX_WATCH_MS;
    if (!was) this.wake();
  }

  /** (wave 40) Is a mixer panel open (a GET within `MIX_WATCH_MS`)? */
  mixWatched(): boolean {
    return this.watchUntil !== null && this.now() < this.watchUntil;
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
    const { audio, source } = this.inForce();
    return { audio, version: audioHash(audio), source };
  }

  /** The config in force, unhashed: the spatial hub reads it 10 times a
   *  second while anyone walks (wave 49). */
  config(): AudioConfig {
    return this.inForce().audio;
  }

  private inForce(): { audio: AudioConfig; source: AudioSource } {
    const list = this.announceList;
    const pick = (base: AudioConfig, source: AudioSource) => ({ audio: list === null ? base : withAnnounceTerminals(base, list), source });
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

  // -- footsteps (wave 49, C3.1) --------------------------------------------

  /** Who is heard walking now (the spatial hub's `onWalkers`). */
  setWalkers(walkers: readonly Walker[]): void {
    this.walkerList = [...walkers];
    this.pushWalkers();
  }

  /** A walker on this speaker alone for `FOOTSTEP_TEST_MS`, merged into the
   *  frames as `WALKER_TEST_ID`. A new test takes the running one's place. */
  testWalker(speaker: string): void {
    const walker: Walker = { id: WALKER_TEST_ID, speed: WALKER_TEST_MPS, surface: "floor", to: [{ speaker, db: 0, muffled: false }] };
    this.walkerTest = { walker, until: this.now() + FOOTSTEP_TEST_MS };
    this.pushWalkers();
  }

  /** The frame as it stands now (the test walker gone once it is over). */
  walkersFrame(): WalkersFrame {
    const now = this.now();
    if (this.walkerTest !== null && now >= this.walkerTest.until) this.walkerTest = null;
    return { seq: this.walkerSeq, at: now, walkers: this.walkerTest === null ? [...this.walkerList] : [...this.walkerList, this.walkerTest.walker] };
  }

  /** Subscribe to the frames; the listener gets the current one at once. */
  onWalkers(listener: (frame: WalkersFrame) => void): () => void {
    listener(this.walkersFrame());
    this.walkerSubs.add(listener);
    this.armWalkers();
    return () => {
      this.walkerSubs.delete(listener);
      this.armWalkers();
    };
  }

  /** Drop every subscriber (the runtime's dispose). */
  endWalkers(): void {
    this.walkerSubs.clear();
    this.armWalkers();
  }

  /** Stream subscribers right now (tests). */
  get walkerListeners(): number {
    return this.walkerSubs.size;
  }

  /** Every frame pushed takes a new seq, a keepalive's too: a router may drop
   *  what it has seen, and a steady walk changes nothing for seconds. */
  private pushWalkers(): void {
    this.walkerSeq += 1;
    const frame = this.walkersFrame();
    for (const listener of [...this.walkerSubs]) listener(frame);
    this.armWalkers();
  }

  /** While anyone walks and anyone listens: the next keepalive, or the test
   *  walker's end if that comes first. */
  private armWalkers(): void {
    if (this.walkerTimer !== null) this.walkerTimers.clear(this.walkerTimer);
    this.walkerTimer = null;
    if (this.walkerSubs.size === 0 || this.walkersFrame().walkers.length === 0) return;
    const test = this.walkerTest;
    const ms = test === null ? FOOTSTEPS_KEEP_MS : Math.min(FOOTSTEPS_KEEP_MS, Math.max(0, test.until - this.now()));
    this.walkerTimer = this.walkerTimers.set(() => {
      this.walkerTimer = null;
      this.pushWalkers();
    }, ms);
  }

  /** The hub's clock (server epoch ms). */
  clock(): number {
    return this.now();
  }

  /** Is anything newer than the poller's view? A cursor past this hub's
   *  own counter was issued by an earlier process (a server restart counts
   *  from 1 again): stale, so the poll answers at once with today's list
   *  instead of holding a stop for the whole long poll. */
  /** (wave 40) `mix`: the mix seq the poller holds (moved when it
   *  differs); `music`: its music-command cursor (as `plays`); `watch`:
   *  whether it thinks a panel watches (moved when `mixWatched()` differs). */
  moved(after: string, testsAfter: number | null, stopsAfter: number | null = null, playsAfter: number | null = null, mixer: { mix?: number | null; music?: number | null; watch?: boolean | null } = {}): boolean {
    if (this.current().version !== after) return true;
    if (testsAfter !== null && (testsAfter > this.testSeq || this.tests().some((t) => t.seq > testsAfter))) return true;
    if (playsAfter !== null && (playsAfter > this.playSeq || this.plays().some((p) => p.seq > playsAfter))) return true;
    if (mixer.mix !== undefined && mixer.mix !== null && mixer.mix !== this.mixState.seq) return true;
    const musicAfter = mixer.music;
    if (musicAfter !== undefined && musicAfter !== null && (musicAfter > this.musicSeq || this.musicCommands().some((c) => c.seq > musicAfter))) return true;
    if (mixer.watch !== undefined && mixer.watch !== null && mixer.watch !== this.mixWatched()) return true;
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
  /** (wave 58) Trabolta at the stereo, for the mixer's view. */
  dj?: () => MusicDj | null;
}

/** (wave 58) The music card off the story's world: `Night.dj_locked`,
 *  `Night.dj_bar`, `Night.dj_last`, `Night.dj_for` and each guest's `chummy`.
 *  Null for a story that has none of it. */
export function musicDjOf(world: ReadonlyArray<{ path: string; value: unknown }>, guests: ReadonlyArray<{ id: string; name: string }>): MusicDj | null {
  const vars = new Map(world.map((w) => [w.path, w.value]));
  if (!vars.has("Night.dj_locked")) return null;
  const bar = Number(vars.get("Night.dj_bar") ?? 3);
  const pals = guests
    .map((g) => ({ name: g.name, chummy: Number(vars.get(`${g.id}.chummy`) ?? 0) }))
    .filter((g) => Number.isFinite(g.chummy) && g.chummy >= bar)
    .sort((a, b) => b.chummy - a.chummy || a.name.localeCompare(b.name))
    .slice(0, MUSIC_PALS_MAX);
  const named = (v: unknown): string | null => (typeof v === "string" && v !== "" && v !== "none" ? v : null);
  const what = named(vars.get("Night.dj_last"));
  const who = named(vars.get("Night.dj_for"));
  const locked = vars.get("Night.dj_locked");
  return { locked: locked === true || locked === "true", bar, pals, last: what !== null ? { what, who: who ?? "" } : null };
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
  /** (wave 38) The router's last health report without its `sounds` list
   *  (the house desk has that), null before one; never on the router's own
   *  read (`router=1`), which has no use for its own report. Absent from an
   *  older server. */
  health?: Omit<AudioHealth, "sounds"> | null;
  /** (wave 40) The house mixer's balance in force; the router applies it
   *  when `seq` moves and holds `mix=<seq>` on its long poll. */
  mix: AudioMix;
  /** (wave 40) The soundtrack's recent commands (≤ `MUSIC_COMMANDS`, ≤
   *  `MUSIC_COMMAND_MS` old, oldest first); the router keeps its own
   *  `music=` cursor and drops one more than 10 s old by `now`. */
  music: MusicCommandEntry[];
  /** (wave 40) A mixer panel is open: the router posts its meters. */
  mixWatch: boolean;
}

export function audioView(hub: AudioHub, ctx: AudioContext, o: { router?: boolean } = {}): AudioView {
  const cur = hub.current();
  const model = ctx.model();
  const v = validateAudio(cur.audio, ctx.house());
  const view: AudioView = { ...cur, sounds: storySounds(model), locations: storyLocations(model), tests: hub.tests(), stops: hub.stops(), plays: hub.plays(), now: hub.clock(), router: hub.router(), announceSaved: hub.announceSaved, problems: v.problems, warnings: v.warnings, mix: hub.mix(), music: hub.musicCommands(), mixWatch: hub.mixWatched() };
  if (o.router !== true) {
    const h = hub.health();
    if (h === null) view.health = null;
    else {
      const { sounds: _sounds, ...rest } = h;
      view.health = rest;
    }
  }
  return view;
}

/**
 * `GET /api/mod/audio[?after=&tests=&stops=&plays=&mix=&music=&watch=&wait=]` — the config + the long poll.
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
  // Wave 40: the mixer's cursors (the mix's seq, the music commands', the watch).
  const cursor = (k: string): number | null => {
    const raw = url.searchParams.get(k) ?? "";
    return /^\d+$/u.test(raw) ? Number(raw) : null;
  };
  const watchRaw = url.searchParams.get("watch");
  const mixer = { mix: cursor("mix"), music: cursor("music"), watch: watchRaw === "1" ? true : watchRaw === "0" ? false : null };
  const waitRaw = Number(url.searchParams.get("wait") ?? AUDIO_WAIT_S);
  const waitS = Number.isFinite(waitRaw) ? Math.min(AUDIO_WAIT_MAX_S, Math.max(0, waitRaw)) : AUDIO_WAIT_S;
  // The house Mac's router says who it is (`router=1`); the map editor's own
  // long poll does not, so it never passes for one.
  const router = url.searchParams.get("router") === "1";
  if (router) hub.noteRouter(url.searchParams.get("name"));
  if (after !== null && after !== "" && !hub.moved(after, testsAfter, stopsAfter, playsAfter, mixer) && waitS > 0) {
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
  sendJson(res, 200, audioView(hub, ctx, { router }));
  return true;
}

/** (wave 40) The house mixer's view (`GET /api/mod/audio/mixer`): the mix,
 *  the sources and rooms of the config in force (rooms named from the house
 *  map in force), the live meters (null when stale), the soundtrack now and
 *  the router's presence. Never a `by`: hosts read it too. */
export function mixerView(hub: AudioHub, ctx: AudioContext): MixerView {
  const { audio } = hub.current();
  const house = ctx.house();
  const roomName = (id: string): string | null => {
    const label = house?.rooms.find((r) => r.id === id)?.label;
    return label !== undefined && label.trim() !== "" ? label : null;
  };
  return { mix: hub.mix(), sources: mixerSources(audio), rooms: mixerRooms(audio, roomName), meters: hub.liveMeters(), music: hub.nowPlaying(), dj: ctx.dj?.() ?? null, router: hub.router(), now: hub.clock() };
}

/**
 * `GET /api/mod/audio/mixer` (wave 40) — a director's or a host's mixer
 * panel, polled every second while it is shown. Each read keeps the
 * router's meters coming (`watchMixer`). Never the router's own read.
 */
export function handleMixerGet(hub: AudioHub, ctx: AudioContext, req: IncomingMessage, res: ServerResponse, url: URL, authorized: (token: string | undefined) => boolean): boolean {
  if (!authorized(queryTokenOf(req, url))) {
    sendJson(res, 403, { error: "hosts and directors only" });
    return true;
  }
  res.setHeader?.("cache-control", "no-store");
  hub.watchMixer();
  sendJson(res, 200, mixerView(hub, ctx));
  return true;
}

/** A mix post's changes for the server log ("master −6 dB, src:music muted, …"). */
function mixChangesText(changes: readonly MixChange[], resetAll: boolean): string {
  const one = (c: MixChange): string => (c.reset === true ? `${c.key} reset` : [c.key, c.db !== undefined ? `${c.db} dB` : null, c.mute === true ? "muted" : c.mute === false ? "unmuted" : null].filter((x) => x !== null).join(" "));
  const parts = changes.slice(0, 4).map(one);
  if (changes.length > 4) parts.push(`+${changes.length - 4} more`);
  return [resetAll ? "reset all" : null, parts.length > 0 ? parts.join(", ") : null].filter((x) => x !== null).join(", then ");
}

/** A music command for the server log. */
function musicCommandText(c: MusicCommand): string {
  switch (c.action) {
    case "next":
      return c.playlist !== undefined ? `skipped the ${c.playlist} bed's track` : "skipped every bed's track";
    case "scene":
      return `played the ${c.scene} scene by hand`;
    case "stop":
      return "stopped the soundtrack";
    case "story":
      return "let the story's music cues back in";
    case "previous":
      return "went back a track";
    case "pause":
      return "paused the app";
    case "resume":
      return "played the app again";
    case "playlist":
      return `played the ${c.playlist} playlist by hand`;
    case "tidal":
      return `played ${c.title ?? c.id} from the app by hand`;
  }
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
    case "/api/mod/audio/walkers/test": {
      const id = body["speaker"];
      if (id === undefined) {
        sendJson(res, 400, { error: "a walker test needs a speaker" });
        return true;
      }
      if (typeof id !== "string" || !hub.config().speakers.some((s) => s.id === id)) {
        sendJson(res, 404, { error: "no such speaker" });
        return true;
      }
      hub.testWalker(id);
      sendJson(res, 200, { ok: true });
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
    case "/api/mod/audio/mix": {
      // Wave 40: the house mixer (a director's Run → House → 🎚 Mixer, a host's Desk).
      const raw = body["changes"];
      const resetAll = body["resetAll"];
      if (resetAll !== undefined && typeof resetAll !== "boolean") {
        sendJson(res, 400, { error: "resetAll must be true or false" });
        return true;
      }
      if (raw === undefined ? resetAll !== true : !Array.isArray(raw)) {
        sendJson(res, 400, { error: "changes must be a list of {key, db?, mute?, reset?}" });
        return true;
      }
      const list = (raw ?? []) as unknown[];
      if (list.length > MIX_CHANGES_MAX) {
        sendJson(res, 400, { error: `at most ${MIX_CHANGES_MAX} changes in one post` });
        return true;
      }
      const changes: MixChange[] = [];
      for (const [i, c] of list.entries()) {
        const change = mixChangeOf(c);
        if (typeof change === "string") {
          sendJson(res, 400, { error: `changes[${i}]: ${change}` });
          return true;
        }
        changes.push(change);
      }
      if (changes.length === 0 && resetAll !== true) {
        sendJson(res, 400, { error: "send changes or resetAll" });
        return true;
      }
      const mix = hub.setMix(changes, { resetAll: resetAll === true });
      if (typeof mix === "string") {
        sendJson(res, 400, { error: mix });
        return true;
      }
      process.stdout.write(`  🎚 audio: ${by} moved the mix: ${mixChangesText(changes, resetAll === true)} (${Object.keys(mix.levels).length} level(s) off unity, seq ${mix.seq})\n`);
      sendJson(res, 200, { ok: true, mix });
      return true;
    }
    case "/api/mod/audio/music": {
      const cmd = musicCommandOf(body);
      if (typeof cmd === "string") {
        sendJson(res, 400, { error: cmd });
        return true;
      }
      const entry = hub.music(cmd, by);
      process.stdout.write(`  🎚 audio: ${by} ${musicCommandText(cmd)}\n`);
      sendJson(res, 200, { ok: true, seq: entry.seq, router: hub.router() });
      return true;
    }
    case "/api/mod/audio/meters": {
      // The router's own (never a host's): its live meters while a panel watches.
      const watch = hub.meters(mixerMetersOf(body, hub.clock()));
      sendJson(res, 200, { ok: true, watch });
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
