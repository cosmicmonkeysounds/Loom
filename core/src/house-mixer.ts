//! The house mixer (wave 40): a live balance of the house sound, as pure
//! data — shared by the event server (`server/audio.ts` keeps it and hands
//! it to the router), the editor's Run → House → 🎚 Mixer and the play
//! app's host Desk window (both draw and move it). The contract is
//! `docs/loom-w40-contract.md`; stagehand's `audio/mix.py` mirrors
//! `effectiveDb` (pinned by `test/fixtures/house-mixer.json`, copied byte for
//! byte into `stagehand/tests/fixtures/`).
//!
//! A **level** is `{db, mute}` under one **key**:
//!
//! | key | what it moves |
//! |---|---|
//! | `master` | everything the mixer moves, everywhere |
//! | `src:<source>` | one source everywhere |
//! | `room:<room>` | everything in one room |
//! | `room:<room>/src:<source>` | one source in one room |
//! | `spk:<speaker>` | one speaker (the sub, say) |
//!
//! What a source plays on a speaker is the sum of the five levels that
//! apply (an absent key is 0 dB, unmuted); any mute, or any level at the
//! floor (`MIX_DB_MIN`), silences it. The mix is a live balance on top of
//! `audio.json` (its speakers' `gain` stays the install trim) and never
//! touches the story: it is kept in the event's state dir, never
//! journaled, and outlives a server or router restart.
//!
//! The **sources**: the five buses the router plays (`music`, the
//! soundtrack's playlists; `tracks`, the featured songs a story `sound`
//! plays; `sfx`, every other story or desk sound; `steps`, the programs'
//! footsteps in the real house, wave 49, on the sfx bus and ducked like it;
//! `announce`, the house announcements) and each input the router routes
//! (`in:<role>`, e.g.
//! `in:trabolta`, the TV). An input with a role but no route (Clippy's mic,
//! mixed in CueMix) is shown as a meter only. Speaker tests never go
//! through the mix, so a muted room can still be walked.
//!
//! Dependency-free on purpose (like `house-desk.ts`): the play app imports
//! this file by path, so the audio config is a structural type here.

/** The fader's range (dB). At the floor a level is silent. */
export const MIX_DB_MIN = -60;
export const MIX_DB_MAX = 10;
/** A level is stored to this step (dB). */
export const MIX_DB_STEP = 0.5;
/** At most this many levels in a mix, changes in one post. */
export const MIX_LEVELS_MAX = 256;
export const MIX_CHANGES_MAX = 64;
/** A room, speaker or source id inside a key. */
export const MIX_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/u;
/** The router's buses, in the mixer's order. */
export const MIX_BUS_SOURCES = ["music", "tracks", "sfx", "steps", "announce"] as const;
export type MixBusSource = (typeof MIX_BUS_SOURCES)[number];
export const MIX_BUS_LABELS: Record<MixBusSource, string> = {
  music: "Music",
  tracks: "Featured tracks",
  sfx: "Sound effects",
  steps: "Footsteps",
  announce: "Announcements",
};
/** A mixer view keeps the panel's meters live this long after its last GET (ms). */
export const MIX_WATCH_MS = 8_000;
/** Meters older than this are not shown (ms). */
export const MIX_METERS_STALE_MS = 3_000;
/** The router sends meters this often while someone watches (ms). */
export const MIX_METERS_EVERY_MS = 250;
/** How long a music command waits for the router (ms): older ones are dropped. */
export const MUSIC_COMMAND_MS = 60_000;
export const MUSIC_COMMANDS = 16;
/** (wave 58) At most this many TIDAL playlists in a report. */
export const MUSIC_LIBRARY_MAX = 64;
/** (wave 58) At most this many of Trabolta's pals in a view. */
export const MUSIC_PALS_MAX = 12;
/** (wave 58) A TIDAL playlist's id: the end of its share link. */
export const TIDAL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** (wave 58) The story's cues that keep Trabolta off the music, and let him back. */
export const DJ_LOCK_CUE = "trabolta_music_lock";
export const DJ_UNLOCK_CUE = "trabolta_music_unlock";

export interface MixLevel {
  db: number;
  mute: boolean;
}

/** The mix in force: its levels and a counter that moves with each change. */
export interface AudioMix {
  seq: number;
  levels: Record<string, MixLevel>;
}

export const UNITY: MixLevel = { db: 0, mute: false };

export type MixScope = { kind: "all" } | { kind: "room"; room: string } | { kind: "speaker"; speaker: string };

/** A level's key: a scope, and a source within it (none = the scope's own master). */
export function mixKey(scope: MixScope, source?: string): string {
  const src = source !== undefined ? `src:${source}` : null;
  switch (scope.kind) {
    case "all":
      return src ?? "master";
    case "room":
      return src !== null ? `room:${scope.room}/${src}` : `room:${scope.room}`;
    case "speaker":
      return `spk:${scope.speaker}`;
  }
}

export interface ParsedMixKey {
  scope: MixScope;
  source: string | null;
}

/** A source id inside a key: a bus, or `in:<role or channel>`. */
function sourceOk(s: string): boolean {
  if ((MIX_BUS_SOURCES as readonly string[]).includes(s)) return true;
  return s.startsWith("in:") && MIX_ID_RE.test(s.slice(3));
}

/** A key's scope and source, or null for a key the grammar does not know. */
export function parseMixKey(key: string): ParsedMixKey | null {
  if (key === "master") return { scope: { kind: "all" }, source: null };
  if (key.startsWith("src:")) {
    const s = key.slice(4);
    return sourceOk(s) ? { scope: { kind: "all" }, source: s } : null;
  }
  if (key.startsWith("spk:")) {
    const id = key.slice(4);
    return MIX_ID_RE.test(id) ? { scope: { kind: "speaker", speaker: id }, source: null } : null;
  }
  if (key.startsWith("room:")) {
    const rest = key.slice(5);
    const slash = rest.indexOf("/");
    const room = slash < 0 ? rest : rest.slice(0, slash);
    if (!MIX_ID_RE.test(room)) return null;
    if (slash < 0) return { scope: { kind: "room", room }, source: null };
    const tail = rest.slice(slash + 1);
    if (!tail.startsWith("src:") || !sourceOk(tail.slice(4))) return null;
    return { scope: { kind: "room", room }, source: tail.slice(4) };
  }
  return null;
}

/** A level's dB on the fader's grid. */
export function clampMixDb(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const c = Math.min(MIX_DB_MAX, Math.max(MIX_DB_MIN, db));
  return Math.round(c / MIX_DB_STEP) * MIX_DB_STEP;
}

/** A level as the mix holds it (absent = unity). */
export function levelOf(levels: Readonly<Record<string, MixLevel>>, key: string): MixLevel {
  return levels[key] ?? UNITY;
}

/** Is this level the default (so it is not stored)? */
export function isUnity(l: MixLevel): boolean {
  return l.db === 0 && !l.mute;
}

/** One change a post makes: set a key's dB and / or mute, or reset it. */
export interface MixChange {
  key: string;
  db?: number;
  mute?: boolean;
  reset?: boolean;
}

/** A post's `changes[i]`, or the reason it is refused. */
export function mixChangeOf(raw: unknown): MixChange | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "a change is {key, db?, mute?, reset?}";
  const r = raw as Record<string, unknown>;
  const key = r["key"];
  if (typeof key !== "string" || parseMixKey(key) === null) return "key must be master, src:<source>, room:<room>, room:<room>/src:<source> or spk:<speaker>";
  const out: MixChange = { key };
  if (r["reset"] !== undefined) {
    if (r["reset"] !== true) return "reset must be true";
    out.reset = true;
    return out;
  }
  if (r["db"] !== undefined) {
    if (typeof r["db"] !== "number" || !Number.isFinite(r["db"])) return "db must be a number";
    out.db = clampMixDb(r["db"]);
  }
  if (r["mute"] !== undefined) {
    if (typeof r["mute"] !== "boolean") return "mute must be true or false";
    out.mute = r["mute"];
  }
  if (out.db === undefined && out.mute === undefined) return "a change sets db, mute or reset";
  return out;
}

/** The levels after `changes` (in order; a level back at unity is dropped). */
export function applyMixChanges(levels: Readonly<Record<string, MixLevel>>, changes: readonly MixChange[]): Record<string, MixLevel> {
  const next: Record<string, MixLevel> = { ...levels };
  for (const c of changes) {
    if (c.reset === true) {
      delete next[c.key];
      continue;
    }
    const was = levelOf(next, c.key);
    const l: MixLevel = { db: c.db !== undefined ? clampMixDb(c.db) : was.db, mute: c.mute ?? was.mute };
    if (isUnity(l)) delete next[c.key];
    else next[c.key] = l;
  }
  return next;
}

/** A stored mix's levels as far as they are sound (anything else is dropped). */
export function mixLevelsOf(raw: unknown): Record<string, MixLevel> {
  const out: Record<string, MixLevel> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MIX_LEVELS_MAX) break;
    if (parseMixKey(key) === null || typeof v !== "object" || v === null) continue;
    const l = v as Record<string, unknown>;
    const db = typeof l["db"] === "number" && Number.isFinite(l["db"]) ? clampMixDb(l["db"]) : 0;
    const level: MixLevel = { db, mute: l["mute"] === true };
    if (!isUnity(level)) out[key] = level;
  }
  return out;
}

/** Where a source plays: the speaker and its room (either may be absent:
 *  an output no speaker uses has neither). */
export interface MixTarget {
  source: string;
  room?: string | null;
  speaker?: string | null;
}

/** The keys that apply to a source on a speaker, outermost first. */
export function mixKeysFor(t: MixTarget): string[] {
  const keys = ["master", `src:${t.source}`];
  if (t.room !== undefined && t.room !== null && t.room !== "") keys.push(`room:${t.room}`, `room:${t.room}/src:${t.source}`);
  if (t.speaker !== undefined && t.speaker !== null && t.speaker !== "") keys.push(`spk:${t.speaker}`);
  return keys;
}

/** The mix's gain (dB) for a source on a speaker, or null when silenced
 *  (any mute, or any level at the floor). Unclamped: the sum can pass the
 *  fader's range, the router's limiter catches the top. */
export function effectiveDb(levels: Readonly<Record<string, MixLevel>>, t: MixTarget): number | null {
  let db = 0;
  for (const key of mixKeysFor(t)) {
    const l = levelOf(levels, key);
    if (l.mute || l.db <= MIX_DB_MIN) return null;
    db += l.db;
  }
  return db;
}

// -- the panel's view -----------------------------------------------------------

/** The structural slice of `audio.json` the mixer reads. */
export interface MixerAudioShape {
  inputs: ReadonlyArray<{ ch: number; label?: string; role?: string }>;
  speakers: ReadonlyArray<{ id: string; name?: string; room?: string; out: readonly number[] }>;
  routes?: ReadonlyArray<{ in: number; out: readonly number[] }>;
}

export interface MixerSource {
  /** `music` | `tracks` | `sfx` | `steps` | `announce` | `in:<role or ch>`. */
  id: string;
  label: string;
  kind: "bus" | "input";
  /** An input's channel (1-based). */
  ch?: number;
  role?: string;
  /** Shown with its meter but no fader: the router does not play it (a mic mixed in CueMix). */
  meterOnly: boolean;
}

/** An input's source id: its role, else its channel. */
export function inputSourceId(input: { ch: number; role?: string }): string {
  return input.role !== undefined && input.role !== "" ? `in:${input.role}` : `in:${input.ch}`;
}

/** The mixer's sources for a config: the buses, every routed input (a
 *  fader), every role input with no route (a meter). */
export function mixerSources(audio: MixerAudioShape): MixerSource[] {
  const out: MixerSource[] = MIX_BUS_SOURCES.map((id) => ({ id, label: MIX_BUS_LABELS[id], kind: "bus" as const, meterOnly: false }));
  const routed = new Set((audio.routes ?? []).filter((r) => r.out.length > 0).map((r) => r.in));
  const seen = new Set<string>();
  for (const input of audio.inputs) {
    const hasRole = input.role !== undefined && input.role !== "";
    if (!routed.has(input.ch) && !hasRole) continue;
    const id = inputSourceId(input);
    if (seen.has(id)) continue;
    seen.add(id);
    const label = hasRole ? `${roleLabel(input.role!)} (in ${input.ch})` : (input.label ?? `Input ${input.ch}`);
    out.push({ id, label, kind: "input", ch: input.ch, ...(hasRole ? { role: input.role! } : {}), meterOnly: !routed.has(input.ch) });
  }
  return out;
}

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).replace(/[_-]+/gu, " ");
}

export interface MixerSpeaker {
  id: string;
  name: string;
  out: number[];
}

export interface MixerRoom {
  id: string;
  name: string;
  speakers: MixerSpeaker[];
}

/** The rooms with speakers, in the config's order (`roomName` names them
 *  from the house map; a speaker with no room sits in `""`, "Unplaced"). */
export function mixerRooms(audio: MixerAudioShape, roomName: (id: string) => string | null = () => null): MixerRoom[] {
  const rooms = new Map<string, MixerRoom>();
  for (const s of audio.speakers) {
    const id = s.room ?? "";
    let room = rooms.get(id);
    if (room === undefined) {
      room = { id, name: id === "" ? "Unplaced" : (roomName(id) ?? id), speakers: [] };
      rooms.set(id, room);
    }
    room.speakers.push({ id: s.id, name: s.name ?? s.id, out: [...s.out] });
  }
  return [...rooms.values()];
}

/** The router's live meters (dBFS peaks since its last packet). */
export interface MixerMeters {
  /** Server epoch ms it arrived. */
  at: number;
  /** Output channel ("1"…) → peak dBFS after the mix and the limiter. */
  outputs: Record<string, number>;
  /** Input channel ("1"…) → peak dBFS. */
  inputs: Record<string, number>;
  /** Each ducking source → its activity, 0..1. */
  sources: Record<string, number>;
  /** Each bus source (`music` …) → output channel → its peak dBFS after
   *  the mix, before the limiter (absent from a router that sends none). */
  buses?: Record<string, Record<string, number>>;
}

export interface MixerMusicBed {
  playlist: string;
  speakers: string[];
  track: string | null;
  posS: number;
  /** The track's length (s), when the router knows it. */
  durS?: number;
  /** (wave 58) The bed is the TIDAL app's sound, not a file. */
  live?: boolean;
}

export interface MixerPlaylist {
  name: string;
  tracks: number;
  loop: boolean;
}

/** (wave 58) One playlist in the TIDAL app's sidebar. */
export interface MixerTidalPlaylist {
  id: string;
  title: string;
  items?: number;
}

/** (wave 58) The TIDAL app, as the router sees it. */
export interface MixerTidal {
  /** The app answers on its debug port. */
  online: boolean;
  playing: boolean;
  /** Paused by hand, or by Trabolta: it stays paused until resumed. */
  paused: boolean;
  track: string | null;
  /** Why the app is not doing what it was told, in words (null: all is well). */
  problem: string | null;
  /** The playlist the app was told to play (its id), null with none. */
  playlist: string | null;
  library: MixerTidalPlaylist[];
}

/** The soundtrack as the panel shows it (the router's `music` report). */
export interface MixerMusic {
  scene: string | null;
  beds: MixerMusicBed[];
  missing: string[];
  /** (wave 40) Every scene the soundtrack defines (`off` included). */
  scenes?: string[];
  /** (wave 40) The scene was picked by hand: the story's music cues are held until "Follow the story". */
  hand?: boolean;
  /** (wave 40) Every playlist and its size. */
  playlists?: MixerPlaylist[];
  /** (wave 58) The app, on a router that has it. */
  tidal?: MixerTidal;
  /** (wave 58) The hand is Trabolta's: it ends by itself. */
  loan?: boolean;
}

/** What a director or host may tell the soundtrack. */
export type MusicCommand =
  /** Skip to the next track: in one playlist's bed, or every bed. */
  | { action: "next"; playlist?: string }
  /** Play a scene by hand (held against the story's catch-ups). */
  | { action: "scene"; scene: string }
  /** Stop the soundtrack (held, like a hand scene). */
  | { action: "stop" }
  /** Let go of a hand scene: the story's scene again, now. */
  | { action: "story" }
  /** (wave 58) The app's ⏮. */
  | { action: "previous" }
  /** (wave 58) Pause the app; it stays paused until `resume` or a scene change. */
  | { action: "pause" }
  /** (wave 58) Play the app again. */
  | { action: "resume" }
  /** (wave 58) A show playlist by hand, on the main bed's speakers. */
  | { action: "playlist"; playlist: string }
  /** (wave 58) Any TIDAL playlist by hand, the same way. */
  | { action: "tidal"; id: string; title?: string };

/** A queued command, as the router reads it. */
export type MusicCommandEntry = MusicCommand & { seq: number; at: number; by: string };

/** (wave 58) The playlist id in a share link or a bare id, or null for
 *  anything else (an album's or a track's link has none). */
export function tidalPlaylistId(text: string): string | null {
  const hit = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.exec(text.trim());
  return hit !== null ? hit[0].toLowerCase() : null;
}

/** A post's body as a music command, or the reason it is refused. */
export function musicCommandOf(raw: unknown): MusicCommand | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "send {action}";
  const r = raw as Record<string, unknown>;
  switch (r["action"]) {
    case "next": {
      const p = r["playlist"];
      if (p === undefined || p === null) return { action: "next" };
      if (typeof p !== "string" || !MIX_ID_RE.test(p)) return "playlist must be a playlist name";
      return { action: "next", playlist: p };
    }
    case "scene": {
      const s = r["scene"];
      if (typeof s !== "string" || !MIX_ID_RE.test(s)) return "scene must be a scene name";
      return { action: "scene", scene: s };
    }
    case "stop":
      return { action: "stop" };
    case "story":
      return { action: "story" };
    case "previous":
      return { action: "previous" };
    case "pause":
      return { action: "pause" };
    case "resume":
      return { action: "resume" };
    case "playlist": {
      const p = r["playlist"];
      if (typeof p !== "string" || !MIX_ID_RE.test(p)) return "playlist must be a playlist name";
      return { action: "playlist", playlist: p };
    }
    case "tidal": {
      const id = r["id"];
      if (typeof id !== "string" || !TIDAL_ID_RE.test(id)) return "id must be a TIDAL playlist id";
      const title = r["title"];
      if (typeof title === "string" && title.trim() !== "") return { action: "tidal", id, title: title.trim().slice(0, 80) };
      return { action: "tidal", id };
    }
    default:
      return "action must be next, scene, stop, story, previous, pause, resume, playlist or tidal";
  }
}

/** (wave 58) Trabolta at the stereo: the panel's card, off the story. */
export interface MusicDj {
  /** A host or a director has kept him off the music. */
  locked: boolean;
  /** How chummy a program must be before he will do it for them. */
  bar: number;
  /** The programs at or over the bar, the chummiest first. */
  pals: Array<{ name: string; chummy: number }>;
  /** What he did last, and for whom. */
  last: { what: string; who: string } | null;
}

/** `GET /api/mod/audio/mixer`: everything the panel draws. */
export interface MixerView {
  mix: AudioMix;
  sources: MixerSource[];
  rooms: MixerRoom[];
  /** The router's last meters, null when none arrived in `MIX_METERS_STALE_MS`. */
  meters: MixerMeters | null;
  /** The soundtrack, null before the router reports one (or it has none). */
  music: MixerMusic | null;
  /** (wave 58) Trabolta at the stereo; null for a story without the power. */
  dj?: MusicDj | null;
  router: { online: boolean; lastSeen: number | null; name: string | null };
  /** Server epoch ms. */
  now: number;
}

/** A meter's 0..1 fill for a dBFS peak (−60 dB … 0 dB). */
export function meterFill(db: number | null | undefined): number {
  if (db === null || db === undefined || !Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db - MIX_DB_MIN) / -MIX_DB_MIN));
}

/** The loudest output peak among a set of outputs (dBFS), or null. */
export function peakOf(meters: MixerMeters | null, outs: readonly number[]): number | null {
  if (meters === null) return null;
  let best: number | null = null;
  for (const o of outs) {
    const v = meters.outputs[String(o)];
    if (typeof v === "number" && (best === null || v > best)) best = v;
  }
  return best;
}

/** A dB for a label: "+3.0", "−12.5", "−∞" at the floor. */
export function formatMixDb(db: number): string {
  if (db <= MIX_DB_MIN) return "−∞";
  if (db === 0) return "0.0";
  return `${db > 0 ? "+" : "−"}${Math.abs(db).toFixed(1)}`;
}

// -- the panel's strips (both apps draw these) ----------------------------------

/** The scopes a panel offers: everywhere, then each room with speakers. */
export function mixerScopes(view: Pick<MixerView, "rooms">): Array<{ scope: MixScope; id: string; label: string }> {
  return [{ scope: { kind: "all" }, id: "all", label: "Everywhere" }, ...view.rooms.map((r) => ({ scope: { kind: "room", room: r.id } as MixScope, id: `room:${r.id}`, label: r.name }))];
}

/** One fader (or meter) row in a scope. */
export interface MixerStrip {
  key: string | null;
  label: string;
  kind: "scope" | "source" | "speaker" | "meter";
  /** The level under `key` (unity for a meter). */
  level: MixLevel;
  /** What this strip's sound plays at with every outer level summed (null = silent). */
  effective: number | null;
  /** The live peak (dBFS) to draw, null when there is none to read. */
  meterDb: number | null;
  /** A source id for a source or meter strip. */
  source?: string;
  /** A speaker strip's speaker. */
  speaker?: string;
  /** Why a meter strip has no fader. */
  note?: string;
}

function outsOf(view: Pick<MixerView, "rooms">, scope: MixScope): number[] {
  const rooms = scope.kind === "room" ? view.rooms.filter((r) => r.id === scope.room) : view.rooms;
  return [...new Set(rooms.flatMap((r) => r.speakers.flatMap((s) => s.out)))];
}

function busPeak(meters: MixerMeters | null, source: string, outs: readonly number[]): number | null {
  const per = meters?.buses?.[source];
  if (per === undefined) return null;
  let best: number | null = null;
  for (const o of outs) {
    const v = per[String(o)];
    if (typeof v === "number" && (best === null || v > best)) best = v;
  }
  return best;
}

/** The strips of one scope, top to bottom: the scope's own master, each
 *  source (a meter only for an input the router does not play), and in a
 *  room each speaker. `levels` defaults to the view's (pass the panel's
 *  optimistic copy while a fader moves). */
export function scopeStrips(view: MixerView, scope: MixScope, levels: Readonly<Record<string, MixLevel>> = view.mix.levels): MixerStrip[] {
  const outs = outsOf(view, scope);
  const room = scope.kind === "room" ? scope.room : null;
  const masterKey = mixKey(scope);
  const strips: MixerStrip[] = [];
  const scopeDb = (() => {
    let db = 0;
    for (const key of room === null ? ["master"] : ["master", `room:${room}`]) {
      const l = levelOf(levels, key);
      if (l.mute || l.db <= MIX_DB_MIN) return null;
      db += l.db;
    }
    return db;
  })();
  strips.push({ key: masterKey, label: room === null ? "Master" : "Room", kind: "scope", level: levelOf(levels, masterKey), effective: scopeDb, meterDb: peakOf(view.meters, outs) });
  for (const src of view.sources) {
    if (src.meterOnly) {
      strips.push({ key: null, label: src.label, kind: "meter", level: UNITY, effective: null, meterDb: src.ch !== undefined ? (view.meters?.inputs[String(src.ch)] ?? null) : null, source: src.id, note: "Mixed outside the router (CueMix): meter only" });
      continue;
    }
    const key = mixKey(scope, src.id);
    const meterDb = src.kind === "input" ? (src.ch !== undefined ? (view.meters?.inputs[String(src.ch)] ?? null) : null) : busPeak(view.meters, src.id, outs);
    strips.push({ key, label: src.label, kind: "source", level: levelOf(levels, key), effective: effectiveDb(levels, { source: src.id, room }), meterDb, source: src.id });
  }
  if (room !== null) {
    const r = view.rooms.find((x) => x.id === room);
    for (const sp of r?.speakers ?? []) {
      const key = mixKey({ kind: "speaker", speaker: sp.id });
      const l = levelOf(levels, key);
      const effective = scopeDb === null || l.mute || l.db <= MIX_DB_MIN ? null : scopeDb + l.db;
      strips.push({ key, label: sp.name, kind: "speaker", level: l, effective, meterDb: peakOf(view.meters, sp.out), speaker: sp.id });
    }
  }
  return strips;
}

/** Every stored key a scope's Reset clears (its strips' keys that hold a level). */
export function scopeKeys(view: MixerView, scope: MixScope): string[] {
  return scopeStrips(view, scope)
    .map((s) => s.key)
    .filter((k): k is string => k !== null && view.mix.levels[k] !== undefined);
}
