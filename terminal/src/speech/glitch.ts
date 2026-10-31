//! His voice coming apart (wave 56, `docs/loom-w56-contract.md`), the
//! terminal's half. The server says how broken he is (`voiceFx`,
//! `core/src/voice-fx.ts`); this turns one sentence into a **plan**: the
//! fragments to say, each with its own pace, pitch, voice and volume, the
//! silences between them, and the cut-offs that make a real stutter. The
//! router (`stagehand/audio/voicefx.py`) tears up the sound itself, but only
//! on the house speakers: everywhere else (the server room above all) this
//! is the whole effect. Pure and seeded: the same sentence on the same seed
//! plans the same way.
//!
//! The rules a plan keeps:
//!
//! - **Only his own words.** A fragment is a word of the sentence, or its
//!   letters. Nothing is added, so a glitch can never break the fiction or
//!   say something he doesn't know; the caption and the transcript are never
//!   touched (they read the written text; a plan is only what is *said*).
//! - **Digits and names survive.** A results line stays a results line:
//!   `packet` never drops a number or a capitalised word.
//! - **One sentence stays one chunk.** `SpeechQueue` plays a plan inside one
//!   `engine.play`, so the captions, the voice-timed scenes and `said=` see
//!   exactly the sentences they always did, only longer.
//! - **Bounded.** A flavour works on a window of `WINDOW_WORDS`, so a
//!   thousand-character filing reading frays without doubling in length.
//!
//! Why `pace` is whole steps, not a multiplier: Chrome on Windows (the TV,
//! SAPI) sets `int(10 · log10(rate))` (`tts_win.cc`), so every rate from 0.8
//! to 1.25 is one and the same speed, and the TV's 0.92 sounds like 1. A
//! pace of n is that step; `paceRate` lands safely inside it, and it is as
//! good a ladder on any other engine. Pitch likewise moves in tenths
//! (`pitch · 10 − 10`). Fully Kiosk has neither (`flatText`: only the words).

import { VOICE_FLAVOURS, type VoiceFlavour } from "../../../core/src/voice-fx.ts";
import { mix, mulberry32 } from "../idle-show/rng.ts";

export { VOICE_FLAVOURS, type VoiceFlavour };

/** A burst of digital noise between two fragments (`sound/bus.ts` `voiceNoise`). */
export type VoiceNoise = "tick" | "buzz" | "sweep";

export interface VoiceFrag {
  /** What this fragment says: never empty unless it is only a silence. */
  text: string;
  /** Whole steps of speed; 0 is the terminal's own (`paceRate`). */
  pace: number;
  /** The utterance's pitch, 0..2. */
  pitch: number;
  /** The utterance's volume, 0..1. */
  volume: number;
  /** One of the device's other voices (`index % count`); absent: his own. */
  voice?: number;
  /** Silence after it, ms. */
  gapMs: number;
  /** Cut it off this long after it starts: a real stutter, not a repeat. */
  cutMs?: number;
  /** A burst of noise after it. */
  noise?: VoiceNoise;
}

export interface VoicePlan {
  flavours: VoiceFlavour[];
  frags: VoiceFrag[];
}

/** His pitch when nothing is wrong (`BrowserEngine`'s default). */
export const HIS_PITCH = 0.85;
/** A flavour works on at most this many words of a sentence. */
export const WINDOW_WORDS = 12;
/** `stall`'s drag, which multiplies a word's length, on at most this many. */
const DRAG_WORDS = 6;
/** From this level a long sentence can break in two places. */
const TWICE_AT = 0.7;
/** A sentence this long has room for two flavours. */
const TWICE_WORDS = 10;

/** The rate that lands on pace step `pace`; 0 is the terminal's own `speed`.
 *  Off the step's edge, because SAPI truncates (`10 · log10(1.2589)` < 1). */
export function paceRate(pace: number, speed: number): number {
  if (pace === 0) return speed;
  return 10 ** ((pace + Math.sign(pace) * 0.05) / 10);
}

type Rng = () => number;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const between = (r: Rng, a: number, b: number): number => a + r() * (b - a);
const tenths = (v: number): number => Math.round(clamp(v, 0, 2) * 10) / 10;

/** The word without what surrounds it (quotes, commas). */
function bare(w: string): string {
  return w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** The sentence's words; a token with nothing to say rides with the word before. */
function wordsOf(said: string): string[] {
  const out: string[] = [];
  for (const t of said.split(/\s+/u)) {
    if (t === "") continue;
    if (/[\p{L}\p{N}]/u.test(t)) out.push(t);
    else if (out.length > 0) out[out.length - 1] += ` ${t}`;
  }
  return out;
}

/** Never dropped: a number, or a name (capitalised, past the sentence's start). */
function survives(w: string, i: number): boolean {
  const b = bare(w);
  return /\d/u.test(b) || (i > 0 && /^\p{Lu}/u.test(b));
}

function say(text: string, o: Partial<VoiceFrag> = {}): VoiceFrag {
  return { text, pace: 0, pitch: HIS_PITCH, volume: 1, gapMs: 0, ...o };
}

/** `n` runs of `words`, in order, as even as they go. */
function chop(words: readonly string[], n: number): string[][] {
  const parts = Math.max(1, Math.min(n, words.length));
  const out: string[][] = [];
  for (let i = 0; i < parts; i++) out.push(words.slice(Math.floor((i * words.length) / parts), Math.floor(((i + 1) * words.length) / parts)));
  return out;
}

/** Up to `n` different indices of `words` that `ok` allows, in order. */
function picks(words: readonly string[], n: number, r: Rng, ok: (w: string, i: number) => boolean): number[] {
  const free = words.map((_, i) => i).filter((i) => ok(words[i]!, i));
  const out: number[] = [];
  while (out.length < n && free.length > 0) out.push(free.splice(Math.floor(r() * free.length), 1)[0]!);
  return out.sort((a, b) => a - b);
}

interface Ctx {
  r: Rng;
  /** How hard it bites, 0..1. */
  s: number;
  /** How many other voices the device has. */
  voices: number;
}

type Flavour = (words: readonly string[], c: Ctx) => VoiceFrag[];

/** 💿 A scratched disc: words catch and repeat, cut off, then land. */
const skip: Flavour = (words, c) => {
  const hits = new Set(picks(words, 1 + Math.round(c.s * 2), c.r, (w) => bare(w).length >= 2));
  const out: VoiceFrag[] = [];
  let run: string[] = [];
  words.forEach((w, i) => {
    if (hits.has(i)) {
      if (run.length > 0) out.push(say(run.join(" ")));
      run = [];
      const b = bare(w);
      const n = 2 + Math.floor(c.s * 3 + c.r());
      for (let k = 0; k < n; k++) out.push(say(b, b.length >= 4 ? { cutMs: Math.round(between(c.r, 90, 170)), gapMs: Math.round(between(c.r, 0, 30)) } : { pace: 3, gapMs: 20 }));
      if (c.s > 0.55 && c.r() < 0.5) out[out.length - 1]!.noise = "tick";
    }
    run.push(w);
  });
  if (run.length > 0) out.push(say(run.join(" ")));
  return out;
};

/** ⏳ Buffering: he drags, sinks, stops dead, and comes back on the last word. */
const stall: Flavour = (words, c) => {
  const keep = Math.max(words.length - DRAG_WORDS, Math.floor(words.length * between(c.r, 0.25, 0.6)));
  const head = words.slice(0, keep);
  const tail = words.slice(keep);
  const out: VoiceFrag[] = head.length > 0 ? [say(head.join(" "))] : [];
  const steps: ReadonlyArray<readonly [number, number]> = [
    [-1, 0.7],
    [-2, 0.5],
    [-3, 0.3],
    [-4, 0.1],
  ];
  const drag = chop(tail, 2 + Math.round(c.s * 2));
  drag.forEach((g, i) => out.push(say(g.join(" "), { pace: steps[i]![0], pitch: steps[i]![1] })));
  const last = out[out.length - 1]!;
  last.gapMs = Math.round(300 + 1100 * c.s);
  if (c.s > 0.5) last.noise = "sweep";
  if (c.s > 0.4) out.push(say(bare(words[words.length - 1]!), { pace: 1 }));
  return out;
};

/** 🔥 Overclock: he runs away from himself, faster and higher to the end. */
const overclock: Flavour = (words, _c) => {
  const groups = chop(words, 3 + Math.round(_c.s * 2));
  return groups.map((g, i) => say(g.join(" "), { pace: i + 1, pitch: tenths(0.9 + (i * 0.9) / Math.max(1, groups.length - 1)) }));
};

/** 🎭 The wrong driver: other voices take over, a few words each. A device
 *  with no others swings his own pitch instead. */
const driver: Flavour = (words, c) => {
  const start = Math.floor(c.r() * 8);
  return chop(words, 2 + Math.round(c.s * 3)).map((g, i) => {
    const text = g.join(" ");
    if (c.voices > 0) return say(text, { voice: start + i, pitch: 1 });
    return say(text, { pitch: i % 2 === 0 ? 0.2 : 1.7, pace: i % 2 === 0 ? -1 : 1 });
  });
};

/** 📉 Packet loss: words punched out, the hole as long as the word was. */
const packet: Flavour = (words, c) => {
  const out: VoiceFrag[] = [];
  let run: string[] = [];
  const most = Math.max(1, Math.floor(words.length * 0.4));
  const gone = new Set(picks(words, Math.round(between(c.r, 0.5, 1) * most * (0.5 + c.s / 2)), c.r, (w, i) => i > 0 && i < words.length - 1 && !survives(w, i)));
  words.forEach((w, i) => {
    if (!gone.has(i)) {
      run.push(w);
      return;
    }
    const b = bare(w);
    if (b.length >= 5 && c.r() < 0.5) {
      // Half a word gets through.
      if (run.length > 0) out.push(say(run.join(" ")));
      out.push(say(b, { cutMs: Math.round(between(c.r, 110, 200)) }));
    } else {
      if (run.length === 0 && out.length === 0) return;
      if (run.length > 0) out.push(say(run.join(" ")));
      const last = out[out.length - 1]!;
      last.gapMs += Math.round(62 * b.length);
      if (c.r() < c.s) last.noise = "tick";
    }
    run = [];
  });
  if (run.length > 0) out.push(say(run.join(" ")));
  return out;
};

/** 🔢 A memory dump: a word comes out letter by letter, flat and fast. */
const dump: Flavour = (words, c) => {
  const hits = new Set(picks(words, 1 + Math.round(c.s), c.r, (w, i) => bare(w).length >= 4 && bare(w).length <= 10 && !survives(w, i)));
  if (hits.size === 0) return loop(words, c);
  const out: VoiceFrag[] = [];
  let run: string[] = [];
  words.forEach((w, i) => {
    if (!hits.has(i)) {
      run.push(w);
      return;
    }
    if (run.length > 0) out.push(say(run.join(" "), { gapMs: 60 }));
    run = [];
    out.push(say(bare(w).toUpperCase().split("").join(" "), { pace: 2, pitch: 0.4, gapMs: 80, noise: "buzz" }));
  });
  if (run.length > 0) out.push(say(run.join(" ")));
  return out;
};

/** 🧊 Safe mode: one flat word at a time, evenly, nobody home. */
const safe: Flavour = (words, c) => chop(words, words.length > 8 ? Math.ceil(words.length / 2) : words.length).map((g) => say(g.map(bare).join(" "), { pace: -1, pitch: 0.5, gapMs: Math.round(between(c.r, 60, 160)) }));

/** 🔁 Feedback: the end of the sentence goes round, fading and tightening. */
const loop: Flavour = (words, c) => {
  const n = Math.min(3, Math.max(1, Math.round(1 + c.r() * 2)));
  const tail = words.slice(-n).map(bare).join(" ");
  const out = [say(words.join(" "))];
  const rounds = 3 + Math.round(c.s * 3);
  for (let k = 1; k <= rounds; k++) out.push(say(tail, { volume: Math.max(0.2, Math.round((1 - k / (rounds + 1)) * 10) / 10), pace: Math.min(5, k), gapMs: 20 }));
  return out;
};

/** 👹 Kernel: something underneath him speaks, low, slow and quiet. */
const kernel: Flavour = (words, c) => {
  const out: VoiceFrag[] = chop(words, Math.ceil(words.length / 3)).map((g) => say(g.join(" "), { pace: -2, pitch: 0, volume: 0.9, gapMs: Math.round(between(c.r, 80, 180)) }));
  if (c.s > 0.5) out[0]!.noise = "buzz";
  return out;
};

const FLAVOURS: Record<VoiceFlavour, Flavour> = { skip, stall, overclock, driver, packet, dump, safe, loop, kernel };

/** The level each flavour starts to appear at, and how often it comes. */
export const FLAVOUR_FROM: Readonly<Record<VoiceFlavour, { level: number; weight: number }>> = {
  skip: { level: 0, weight: 3 },
  packet: { level: 0.1, weight: 2 },
  stall: { level: 0.2, weight: 2 },
  loop: { level: 0.3, weight: 2 },
  overclock: { level: 0.35, weight: 2 },
  safe: { level: 0.5, weight: 1 },
  driver: { level: 0.55, weight: 2 },
  dump: { level: 0.6, weight: 1 },
  kernel: { level: 0.7, weight: 1 },
};

/** The chance a sentence breaks at all (the rest only wander, `wandered`). */
export function breakChance(level: number): number {
  return clamp(0.05 + 1.15 * clamp(level, 0, 1) ** 0.9, 0, 1);
}

function drawFlavour(level: number, r: Rng): VoiceFlavour {
  const open = VOICE_FLAVOURS.filter((f) => FLAVOUR_FROM[f].level <= level);
  let left = r() * open.reduce((a, f) => a + FLAVOUR_FROM[f].weight, 0);
  for (const f of open) {
    left -= FLAVOUR_FROM[f].weight;
    if (left <= 0) return f;
  }
  return open[open.length - 1] ?? "skip";
}

/** A sentence that didn't break still drifts off pace and off key: one
 *  fragment, a step or two from where he should be. */
function wandered(words: readonly string[], level: number, r: Rng): VoiceFrag {
  const reach = level > 0.6 ? 2 : 1;
  const pace = r() < level * 0.8 ? (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * reach)) : 0;
  return say(words.join(" "), { pace, pitch: tenths(HIS_PITCH + between(r, -0.5, 0.5) * level) });
}

/** The longest a plain sentence runs, by the engine's reading pace. */
function plainMs(text: string, pace: number, volumeGap = 0): number {
  return (62 * text.length) / paceRate(pace, 1) + volumeGap;
}

/** About how long a plan takes to say, ms (the tests bound it). */
export function planMs(frags: readonly VoiceFrag[]): number {
  return frags.reduce((a, f) => a + (f.cutMs ?? plainMs(f.text, f.pace)) + f.gapMs, 0);
}

export interface BreakOptions {
  /** The night's level, 0..1. */
  level: number;
  /** A spike's flavours: one of them is certain. */
  flavours?: readonly VoiceFlavour[] | undefined;
  /** A spike's strength: at least this level. */
  strength?: number | undefined;
  seed: number;
  /** How many other voices the device has. */
  voices: number;
}

/**
 * How to say one sentence (`said`, already pronounced), or null to say it
 * plainly. A spike makes it certain and picks from its own flavours; the
 * night rolls `breakChance`, then breaks it in the flavours its level has
 * reached, twice over in a long sentence late at night.
 */
export function breakChunk(said: string, o: BreakOptions): VoicePlan | null {
  const words = wordsOf(said);
  if (words.length === 0) return null;
  const forced = o.flavours !== undefined && o.flavours.length > 0 ? o.flavours : null;
  const level = clamp(forced !== null ? Math.max(o.level, o.strength ?? 1) : o.level, 0, 1);
  if (!(level > 0)) return null;
  const r = mulberry32(o.seed);
  if (forced === null && r() >= breakChance(level)) return level >= 0.2 ? { flavours: [], frags: [wandered(words, level, r)] } : null;
  const draw = (): VoiceFlavour => (forced !== null ? forced[Math.floor(r() * forced.length)]! : drawFlavour(level, r));
  const c = (): Ctx => ({ r, s: clamp(level * between(r, 0.7, 1.3), 0, 1), voices: Math.max(0, o.voices) });
  const twice = level >= TWICE_AT && words.length >= TWICE_WORDS;
  const spans = twice ? chop(words, 2) : [words];
  const flavours: VoiceFlavour[] = [];
  const frags: VoiceFrag[] = [];
  for (const span of spans) {
    const f = draw();
    flavours.push(f);
    const size = Math.min(span.length, WINDOW_WORDS);
    // `loop` belongs at the end of what it repeats; the rest fall anywhere.
    const from = f === "loop" ? span.length - size : Math.floor(r() * (span.length - size + 1));
    const before = span.slice(0, from);
    const after = span.slice(from + size);
    if (before.length > 0) frags.push(wandered(before, level, r));
    frags.push(...FLAVOURS[f](span.slice(from, from + size), c()));
    if (after.length > 0) frags.push(wandered(after, level, r));
  }
  return { flavours, frags };
}

/** The plan as plain words, for a voice that takes only text (Fully Kiosk):
 *  its repeats and its holes survive, nothing else can. */
export function flatText(plan: VoicePlan): string {
  return plan.frags
    .map((f) => f.text)
    .filter((t) => t !== "")
    .join(" ");
}

/** Lines that are never broken, whatever the night says: the moments he
 *  stops being broken. The helped ending heals the level, but only after
 *  these lines start the story's vars moving. */
export const CLEAN_BEATS: readonly string[] = ["Heart Heard", "Advice Helped"];

const fold = (s: string): string => s.toLowerCase().replace(/[\s_-]+/gu, " ").trim();

export function isCleanBeat(beat: string | null | undefined): boolean {
  if (beat === null || beat === undefined) return false;
  const b = fold(beat);
  return CLEAN_BEATS.some((c) => fold(c) === b);
}

/** The screen state's `voiceFx`, as far as a sentence needs it. */
export interface VoiceFxState {
  level: number;
  spike: { key: string; at: number; ms: number; strength: number; flavours: readonly VoiceFlavour[] } | null;
}

/** A queue's way to ask how to say a sentence (`SpeechQueue`'s `shape`). */
export type ChunkShaper = (said: string, id: number, index: number) => VoicePlan | null;

/** The shaper of a page that speaks him: reads the newest screen answer each
 *  time, so a spike reaches the very next sentence. `salt` keeps two
 *  terminals saying one line from breaking it alike. */
export function voiceShaper(o: { fx: () => VoiceFxState | null | undefined; now: () => number; salt: number; voices: () => number }): ChunkShaper {
  return (said, id, index) => {
    const fx = o.fx();
    if (fx === null || fx === undefined) return null;
    const spike = fx.spike !== null && o.now() >= fx.spike.at && o.now() - fx.spike.at < fx.spike.ms ? fx.spike : null;
    return breakChunk(said, { level: fx.level, flavours: spike?.flavours, strength: spike?.strength, seed: mix(o.salt, id, index, spike?.at ?? 0), voices: o.voices() });
  };
}
