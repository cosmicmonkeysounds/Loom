//! The house desk (wave 25): the house's own cue list, as pure data — shared
//! by the event server (`server/desk.ts` runs it), the editor's Run → House
//! page (builds and fires it) and the play app's host Desk window (fires it,
//! walks the checks). The contract is `docs/loom-house-desk.md`.
//!
//! A **desk cue** is a short timeline of house steps: a sound to some
//! speakers, a house announcement, a lights look, one light state, stop the
//! house sounds, a story event, wait for a room's lines to be spoken, or
//! plain time. Steps run in **groups**: a step marked `start: "with"` starts
//! with the step before it (parallel); any other step opens a new group that
//! starts once every step of the group before it has ended (series). Each
//! step may wait (`wait`, ms) after its group starts. So "the heart flashes
//! while he speaks, and the room only moves on once the flash is over" is
//! one cue: `look` + `event` (with) → `event` (after).
//!
//! The story plays a desk cue with `cue <id>` (the same statement as a
//! lights look: a desk cue never shares a look's name), and hears back
//! through story events: an `event` step fires `when <event>:`, and a cue's
//! `done:` fires once its last group has ended. Those fires are journaled
//! like a sensor's; the desk's own clock is memory only.
//!
//! The project file is `desk.json` beside `audio.json` and `lights.json`.
//!
//! Dependency-free on purpose: the play app imports this file by path (it
//! has no `@loom/core` or `@loom/house` dependency), so the light state is a
//! structural copy of `@loom/house`'s `LightState` and the server injects the
//! real checks through `DeskRefs`.

/** The project file's name. */
export const DESK_FILE = "desk.json";
/** A cue id: what the story writes after `cue` (lower case, `_` / `-`). */
export const DESK_ID_RE = /^[a-z0-9][a-z0-9_-]*$/u;
/** A story event name, as `when <event>:` writes it. */
export const DESK_EVENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
/** A sound name, as `sound X` writes it (the router's file name). */
export const DESK_SOUND_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;
/** Cue families a desk cue id may never start with: the screens', and (wave
 *  38) `music_`, the soundtrack's scenes (the router takes every `cue
 *  music_<scene>`, so a desk cue named so would fire with a scene change). */
export const DESK_RESERVED_PREFIXES = ["screens_", "terminals_", "tv_", "tablet_", "room_", "music_"] as const;
/** The story's announcement chime: rung with the announcements, never as a cue. */
export const DESK_CHIME_SOUND = "announce_chime";
export const DESK_MAX_CUES = 200;
export const DESK_MAX_STEPS = 48;
/** The longest `wait`, `ms` or `dur` (ms). */
export const DESK_WAIT_MAX_MS = 600_000;
/** The longest house announcement (characters). */
export const DESK_SAY_MAX = 280;
/** A gain (dB) is within these (`audio.json`'s). */
export const DESK_GAIN_MIN = -60;
export const DESK_GAIN_MAX = 12;
/** A `speech` step's wait: the default and the longest (ms). */
export const DESK_SPEECH_MS = 30_000;
export const DESK_SPEECH_MAX_MS = 300_000;
/** How long a `speech` step waits before it may end (the lines have to reach the terminal first). */
export const DESK_SPEECH_GRACE_MS = 1_500;
/** A sound / say with no router answer by then ends (the router may be away). */
export const DESK_ACK_MS = 5_000;
/** The router's fade on a stop (ms): a `stop` step lasts this long. */
export const DESK_STOP_MS = 300;

/** How a step starts: with the step before it, or after its whole group. */
export type DeskStart = "with" | "after";
export const DESK_STARTS = ["with", "after"] as const;

/** One light command, in Zigbee2MQTT's words (`@loom/house` `LightState`). */
export interface DeskLightState {
  state?: "ON" | "OFF";
  /** 0–254. */
  brightness?: number;
  /** `#rrggbb`. */
  color?: string;
  /** Mireds 150–500. */
  color_temp?: number;
  effect?: string;
  /** Seconds 0–30. */
  transition?: number;
}

interface DeskStepBase {
  /** Default `"after"`; the first step always opens the first group. */
  start?: DeskStart;
  /** ms after its group starts (0–`DESK_WAIT_MAX_MS`). */
  wait?: number;
  note?: string;
}

/** Play a sound file on the house speakers. No `to`: as the story routes
 *  it (`audio.json` `cues[sound].to`, else everywhere). `dur` overrides the
 *  length the router reports. */
export interface DeskSoundStep extends DeskStepBase {
  kind: "sound";
  sound: string;
  to?: string[];
  gain?: number;
  dur?: number;
}
/** A house announcement in the router's voice (`audio.json` `announce.to`
 *  unless `to`), with the chime unless `chime: false`. */
export interface DeskSayStep extends DeskStepBase {
  kind: "say";
  text: string;
  to?: string[];
  chime?: boolean;
  dur?: number;
}
/** Play a `lights.json` look. It lasts as long as its plan (a loop: no time). */
export interface DeskLookStep extends DeskStepBase {
  kind: "look";
  look: string;
}
/** One light state on some fixtures (fixture ids, zones, rooms, `everywhere`). */
export interface DeskLightStep extends DeskStepBase {
  kind: "light";
  to: string[];
  set: DeskLightState;
}
/** Stop the house sounds (with `announce`, the announcement too). */
export interface DeskStopStep extends DeskStepBase {
  kind: "stop";
  announce?: boolean;
}
/** Fire a story event (`when <event>:`), journaled. Takes no time. */
export interface DeskEventStep extends DeskStepBase {
  kind: "event";
  event: string;
}
/** Wait until the terminals that speak `room` (a LOCATION) have said its
 *  lines, at most `max` ms. */
export interface DeskSpeechStep extends DeskStepBase {
  kind: "speech";
  room: string;
  max?: number;
}
/** Plain time. */
export interface DeskWaitStep extends DeskStepBase {
  kind: "wait";
  ms: number;
}

export type DeskStep = DeskSoundStep | DeskSayStep | DeskLookStep | DeskLightStep | DeskStopStep | DeskEventStep | DeskSpeechStep | DeskWaitStep;
export type DeskStepKind = DeskStep["kind"];
export const DESK_STEP_KINDS = ["sound", "say", "look", "light", "stop", "event", "speech", "wait"] as const;

export interface DeskCue {
  /** `DESK_ID_RE`; what the story's `cue <id>` names. */
  id: string;
  /** The operator's number ("1", "2.5"), shown before the name. */
  number?: string;
  name: string;
  /** A heading the cue list groups under ("Pre-show", "The Heart"). */
  section?: string;
  notes?: string;
  steps: DeskStep[];
  /** A story event fired once the cue's last group has ended. */
  done?: string;
}

export interface DeskConfig {
  version: 1;
  note?: string;
  /** The cue list, in running order. */
  cues: DeskCue[];
}

export interface DeskValidation {
  ok: boolean;
  problems: string[];
  warnings: string[];
}

/** What the server knows to check a desk against (each list optional:
 *  absent = not checked). */
export interface DeskRefs {
  /** The story's `sound X` names (a sound outside them is a warning: the house Mac may have the file). */
  sounds?: readonly string[];
  /** `lights.json`'s look names. */
  looks?: readonly string[];
  /** Every name a light step's `to` may use (fixtures, zones, rooms, LOCATIONs, `everywhere`). */
  lightTargets?: readonly string[];
  /** Every name a sound's `to` may use (speakers, zones, rooms, LOCATIONs, `everywhere`). */
  audioTargets?: readonly string[];
  /** The story's LOCATION names (a speech step's room). */
  rooms?: readonly string[];
  /** The story's `when <event>:` names (an event nothing hears is a warning). */
  events?: readonly string[];
  /** `@loom/house` `lightStateProblems`. */
  lightStateProblems?: (at: string, s: unknown) => string[];
}

/** An empty desk. */
export function defaultDesk(): DeskConfig {
  return { version: 1, cues: [] };
}

/** FNV-1a 32 over UTF-8 (`@loom/house` `fnv1a32`, copied: no dependency). */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(s)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A short content hash (8 hex digits): the desk's `version` on the wire. */
export function deskHash(desk: DeskConfig): string {
  return fnv1a32(JSON.stringify(desk)).toString(16).padStart(8, "0");
}

/** Lower case, spaces / dashes / underscores folded: how a target name matches. */
export function foldDeskName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/gu, " ");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isMs(v: unknown, max = DESK_WAIT_MAX_MS): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
}
function isNames(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim() !== "");
}
function inList(name: string, list: readonly string[]): boolean {
  const f = foldDeskName(name);
  return list.some((x) => foldDeskName(x) === f);
}

const STEP_KEYS: Record<DeskStepKind, readonly string[]> = {
  sound: ["sound", "to", "gain", "dur"],
  say: ["text", "to", "chime", "dur"],
  look: ["look"],
  light: ["to", "set"],
  stop: ["announce"],
  event: ["event"],
  speech: ["room", "max"],
  wait: ["ms"],
};
const BASE_KEYS = ["kind", "start", "wait", "note"];
const CUE_KEYS = ["id", "number", "name", "section", "notes", "steps", "done"];

/** Refuse a broken desk (`problems`), advise on a valid one (`warnings`). */
export function validateDesk(raw: unknown, refs: DeskRefs = {}): DeskValidation {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(raw)) return { ok: false, problems: ["the desk is not an object"], warnings };
  if (raw["version"] !== 1) problems.push("version must be 1");
  if (raw["note"] !== undefined && typeof raw["note"] !== "string") problems.push("note must be text");
  const cues = raw["cues"];
  if (!Array.isArray(cues)) return { ok: false, problems: [...problems, "cues must be a list"], warnings };
  if (cues.length > DESK_MAX_CUES) problems.push(`at most ${DESK_MAX_CUES} cues`);
  const seen = new Set<string>();
  cues.forEach((c, ci) => {
    const at = `cues[${ci}]`;
    if (!isRecord(c)) {
      problems.push(`${at} is not an object`);
      return;
    }
    for (const k of Object.keys(c)) if (!CUE_KEYS.includes(k)) problems.push(`${at}: unknown key ${k}`);
    const id = c["id"];
    const named = typeof id === "string" ? `cue ${id}` : at;
    if (typeof id !== "string" || !DESK_ID_RE.test(id)) problems.push(`${at}: id must match ${DESK_ID_RE.source}`);
    else {
      if (seen.has(id)) problems.push(`${named}: the id is used twice`);
      seen.add(id);
      if (DESK_RESERVED_PREFIXES.some((p) => id.startsWith(p))) problems.push(`${named}: ids starting ${DESK_RESERVED_PREFIXES.join(" / ")} are the screens' cues or the soundtrack's scenes`);
      if (refs.looks !== undefined && refs.looks.includes(id)) problems.push(`${named}: a lights look has this name too (\`cue ${id}\` would play both)`);
    }
    if (typeof c["name"] !== "string" || c["name"].trim() === "") problems.push(`${named}: name must be text`);
    for (const k of ["number", "section", "notes"] as const) if (c[k] !== undefined && typeof c[k] !== "string") problems.push(`${named}: ${k} must be text`);
    const done = c["done"];
    if (done !== undefined) {
      if (typeof done !== "string" || !DESK_EVENT_RE.test(done)) problems.push(`${named}: done must be a story event name`);
      else if (refs.events !== undefined && !refs.events.includes(done)) warnings.push(`${named}: no \`when ${done}:\` in the story hears its done event`);
    }
    const steps = c["steps"];
    if (!Array.isArray(steps)) {
      problems.push(`${named}: steps must be a list`);
      return;
    }
    if (steps.length === 0) warnings.push(`${named}: no steps (GO does nothing)`);
    if (steps.length > DESK_MAX_STEPS) problems.push(`${named}: at most ${DESK_MAX_STEPS} steps`);
    steps.forEach((s, si) => stepChecks(s, `${named} step ${si + 1}`, refs, problems, warnings));
  });
  return { ok: problems.length === 0, problems, warnings };
}

function stepChecks(s: unknown, at: string, refs: DeskRefs, problems: string[], warnings: string[]): void {
  if (!isRecord(s)) {
    problems.push(`${at} is not an object`);
    return;
  }
  const kind = s["kind"];
  if (typeof kind !== "string" || !(DESK_STEP_KINDS as readonly string[]).includes(kind)) {
    problems.push(`${at}: kind must be one of ${DESK_STEP_KINDS.join(", ")}`);
    return;
  }
  const k = kind as DeskStepKind;
  for (const key of Object.keys(s)) if (!BASE_KEYS.includes(key) && !STEP_KEYS[k].includes(key)) problems.push(`${at}: a ${k} step has no ${key}`);
  if (s["start"] !== undefined && !(DESK_STARTS as readonly string[]).includes(s["start"] as string)) problems.push(`${at}: start must be "with" or "after"`);
  if (s["wait"] !== undefined && !isMs(s["wait"])) problems.push(`${at}: wait must be whole ms from 0 to ${DESK_WAIT_MAX_MS}`);
  if (s["note"] !== undefined && typeof s["note"] !== "string") problems.push(`${at}: note must be text`);
  if (s["dur"] !== undefined && !isMs(s["dur"])) problems.push(`${at}: dur must be whole ms from 0 to ${DESK_WAIT_MAX_MS}`);
  const gain = s["gain"];
  if (gain !== undefined && (typeof gain !== "number" || !Number.isFinite(gain) || gain < DESK_GAIN_MIN || gain > DESK_GAIN_MAX)) problems.push(`${at}: gain must be ${DESK_GAIN_MIN} to ${DESK_GAIN_MAX} dB`);
  const to = s["to"];
  const audioTo = () => {
    if (to === undefined) return;
    if (!isNames(to) || to.length === 0) problems.push(`${at}: to must be a list of names`);
    else if (refs.audioTargets !== undefined) for (const t of to) if (!inList(t, refs.audioTargets)) warnings.push(`${at}: no speaker, zone or room is called ${t}`);
  };
  switch (k) {
    case "sound": {
      const sound = s["sound"];
      if (typeof sound !== "string" || !DESK_SOUND_RE.test(sound)) problems.push(`${at}: sound must be a sound name`);
      else {
        if (sound === DESK_CHIME_SOUND) warnings.push(`${at}: ${DESK_CHIME_SOUND} rings with the announcements; a say step rings it`);
        else if (refs.sounds !== undefined && !refs.sounds.includes(sound)) warnings.push(`${at}: ${sound} is not one of the story's sounds (fine if the router's machine has the file)`);
      }
      audioTo();
      break;
    }
    case "say": {
      const text = s["text"];
      if (typeof text !== "string" || text.trim() === "") problems.push(`${at}: text must be what to say`);
      else if (text.length > DESK_SAY_MAX) problems.push(`${at}: at most ${DESK_SAY_MAX} characters`);
      if (s["chime"] !== undefined && typeof s["chime"] !== "boolean") problems.push(`${at}: chime must be true or false`);
      audioTo();
      break;
    }
    case "look": {
      const look = s["look"];
      if (typeof look !== "string" || look === "") problems.push(`${at}: look must be a look name`);
      else if (refs.looks !== undefined && !refs.looks.includes(look)) problems.push(`${at}: lights.json has no look ${look}`);
      break;
    }
    case "light": {
      if (!isNames(to) || to.length === 0) problems.push(`${at}: to must name some lights`);
      else if (refs.lightTargets !== undefined) for (const t of to) if (!inList(t, refs.lightTargets)) problems.push(`${at}: no light, zone or room is called ${t}`);
      const set = s["set"];
      if (!isRecord(set)) problems.push(`${at}: set must be a light state`);
      else if (refs.lightStateProblems !== undefined) for (const p of refs.lightStateProblems(`${at} set`, set)) problems.push(p);
      break;
    }
    case "stop":
      if (s["announce"] !== undefined && typeof s["announce"] !== "boolean") problems.push(`${at}: announce must be true or false`);
      break;
    case "event": {
      const event = s["event"];
      if (typeof event !== "string" || !DESK_EVENT_RE.test(event)) problems.push(`${at}: event must be a story event name`);
      else if (refs.events !== undefined && !refs.events.includes(event)) warnings.push(`${at}: no \`when ${event}:\` in the story hears it`);
      break;
    }
    case "speech": {
      const room = s["room"];
      if (typeof room !== "string" || room.trim() === "") problems.push(`${at}: room must be a LOCATION`);
      else if (refs.rooms !== undefined && !inList(room, refs.rooms)) problems.push(`${at}: the story has no LOCATION ${room}`);
      if (s["max"] !== undefined && !isMs(s["max"], DESK_SPEECH_MAX_MS)) problems.push(`${at}: max must be whole ms from 0 to ${DESK_SPEECH_MAX_MS}`);
      break;
    }
    case "wait":
      if (!isMs(s["ms"])) problems.push(`${at}: ms must be whole ms from 0 to ${DESK_WAIT_MAX_MS}`);
      break;
  }
}

/** Every story event a desk can fire (its `event` steps and `done`s), sorted. */
export function deskEvents(desk: DeskConfig): string[] {
  const out = new Set<string>();
  for (const c of desk.cues) {
    if (c.done !== undefined) out.add(c.done);
    for (const s of c.steps) if (s.kind === "event") out.add(s.event);
  }
  return [...out].sort();
}

/** The story events one cue fires, in step order, its `done` last. */
export function cueEvents(cue: DeskCue): string[] {
  const out = cue.steps.flatMap((s) => (s.kind === "event" ? [s.event] : []));
  return cue.done !== undefined ? [...out, cue.done] : out;
}

// ---------------------------------------------------------------------------
// The timeline: groups, and how long each step lasts.

/** The steps' groups, as step indices: a `with` step joins the group of the
 *  step before it; any other step opens a new group. */
export function deskGroups(cue: Pick<DeskCue, "steps">): number[][] {
  const groups: number[][] = [];
  cue.steps.forEach((s, i) => {
    if (i > 0 && s.start === "with") groups[groups.length - 1]!.push(i);
    else groups.push([i]);
  });
  return groups;
}

/** What the timeline needs to know about the house (each answer null = not known yet). */
export interface DeskDurations {
  /** A look's planned length (ms; a loop: 0). */
  lookMs?: (look: string) => number | null;
  /** A sound file's length (ms), as the router reports it. */
  soundMs?: (sound: string) => number | null;
}

/** How long a step lasts, if it is known before it plays (null: the router or
 *  a terminal will say). */
export function stepMs(step: DeskStep, d: DeskDurations = {}): number | null {
  switch (step.kind) {
    case "sound":
      return step.dur ?? d.soundMs?.(step.sound) ?? null;
    case "say":
      return step.dur ?? null;
    case "look":
      return d.lookMs?.(step.look) ?? null;
    case "light":
      return Math.round((step.set.transition ?? 0) * 1000);
    case "stop":
      return DESK_STOP_MS;
    case "event":
      return 0;
    case "speech":
      return null;
    case "wait":
      return step.ms;
  }
}

export interface DeskTimelineStep {
  i: number;
  group: number;
  /** ms from GO (null: after a step whose length isn't known). */
  start: number | null;
  end: number | null;
}

/** The cue as planned: each step's start and end from GO, as far as known.
 *  The editor draws it; the server never runs off it (it runs `DeskRun`). */
export function cueTimeline(cue: Pick<DeskCue, "steps">, d: DeskDurations = {}): { steps: DeskTimelineStep[]; end: number | null } {
  const out: DeskTimelineStep[] = [];
  let groupStart: number | null = 0;
  deskGroups(cue).forEach((g, gi) => {
    let groupEnd: number | null = groupStart;
    for (const i of g) {
      const s = cue.steps[i]!;
      const start = groupStart === null ? null : groupStart + (s.wait ?? 0);
      const ms = stepMs(s, d);
      const end = start === null || ms === null ? null : start + ms;
      out.push({ i, group: gi, start, end });
      groupEnd = groupEnd === null || end === null ? null : Math.max(groupEnd, end);
    }
    groupStart = groupEnd;
  });
  return { steps: out, end: groupStart };
}

// ---------------------------------------------------------------------------
// A run: the server's state machine for one GO (pure; the hub owns the clock).

export type DeskRunStepState = "pending" | "waiting" | "running" | "ended" | "skipped";

export interface DeskRunStep {
  i: number;
  group: number;
  state: DeskRunStepState;
  /** Server ms: when it starts (waiting) / started (running, ended). */
  startAt: number | null;
  /** Server ms: when it ends (running: the deadline until the router or a terminal says sooner). */
  endAt: number | null;
  /** How it went: `played`, `no-file`, `nowhere`, `timeout`, `no terminal`, `router away`, `stopped`, … */
  result?: string;
}

export interface DeskRun {
  /** The hub's run counter (unique within a server process). */
  run: number;
  cue: string;
  name: string;
  /** Who pressed GO (a director's name, a host's part, "the story"). Views for booths pass it through `unseen-directors`. */
  by: string;
  source: "desk" | "story";
  startedAt: number;
  /** The group running now. */
  group: number;
  steps: DeskRunStep[];
  state: "running" | "done" | "stopped";
  endedAt: number | null;
}

/** A new run of `cue` at `now`: the first group waiting. */
export function beginRun(cue: DeskCue, run: number, by: string, source: DeskRun["source"], now: number): DeskRun {
  const groups = deskGroups(cue);
  const steps: DeskRunStep[] = [];
  groups.forEach((g, gi) => {
    for (const i of g) steps.push({ i, group: gi, state: gi === 0 ? "waiting" : "pending", startAt: gi === 0 ? now + (cue.steps[i]!.wait ?? 0) : null, endAt: null });
  });
  steps.sort((a, b) => a.i - b.i);
  const r: DeskRun = { run, cue: cue.id, name: cue.name, by, source, startedAt: now, group: 0, steps, state: "running", endedAt: null };
  return steps.length === 0 ? { ...r, state: "done", endedAt: now } : r;
}

/** One tick at `now`: running steps past their end end (`timeout` when the
 *  end was only a deadline: `dynamic`), a finished group opens the next, and
 *  the steps due to start are returned — marked running with no end yet;
 *  the hub plays each and calls `stepStarted`. `finished` once, when the
 *  last group ends. Call again until `start` comes back empty (an instant
 *  step can open the next group in the same instant). */
export function tickRun(run: DeskRun, cue: DeskCue, now: number): { run: DeskRun; start: number[]; finished: boolean } {
  if (run.state !== "running") return { run, start: [], finished: false };
  const steps = run.steps.map((s) => ({ ...s }));
  for (const s of steps) {
    if (s.state === "running" && s.endAt !== null && s.endAt <= now) {
      s.state = "ended";
      if (s.result === undefined && dynamicStep(cue.steps[s.i]!)) s.result = "timeout";
    }
  }
  let group = run.group;
  const groupDone = (g: number) => steps.every((s) => s.group !== g || s.state === "ended" || s.state === "skipped");
  const lastGroup = steps.reduce((m, s) => Math.max(m, s.group), 0);
  if (groupDone(group)) {
    if (group >= lastGroup) return { run: { ...run, steps, state: "done", endedAt: now }, start: [], finished: true };
    group += 1;
    for (const s of steps) if (s.group === group) {
      s.state = "waiting";
      s.startAt = now + (cue.steps[s.i]!.wait ?? 0);
    }
  }
  const start: number[] = [];
  for (const s of steps) {
    if (s.state === "waiting" && s.startAt !== null && s.startAt <= now) {
      s.state = "running";
      s.startAt = now;
      s.endAt = null;
      start.push(s.i);
    }
  }
  return { run: { ...run, steps, group }, start, finished: false };
}

/** Steps whose end only the router or a terminal knows. */
function dynamicStep(s: DeskStep): boolean {
  return (s.kind === "sound" || s.kind === "say") ? s.dur === undefined : s.kind === "speech";
}

/** The hub played step `i`: it ends at `endAt` (a known length, or a deadline
 *  the router / a terminal may beat with `stepEnded`). */
export function stepStarted(run: DeskRun, i: number, endAt: number, result?: string): DeskRun {
  return { ...run, steps: run.steps.map((s) => (s.i === i && s.state === "running" ? { ...s, endAt, ...(result !== undefined ? { result } : {}) } : s)) };
}

/** Step `i` ended at `now` (the router's answer, a terminal fell quiet, a
 *  refusal). A step that isn't running is left alone. */
export function stepEnded(run: DeskRun, i: number, now: number, result?: string): DeskRun {
  return { ...run, steps: run.steps.map((s) => (s.i === i && s.state === "running" ? { ...s, state: "ended" as const, endAt: now, ...(result !== undefined ? { result } : {}) } : s)) };
}

/** A sound / say step learned its length from the router (`ms` from its start). */
export function stepLength(run: DeskRun, i: number, ms: number, result?: string): DeskRun {
  return { ...run, steps: run.steps.map((s) => (s.i === i && s.state === "running" && s.startAt !== null ? { ...s, endAt: s.startAt + Math.max(0, ms), ...(result !== undefined ? { result } : {}) } : s)) };
}

/** Stop a run: nothing more starts; what hasn't ended is `stopped`. Its
 *  `done` event is never fired. */
export function stopRun(run: DeskRun, now: number): DeskRun {
  if (run.state !== "running") return run;
  return { ...run, state: "stopped", endedAt: now, steps: run.steps.map((s) => (s.state === "ended" || s.state === "skipped" ? s : { ...s, state: s.state === "running" ? ("ended" as const) : ("skipped" as const), result: "stopped" })) };
}

/** When the hub must tick this run next (server ms), or null (finished). */
export function runWakeAt(run: DeskRun): number | null {
  if (run.state !== "running") return null;
  let at: number | null = null;
  for (const s of run.steps) {
    const t = s.state === "waiting" ? s.startAt : s.state === "running" ? s.endAt : null;
    if (t !== null && (at === null || t < at)) at = t;
  }
  return at;
}

/** 0–1 through the run for a progress bar, off the steps' known ends. */
export function runProgress(run: DeskRun, now: number): number {
  if (run.state !== "running") return 1;
  const ends = run.steps.map((s) => s.endAt).filter((t): t is number => t !== null);
  const last = Math.max(now, ...ends);
  const span = last - run.startedAt;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (now - run.startedAt) / span));
}

/** The cue after `id` in running order (the playhead after a GO), or null. */
export function cueAfter(desk: DeskConfig, id: string | null): string | null {
  if (desk.cues.length === 0) return null;
  if (id === null) return desk.cues[0]!.id;
  const i = desk.cues.findIndex((c) => c.id === id);
  return i < 0 || i + 1 >= desk.cues.length ? null : desk.cues[i + 1]!.id;
}

/** The cue list under its sections, in order (a cue with no section joins the one above it). */
export function deskSections(desk: DeskConfig): Array<{ title: string | null; cues: DeskCue[] }> {
  const out: Array<{ title: string | null; cues: DeskCue[] }> = [];
  for (const c of desk.cues) {
    const title = c.section?.trim() || null;
    if (out.length === 0 || (title !== null && title !== out[out.length - 1]!.title)) out.push({ title, cues: [c] });
    else out[out.length - 1]!.cues.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plain words for steps (the cue list's summary line, the editor's rows).

function toText(to: readonly string[] | undefined, fallback: string): string {
  return to === undefined || to.length === 0 ? fallback : to.join(", ");
}

function lightText(set: DeskLightState): string {
  const bits: string[] = [];
  if (set.state === "OFF") bits.push("off");
  else if (set.state === "ON") bits.push("on");
  if (set.color !== undefined) bits.push(set.color);
  if (set.color_temp !== undefined) bits.push(`${set.color_temp} mired`);
  if (set.brightness !== undefined) bits.push(`${Math.round((set.brightness / 254) * 100)}%`);
  if (set.effect !== undefined) bits.push(set.effect);
  if (set.transition !== undefined && set.transition > 0) bits.push(`over ${set.transition} s`);
  return bits.join(" ") || "no change";
}

/** One step in a line: "🔊 modem_handshake → The Optical Drive (−6 dB)". */
export function stepText(step: DeskStep): string {
  switch (step.kind) {
    case "sound":
      return `🔊 ${step.sound} → ${toText(step.to, "as the story routes it")}${step.gain !== undefined && step.gain !== 0 ? ` (${step.gain > 0 ? "+" : "−"}${Math.abs(step.gain)} dB)` : ""}`;
    case "say":
      return `📢 “${step.text}” → ${toText(step.to, "the announcement speakers")}${step.chime === false ? " (no chime)" : ""}`;
    case "look":
      return `💡 look ${step.look}`;
    case "light":
      return `💡 ${toText(step.to, "?")}: ${lightText(step.set)}`;
    case "stop":
      return step.announce === true ? "■ stop the house sounds + the announcement" : "■ stop the house sounds";
    case "event":
      return `⚡ story: ${step.event}`;
    case "speech":
      return `🗣 until ${step.room} has said its lines${step.max !== undefined ? ` (at most ${Math.round(step.max / 1000)} s)` : ""}`;
    case "wait":
      return `⏱ ${secondsText(step.ms)}`;
  }
}

/** "1.5 s", "2:05". */
export function secondsText(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s - m * 60)).padStart(2, "0")}`;
}

/** The step's timing prefix: "with ↑", "+2 s", "then +2 s". */
export function stepTiming(step: DeskStep, i: number): string {
  const wait = step.wait !== undefined && step.wait > 0 ? `+${secondsText(step.wait)}` : "";
  if (i === 0) return wait;
  return step.start === "with" ? `with ↑${wait !== "" ? ` ${wait}` : ""}` : `then${wait !== "" ? ` ${wait}` : ""}`;
}

// ---------------------------------------------------------------------------
// The wire: `GET /api/mod/desk` (directors and hosts).

export interface DeskMark {
  mark: "ok" | "bad";
  /** Booth views: a director reads "Director". */
  by: string;
  at: number;
  note?: string;
}

/** The router's last report (`POST /api/mod/audio/report`), as the desk shows it. */
export interface DeskAudioHealth {
  /** Server ms it arrived. */
  at: number;
  ok: boolean;
  /** The CoreAudio device it opened, or null (none). */
  device: string | null;
  /** `moved`: the device reports other channel totals than `audio.json` expects. */
  layout: "ok" | "moved" | null;
  voices: number;
  xruns: number;
  peakDb: number | null;
  announce: "on" | "off" | "blocked" | null;
  /** Story sounds with no file on the house Mac. */
  missing: string[];
  /** Sounds still playing the generated placeholder. */
  placeholders: string[];
  /** How many sound files it has. */
  files: number;
  /** (wave 38) The soundtrack's scene, its beds and the playlists with no
   *  file; each input's peak (dBFS) and each ducking source's activity
   *  (0..1); stream underruns. Absent from an older router. */
  music?: { scene: string | null; beds: Array<{ playlist: string; speakers: string[]; track: string | null; posS: number }>; missing: string[] };
  inputs?: Record<string, number>;
  sources?: Record<string, number>;
  underruns?: number;
}

export interface DeskPresence {
  online: boolean;
  /** Server ms of its last poll, null = never since the server started. */
  lastSeen: number | null;
  name: string | null;
}

/** A character the story hands to an outside mind (`mind: external`:
 *  Trabolta), and the stagehand `agents` workers voicing it now (wave 30). */
export interface DeskMind {
  character: string;
  name: string;
  online: boolean;
  /** The connected workers' names (`laptop.yaml` `agents.name`). */
  workers: string[];
}

export interface DeskSpeaker {
  id: string;
  name: string;
  room: string;
  /** The map's room label (the id when the map has none). */
  roomName: string;
  out: number[];
}

export interface DeskSound {
  name: string;
  /** `audio.json` `cues[name].to`, or null (the story's rooms, else everywhere). */
  to: string[] | null;
  /** On the house Mac: a real file, the placeholder, none, or not known (no report). */
  file: "ok" | "placeholder" | "missing" | null;
  /** Its length (ms), when the router reported it. */
  ms: number | null;
}

export interface DeskFixture {
  id: string;
  name: string;
  room: string;
  roomName: string;
  kind: string;
  caps: { color: boolean; ct: boolean; dim: boolean };
  safety: boolean;
  device: string;
  /** Is its device in the lights module's Zigbee2MQTT list (null: no list yet)? */
  inZ2m: boolean | null;
}

export interface DeskLook {
  name: string;
  to: string[];
  /** Its planned length (ms; a loop: 0), null when it can't be planned. */
  ms: number | null;
  loop: boolean;
  note?: string;
}

export interface DeskHouse {
  router: DeskPresence;
  health: DeskAudioHealth | null;
  speakers: DeskSpeaker[];
  outputs: Array<{ ch: number; label: string }>;
  zones: Array<{ id: string; name: string; speakers: string[] }>;
  /** The story's sounds (sorted), with what the house Mac said about each. */
  sounds: DeskSound[];
  /** Names a sound's `to` may use. */
  audioTargets: string[];
  lightsModule: DeskPresence | null;
  fixtures: DeskFixture[];
  lightZones: Array<{ id: string; name: string; fixtures: string[] }>;
  looks: DeskLook[];
  /** Names a light step's `to` may use. */
  lightTargets: string[];
  /** Zigbee pairing open until (server ms), or null. */
  pairUntil: number | null;
  /** The story's LOCATIONs (a speech step's room). */
  rooms: string[];
  /** The story's `when <event>:` names. */
  events: string[];
  /** Every `mind: external` character and its workers (wave 30; absent
   *  from an older server). Read when the view is built: a worker coming
   *  or going shows on the next answer (a long poll answers within 25 s). */
  minds?: DeskMind[];
}

/** One thing the house did lately (tests, plays, light tests, GOs), newest first. */
export interface DeskActivity {
  at: number;
  kind: "test" | "play" | "say" | "stop" | "light" | "look" | "go" | "event" | "done";
  text: string;
  by: string;
  /** The router's / module's answer, once known (`played`, `no-file`, …). */
  result?: string;
}

export interface DeskView {
  desk: DeskConfig;
  version: string;
  source: "director" | "project" | "default";
  problems: string[];
  warnings: string[];
  /** Bumps on every change; `?after=<rev>` long-polls past it. */
  rev: number;
  /** Server ms. */
  now: number;
  /** The playhead: the cue GO fires, or null (the end of the list). */
  standby: string | null;
  /** Running runs, then the last few ended ones (newest first). */
  runs: DeskRun[];
  /** The checks' marks by check key. */
  marks: Record<string, DeskMark>;
  /** The doors are open and the show hasn't ended: a test tone asks first. */
  live: boolean;
  house: DeskHouse;
  recent: DeskActivity[];
}

// ---------------------------------------------------------------------------
// The checks: walk every speaker, output, story sound, light and look.

/** A test's POST (relative to `/e/:id`). */
export interface DeskTestCall {
  route: "/api/mod/audio/test" | "/api/mod/audio/play" | "/api/mod/lights/test";
  body: Record<string, unknown>;
}

export type DeskCheckKind = "speaker" | "out" | "sound" | "fixture" | "look";

export interface DeskCheckRow {
  /** `speaker:<id>`, `out:<ch>`, `sound:<name>`, `fixture:<id>`, `look:<name>`. */
  key: string;
  kind: DeskCheckKind;
  label: string;
  /** Where it is / what it reaches. */
  detail: string;
  test: DeskTestCall;
  /** More buttons beside Test (a fixture's colours). */
  extra: Array<{ label: string; test: DeskTestCall }>;
  mark: DeskMark | null;
  /** Why it may not work, before anyone listens ("no file on the house Mac"). */
  hints: string[];
}

export interface DeskCheckSection {
  id: "speakers" | "outputs" | "sounds" | "lights" | "looks";
  title: string;
  rows: DeskCheckRow[];
}

export function checkKey(kind: DeskCheckKind, id: string | number): string {
  return `${kind}:${id}`;
}

/** The colours a colour bulb is walked through (and white / off for any). */
export const DESK_SWATCHES: ReadonlyArray<{ label: string; set: DeskLightState; needs: "color" | "ct" | "dim" | null }> = [
  { label: "Red", set: { state: "ON", color: "#ff0000", brightness: 254 }, needs: "color" },
  { label: "Green", set: { state: "ON", color: "#00ff00", brightness: 254 }, needs: "color" },
  { label: "Blue", set: { state: "ON", color: "#0000ff", brightness: 254 }, needs: "color" },
  { label: "White", set: { state: "ON", color_temp: 250, brightness: 254 }, needs: "ct" },
  { label: "Dim", set: { state: "ON", brightness: 60 }, needs: "dim" },
  { label: "Off", set: { state: "OFF" }, needs: null },
];

/** The check list off a desk view: what to walk, how to test each, its mark
 *  and what may stop it working. */
export function deskChecks(view: Pick<DeskView, "house" | "marks">): DeskCheckSection[] {
  const h = view.house;
  const mark = (key: string) => view.marks[key] ?? null;
  const routerAway = h.router.online ? [] : [h.router.lastSeen === null ? "the sound router has never connected" : "the sound router is offline"];
  const moduleAway = h.lightsModule?.online === true ? [] : [h.lightsModule === null || h.lightsModule.lastSeen === null ? "the lights module has never connected" : "the lights module is offline"];
  const speakerOf = new Map(h.speakers.map((s) => [s.id, s]));
  const speakers: DeskCheckRow[] = h.speakers.map((s) => {
    const key = checkKey("speaker", s.id);
    return { key, kind: "speaker", label: s.name, detail: `${s.roomName} · out ${s.out.join(", ")}`, test: { route: "/api/mod/audio/test", body: { speaker: s.id } }, extra: [], mark: mark(key), hints: routerAway };
  });
  const outputs: DeskCheckRow[] = h.outputs.map((o) => {
    const key = checkKey("out", o.ch);
    const on = h.speakers.filter((s) => s.out.includes(o.ch)).map((s) => s.name);
    return { key, kind: "out", label: `Out ${o.ch}`, detail: `${o.label}${on.length > 0 ? ` · ${on.join(", ")}` : " · no speaker"}`, test: { route: "/api/mod/audio/test", body: { out: o.ch } }, extra: [], mark: mark(key), hints: routerAway };
  });
  const sounds: DeskCheckRow[] = h.sounds.map((s) => {
    const key = checkKey("sound", s.name);
    const hints = [...routerAway];
    if (s.file === "missing") hints.push("no file on the router's machine");
    if (s.file === "placeholder") hints.push("still the placeholder");
    const reach = s.to === null ? "the story's rooms, else everywhere" : s.to.map((t) => speakerOf.get(t)?.name ?? t).join(", ");
    return { key, kind: "sound", label: s.name, detail: `→ ${reach}${s.ms !== null ? ` · ${secondsText(s.ms)}` : ""}`, test: { route: "/api/mod/audio/play", body: { sound: s.name } }, extra: [], mark: mark(key), hints };
  });
  const lights: DeskCheckRow[] = h.fixtures.map((f) => {
    const key = checkKey("fixture", f.id);
    const hints = [...moduleAway];
    if (f.inZ2m === false) hints.push(`Zigbee2MQTT has no device ${f.device}`);
    if (f.safety) hints.push("safety light: never fully off");
    const extra = DESK_SWATCHES.filter((w) => w.needs === null || f.caps[w.needs]).filter((w) => !(f.safety && w.set.state === "OFF")).map((w) => ({ label: w.label, test: { route: "/api/mod/lights/test" as const, body: { fixture: f.id, set: w.set } } }));
    return { key, kind: "fixture", label: f.name, detail: `${f.roomName} · ${f.kind} ${f.device}`, test: { route: "/api/mod/lights/test", body: { fixture: f.id } }, extra, mark: mark(key), hints };
  });
  const looks: DeskCheckRow[] = h.looks.map((l) => {
    const key = checkKey("look", l.name);
    const len = l.loop ? "loops" : l.ms !== null ? secondsText(l.ms) : "";
    return { key, kind: "look", label: l.name, detail: `${l.to.join(", ")}${len !== "" ? ` · ${len}` : ""}${l.note !== undefined && l.note !== "" ? ` · ${l.note}` : ""}`, test: { route: "/api/mod/lights/test", body: { look: l.name } }, extra: [], mark: mark(key), hints: moduleAway };
  });
  const out: DeskCheckSection[] = [
    { id: "speakers", title: "Speakers", rows: speakers },
    { id: "outputs", title: "Outputs", rows: outputs },
    { id: "sounds", title: "Story sounds", rows: sounds },
    { id: "lights", title: "Lights", rows: lights },
    { id: "looks", title: "Looks", rows: looks },
  ];
  return out.filter((s) => s.rows.length > 0);
}

/** How far the walk has got. */
export function checkProgress(sections: readonly DeskCheckSection[]): { ok: number; bad: number; open: number; total: number } {
  let ok = 0;
  let bad = 0;
  let total = 0;
  for (const s of sections)
    for (const r of s.rows) {
      total += 1;
      if (r.mark?.mark === "ok") ok += 1;
      else if (r.mark?.mark === "bad") bad += 1;
    }
  return { ok, bad, open: total - ok - bad, total };
}

/** The next row with no mark after `key` (wrapping), or null when all are marked. */
export function nextOpenCheck(sections: readonly DeskCheckSection[], key: string | null): DeskCheckRow | null {
  const rows = sections.flatMap((s) => s.rows);
  if (rows.length === 0) return null;
  const from = key === null ? -1 : rows.findIndex((r) => r.key === key);
  for (let k = 1; k <= rows.length; k++) {
    const r = rows[(from + k + rows.length) % rows.length]!;
    if (r.mark === null) return r;
  }
  return null;
}

/** Does a test need a "the show is live" confirm first? Tones, plays and
 *  light tests are heard / seen by guests once the doors are open. */
export function testNeedsConfirm(view: Pick<DeskView, "live">): boolean {
  return view.live;
}

// ---------------------------------------------------------------------------
// The status strip (both screens): the router, the lights, what's wrong.

export interface DeskChip {
  kind: "router" | "files" | "layout" | "lights" | "z2m" | "mind" | "problems";
  tone: "ok" | "warn" | "bad";
  text: string;
}

/** The desk's status chips, worst first within each kind's order. */
export function deskStatus(view: Pick<DeskView, "house" | "problems">): DeskChip[] {
  const h = view.house;
  const chips: DeskChip[] = [];
  const who = h.router.name !== null ? ` (${h.router.name})` : "";
  chips.push(h.router.online ? { kind: "router", tone: h.health !== null && !h.health.ok ? "warn" : "ok", text: `🔊 router online${who}${h.health?.device != null ? ` · ${h.health.device}` : ""}` } : { kind: "router", tone: "bad", text: h.router.lastSeen === null ? "🔊 router never connected" : "🔊 router offline" });
  if (h.health !== null) {
    const missing = h.sounds.filter((s) => s.file === "missing").length;
    const placeholders = h.sounds.filter((s) => s.file === "placeholder").length;
    if (missing > 0) chips.push({ kind: "files", tone: "bad", text: `${missing} sound${missing === 1 ? "" : "s"} missing` });
    if (placeholders > 0) chips.push({ kind: "files", tone: "warn", text: `${placeholders} placeholder${placeholders === 1 ? "" : "s"}` });
    if (h.health.layout === "moved") chips.push({ kind: "layout", tone: "bad", text: "interface layout moved" });
  }
  if (h.fixtures.length > 0 || h.looks.length > 0) {
    const m = h.lightsModule;
    chips.push(m?.online === true ? { kind: "lights", tone: "ok", text: `💡 lights online${m.name !== null ? ` (${m.name})` : ""}` } : { kind: "lights", tone: "bad", text: m === null || m.lastSeen === null ? "💡 lights never connected" : "💡 lights offline" });
    const lost = h.fixtures.filter((f) => f.inZ2m === false).length;
    if (lost > 0) chips.push({ kind: "z2m", tone: "bad", text: `${lost} light${lost === 1 ? "" : "s"} not in Zigbee2MQTT` });
  }
  for (const m of h.minds ?? []) chips.push(m.online ? { kind: "mind", tone: "ok", text: `🧠 ${m.name} online${m.workers.length > 0 ? ` (${m.workers.join(", ")})` : ""}` } : { kind: "mind", tone: "bad", text: `🧠 ${m.name}: no mind connected` });
  if (view.problems.length > 0) chips.push({ kind: "problems", tone: "bad", text: `desk.json: ${view.problems.length} problem${view.problems.length === 1 ? "" : "s"}` });
  return chips;
}

// ---------------------------------------------------------------------------
// Setup (wave 30): the house's three systems, each with what to do next.
// Both screens render it: the editor's Run → House → Setup and the hosts'
// Desk window. Plain words, no machine names beyond the workers' own: the
// runbooks (`scripts/house-desktop/README.md`, `stagehand/README.md`) say
// which machine runs which job.

export interface DeskSetupRow {
  /** `sound`, `lights`, or `mind:<character>`. */
  id: string;
  /** "🔊 Sound", "💡 Lights", "🧠 Trabolta". */
  title: string;
  tone: "ok" | "warn" | "bad";
  /** One line: what is connected. */
  status: string;
  /** What to do, in order (empty when nothing is wrong). */
  fix: string[];
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const firstFew = (xs: readonly string[], n = 4): string => (xs.length <= n ? xs.join(", ") : `${xs.slice(0, n).join(", ")} and ${xs.length - n} more`);

/** "12 s ago", "4 min ago". */
export function agoText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** The sound router, the lights module and each outside mind: up or not, and what to do. */
export function deskSetup(view: Pick<DeskView, "house" | "now">): DeskSetupRow[] {
  const h = view.house;
  const rows: DeskSetupRow[] = [];

  // --- sound --------------------------------------------------------------
  {
    const r = h.router;
    const hl = h.health;
    const fix: string[] = [];
    let tone: DeskSetupRow["tone"] = "ok";
    let status: string;
    const bad = (line: string) => {
      tone = "bad";
      fix.push(line);
    };
    const warn = (line: string) => {
      if (tone === "ok") tone = "warn";
      fix.push(line);
    };
    if (!r.online) {
      status = r.lastSeen === null ? "The sound router has not connected to this event" : `The sound router went quiet ${agoText(view.now - r.lastSeen)}`;
      bad(
        r.lastSeen === null
          ? "Start stagehand's audio job on the machine the audio interface is plugged into, with this event's id and the moderator passcode in its local config."
          : "Restart stagehand's audio job on the audio machine, and check that machine is online.",
      );
      fix.push("Windows: scripts\\house-desktop\\start-stagehand.ps1 -Restart audio (-Status reads its log). Mac (the fallback): uv run stagehand launchd restart --job audio.");
    } else {
      const parts = [`Online${r.name !== null ? ` on ${r.name}` : ""}`];
      if (hl === null) {
        parts.push("no report yet");
        warn("Wait a few seconds for its first report; an old router never reports (update stagehand on the audio machine).");
      } else {
        parts.push(hl.device !== null ? hl.device : "no interface");
        parts.push(plural(hl.files, "sound file"));
        if (hl.device === null) bad("The router found no audio interface: power the interface on, plug it in, and check its driver (ASIO on Windows), then restart the audio job.");
        if (hl.layout === "moved") bad("The interface shows other channel counts than audio.json expects: turn on and clock the ADAT expander, then restart the audio job.");
        if (hl.announce === "blocked") bad("Announcements are blocked: the router can't reach the house broker (check Mosquitto and the props password).");
        if (hl.xruns > 0) warn(`${plural(hl.xruns, "audio dropout")} so far: close other audio apps on that machine, or raise the router's buffer.`);
      }
      status = parts.join(" · ");
    }
    const missing = h.sounds.filter((x) => x.file === "missing").map((x) => x.name);
    const placeholders = h.sounds.filter((x) => x.file === "placeholder").map((x) => x.name);
    if (missing.length > 0) bad(`${plural(missing.length, "story sound")} with no file: ${firstFew(missing)}. Put each file in stagehand/media/sounds/ on the audio machine (or run stagehand sounds placeholders).`);
    if (placeholders.length > 0) warn(`${plural(placeholders.length, "sound")} still the generated placeholder: ${firstFew(placeholders)}.`);
    if (h.speakers.length === 0) warn("No speakers are placed: place them on the house map's 🔊 Audio tab.");
    else if (r.online && fix.length === 0) status += ` · ${plural(h.speakers.length, "speaker")}`;
    rows.push({ id: "sound", title: "🔊 Sound", tone, status, fix });
  }

  // --- lights -------------------------------------------------------------
  {
    const m = h.lightsModule;
    const fix: string[] = [];
    let tone: DeskSetupRow["tone"] = "ok";
    let status: string;
    if (h.fixtures.length === 0) {
      tone = "warn";
      status = h.looks.length > 0 ? `No lights placed (${plural(h.looks.length, "look")} written)` : "No lights yet";
      fix.push("Pair each bulb with Zigbee2MQTT (🔗 Pair a bulb), give it a friendly name, then place it on the house map's 💡 Lights tab and Save to project.");
      fix.push("A WLED strip joins over Wi-Fi: point its MQTT at the house broker, then place it as a WLED light.");
    } else if (m === null || !m.online) {
      tone = "bad";
      status = m === null || m.lastSeen === null ? "The lights module has not connected to this event" : `The lights module went quiet ${agoText(view.now - m.lastSeen)}`;
      fix.push("Start stagehand's lights job on the machine running Zigbee2MQTT (Windows: scripts\\house-desktop\\start-stagehand.ps1 -Restart lights; -Status reads its log).");
    } else {
      const zig = h.fixtures.filter((f) => f.kind !== "wled").length;
      const wled = h.fixtures.length - zig;
      status = [`Online${m.name !== null ? ` on ${m.name}` : ""}`, zig > 0 ? plural(zig, "Zigbee light") : null, wled > 0 ? plural(wled, "WLED strip") : null, plural(h.looks.length, "look")].filter((x) => x !== null).join(" · ");
    }
    const lost = h.fixtures.filter((f) => f.inZ2m === false);
    if (lost.length > 0) {
      tone = "bad";
      fix.push(`Zigbee2MQTT doesn't know ${firstFew(lost.map((f) => `${f.name} (${f.device})`))}: pair it, then rename it in Zigbee2MQTT to exactly that friendly name.`);
    }
    if (h.pairUntil !== null) status += ` · pairing open ${Math.max(0, Math.round((h.pairUntil - view.now) / 1000))} s`;
    rows.push({ id: "lights", title: "💡 Lights", tone, status, fix });
  }

  // --- the outside minds ---------------------------------------------------
  for (const mind of h.minds ?? []) {
    rows.push(
      mind.online
        ? { id: `mind:${mind.character}`, title: `🧠 ${mind.name}`, tone: "ok", status: `Online on ${mind.workers.join(", ")}`, fix: [] }
        : {
            id: `mind:${mind.character}`,
            title: `🧠 ${mind.name}`,
            tone: "bad",
            status: `No mind connected: ${mind.name} answers with the story's holding line`,
            fix: [
              "On the mind's machine, check Ollama is running (ollama ps) with the model pulled.",
              "Then start stagehand's agents job with this event's id in its config (Mac: uv run stagehand launchd restart --job agents).",
            ],
          },
    );
  }
  return rows;
}
