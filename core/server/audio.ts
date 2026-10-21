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
//! - `POST /api/mod/audio/test {speaker} | {out}` → `{ok, seq}`: the router
//!   plays an identifying tone + label there (the last `AUDIO_TESTS`, memory
//!   only, `AUDIO_TEST_MS` old at most, ride every GET).
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

/** How many tests ride a GET, and for how long. */
export const AUDIO_TESTS = 8;
export const AUDIO_TEST_MS = 60_000;
/** The long poll's default and longest wait (seconds). */
export const AUDIO_WAIT_S = 25;
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

/** The config an event plays, its tests, and the long poll's waiters. */
export class AudioHub {
  private readonly store: Store;
  private projectText: string | null;
  private projectMemo: { text: string; audio: AudioConfig | null } | null = null;
  private director: AudioConfig | null;
  private readonly envFile: string | null;
  private envMemo: { mtimeMs: number; audio: AudioConfig | null } | null = null;
  private readonly now: () => number;
  private testLog: AudioTest[] = [];
  private testSeq = 0;
  private waiters = new Set<() => void>();
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
    const pick = (audio: AudioConfig, source: AudioSource) => ({ audio, version: audioHash(audio), source });
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
    this.wake();
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

  /** Is anything newer than the poller's view? */
  moved(after: string, testsAfter: number | null): boolean {
    if (this.current().version !== after) return true;
    return testsAfter !== null && this.tests().some((t) => t.seq > testsAfter);
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
  /** The config in force checked against the house in force (a map edit
   *  can leave a speaker outside its room) — advice, never a refusal here. */
  problems: string[];
  warnings: string[];
}

export function audioView(hub: AudioHub, ctx: AudioContext): AudioView {
  const cur = hub.current();
  const model = ctx.model();
  const v = validateAudio(cur.audio, ctx.house());
  return { ...cur, sounds: storySounds(model), locations: storyLocations(model), tests: hub.tests(), problems: v.problems, warnings: v.warnings };
}

/**
 * `GET /api/mod/audio[?after=&tests=&wait=]` — the config + the long poll.
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
  const waitRaw = Number(url.searchParams.get("wait") ?? AUDIO_WAIT_S);
  const waitS = Number.isFinite(waitRaw) ? Math.min(AUDIO_WAIT_MAX_S, Math.max(0, waitRaw)) : AUDIO_WAIT_S;
  if (after !== null && after !== "" && !hub.moved(after, testsAfter) && waitS > 0) {
    const w = hub.waitChange(waitS * 1000);
    // A caller that hangs up frees its waiter at once.
    req.on?.("close", w.cancel);
    await w.done;
  }
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
        sendJson(res, 200, { ok: true, seq: hub.test({ speaker: id }).seq });
        return true;
      }
      const out = body["out"];
      if (typeof out !== "number" || !Number.isInteger(out) || out < 1 || out > audio.device.outputs) {
        sendJson(res, 400, { error: `out must be an output from 1 to ${audio.device.outputs}` });
        return true;
      }
      sendJson(res, 200, { ok: true, seq: hub.test({ out }).seq });
      return true;
    }
    default:
      return false;
  }
}
