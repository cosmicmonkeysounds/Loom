//! The house desk (wave 25): the server half of `desk.json`, the house's own
//! cue list. The pure model (schema, validation, groups, the run state
//! machine, the checks) is `src/house-desk.ts`; the contract is
//! `docs/loom-house-desk.md`. This module holds the desk an event plays, its
//! runs, the playhead, the check marks and the recent activity, and the
//! routes. What is in force:
//!
//! 1. a director's save (`POST /api/mod/desk`, Run → House) — kept in the
//!    event's state dir, it wins until a Save to project replaces it;
//! 2. the project's `desk.json`, snapshotted at launch / reload beside the
//!    maps (the event row's `house_maps` record, key `desk.json`);
//! 3. `LOOM_DESK` — the LAN fallback file (re-read on mtime, last good kept);
//! 4. `defaultDesk()` (an empty list).
//!
//! `DeskView.source` has no `env`: a desk from `LOOM_DESK` reads `default`
//! there (nothing of this event's own); `DeskHub.current().source` says `env`.
//!
//! **Memory only:** the runs, the playhead and the activity. A restart
//! drops a run mid-cue and its `done` never fires (a host can GO it again or
//! fire its event). The check marks are kept in the state dir
//! (`desk-marks.json`), never in the journal: setup happens days before the
//! show. The story events a run fires (`event` steps, `done`) are journaled
//! signals labelled `House desk` (the runtime's `deskFire`), so a replay
//! re-derives the story without the desk; a replay never starts a run (only
//! a live `cue X`, seen in the runtime's `fanout`, does).
//!
//! Routes (a mod token or the owning author's session; **H** = the host
//! allowlist too):
//! - `GET /api/mod/desk[?after=<rev>&wait=<s>]` → `DeskView` (H); with
//!   `after` a long poll (answers at once when `rev` moved on, else after
//!   the first change or `wait` s, default 25, at most 30);
//! - `POST /api/mod/desk {desk, base?}` → `{ok, version, source, warnings}`;
//!   400 `{problems}`; 409 `{error: "stale", version}`;
//! - `POST /api/mod/desk/project` → the desk in force becomes the project's
//!   `desk.json` (409 `no project`);
//! - `POST /api/mod/desk/go {cue?, standby?}` → `{ok, run, standby}` (H;
//!   `run` is the new run's number); 409 `{error: "moved", standby}` on a
//!   stale playhead, 404 no such cue, 409 `{error: "end"}`;
//! - `POST /api/mod/desk/standby {cue}` → `{ok, standby}` (H);
//! - `POST /api/mod/desk/stop {run} | {all: true, announce?}` → `{ok, stopped}` (H);
//! - `POST /api/mod/desk/check {key, mark, note?}` → `{ok}` (H; 404 for a
//!   key that isn't one of this house's checks);
//! - `POST /api/mod/desk/check/reset` → every mark cleared.
//!
//! Transport-light: `DeskHub` takes an injected clock, timers, store and the
//! `DeskDeps` that play a step; the handlers take the runtime's context.

import { readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

import { planLook, resolveLightTargets, type AudioConfig, type HouseMap, type LightsConfig } from "@loom/house";

import {
  DESK_ACK_MS,
  DESK_FILE,
  DESK_SPEECH_GRACE_MS,
  DESK_SPEECH_MS,
  DESK_STOP_MS,
  beginRun,
  checkKey,
  cueAfter,
  defaultDesk,
  deskChecks,
  deskEvents,
  deskHash,
  foldDeskName,
  runWakeAt,
  stepEnded,
  stepLength,
  stepStarted,
  stepText,
  stopRun,
  tickRun,
  validateDesk,
  type DeskActivity,
  type DeskAudioHealth,
  type DeskConfig,
  type DeskCue,
  type DeskHouse,
  type DeskLightState,
  type DeskMark,
  type DeskMind,
  type DeskRefs,
  type DeskRun,
  type DeskStep,
  type DeskView,
} from "../src/house-desk.ts";
import { foldName } from "../src/parser/names.ts";
import { isBuiltinVerb, type SimModel } from "../src/runtime/sim/model.ts";
import { storyLocations, storySounds, type AudioAck, type AudioHealth, type AudioPlayRequest, type AudioRouterPresence } from "./audio.ts";
import { queryTokenOf, sendJson } from "./http-util.ts";
import type { LightPair, LightsModule, Z2mDevice } from "./lights.ts";
import type { Store } from "./store.ts";

export { DESK_FILE } from "../src/house-desk.ts";

/** Where the desk in force comes from. */
export type DeskSource = "director" | "project" | "env" | "default";

/** The journal's `by` on every story event the desk fires (§3). */
export const DESK_BY = "House desk";
/** The `by` of a run the story's `cue X` started. */
export const DESK_STORY_BY = "the story";
/** Ended runs kept in the view: the last 8, at most 2 min old. */
export const DESK_ENDED_RUNS = 8;
export const DESK_ENDED_MS = 120_000;
/** The recent activity kept. */
export const DESK_ACTIVITY = 20;
/** The long poll's default and longest wait (seconds). */
export const DESK_WAIT_S = 25;
export const DESK_WAIT_MAX_S = 30;
/** How deep story `cue X`s a desk event raises may chain (a cue whose
 *  event cues another …) before the desk refuses one: no loop runs forever. */
export const DESK_CHAIN_MAX = 8;
/** A check mark's note, at most. */
export const DESK_NOTE_MAX = 200;

/** Is `path` the project's desk file (at the project's root)? */
export function isDeskFile(path: string): boolean {
  return path === DESK_FILE;
}

/** The `desk.json` text among a project's files, or null (an empty file —
 *  just created — counts as none). */
export function deskFileOf(files: Iterable<{ path: string; content: string }>): string | null {
  for (const f of files) if (isDeskFile(f.path)) return f.content.trim() === "" ? null : f.content;
  return null;
}

/** The `desk.json` string inside an untrusted data-file record (the event
 *  row's `house_maps` jsonb, a `/api/mod/load` body). */
export function deskOf(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>)[DESK_FILE];
  return typeof v === "string" ? v : null;
}

/** Parse + shape-check a `desk.json` text (no refs: a look the lights lost
 *  must not silently drop the whole desk mid-show). */
export function parseDeskText(text: string): { desk: DeskConfig | null; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { desk: null, problems: [`not JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const v = validateDesk(raw);
  return v.ok ? { desk: raw as DeskConfig, problems: [] } : { desk: null, problems: v.problems };
}

/** The problems a project `desk.json` write would be refused for ([] = fine). */
export function deskProblems(text: string): string[] {
  return parseDeskText(text).problems;
}

/** A `desk.json` as a project file: pretty, one trailing newline. */
export function deskFileText(desk: DeskConfig): string {
  return `${JSON.stringify(desk, null, 2)}\n`;
}

/** The story's `when <event>:` names (named events only: no timers, no
 *  conditions, no built-in verbs), sorted, deduped by folded name. */
export function storyWhenEvents(model: SimModel | null): string[] {
  if (model === null) return [];
  const out = new Map<string, string>();
  const collect = (hooks: ReadonlyArray<{ verb: string; timer: unknown; condition: unknown }>): void => {
    for (const h of hooks) {
      if (h.timer !== null || h.condition !== null || h.verb === "" || isBuiltinVerb(h.verb)) continue;
      const k = foldName(h.verb);
      if (!out.has(k)) out.set(k, h.verb);
    }
  };
  for (const c of model.characters.values()) collect(c.hooks);
  for (const r of model.roles.values()) collect(r.hooks);
  collect(model.rules);
  return [...out.values()].sort();
}

/** A look's length for the timeline (`planLook`): a loop 0 (it keeps going),
 *  a `restore` look its restore delay, else the repeats + the last step + its
 *  slowest transition. Null for an unknown look. */
export function lookMsOf(lights: LightsConfig, house: HouseMap | null, look: string): number | null {
  const plan = planLook(lights, house, look);
  if (plan === null) return null;
  if (plan.loop) return 0;
  if (plan.restore) return plan.period ?? 0;
  const lastAt = plan.commands.reduce((m, c) => Math.max(m, c.at), 0);
  const fade = plan.commands.reduce((m, c) => Math.max(m, Math.round((c.set.transition ?? 0) * 1000)), 0);
  return Math.max(0, plan.repeat - 1) * (plan.period ?? 0) + lastAt + fade;
}

// ---------------------------------------------------------------------------
// The hub.

/** One running `speech` step's watch: has every terminal that speaks the
 *  room said its lines? (`null` from `DeskDeps.speech`: no terminal speaks it.) */
export interface DeskSpeechWatch {
  /** True once it may end; the reason (`said`, `no terminal`: they all went away). */
  done(now: number): string | null;
}

/** What playing a step needs: the runtime wires it to the audio and lights
 *  hubs, the story and the terminals' poll. */
export interface DeskDeps {
  /** Queue a play on the router; its seq. */
  play(p: AudioPlayRequest, by: string): number;
  /** Is the house Mac's router listening? */
  routerOnline(): boolean;
  /** Stop the house sounds (`/api/mod/audio/stop`). */
  stopAudio(announce: boolean, by: string): void;
  /** Queue a look test; false = `lights.json` has no such look. */
  look(look: string, by: string): boolean;
  /** A look's planned length (ms; a loop 0), null = unknown. */
  lookMs(look: string): number | null;
  /** One `{fixture, set}` test per fixture `to` reaches; how many it reached. */
  light(to: readonly string[], set: DeskLightState, by: string): number;
  /** Is the lights module listening? */
  lightsOnline(): boolean;
  /** Fire a story event as a journaled signal labelled `House desk`. */
  fire(event: string): "fired" | "refused" | "no story";
  /** Watch a `speech` step on `room` from `startAt`; null = no online
   *  terminal speaks that room. */
  speech(room: string, startAt: number): DeskSpeechWatch | null;
}

export interface DeskTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: DeskTimers = {
  set: (fn, ms) => setTimeout(fn, Math.max(0, ms)),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface DeskHubInit {
  store: Store;
  /** The project's `desk.json` text as the row snapshotted it: null = the
   *  project has none; absent = no row snapshot (the state dir's copy). */
  projectText?: string | null;
  /** `LOOM_DESK`: the LAN fallback file. */
  envFile?: string | null;
  now?: () => number;
  timers?: DeskTimers;
  deps: DeskDeps;
}

/** A run in flight: the pure run, the cue as it was at GO (a save mid-run
 *  never changes it), the router plays it waits on, its speech watches. */
interface LiveRun {
  run: DeskRun;
  cue: DeskCue;
  timer: unknown;
  plays: Map<number, number>;
  speech: Map<number, { watch: DeskSpeechWatch; graceAt: number }>;
  /** How deep in a story chain it was started (`DESK_CHAIN_MAX`). */
  depth: number;
}

interface Activity extends DeskActivity {
  /** The router ack it waits on (a play / test the activity names). */
  ack?: { kind: "play" | "test"; seq: number };
}

type GoAnswer = { status: 200; run: DeskRun; standby: string | null } | { status: 404 | 409; body: Record<string, unknown> };

/** The desk an event plays, its runs, the playhead, the marks, the activity
 *  and the long poll's waiters. */
export class DeskHub {
  private readonly store: Store;
  private projectText: string | null;
  private projectMemo: { text: string; desk: DeskConfig | null } | null = null;
  private director: DeskConfig | null;
  private readonly envFile: string | null;
  private envMemo: { mtimeMs: number; desk: DeskConfig | null } | null = null;
  private readonly now: () => number;
  private readonly timers: DeskTimers;
  private readonly deps: DeskDeps;
  private readonly live = new Map<number, LiveRun>();
  private ended: DeskRun[] = [];
  private runSeq = 0;
  /** The playhead: undefined = never set (the first cue), null = the end. */
  private standbyId: string | null | undefined = undefined;
  private marks: Record<string, DeskMark>;
  private activity: Activity[] = [];
  private revision = 1;
  private waiters = new Set<() => void>();
  /** The chain depth of the story event being fired right now (0 = none). */
  private firingDepth = 0;
  private readonly warned = new Set<string>();

  constructor(init: DeskHubInit) {
    this.store = init.store;
    this.now = init.now ?? Date.now;
    this.timers = init.timers ?? realTimers;
    this.deps = init.deps;
    this.envFile = init.envFile ?? null;
    this.projectText = init.projectText !== undefined ? init.projectText : init.store.loadDesk();
    if (init.projectText !== undefined) init.store.saveDesk(init.projectText);
    const saved = init.store.loadDeskSave();
    this.director = saved !== null && validateDesk(saved).ok ? (saved as DeskConfig) : null;
    this.marks = marksOf(init.store.loadDeskMarks());
  }

  // --- the desk in force ----------------------------------------------------

  /** The project's `desk.json` text as this event holds it. */
  get project(): string | null {
    return this.projectText;
  }

  /** A reload's (or `/api/mod/load`'s) fresh project snapshot. */
  setProjectText(text: string | null): void {
    const was = this.current().version;
    this.projectText = text;
    this.store.saveDesk(text);
    if (this.current().version !== was) this.changed();
  }

  current(): { desk: DeskConfig; version: string; source: DeskSource } {
    const pick = (desk: DeskConfig, source: DeskSource) => ({ desk, version: deskHash(desk), source });
    if (this.director !== null) return pick(this.director, "director");
    const project = this.projectDesk();
    if (project !== null) return pick(project, "project");
    const env = this.envDesk();
    if (env !== null) return pick(env, "env");
    return pick(defaultDesk(), "default");
  }

  private projectDesk(): DeskConfig | null {
    const text = this.projectText;
    if (text === null || text.trim() === "") return null;
    if (this.projectMemo === null || this.projectMemo.text !== text) {
      const p = parseDeskText(text);
      if (p.desk === null) this.warn(`the project's ${DESK_FILE} is ignored (${p.problems[0] ?? "invalid"})`);
      this.projectMemo = { text, desk: p.desk };
    }
    return this.projectMemo.desk;
  }

  private envDesk(): DeskConfig | null {
    if (this.envFile === null) return null;
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.envFile).mtimeMs;
    } catch {
      return this.envMemo?.desk ?? null;
    }
    if (this.envMemo === null || this.envMemo.mtimeMs !== mtimeMs) {
      let p: { desk: DeskConfig | null; problems: string[] };
      try {
        p = parseDeskText(readFileSync(this.envFile, "utf8"));
      } catch (err) {
        p = { desk: null, problems: [`unreadable: ${err instanceof Error ? err.message : String(err)}`] };
      }
      if (p.desk === null) this.warn(`${this.envFile}: ${p.problems[0] ?? "invalid"} — keeping the last good desk`);
      this.envMemo = { mtimeMs, desk: p.desk ?? this.envMemo?.desk ?? null };
    }
    return this.envMemo.desk;
  }

  private warn(line: string): void {
    if (this.warned.has(line)) return;
    this.warned.add(line);
    process.stderr.write(`  ⚠️  desk: ${line}\n`);
  }

  /** A director's save: validated against the house in force (`refs`);
   *  refused on a stale `base`. */
  save(raw: unknown, base: unknown, refs: DeskRefs): { status: 200; version: string; warnings: string[] } | { status: 400 | 409; body: Record<string, unknown> } {
    const cur = this.current();
    if (typeof base === "string" && base !== "" && base !== cur.version) return { status: 409, body: { error: "stale", version: cur.version, source: viewSource(cur.source) } };
    const v = validateDesk(raw, refs);
    if (!v.ok) return { status: 400, body: { error: `invalid ${DESK_FILE}`, problems: v.problems, warnings: v.warnings } };
    const desk = JSON.parse(JSON.stringify(raw)) as DeskConfig;
    this.director = desk;
    this.store.saveDeskSave(desk);
    this.changed();
    return { status: 200, version: deskHash(desk), warnings: v.warnings };
  }

  /** The desk in force became the project's `desk.json`: the snapshot
   *  follows and the director's save is dropped (it is the project's now). */
  savedToProject(text: string): void {
    this.projectText = text;
    this.store.saveDesk(text);
    this.director = null;
    this.store.clearDeskSave();
    this.changed();
  }

  /** Is `id` one of the desk's cues (what a story `cue X` asks)? */
  hasCue(id: string): boolean {
    return this.current().desk.cues.some((c) => c.id === id);
  }

  // --- the playhead ---------------------------------------------------------

  /** The cue GO fires, or null (the end of the list). */
  standby(): string | null {
    const desk = this.current().desk;
    const id = this.standbyId;
    if (id === undefined) return cueAfter(desk, null);
    if (id === null) return null;
    return desk.cues.some((c) => c.id === id) ? id : cueAfter(desk, null);
  }

  /** Put the playhead on `cue` (null = the end). 404 for no such cue. */
  setStandby(cue: unknown): { status: 200; standby: string | null } | { status: 400 | 404; body: Record<string, unknown> } {
    if (cue !== null && typeof cue !== "string") return { status: 400, body: { error: "send {cue: id | null}" } };
    if (cue !== null && !this.hasCue(cue)) return { status: 404, body: { error: "no such cue" } };
    this.standbyId = cue;
    this.changed();
    return { status: 200, standby: this.standby() };
  }

  // --- runs -----------------------------------------------------------------

  /** A desk GO (`POST /api/mod/desk/go`): `cue` or the playhead's, refused
   *  when the console's playhead (`standby`, if sent) moved. The playhead
   *  moves to the cue after the one fired. */
  go(o: { cue?: unknown; standby?: unknown }, by: string): GoAnswer | { status: 400; body: Record<string, unknown> } {
    if (o.cue !== undefined && typeof o.cue !== "string") return { status: 400, body: { error: "cue must be a cue id" } };
    if (o.standby !== undefined && o.standby !== null && typeof o.standby !== "string") return { status: 400, body: { error: "standby must be a cue id or null" } };
    const standby = this.standby();
    if (o.standby !== undefined && o.standby !== standby) return { status: 409, body: { error: "moved", standby } };
    const id = typeof o.cue === "string" ? o.cue : standby;
    if (id === null) return { status: 409, body: { error: "end", standby } };
    const cue = this.current().desk.cues.find((c) => c.id === id);
    if (cue === undefined) return { status: 404, body: { error: "no such cue", standby } };
    const run = this.start(cue, by, "desk", 0);
    this.standbyId = cueAfter(this.current().desk, cue.id);
    this.changed();
    return { status: 200, run, standby: this.standby() };
  }

  /** A live story `cue X` naming a desk cue (the runtime's `fanout`, never a
   *  replay): started on the next turn, so a desk event's own `cue X` never
   *  re-enters the run firing it. True when `id` is a desk cue. */
  storyCue(id: string): boolean {
    const cue = this.current().desk.cues.find((c) => c.id === id);
    if (cue === undefined) return false;
    const depth = this.firingDepth + 1;
    if (depth > DESK_CHAIN_MAX) {
      this.note({ kind: "go", text: `${cue.name}: the story's cue was refused (${DESK_CHAIN_MAX} cues deep in one chain)`, by: DESK_STORY_BY, result: "refused" });
      this.changed();
      return true;
    }
    this.timers.set(() => {
      const now = this.current().desk.cues.find((c) => c.id === id);
      if (now === undefined) return;
      this.start(now, DESK_STORY_BY, "story", depth);
      this.changed();
    }, 0);
    return true;
  }

  private start(cue: DeskCue, by: string, source: DeskRun["source"], depth: number): DeskRun {
    // One run per cue: a new run of a cue still running stops the old one.
    for (const l of [...this.live.values()]) if (l.cue.id === cue.id) this.stopLive(l, "stopped");
    const run = beginRun(cue, ++this.runSeq, by.slice(0, 64), source, this.now());
    this.note({ kind: "go", text: `GO ${cue.number !== undefined ? `${cue.number} ` : ""}${cue.name}`, by: run.by });
    const l: LiveRun = { run, cue, timer: null, plays: new Map(), speech: new Map(), depth };
    if (run.state !== "running") {
      this.retire(run);
      return run;
    }
    this.live.set(run.run, l);
    this.drive(l);
    return this.live.get(run.run)?.run ?? this.ended.find((r) => r.run === run.run) ?? run;
  }

  /** Tick a run until nothing more starts now, play what starts, schedule the next wake. */
  private drive(l: LiveRun): void {
    if (l.timer !== null) this.timers.clear(l.timer);
    l.timer = null;
    for (let guard = 0; guard < 4 * l.cue.steps.length + 8; guard++) {
      if (this.live.get(l.run.run) !== l) return;
      const now = this.now();
      this.checkSpeech(l, now);
      const t = tickRun(l.run, l.cue, now);
      l.run = t.run;
      if (t.finished) {
        this.finish(l);
        return;
      }
      if (t.start.length === 0) break;
      for (const i of t.start) {
        this.playStep(l, i, now);
        if (this.live.get(l.run.run) !== l) return;
      }
    }
    this.schedule(l);
    this.changed();
  }

  private schedule(l: LiveRun): void {
    const now = this.now();
    let at = runWakeAt(l.run);
    for (const [i, s] of l.speech) {
      const step = l.run.steps.find((x) => x.i === i);
      if (step?.state === "running" && s.graceAt > now && (at === null || s.graceAt < at)) at = s.graceAt;
    }
    if (at === null) return;
    l.timer = this.timers.set(() => {
      l.timer = null;
      this.drive(l);
    }, Math.max(0, at - now));
  }

  private checkSpeech(l: LiveRun, now: number): void {
    for (const [i, s] of l.speech) {
      const step = l.run.steps.find((x) => x.i === i);
      if (step?.state !== "running") {
        l.speech.delete(i);
        continue;
      }
      if (now < s.graceAt) continue;
      const why = s.watch.done(now);
      if (why !== null) {
        l.run = stepEnded(l.run, i, now, why);
        l.speech.delete(i);
      }
    }
  }

  /** Play step `i` of a run (it just went running at `now`). */
  private playStep(l: LiveRun, i: number, now: number): void {
    const step = l.cue.steps[i]!;
    const by = l.run.by;
    const started = (ms: number, result?: string) => {
      l.run = stepStarted(l.run, i, now + Math.max(0, ms), result);
    };
    switch (step.kind) {
      case "sound":
      case "say": {
        const req: AudioPlayRequest =
          step.kind === "sound"
            ? { sound: step.sound, ...(step.to !== undefined ? { to: step.to } : {}), ...(step.gain !== undefined ? { gain: step.gain } : {}) }
            : { say: step.text, ...(step.to !== undefined ? { to: step.to } : {}), ...(step.chime !== undefined ? { chime: step.chime } : {}) };
        const seq = this.deps.play(req, by);
        l.plays.set(seq, i);
        const away = this.deps.routerOnline() ? undefined : "router away";
        started(step.dur ?? DESK_ACK_MS, away);
        this.note({ kind: step.kind === "sound" ? "play" : "say", text: stepText(step), by, ack: { kind: "play", seq } });
        return;
      }
      case "look": {
        const ok = this.deps.look(step.look, by);
        if (!ok) {
          l.run = stepEnded(l.run, i, now, "no such look");
          return;
        }
        started(this.deps.lookMs(step.look) ?? 0, this.deps.lightsOnline() ? "sent" : "lights away");
        this.note({ kind: "look", text: stepText(step), by });
        return;
      }
      case "light": {
        const n = this.deps.light(step.to, step.set, by);
        started(Math.round((step.set.transition ?? 0) * 1000), n === 0 ? "no lights" : this.deps.lightsOnline() ? "sent" : "lights away");
        this.note({ kind: "light", text: stepText(step), by });
        return;
      }
      case "stop":
        this.deps.stopAudio(step.announce === true, by);
        started(DESK_STOP_MS, "sent");
        this.note({ kind: "stop", text: stepText(step), by });
        return;
      case "event": {
        const result = this.fire(step.event, l.depth);
        started(0, result);
        this.note({ kind: "event", text: `⚡ ${step.event}`, by: DESK_BY, result });
        return;
      }
      case "speech": {
        const watch = this.deps.speech(step.room, now);
        if (watch === null) {
          l.run = stepEnded(l.run, i, now, "no terminal");
          return;
        }
        l.speech.set(i, { watch, graceAt: now + DESK_SPEECH_GRACE_MS });
        started(step.max ?? DESK_SPEECH_MS);
        return;
      }
      case "wait":
        started(step.ms);
        return;
    }
  }

  private fire(event: string, depth: number): "fired" | "refused" | "no story" {
    const was = this.firingDepth;
    this.firingDepth = depth;
    try {
      return this.deps.fire(event);
    } finally {
      this.firingDepth = was;
    }
  }

  private finish(l: LiveRun): void {
    this.live.delete(l.run.run);
    if (l.timer !== null) this.timers.clear(l.timer);
    l.timer = null;
    this.retire(l.run);
    const done = l.cue.done;
    if (done !== undefined) {
      const result = this.fire(done, l.depth);
      this.note({ kind: "done", text: `${l.cue.name} done: ⚡ ${done}`, by: DESK_BY, result });
    }
    this.changed();
  }

  private retire(run: DeskRun): void {
    this.ended.unshift(run);
    if (this.ended.length > DESK_ENDED_RUNS) this.ended.length = DESK_ENDED_RUNS;
  }

  private stopLive(l: LiveRun, _why: string): void {
    this.live.delete(l.run.run);
    if (l.timer !== null) this.timers.clear(l.timer);
    l.timer = null;
    l.run = stopRun(l.run, this.now());
    this.retire(l.run);
  }

  /** Stop one run (`{run}`) → how many stopped (0: not running). */
  stop(run: number): number {
    const l = this.live.get(run);
    if (l === undefined) return 0;
    this.stopLive(l, "stopped");
    this.changed();
    return 1;
  }

  /** The panic: every run, and the house sounds. */
  stopAll(announce: boolean, by: string): number {
    const n = this.live.size;
    for (const l of [...this.live.values()]) this.stopLive(l, "stopped");
    this.deps.stopAudio(announce, by);
    this.note({ kind: "stop", text: announce ? "■ STOP ALL (and the announcement)" : "■ STOP ALL", by });
    this.changed();
    return n;
  }

  /** A router ack (`/api/mod/audio/report`): a desk play's length or its end,
   *  and the activity's result. */
  ack(a: AudioAck): void {
    let moved = false;
    for (const act of this.activity) {
      if (act.ack !== undefined && act.ack.kind === a.kind && act.ack.seq === a.seq) {
        act.result = a.result;
        delete act.ack;
        moved = true;
      }
    }
    if (a.kind === "play") {
      for (const l of [...this.live.values()]) {
        const i = l.plays.get(a.seq);
        if (i === undefined) continue;
        l.plays.delete(a.seq);
        const step = l.cue.steps[i]!;
        const now = this.now();
        if (a.result !== "played") l.run = stepEnded(l.run, i, now, a.result);
        else if (hasDur(step)) l.run = withResult(l.run, i, "played");
        else if (a.ms !== undefined) l.run = stepLength(l.run, i, a.ms, "played");
        else l.run = withResult(l.run, i, "played");
        this.drive(l);
        moved = true;
      }
    }
    if (moved) this.changed();
  }

  /** A terminal polled: re-check every running speech step now. */
  poke(): void {
    for (const l of [...this.live.values()]) if (l.speech.size > 0) this.drive(l);
  }

  /** Running runs (newest first), then the recent ended ones. */
  runs(): DeskRun[] {
    const since = this.now() - DESK_ENDED_MS;
    this.ended = this.ended.filter((r) => (r.endedAt ?? 0) >= since);
    return [...[...this.live.values()].map((l) => l.run).reverse(), ...this.ended];
  }

  // --- activity -------------------------------------------------------------

  /** Note one thing the house did (a route's test or play, a GO). `ack`:
   *  the router seq whose answer fills `result`. */
  note(a: Omit<DeskActivity, "at"> & { ack?: { kind: "play" | "test"; seq: number } }): void {
    this.activity.unshift({ ...a, at: this.now() });
    if (this.activity.length > DESK_ACTIVITY) this.activity.length = DESK_ACTIVITY;
    this.changed();
  }

  recent(): DeskActivity[] {
    return this.activity.map(({ ack: _ack, ...a }) => ({ ...a }));
  }

  // --- the checks' marks ----------------------------------------------------

  /** `{key, mark, note?}`: `keys` = this house's check keys. */
  mark(key: unknown, mark: unknown, note: unknown, by: string, keys: ReadonlySet<string>): { status: 200 } | { status: 400 | 404; body: Record<string, unknown> } {
    if (typeof key !== "string" || key === "") return { status: 400, body: { error: "send {key, mark}" } };
    if (mark !== null && mark !== "ok" && mark !== "bad") return { status: 400, body: { error: 'mark must be "ok", "bad" or null' } };
    if (note !== undefined && note !== null && typeof note !== "string") return { status: 400, body: { error: "note must be text" } };
    if (!keys.has(key) && !(mark === null && key in this.marks)) return { status: 404, body: { error: "no such check" } };
    if (mark === null) delete this.marks[key];
    else {
      const n = typeof note === "string" ? note.trim().slice(0, DESK_NOTE_MAX) : "";
      this.marks[key] = { mark, by: by.slice(0, 64), at: this.now(), ...(n !== "" ? { note: n } : {}) };
    }
    this.store.saveDeskMarks(this.marks);
    this.changed();
    return { status: 200 };
  }

  resetMarks(): void {
    this.marks = {};
    this.store.saveDeskMarks(this.marks);
    this.changed();
  }

  allMarks(): Record<string, DeskMark> {
    return { ...this.marks };
  }

  // --- the long poll --------------------------------------------------------

  get rev(): number {
    return this.revision;
  }

  clock(): number {
    return this.now();
  }

  /** Has the view moved past `after`? A cursor past this hub's own rev was
   *  issued by an earlier process: stale, so the poll answers at once. */
  moved(after: number): boolean {
    return after !== this.revision;
  }

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

  get waiting(): number {
    return this.waiters.size;
  }

  /** Something the view shows changed: bump the rev, wake the waiters. */
  changed(): void {
    this.revision += 1;
    for (const w of [...this.waiters]) w();
  }

  /** Stop every timer (the runtime is going away; tests). */
  dispose(): void {
    for (const l of this.live.values()) if (l.timer !== null) this.timers.clear(l.timer);
    this.live.clear();
  }
}

function hasDur(step: DeskStep): boolean {
  return (step.kind === "sound" || step.kind === "say") && step.dur !== undefined;
}

function withResult(run: DeskRun, i: number, result: string): DeskRun {
  return { ...run, steps: run.steps.map((s) => (s.i === i ? { ...s, result } : s)) };
}

function marksOf(raw: unknown): Record<string, DeskMark> {
  const out: Record<string, DeskMark> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) continue;
    const m = v as Record<string, unknown>;
    if ((m["mark"] !== "ok" && m["mark"] !== "bad") || typeof m["by"] !== "string" || typeof m["at"] !== "number") continue;
    out[k] = { mark: m["mark"], by: m["by"], at: m["at"], ...(typeof m["note"] === "string" && m["note"] !== "" ? { note: m["note"] } : {}) };
  }
  return out;
}

function viewSource(s: DeskSource): DeskView["source"] {
  return s === "env" ? "default" : s;
}

// ---------------------------------------------------------------------------
// The view: the house the desk drives, and its refs.

/** What the house view is built from (the runtime reads it off the hubs). */
export interface DeskHouseInputs {
  audio: AudioConfig;
  router: AudioRouterPresence;
  health: AudioHealth | null;
  lights: LightsConfig;
  module: LightsModule | null;
  devices: Z2mDevice[];
  devicesAt: number | null;
  pair: LightPair | null;
  house: HouseMap | null;
  model: SimModel | null;
  /** The connected agent workers (`AgentHub.workerList()`; wave 30). */
  workers?: ReadonlyArray<{ name: string; characters: readonly string[] }>;
  now: number;
}

const uniq = (xs: Iterable<string>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = foldDeskName(x);
    if (x.trim() === "" || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
};

/** `DeskHouse` off the audio and lights config in force, the map, the story
 *  model, the router's last report and the lights module's devices. */
export function deskHouseOf(i: DeskHouseInputs): DeskHouse {
  const rooms = i.house?.rooms ?? [];
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.label || id;
  const locations = storyLocations(i.model);
  const roomTargets = [...rooms.flatMap((r) => [r.id, r.label, ...(r.location !== undefined ? [r.location] : [])]), ...locations];
  const h = i.health;
  const health: DeskAudioHealth | null =
    h === null ? null : { at: h.at, ok: h.ok, device: h.device, layout: h.layout, voices: h.voices, xruns: h.xruns, peakDb: h.peakDb, announce: h.announce, missing: [...h.missing], placeholders: [...h.placeholders], files: Object.keys(h.sounds).length };
  const sounds = storySounds(i.model).map((name) => ({
    name,
    to: i.audio.cues[name]?.to !== undefined ? [...i.audio.cues[name]!.to] : null,
    // Judged off the files the router has (`health.sounds`): its `missing`
    // only lists the names it already failed to play.
    file: h === null ? null : h.placeholders.includes(name) ? ("placeholder" as const) : Object.prototype.hasOwnProperty.call(h.sounds, name) ? ("ok" as const) : ("missing" as const),
    ms: h?.sounds[name] ?? null,
  }));
  const module = i.module === null ? null : { online: i.module.online, lastSeen: i.module.at, name: i.module.name !== "" ? i.module.name : null };
  const looks = Object.entries(i.lights.looks ?? {}).map(([name, l]) => ({ name, to: [...(l.to ?? [])], ms: lookMsOf(i.lights, i.house, name), loop: l.loop === true, ...(l.note !== undefined ? { note: l.note } : {}) }));
  return {
    router: { ...i.router },
    health,
    speakers: i.audio.speakers.map((s) => ({ id: s.id, name: s.name, room: s.room, roomName: roomName(s.room), out: [...s.out] })),
    outputs: i.audio.outputs.map((o) => ({ ch: o.ch, label: o.label })),
    zones: i.audio.zones.map((z) => ({ id: z.id, name: z.name, speakers: [...z.speakers] })),
    sounds,
    audioTargets: uniq(["everywhere", ...i.audio.speakers.map((s) => s.id), ...i.audio.zones.flatMap((z) => [z.id, z.name]), ...roomTargets]),
    lightsModule: module,
    fixtures: i.lights.fixtures.map((f) => ({
      id: f.id,
      name: f.name,
      room: f.room,
      roomName: roomName(f.room),
      kind: f.kind,
      caps: { ...f.caps },
      safety: f.safety === true,
      device: f.device,
      inZ2m: i.devicesAt === null ? null : i.devices.some((d) => d.friendly === f.device),
    })),
    lightZones: i.lights.zones.map((z) => ({ id: z.id, name: z.name, fixtures: [...z.fixtures] })),
    looks,
    lightTargets: uniq(["everywhere", ...i.lights.fixtures.map((f) => f.id), ...i.lights.zones.flatMap((z) => [z.id, z.name]), ...roomTargets]),
    pairUntil: i.pair !== null && i.pair.seconds > 0 && i.pair.until > i.now ? i.pair.until : null,
    rooms: locations,
    events: storyWhenEvents(i.model),
    minds: deskMindsOf(i.model, i.workers ?? []),
  };
}

/** Every `mind: external` character (source order) and the workers voicing it. */
export function deskMindsOf(model: SimModel | null, workers: ReadonlyArray<{ name: string; characters: readonly string[] }>): DeskMind[] {
  if (model === null) return [];
  return [...model.characters.values()]
    .filter((c) => c.mind === "external")
    .map((c) => {
      const by = workers.filter((w) => w.characters.some((n) => foldName(n) === foldName(c.id))).map((w) => w.name);
      return { character: c.id, name: c.id, online: by.length > 0, workers: [...new Set(by)] };
    });
}

/** The refs a desk is checked against. `extraEvents`: the desk's own event
 *  spellings that fold to one the story hears (`when heart_speaks:` hears
 *  `heart speaks`), so validation's exact match is fold-aware. */
export function deskRefsOf(house: DeskHouse, model: SimModel | null, lightStateProblems: (at: string, s: unknown) => string[], desk?: DeskConfig): DeskRefs {
  const heard = new Set(house.events.map(foldName));
  let extra: string[] = [];
  try {
    if (desk !== undefined) extra = deskEvents(desk).filter((e) => typeof e === "string" && heard.has(foldName(e)));
  } catch {
    extra = []; // an ill-formed save: validation names its problems
  }
  const labels = model === null ? [] : [...model.locations.values()].flatMap((l) => (l.label !== null ? [l.label] : []));
  return {
    sounds: house.sounds.map((s) => s.name),
    looks: house.looks.map((l) => l.name),
    lightTargets: house.lightTargets,
    audioTargets: house.audioTargets,
    rooms: [...house.rooms, ...labels],
    events: [...house.events, ...extra],
    lightStateProblems,
  };
}

/** What the desk routes read off the event runtime. */
export interface DeskContext {
  house(): DeskHouse;
  refs(desk?: DeskConfig): DeskRefs;
  /** The doors are open and the show hasn't ended. */
  live(): boolean;
  /** `by` as this caller may read it (a booth: directors read "Director"). */
  seen?: (by: string) => string;
}

/** The GET answer. `seen` rewrites every `by` for a booth's view. */
export function deskView(hub: DeskHub, ctx: DeskContext, seen?: (by: string) => string): DeskView {
  const cur = hub.current();
  const house = ctx.house();
  const v = validateDesk(cur.desk, ctx.refs(cur.desk));
  const name = seen ?? ((b: string) => b);
  const marks: Record<string, DeskMark> = {};
  for (const [k, m] of Object.entries(hub.allMarks())) marks[k] = { ...m, by: name(m.by) };
  return {
    desk: cur.desk,
    version: cur.version,
    source: viewSource(cur.source),
    problems: v.problems,
    warnings: v.warnings,
    rev: hub.rev,
    now: hub.clock(),
    standby: hub.standby(),
    runs: hub.runs().map((r) => ({ ...r, by: name(r.by) })),
    marks,
    live: ctx.live(),
    house,
    recent: hub.recent().map((a) => ({ ...a, by: name(a.by) })),
  };
}

/** `by` as a booth reads it on the desk: the story and the desk keep their
 *  own words; everyone else goes through `seenName` (directors → "Director"). */
export function deskSeen(seenName: (by: string) => string): (by: string) => string {
  return (by) => (by === DESK_STORY_BY || by === DESK_BY ? by : seenName(by));
}

/** Every check key of this house (`deskChecks` over the view's house). */
export function deskCheckKeys(house: DeskHouse): Set<string> {
  const keys = new Set<string>();
  for (const s of deskChecks({ house, marks: {} })) for (const r of s.rows) keys.add(r.key);
  return keys;
}

/** `checkKey`, re-exported for the runtime's activity notes. */
export { checkKey };

/**
 * `GET /api/mod/desk[?after=<rev>&wait=<s>]` — the view + the long poll.
 * `authorized` already admits hosts (the allowlist); `seen` is set for a booth.
 */
export async function handleDeskGet(hub: DeskHub, ctx: DeskContext, req: IncomingMessage, res: ServerResponse, url: URL, authorized: (token: string | undefined) => boolean, seen?: (by: string) => string): Promise<boolean> {
  if (!authorized(queryTokenOf(req, url))) {
    sendJson(res, 403, { error: "moderators only" });
    return true;
  }
  res.setHeader?.("cache-control", "no-store");
  const afterRaw = url.searchParams.get("after") ?? "";
  const after = /^\d+$/u.test(afterRaw) ? Number(afterRaw) : null;
  const waitRaw = Number(url.searchParams.get("wait") ?? DESK_WAIT_S);
  const waitS = Number.isFinite(waitRaw) ? Math.min(DESK_WAIT_MAX_S, Math.max(0, waitRaw)) : DESK_WAIT_S;
  if (after !== null && !hub.moved(after) && waitS > 0) {
    const w = hub.waitChange(waitS * 1000);
    req.on?.("close", w.cancel);
    await w.done;
  }
  sendJson(res, 200, deskView(hub, ctx, seen));
  return true;
}

/** The project link the save needs (`ProjectLink.writeFile` + the row snapshot). */
export interface DeskProjectLink {
  writeFile(path: string, content: string): Promise<void>;
  saveSnapshot(): Promise<void>;
}

/**
 * `POST /api/mod/desk`, `…/project`, `…/go`, `…/standby`, `…/stop`,
 * `…/check`, `…/check/reset` — already authorized by the runtime's mod gate
 * (and the host allowlist). Returns false for any other path.
 */
export async function handleDeskPost(hub: DeskHub, ctx: DeskContext, path: string, body: Record<string, unknown>, res: ServerResponse, project: DeskProjectLink | null, by: string): Promise<boolean> {
  switch (path) {
    case "/api/mod/desk": {
      const r = hub.save(body["desk"], body["base"], ctx.refs(isDeskLike(body["desk"]) ? (body["desk"] as DeskConfig) : undefined));
      if (r.status !== 200) sendJson(res, r.status, r.body);
      else {
        process.stdout.write(`  🎛  desk: ${by} saved the desk (${r.version})\n`);
        sendJson(res, 200, { ok: true, version: r.version, source: "director", warnings: r.warnings });
      }
      return true;
    }
    case "/api/mod/desk/project": {
      if (project === null) {
        sendJson(res, 409, { error: "no project" });
        return true;
      }
      const text = deskFileText(hub.current().desk);
      try {
        await project.writeFile(DESK_FILE, text);
      } catch (err) {
        process.stderr.write(`  ⚠️  desk: saving ${DESK_FILE} to the project failed (${err instanceof Error ? err.message : String(err)})\n`);
        sendJson(res, 502, { error: "could not write the project file" });
        return true;
      }
      hub.savedToProject(text);
      try {
        await project.saveSnapshot();
      } catch (err) {
        process.stderr.write(`  ⚠️  desk: recording the snapshot failed (${err instanceof Error ? err.message : String(err)})\n`);
      }
      process.stdout.write(`  🎛  desk: ${by} saved the desk to the project as ${DESK_FILE}\n`);
      sendJson(res, 200, { ok: true, version: hub.current().version });
      return true;
    }
    case "/api/mod/desk/go": {
      const r = hub.go({ cue: body["cue"], standby: body["standby"] }, by);
      if (r.status !== 200) sendJson(res, r.status, r.body);
      else {
        process.stdout.write(`  🎛  desk: ${by} GO ${r.run.cue}\n`);
        sendJson(res, 200, { ok: true, run: r.run.run, standby: r.standby });
      }
      return true;
    }
    case "/api/mod/desk/standby": {
      const r = hub.setStandby(body["cue"] === undefined ? undefined : body["cue"]);
      if (r.status !== 200) sendJson(res, r.status, r.body);
      else sendJson(res, 200, { ok: true, standby: r.standby });
      return true;
    }
    case "/api/mod/desk/stop": {
      if (body["all"] === true) {
        const announce = body["announce"];
        if (announce !== undefined && typeof announce !== "boolean") {
          sendJson(res, 400, { error: "announce must be true or false" });
          return true;
        }
        const stopped = hub.stopAll(announce === true, by);
        process.stdout.write(`  🎛  desk: ${by} STOP ALL (${stopped} run${stopped === 1 ? "" : "s"})\n`);
        sendJson(res, 200, { ok: true, stopped });
        return true;
      }
      const run = body["run"];
      if (typeof run !== "number" || !Number.isInteger(run)) {
        sendJson(res, 400, { error: "send {run} or {all: true}" });
        return true;
      }
      sendJson(res, 200, { ok: true, stopped: hub.stop(run) });
      return true;
    }
    case "/api/mod/desk/check": {
      const r = hub.mark(body["key"], body["mark"] === undefined ? undefined : body["mark"], body["note"], by, deskCheckKeys(ctx.house()));
      if (r.status !== 200) sendJson(res, r.status, r.body);
      else sendJson(res, 200, { ok: true });
      return true;
    }
    case "/api/mod/desk/check/reset": {
      hub.resetMarks();
      process.stdout.write(`  🎛  desk: ${by} cleared the check marks\n`);
      sendJson(res, 200, { ok: true });
      return true;
    }
    default:
      return false;
  }
}

function isDeskLike(v: unknown): boolean {
  return typeof v === "object" && v !== null && Array.isArray((v as { cues?: unknown }).cues) && (v as { cues: unknown[] }).cues.every((c) => typeof c === "object" && c !== null && Array.isArray((c as { steps?: unknown }).steps));
}

/** The light step's fixtures (`resolveLightTargets`), for the runtime's `DeskDeps.light`. */
export function deskLightFixtures(lights: LightsConfig, house: HouseMap | null, to: readonly string[]): string[] {
  return resolveLightTargets(lights, house, to).fixtures;
}
