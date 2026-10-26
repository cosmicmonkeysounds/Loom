//! The voice clock (wave 26, V1; contract C11), pure. On the TV a voiced
//! scene is drawn at a `t` warped by his speech, so the picture waits for
//! his voice: it holds the frame just before each sentence until he starts
//! it, and jumps ahead when he gets there first. Scenes stay pure pictures
//! of `t`; only the `t` they are handed changes.
//!
//! A scene's `VoiceScene` (`voice-scenes.ts`) names the beats it voices and
//! `marks[i]`: the scene-time ms at which his i-th spoken sentence (across
//! the scene's lines, in order, as `splitSentences` cuts them) begins. From
//! the speech bus (`speech-bus.ts`):
//!
//! - the scene's lines are the ones whose beat it names and that the TV took
//!   in around the moment (from `VOICE_LOOKBACK_MS` before it to
//!   `VOICE_WAIT_MS` after);
//! - none (a muted TV, a reload that resynced, a beat with no line of his):
//!   null, the plain clock;
//! - queued but not started: hold at `marks[0] − 1` until `VOICE_WAIT_MS`
//!   after the scene started, then null for good (a stuck voice never holds
//!   it, and a voice that starts later never pulls it back);
//! - during sentence g: `marks[g] + (now − its start)`, held below the next
//!   sentence's mark (or below the end of his part, `ms − tail`);
//! - after his last line is done: on from there (from `ms − tail` when he
//!   finished early), so the scene ends `tail` after he stops; a line that
//!   was cut (the mute, `cut` on its `done`) runs on from where it was.
//!
//! When the spoken count differs from the marks (a name that merged into
//! the next sentence, a branch of the beat), sentence g maps to mark
//! `floor(g · marks / spoken)`; sentences that share a mark run on as one.
//! The stretch is capped by `MomentQueue.extendTo` (`VOICE_STRETCH_MAX_MS`).

import { foldName } from "../config.ts";
import type { SpeechEvent } from "./speech-bus.ts";
import type { SceneVoice } from "./types.ts";

/** A queued line that hasn't started this long after the scene did: the plain clock. */
export const VOICE_WAIT_MS = 6000;
/** A line taken in this long before the moment still belongs to it (a poll's skew). */
export const VOICE_LOOKBACK_MS = 2000;
/** A voiced scene runs at most this much longer than its own `ms`. */
export const VOICE_STRETCH_MAX_MS = 20_000;

/** How a scene follows his voice (`VOICE_SCENES`, by scene id). */
export interface VoiceScene {
  /** The story beats whose lines this scene voices (`== Trabolta Introduction`). */
  beats: string[];
  /** Scene-time ms at which each spoken sentence should begin, increasing. */
  marks: readonly number[];
  /** ms of picture after his last sentence ends (the scene's numeric `ms` minus his part). */
  tail?: number;
  /** The scene draws the spoken sentence itself (`SceneProps.voice`); else the layer captions it. */
  ownCaption?: boolean;
}

/** A voice scene and the scene's own length. */
export type VoiceTiming = VoiceScene & { ms?: number | "hold" };

/** The sentence being said now, for the caption (the written words, never the pronounced ones). */
export type SpokenNow = SceneVoice;

export interface VoiceState {
  /** The warped scene time. */
  t: number;
  /** The sentence he is saying now (null: between sentences, before, after). */
  spoken: SpokenNow | null;
  /** He has finished the scene's last line. */
  ended: boolean;
  /** Server ms the warped clock reaches `ms` (null: a `hold` scene). */
  endAt: number | null;
}

interface Member {
  seq: number;
  chunks: number;
  texts: readonly string[] | null;
  starts: Map<number, number>;
  done: number | null;
  /** The line was cut (the mute), not finished. */
  cut: boolean;
}

/** The scene's lines off the bus, oldest seq first. */
function membersOf(v: VoiceScene, events: readonly SpeechEvent[], momentAt: number): Member[] {
  const beats = new Set(v.beats.map(foldName));
  const lines = new Map<number, Member & { first: number; beat: string | null }>();
  for (const e of events) {
    let m = lines.get(e.seq);
    if (e.kind === "queued" || e.kind === "line") {
      if (m === undefined) {
        m = { seq: e.seq, chunks: e.chunks, texts: null, starts: new Map(), done: null, cut: false, first: e.at, beat: e.beat };
        lines.set(e.seq, m);
      }
      m.chunks = Math.max(1, e.chunks);
      if (e.kind === "line") {
        m.texts = e.texts;
        if (!m.starts.has(0)) m.starts.set(0, e.at);
      }
      continue;
    }
    if (m === undefined) continue;
    if (e.kind === "chunk") {
      if (!m.starts.has(e.index)) m.starts.set(e.index, e.at);
    } else if (m.done === null) {
      m.done = e.at;
      m.cut = e.cut === true;
    }
  }
  return [...lines.values()]
    .filter((m) => m.beat !== null && beats.has(foldName(m.beat)) && m.first >= momentAt - VOICE_LOOKBACK_MS && m.first <= momentAt + VOICE_WAIT_MS)
    .sort((a, b) => a.seq - b.seq);
}

/**
 * The scene's voiced state at server `now`, or null for the plain clock.
 * `sceneStart` is when the scene began (server ms; a queued moment starts
 * late), `momentAt` when its moment / cue happened (the lines arrive with
 * it; default `sceneStart`).
 */
export function voiceState(def: VoiceTiming, sceneStart: number, now: number, events: readonly SpeechEvent[], momentAt: number = sceneStart): VoiceState | null {
  const marks = def.marks;
  const n = marks.length;
  if (n === 0 || !(sceneStart > 0)) return null;
  const plain = Math.max(0, now - sceneStart);
  const lines = membersOf(def, events, momentAt);
  if (lines.length === 0) return null;
  const ms = typeof def.ms === "number" ? def.ms : null;
  const voiceEnd = ms !== null && def.tail !== undefined ? Math.max(marks[n - 1]!, ms - def.tail) : null;

  // Every spoken sentence across the lines, with its mark and its start.
  const sentences: Array<{ line: Member; index: number; start: number | undefined }> = [];
  for (const line of lines) for (let i = 0; i < line.chunks; i++) sentences.push({ line, index: i, start: line.starts.get(i) });
  const k = sentences.length;
  const markOf = (g: number) => (k === n ? g : Math.min(n - 1, Math.floor((g * n) / k)));
  // Anchors: the sentences that start a new mark (the others run on with them).
  const anchors: Array<{ mark: number; start: number | undefined }> = [];
  for (let g = 0; g < k; g++) if (g === 0 || markOf(g) !== markOf(g - 1)) anchors.push({ mark: marks[markOf(g)]!, start: sentences[g]!.start });
  const ceiling = (j: number) => (j + 1 < anchors.length ? anchors[j + 1]!.mark - 1 : voiceEnd !== null ? voiceEnd - 1 : Number.POSITIVE_INFINITY);
  /** The warped t at `time` (≤ now), before his last line is done. */
  const speaking = (time: number): number => {
    let j = -1;
    for (let i = 0; i < anchors.length; i++) {
      const s = anchors[i]!.start;
      if (s !== undefined && s <= time) j = i;
    }
    if (j < 0) return Math.max(0, Math.min(Math.max(0, time - sceneStart), marks[0]! - 1));
    return Math.max(0, Math.min(anchors[j]!.mark + (time - anchors[j]!.start!), ceiling(j)));
  };

  const last = lines[lines.length - 1]!;
  const doneAt = last.done !== null && last.done <= now ? last.done : null;
  // When his voice first reached the scene: its first sentence, else the cut
  // that ended it unsaid, else not yet (now). Past `VOICE_WAIT_MS`, the plain
  // clock for good: a scene that fell back never jumps back to his voice.
  const s0 = anchors[0]!.start;
  const reached = s0 !== undefined && s0 <= now ? s0 : (doneAt ?? now);
  if (reached - sceneStart >= VOICE_WAIT_MS) return null;

  let t: number;
  let endAt: number | null;
  if (doneAt !== null) {
    const atDone = speaking(doneAt);
    // Finished: on from the end of his part. Cut: on from where it was.
    const from = voiceEnd !== null && !last.cut ? Math.max(atDone, voiceEnd) : atDone;
    t = from + (now - doneAt);
    endAt = ms === null ? null : doneAt + Math.max(0, ms - from);
  } else {
    t = speaking(now);
    endAt = ms === null ? null : now + Math.max(0, ms - t);
  }

  // The sentence being said: the newest started one whose line isn't done.
  let spoken: SpokenNow | null = null;
  let newest = Number.NEGATIVE_INFINITY;
  for (const s of sentences) {
    if (s.start === undefined || s.start > now || s.start < newest) continue;
    if (s.line.done !== null && s.line.done <= now) continue;
    newest = s.start;
    spoken = { seq: s.line.seq, index: s.index, text: s.line.texts?.[s.index] ?? "" };
  }
  if (spoken !== null && spoken.text === "") spoken = null;
  return { t, spoken, ended: doneAt !== null, endAt };
}

/** The warped scene time at `now` (C11's `voiceClock`), or null for the plain clock. */
export function voiceClock(def: VoiceTiming, sceneStart: number, now: number, events: readonly SpeechEvent[], momentAt: number = sceneStart): number | null {
  return voiceState(def, sceneStart, now, events, momentAt)?.t ?? null;
}
