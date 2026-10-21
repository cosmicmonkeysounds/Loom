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
//!   resumes whatever is still running (D2) instead of skipping it.
//!
//! Precedence: an overlay (blackout / alarm / go to the living room) wins
//! over everything, and a pilot / peek / room terminal shows no scene at all
//! (as no slide); a moment shows over the slide (in its place, or over it
//! when the scene says `over`) unless the slide's scene has the higher
//! priority. A `namesCharacter` scene never plays before the introduction.

import { epochMoved } from "../announce.ts";
import { foldName } from "../config.ts";
import type { ScreenMoment, ScreenState } from "../screen.ts";
import type { ScreenLayers } from "../slides.ts";
import { sceneT } from "./clock.ts";
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

export function triggerMatches(trigger: SceneTrigger, on: { slide: string } | { moment: ScreenMoment }): boolean {
  if ("slide" in trigger) return "slide" in on && nameMatches(trigger.slide, on.slide);
  return "moment" in on && trigger.moment === on.moment.kind && nameMatches(trigger.name, on.moment.name);
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

/** May this scene play now (the introduction gate)? */
export function allowed(def: SceneDef, state: Pick<ScreenState, "character"> | null): boolean {
  return def.namesCharacter !== true || introduced(state);
}

const priorityOf = (d: SceneDef) => d.priority ?? 0;

// --- the moment queue -------------------------------------------------------------

/** One scene on screen (or due). `start` is server ms; `t` follows from it. */
export interface ActiveScene {
  kind: "slide" | "moment";
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
  private playing: { w: Waiting; start: number } | null = null;
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
    const from = this.cursor ?? Number.NEGATIVE_INFINITY;
    for (const m of list) {
      if (m.seq <= from) continue;
      if (now - m.at > MOMENT_STALE_MS) continue; // stale on arrival (an offline tablet catching up)
      const def = sceneForMoment(scenes, m, target, state);
      if (def === null) continue;
      if (typeof def.ms === "number" && m.at + def.ms <= now) continue; // already over by its own clock
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
        const end = start + (typeof w.def.ms === "number" ? w.def.ms : MOMENT_HOLD_MAX_MS);
        const cut = this.finished.has(w.moment.seq);
        if (!cut && now < end) return activeOf(w, start);
        this.lastEnd = Math.min(now, end);
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

/** What the cutscene layer draws: under (`base`: the slide's scene, its plain card, or nothing) and over (`top`: a moment). */
export interface ScenePick {
  base: ActiveScene | "card" | null;
  top: ActiveScene | null;
}

export const NO_PICK: ScenePick = { base: null, top: null };

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
}): ScenePick {
  // The queue moves on whatever is drawn (its scenes run on the server's clock).
  const moment = o.queue.current(o.now);
  if (o.state === null || o.layers.overlay !== null || o.bare) return NO_PICK;
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
  if (moment === null) return { base, top: null };
  if (slideScene !== null && priorityOf(slideScene.def) > priorityOf(moment.def)) return { base, top: null };
  return { base: moment.def.over === true ? base : null, top: moment };
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
