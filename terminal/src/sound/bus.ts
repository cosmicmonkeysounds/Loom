//! The page's sound bus (wave 17): every sound a terminal page makes runs
//! through one master `GainNode` over the shared `audioContext()`
//! (`speech/engine.ts`), and the effects (`sfx`) through their own sub-bus —
//! a per-view level and a soft compressor, so a pile of popups never clips:
//!
//!   sfx parts → sfx bus (view level: tv 0.35, others 0.6) → compressor ─┐
//!   the announcement chime, the casino's jingles ───────────────────────┤
//!   the players' voices (wave 19, `voice/playback.ts`) → voices bus ────┴→ master → speakers
//!
//! The rules for an effect (`sfxGate`, pure): it is **dropped, never
//! queued**, when sound is still locked (no gesture yet), when the page is
//! muted (`setSoundMuted` — the TV's director mute), or while the voice floor
//! is busy (the character or an announcement is speaking) — unless asked
//! with `{over: true}`, which plays it under the voice at a lower level.
//! The same sound twice inside `MIN_GAP_MS` plays once (a typewriter's keys).
//!
//! The announcement chime (`ringChime`, which rings *while* the floor is
//! held for the announcement it opens) and the casino jingles keep their old
//! levels on the master bus and skip the gate but for the lock. So does the
//! reinstallation game on the tent laptop (wave 18b, `soundOutput()`: the
//! game's quack, fanfare, buzz and thud play on the master bus).
//!
//! The voices bus (wave 19) carries the reinstallation players this terminal
//! hears: never the voice floor's (Trabolta's replies never queue behind a
//! player), ducked to `VOICES_DUCK` while the floor is busy, and muted with
//! the effects (`setSoundMuted`: the TV's director mute, the mirror). The
//! microphone's half-duplex asks `soundPlayingUntil()` when this page's own
//! effects, jingles and chime stop, so they are never sent to the games.

import { audioContext, voiceFloor } from "../speech/engine.ts";
import { CHIME_PARTS, partsLength, recipe, type NoisePart, type Part, type SfxName, type TonePart } from "./library.ts";

/** The effects' level per view: the TV's are quiet accents (the house speakers are beside it). */
export const VIEW_VOLUME = { tv: 0.35, other: 0.6 } as const;
/** An effect asked `{over: true}` while a voice speaks plays at this share of its level. */
export const OVER_GAIN = 0.4;
/** The same effect again inside this long plays once (ms). */
export const MIN_GAP_MS = 35;
/** The players' voices' level. */
export const VOICES_LEVEL = 1;
/** …while the voice floor is busy (the character or an announcement speaking). */
export const VOICES_DUCK = 0.3;
/** A duck / mute on the voices bus ramps over this long (s): no click. */
const VOICES_RAMP_S = 0.08;

export interface SfxOpts {
  /** Play under a speaking voice (at `OVER_GAIN`) instead of dropping. */
  over?: boolean;
  /** Scale the level (default 1). */
  gain?: number;
  /** Scale every frequency (default 1: 1.5 = a fifth up). */
  pitch?: number;
  /** Start this many seconds from now. */
  delay?: number;
}

/** What the gate says about one effect (pure). */
export function sfxGate(s: { running: boolean; muted: boolean; floorBusy: boolean; over: boolean }): { play: boolean; gain: number } {
  if (!s.running || s.muted) return { play: false, gain: 0 };
  if (s.floorBusy) return s.over ? { play: true, gain: OVER_GAIN } : { play: false, gain: 0 };
  return { play: true, gain: 1 };
}

// --- the bus ------------------------------------------------------------------------

/** The slice of an `AudioContext` the bus uses (tests hand in a fake). */
export type SoundContext = Pick<AudioContext, "state" | "currentTime" | "sampleRate" | "destination" | "createGain" | "createOscillator" | "createBufferSource" | "createBuffer" | "createBiquadFilter"> & {
  createDynamicsCompressor?: AudioContext["createDynamicsCompressor"];
};

interface Bus {
  ctx: SoundContext;
  master: GainNode;
  sfx: GainNode;
  voices: GainNode;
  /** The level the voices bus is (ramping) at. */
  voicesAt: number;
  noise: AudioBuffer | null;
}

let override: SoundContext | null | undefined;
let bus: Bus | null = null;
let muted = false;
let volume: number = VIEW_VOLUME.other;
let ducked = false;
/** Context seconds when the last effect / jingle / chime scheduled ends. */
let until = 0;
const lastPlayed = new Map<string, number>();

/** Use this context instead of the page's (tests; undefined = the page's again). */
export function setSoundContext(c: SoundContext | null | undefined): void {
  override = c;
  bus = null;
  until = 0;
  lastPlayed.clear();
}

function context(): SoundContext | null {
  return override !== undefined ? override : audioContext();
}

function ensureBus(): Bus | null {
  const ctx = context();
  if (ctx === null) return null;
  if (bus !== null && bus.ctx === ctx) return bus;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  const sfx = ctx.createGain();
  sfx.gain.value = muted ? 0 : volume;
  // A gentle compressor: a storm of popups stacks without clipping.
  const comp = typeof ctx.createDynamicsCompressor === "function" ? ctx.createDynamicsCompressor() : null;
  if (comp !== null) {
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    sfx.connect(comp);
    comp.connect(master);
  } else sfx.connect(master);
  const voices = ctx.createGain();
  voices.gain.value = voicesLevel();
  voices.connect(master);
  bus = { ctx, master, sfx, voices, voicesAt: voices.gain.value, noise: null };
  return bus;
}

function voicesLevel(): number {
  return muted ? 0 : ducked ? VOICES_DUCK : VOICES_LEVEL;
}

function applyVoices(b: Bus): void {
  const v = voicesLevel();
  if (b.voicesAt === v) return;
  const g = b.voices.gain;
  const t = b.ctx.currentTime;
  g.setValueAtTime(b.voicesAt, t);
  g.linearRampToValueAtTime(v, t + VOICES_RAMP_S);
  b.voicesAt = v;
}

/** Mute every effect on this page (the TV's director mute). The chime and the casino are not effects. */
export function setSoundMuted(on: boolean): void {
  muted = on;
  if (bus !== null) {
    bus.sfx.gain.value = on ? 0 : volume;
    applyVoices(bus);
  }
}

/** Duck the players' voices under the voice floor (the voice link polls `voiceFloor.busy`). */
export function setVoicesDucked(on: boolean): void {
  ducked = on;
  if (bus !== null) applyVoices(bus);
}

/** The voices bus to play the players on (null: no audio here). */
export function voicesOut(): { ctx: SoundContext; out: AudioNode } | null {
  try {
    const b = ensureBus();
    return b === null ? null : { ctx: b.ctx, out: b.voices };
  } catch {
    return null;
  }
}

/** Context seconds when this page's own effects, jingles and chime stop
 *  (0 = none yet): the microphone holds its uplink until then. */
export function soundPlayingUntil(): number {
  return until;
}

export function soundMuted(): boolean {
  return muted;
}

/** The effects' level for this terminal's view (`VIEW_VOLUME`). */
export function setSoundView(view: string | null | undefined): void {
  setSoundVolume(view === "tv" ? VIEW_VOLUME.tv : VIEW_VOLUME.other);
}

/** The effects' level, 0..1. */
export function setSoundVolume(v: number): void {
  volume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : VIEW_VOLUME.other));
  if (bus !== null && !muted) bus.sfx.gain.value = volume;
}

export function soundVolume(): number {
  return volume;
}

// --- scheduling ---------------------------------------------------------------------

/** One second of white noise, made once per context (a fixed seed: the same hiss every time). */
function noiseBuffer(b: Bus): AudioBuffer {
  if (b.noise !== null) return b.noise;
  const len = Math.max(1, Math.floor(b.ctx.sampleRate));
  const buf = b.ctx.createBuffer(1, len, b.ctx.sampleRate);
  const data = buf.getChannelData(0);
  let s = 22222;
  for (let i = 0; i < len; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    data[i] = s / 2147483648 - 1;
  }
  b.noise = buf;
  return buf;
}

/** The envelope every part shares: from silence to the peak in `attack`, then down to silence by the end. */
function envelope(g: GainNode, t: number, peak: number, attack: number, dur: number): void {
  const p = Math.max(0.0002, peak);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(p, t + Math.min(attack, dur * 0.9));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function scheduleTone(b: Bus, p: TonePart, t0: number, out: AudioNode, level: number, pitch: number): void {
  const t = t0 + p.at;
  const osc = b.ctx.createOscillator();
  osc.type = p.wave;
  osc.frequency.value = p.f * pitch;
  if (p.f2 !== undefined) {
    osc.frequency.setValueAtTime(p.f * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, p.f2 * pitch), t + p.dur);
  }
  if (p.detune !== undefined) osc.detune.value = p.detune;
  const env = b.ctx.createGain();
  envelope(env, t, p.gain * level, p.attack ?? 0.008, p.dur);
  if (p.lowpass !== undefined) {
    const f = b.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = p.lowpass;
    osc.connect(f);
    f.connect(env);
  } else osc.connect(env);
  env.connect(out);
  osc.start(t);
  osc.stop(t + p.dur + 0.02);
}

function scheduleNoise(b: Bus, p: NoisePart, t0: number, out: AudioNode, level: number, pitch: number): void {
  const t = t0 + p.at;
  const src = b.ctx.createBufferSource();
  src.buffer = noiseBuffer(b);
  src.loop = true;
  const env = b.ctx.createGain();
  envelope(env, t, p.gain * level, p.attack ?? 0.004, p.dur);
  if (p.filter !== undefined) {
    const f = b.ctx.createBiquadFilter();
    f.type = p.filter.type;
    f.frequency.setValueAtTime(p.filter.f * pitch, t);
    if (p.filter.f2 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(1, p.filter.f2 * pitch), t + p.dur);
    if (p.filter.q !== undefined) f.Q.value = p.filter.q;
    src.connect(f);
    f.connect(env);
  } else src.connect(env);
  env.connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + p.dur + 0.02);
}

/** Schedule parts on `out` from `t0` (context seconds). */
function schedule(b: Bus, parts: readonly Part[], t0: number, out: AudioNode, level: number, pitch = 1): void {
  until = Math.max(until, t0 + partsLength(parts) + 0.02);
  for (const p of parts) {
    if (p.kind === "tone") scheduleTone(b, p, t0, out, level, pitch);
    else scheduleNoise(b, p, t0, out, level, pitch);
  }
}

// --- the public calls ---------------------------------------------------------------

/**
 * Play one effect now (or `delay` s from now). Returns whether it plays:
 * false when sound is locked, the page is muted, a voice is speaking (and
 * not `over`), or the same effect played within `MIN_GAP_MS`. Never throws.
 */
export function sfx(name: SfxName, opts: SfxOpts = {}): boolean {
  try {
    const ctx = context();
    const gate = sfxGate({ running: ctx !== null && ctx.state === "running", muted, floorBusy: voiceFloor.busy, over: opts.over === true });
    if (!gate.play) return false;
    const b = ensureBus();
    if (b === null) return false;
    const now = b.ctx.currentTime * 1000;
    const key = `${name}@${opts.pitch ?? 1}`;
    const last = lastPlayed.get(key);
    if (last !== undefined && now - last < MIN_GAP_MS && opts.delay === undefined) return false;
    lastPlayed.set(key, now);
    schedule(b, recipe(name), b.ctx.currentTime + 0.01 + Math.max(0, opts.delay ?? 0), b.sfx, gate.gain * Math.max(0, opts.gain ?? 1), opts.pitch ?? 1);
    return true;
  } catch {
    return false; // a sound must never take a screen down
  }
}

/** Notes one after another straight onto the master bus (the casino's
 *  jingles): `[Hz, s]`, one envelope each. Silent while locked. */
export function playNotes(notes: ReadonlyArray<readonly [number, number]>, o: { wave: OscillatorType; peak: number; attack: number }): void {
  try {
    const ctx = context();
    if (ctx === null || ctx.state !== "running") return;
    const b = ensureBus();
    if (b === null) return;
    let at = 0;
    const parts: TonePart[] = notes.map(([f, dur]) => {
      const p: TonePart = { kind: "tone", wave: o.wave, f, at, dur, gain: o.peak, attack: o.attack };
      at += dur;
      return p;
    });
    schedule(b, parts, b.ctx.currentTime + 0.02, b.master, 1);
  } catch {
    /* silence */
  }
}

/** The house-announcement chime on the master bus; resolves once it has
 *  rung (at once while sound is locked). */
export function playChime(): Promise<void> {
  try {
    const ctx = context();
    if (ctx === null || ctx.state !== "running") return Promise.resolve();
    const b = ensureBus();
    if (b === null) return Promise.resolve();
    schedule(b, CHIME_PARTS, b.ctx.currentTime + 0.02, b.master, 1);
    const ms = (partsLength(CHIME_PARTS) + 0.12) * 1000;
    return new Promise((r) => setTimeout(r, ms));
  } catch {
    return Promise.resolve();
  }
}

/** The master bus as an output for sounds made elsewhere (wave 18b: the
 *  reinstallation game's `createSfx(soundOutput)` on the tent laptop): the
 *  page's shared context and its master gain, so the game rides the same
 *  speakers and level as every other sound here, skipping the effects' gate
 *  like the casino's jingles. Null while there is no context. Never throws. */
export function soundOutput(): { ctx: AudioContext; out: AudioNode } | null {
  try {
    const b = ensureBus();
    return b === null ? null : { ctx: b.ctx as AudioContext, out: b.master };
  } catch {
    return null;
  }
}
