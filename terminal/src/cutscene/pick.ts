//! Which cutscene is on screen (wave 17), pure. Two sources:
//!
//! - **the slide on top** (`screenLayers`): a story slide cue whose value a
//!   scene names plays that scene for as long as the slide is held (or its
//!   `ms`), drawn from the cue's own `at`; a slide no scene names (or one
//!   that is done) shows its card, as before;
//! - **moments** (`state.moments`): a queue of transient scenes, one at a
//!   time — highest `priority` first, then oldest — each drawn from its
//!   moment's `at`, or from the end of the one before when it had to wait.
//!   A moment older than `MOMENT_STALE_MS` when this page first sees it is
//!   skipped; the cursor resyncs on a story restart (`announceEpoch`), like
//!   the announcements' (`planAnnounce`). The first answer after a reload
//!   resumes whatever is still running (D2) instead of skipping it. A
//!   higher-priority moment that has happened cuts the one playing short.
//!
//! Precedence: an overlay (blackout / alarm / go to the living room) wins
//! over everything, and a pilot / peek / room terminal shows no scene at all
//! (as no slide); a moment shows over the slide (in its place, or over it
//! when the scene says `over`) unless the slide's scene has the higher
//! priority. A `namesCharacter` scene never plays before the introduction.

import { epochMoved } from "../announce.ts";
import { foldName } from "../config.ts";
import type { ScreenMoment, ScreenNight, ScreenState } from "../screen.ts";
import type { ScreenLayers } from "../slides.ts";
import { sceneT } from "./clock.ts";
import { VOICE_STRETCH_MAX_MS } from "./voice-clock.ts";
import type { ComponentType } from "react";
import type { SceneDef, SceneProps, SceneTarget, SceneTrigger } from "./types.ts";

/** A moment first seen later than this after it happened is not played (ms). */
export const MOMENT_STALE_MS = 30_000;
/** A `"hold"` moment scene that never calls `done()` ends after this (ms). */
export const MOMENT_HOLD_MAX_MS = 60_000;
/** Moments waiting at most (the lowest priority, newest drop first). */
export const QUEUE_MAX = 8;
/** A queued moment whose turn comes later than this after it happened is dropped (ms). */
export const QUEUE_WAIT_MAX_MS = 60_000;
/** The TV face's one-shot mood lasts this long unless a scene says (ms). */
export const FACE_FLASH_MS = 2500;

// --- matching ------------------------------------------------------------------------

/** Does a trigger name match a value? Folded (case, spaces, `_`, `-`); a trailing `*` is a prefix. */
export function nameMatches(pattern: string, value: string): boolean {
  const p = pattern.trim();
  if (p.endsWith("*")) return foldName(value).startsWith(foldName(p.slice(0, -1)));
  return foldName(p) === foldName(value);
}

export function triggerMatches(trigger: SceneTrigger, on: { slide: string } | { moment: ScreenMoment } | { room: string }): boolean {
  if ("room" in trigger) return "room" in on && foldName(trigger.room) === foldName(roomCueName(on.room));
  if ("slide" in trigger) return "slide" in on && nameMatches(trigger.slide, on.slide);
  return "moment" in on && trigger.moment === on.moment.kind && nameMatches(trigger.name, on.moment.name);
}

/** `room_heart_wake` → `heart_wake` (a room trigger's name). */
export function roomCueName(value: string): string {
  return value.startsWith("room_") ? value.slice(5) : value;
}

/** The scene for a room cue, on a wall target only (and, given the state, that may play now). */
export function sceneForRoom(scenes: readonly SceneDef[], value: string, target: SceneTarget, state?: Pick<ScreenState, "character"> | null): SceneDef | null {
  if (target !== "wall") return null;
  return scenes.find((d) => d.wall !== undefined && (state === undefined || allowed(d, state)) && d.when.some((w) => triggerMatches(w, { room: value }))) ?? null;
}

/**
 * The room scene on screen at server `now` (wave 20, D4): the room's last
 * picture cue, from its own `at`, for its `ms` — never one from history
 * (`at` 0), never past its end or once it called `done()` (`roomDone`). A
 * newer cue replaces it (the server keeps the last).
 */
export function roomSceneAt(o: { state: Pick<ScreenState, "room" | "character"> | null; now: number; target: SceneTarget; scenes: readonly SceneDef[]; roomDone?: (key: string) => boolean }): ActiveScene | null {
  const cue = o.state?.room?.cue ?? null;
  if (cue === null || cue.at <= 0 || o.state === null) return null;
  const def = sceneForRoom(o.scenes, cue.value, o.target, o.state);
  if (def === null) return null;
  const ms = typeof def.ms === "number" ? def.ms : MOMENT_HOLD_MAX_MS;
  if (o.now >= cue.at + ms || o.now < cue.at - 5000) return null;
  const key = `${def.id}:r${cue.seq}:${cue.at}`;
  if (o.roomDone?.(key) === true) return null;
  return { kind: "room", def, seq: cue.seq, at: cue.at, start: cue.at, value: roomCueName(cue.value), who: null, key };
}

/** The component a scene draws on this target (the TV falls back to the wall's), or null. */
export function componentFor(def: SceneDef, target: SceneTarget): ComponentType<SceneProps> | null {
  return target === "tv" ? (def.tv ?? def.wall ?? null) : (def.wall ?? null);
}

/**
 * The first scene for a slide value with something to draw on `target` —
 * and, given the state, that may play now (`allowed`): a `namesCharacter`
 * scene before the introduction gives way to a later fiction-safe one on
 * the same trigger. Without a state, no gate.
 */
export function sceneForSlide(scenes: readonly SceneDef[], value: string, target: SceneTarget, state?: Pick<ScreenState, "character"> | null): SceneDef | null {
  return scenes.find((d) => componentFor(d, target) !== null && (state === undefined || allowed(d, state)) && d.when.some((w) => triggerMatches(w, { slide: value }))) ?? null;
}

/** The first scene for a moment with something to draw on `target` (and, given the state, that may play now). */
export function sceneForMoment(scenes: readonly SceneDef[], moment: ScreenMoment, target: SceneTarget, state?: Pick<ScreenState, "character"> | null): SceneDef | null {
  return scenes.find((d) => componentFor(d, target) !== null && (state === undefined || allowed(d, state)) && d.when.some((w) => triggerMatches(w, { moment }))) ?? null;
}

/** Has the character been introduced (revealed)? No answer, no character, still hidden: no. */
export function introduced(state: Pick<ScreenState, "character"> | null): boolean {
  return state !== null && state.character !== null && state.character.hidden === false;
}

/** May this scene play now (the introduction gate, then the scene's own `gate` on the night)? */
export function allowed(def: SceneDef, state: (Pick<ScreenState, "character"> & { night?: ScreenState["night"] }) | null): boolean {
  if (def.namesCharacter === true && !introduced(state)) return false;
  return def.gate === undefined || state?.night === undefined || def.gate(state.night);
}

const priorityOf = (d: SceneDef) => d.priority ?? 0;

// --- the moment queue -------------------------------------------------------------

/** One scene on screen (or due). `start` is server ms; `t` follows from it. */
export interface ActiveScene {
  kind: "slide" | "moment" | "room";
  def: SceneDef;
  seq: number;
  /** The cue's / moment's own `at` (0 = history). */
  at: number;
  /** When this scene started, server ms (a moment that waited starts late). */
  start: number;
  value: string;
  who: string | null;
  /** React key: a new seq is a new scene. */
  key: string;
}

interface Waiting {
  def: SceneDef;
  moment: ScreenMoment;
}

/**
 * The moments this page has seen and the one playing. Stateful but pure:
 * fed the screen state and the server's clock; `current` is asked as often
 * as a frame wants.
 */
export class MomentQueue {
  private cursor: number | null = null;
  private epoch: string | null | undefined = undefined;
  private waiting: Waiting[] = [];
  private playing: { w: Waiting; start: number; end?: number } | null = null;
  private lastEnd = 0;
  private finished = new Set<number>();

  /** Take in one answer's moments (`now` = the server's clock). */
  update(state: Pick<ScreenState, "moments" | "announceEpoch" | "character">, now: number, scenes: readonly SceneDef[], target: SceneTarget): void {
    const restarted = epochMoved(this.epoch, state.announceEpoch);
    this.epoch = state.announceEpoch;
    const list = state.moments;
    const head = list.reduce((m, x) => Math.max(m, x.seq), 0);
    // A story restart (or an older server's seqs falling back): forget the
    // old sim's moments; history is never on the wire, so whatever is there now is new.
    if (restarted || (this.cursor !== null && list.length > 0 && head < this.cursor)) {
      this.waiting = [];
      this.playing = null;
      this.finished.clear();
      this.lastEnd = 0;
      this.cursor = null;
    }
    // The first answer this page reads (a reload, a story restart): resume
    // whatever is still running by its own clock (D2), however long ago it
    // began. Later answers: a moment first seen late is skipped.
    const fresh = this.cursor === null;
    const from = this.cursor ?? Number.NEGATIVE_INFINITY;
    for (const m of list) {
      if (m.seq <= from) continue;
      if (!fresh && now - m.at > MOMENT_STALE_MS) continue; // stale on arrival (an offline tablet catching up)
      const def = sceneForMoment(scenes, m, target, state);
      if (def === null) continue;
      if (typeof def.ms === "number" && m.at + def.ms <= now) continue; // already over by its own clock
      if (fresh && typeof def.ms !== "number" && now - m.at > MOMENT_HOLD_MAX_MS) continue; // a hold the queue would have ended
      if (this.playing?.w.moment.seq === m.seq || this.waiting.some((w) => w.moment.seq === m.seq)) continue;
      this.waiting.push({ def, moment: m });
    }
    this.cursor = Math.max(this.cursor ?? 0, head);
    if (this.waiting.length > QUEUE_MAX) {
      this.waiting.sort(byTurn);
      this.waiting.length = QUEUE_MAX;
    }
  }

  /** The moment scene on screen at server `now` (advancing the queue), or null. */
  current(now: number): ActiveScene | null {
    for (;;) {
      if (this.playing !== null) {
        const { w, start } = this.playing;
        const end = this.playing.end ?? start + (typeof w.def.ms === "number" ? w.def.ms : MOMENT_HOLD_MAX_MS);
        // A bigger moment that has happened cuts this one short (midnight
        // never waits behind the majority's frost), from its own `at`, so
        // every screen cuts at the same frame.
        const bigger = this.waiting.reduce((cutAt, x) => (priorityOf(x.def) > priorityOf(w.def) && x.moment.at <= now ? Math.min(cutAt, Math.max(x.moment.at, start)) : cutAt), Number.POSITIVE_INFINITY);
        const cut = this.finished.has(w.moment.seq) || bigger !== Number.POSITIVE_INFINITY;
        if (!cut && now < end) return activeOf(w, start);
        this.lastEnd = Math.min(now, end, bigger);
        this.playing = null;
      }
      if (this.waiting.length === 0) return null;
      this.waiting.sort(byTurn);
      const next = this.waiting.shift()!;
      const start = Math.max(next.moment.at, this.lastEnd);
      if (start - next.moment.at > QUEUE_WAIT_MAX_MS) continue; // waited too long
      if (typeof next.def.ms === "number" && start + next.def.ms <= now) {
        this.lastEnd = start + next.def.ms; // it played out unseen (the page was busy elsewhere)
        continue;
      }
      if (now < start) {
        // Not its turn yet (a clock step back): wait in front.
        this.waiting.unshift(next);
        return null;
      }
      this.playing = { w: next, start };
    }
  }

  /**
   * (wave 26, V1) The playing moment `seq` ends at server `serverMs` instead
   * of its own `ms`: a voiced scene's warped clock (`voice-clock.ts`) moves
   * its end to where his voice takes it. Never before it started, never
   * more than `VOICE_STRETCH_MAX_MS` past its own end (a stuck voice never
   * wedges the queue); a `hold` scene's cap is `MOMENT_HOLD_MAX_MS`. Any
   * other seq (it ended, or another plays): nothing.
   */
  extendTo(seq: number, serverMs: number): void {
    const p = this.playing;
    if (p === null || p.w.moment.seq !== seq || !Number.isFinite(serverMs)) return;
    const own = typeof p.w.def.ms === "number" ? p.w.def.ms : MOMENT_HOLD_MAX_MS;
    const cap = p.start + (typeof p.w.def.ms === "number" ? own + VOICE_STRETCH_MAX_MS : own);
    p.end = Math.max(p.start, Math.min(serverMs, cap));
  }

  /** (wave 26, V1) The playing moment `seq` ends at its own `ms` again (its
   *  voiced scene fell back to the server's clock). Any other seq: nothing. */
  resetEnd(seq: number): void {
    const p = this.playing;
    if (p !== null && p.w.moment.seq === seq) delete p.end;
  }

  /** The playing moment's end, server ms (its own `ms`, or where `extendTo` moved it); null: none. */
  get playingEnd(): number | null {
    const p = this.playing;
    if (p === null) return null;
    return p.end ?? p.start + (typeof p.w.def.ms === "number" ? p.w.def.ms : MOMENT_HOLD_MAX_MS);
  }

  /** A scene called `done()`: it ends now. */
  done(seq: number): void {
    this.finished.add(seq);
  }

  /** How many moments are waiting (tests, the preview). */
  get pending(): number {
    return this.waiting.length;
  }
}

function byTurn(a: Waiting, b: Waiting): number {
  return priorityOf(b.def) - priorityOf(a.def) || a.moment.seq - b.moment.seq;
}

function activeOf(w: Waiting, start: number): ActiveScene {
  return { kind: "moment", def: w.def, seq: w.moment.seq, at: w.moment.at, start, value: w.moment.name, who: w.moment.who, key: `${w.def.id}:m${w.moment.seq}` };
}

// --- the pick -------------------------------------------------------------------------

/**
 * What the cutscene layer draws: under (`base`: the slide's scene, its plain
 * card, or nothing) and over (`top`: a moment). A moment that replaces the
 * slide (no `over`) leaves `base` null and hands the slide's in `under`: the
 * layer keeps it mounted but hidden, so the card (its N-04a clip) and a
 * slide scene carry on underneath instead of starting over afterwards.
 */
export interface ScenePick {
  base: ActiveScene | "card" | null;
  top: ActiveScene | null;
  under: ActiveScene | "card" | null;
  /** A room terminal's room scene (wave 20), drawn whatever the line is doing. */
  room?: ActiveScene | null;
}

export const NO_PICK: ScenePick = { base: null, top: null, under: null };

/**
 * Decide the layer at server `now`. `layers` is `screenLayers`' answer
 * (overlay + the slide on top, already bare for a pilot / peek / room);
 * `bare` is that same "no slides here" flag, which hides moments too;
 * `slideDone(seq)` says a slide scene ended itself early; `historyStarts`
 * (seq → server ms) remembers when a slide from history (`at` 0) was first
 * drawn, so its scene starts `HISTORY_T` in and then moves on (the caller
 * keeps it across answers and clears it on a story restart).
 */
export function pickScene(o: {
  state: ScreenState | null;
  now: number;
  layers: Pick<ScreenLayers, "overlay" | "slide">;
  bare: boolean;
  target: SceneTarget;
  scenes: readonly SceneDef[];
  queue: MomentQueue;
  slideDone?: (seq: number) => boolean;
  historyStarts?: Map<number, number>;
  /** A room scene that ended itself early (its key). */
  roomDone?: (key: string) => boolean;
}): ScenePick {
  // The queue moves on whatever is drawn (its scenes run on the server's clock).
  const moment = o.queue.current(o.now);
  if (o.state === null || o.layers.overlay !== null) return NO_PICK;
  // A room terminal (bare: no slides, no moments) still draws its room's scenes.
  const room = roomSceneAt({ state: o.state, now: o.now, target: o.target, scenes: o.scenes, roomDone: o.roomDone });
  if (o.bare) return room === null ? NO_PICK : { ...NO_PICK, room };
  const slide = o.layers.slide;
  let base: ScenePick["base"] = null;
  let slideScene: ActiveScene | null = null;
  if (slide !== null) {
    base = "card";
    const def = sceneForSlide(o.scenes, slide.value, o.target, o.state);
    if (def !== null && o.slideDone?.(slide.seq) !== true) {
      const start = slide.at > 0 ? slide.at : historyStart(o.historyStarts, slide.seq, o.now);
      const t = Math.max(0, o.now - start);
      if (typeof def.ms !== "number" || t < def.ms) {
        slideScene = { kind: "slide", def, seq: slide.seq, at: slide.at, start, value: slide.value, who: null, key: `${def.id}:s${slide.seq}` };
        base = slideScene;
      }
    }
  }
  // (A wall with no room cue carries no `room` at all: the pick reads as before.)
  const r = room === null ? {} : { room };
  if (moment === null) return { base, top: null, under: null, ...r };
  if (slideScene !== null && priorityOf(slideScene.def) > priorityOf(moment.def)) return { base, top: null, under: null, ...r };
  return moment.def.over === true ? { base, top: moment, under: null, ...r } : { base: null, top: moment, under: base, ...r };
}

/** A history slide's start: `HISTORY_T` before the first time it was drawn (recorded in `seen`). */
function historyStart(seen: Map<number, number> | undefined, seq: number, now: number): number {
  let first = seen?.get(seq);
  if (first === undefined) {
    first = now;
    seen?.set(seq, now);
  }
  return first - sceneT(0, first);
}

/**
 * The TV face's one-shot for the scene that leads now, or null: once per
 * scene key, ever (`seen` remembers every key — a held slide scene leading
 * again after a moment over it never flashes twice; the caller clears it on
 * a story restart). Records the key whatever the target.
 */
export function faceFlashFor(lead: ActiveScene | null, target: SceneTarget, seen: Set<string>, night?: ScreenNight): { mood: NonNullable<SceneDef["face"]>; ms: number } | null {
  if (lead === null || seen.has(lead.key)) return null;
  seen.add(lead.key);
  // The TV's scenes, and (wave 20) a room scene on its room's wall terminal.
  if ((target !== "tv" && lead.kind !== "room") || lead.def.face === undefined) return null;
  if (lead.def.faceWhen !== undefined && night !== undefined && !lead.def.faceWhen(night)) return null;
  return { mood: lead.def.face, ms: lead.def.faceMs ?? FACE_FLASH_MS };
}

/** Does a scene on screen draw the story's countdown itself (`SceneDef.countdown`)?
 *  Then the corner countdown stands aside: one clock, never two that disagree. */
export function drawsCountdown(p: ScenePick, target: SceneTarget): boolean {
  const owns = (s: ScenePick["base"]) => s !== null && s !== "card" && (s.def.countdown === true || (s.def.countdown === "tv" && target === "tv"));
  return owns(p.top) || owns(p.base);
}
