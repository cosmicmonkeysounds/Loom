//! The voice link (wave 19) — `docs/loom-reinstall.md` §2.4. The wall
//! terminals' microphones are heard in the reinstallation games at each
//! terminal's screen, and the players' headsets are heard on the terminals
//! near them. One wire for every client: G.711 μ-law, mono, 16 kHz, 200 ms
//! chunks, POSTed up and fanned out by the server over SSE.
//!
//! Everything here is pure and shared: the codec, a streaming resampler, the
//! level gate (+ the software half-duplex hold), the chunker, the jitter
//! decision, and the one routing rule (`hearsTerminals` / `hearsPlayers`:
//! same room only, wave 26) the server applies. The Godot port (`reinstall/vr/net/voice_codec.gd`) is
//! pinned by `test/fixtures/voice-mulaw.json`. No `node:` imports.

import { locate } from "./locate.ts";
import type { HouseMap, Vec3 } from "./types.ts";
import { spotOf, voiceOn, type SpotRef } from "./voice-on.ts";

export { voiceOn, type SpotRef } from "./voice-on.ts";

/** Samples per second on the wire. */
export const VOICE_RATE = 16000;
/** One chunk of audio, milliseconds. */
export const VOICE_CHUNK_MS = 200;
/** One chunk on the wire: one μ-law byte per sample. */
export const VOICE_CHUNK_BYTES = 3200;
/** The largest upload body (≤ 500 ms). */
export const VOICE_MAX_BYTES = 8000;
/** The smallest upload body (10 ms). */
export const VOICE_MIN_BYTES = 160;
/** The wire codec's name (the stream's `hello.codec`). */
export const VOICE_CODEC = "mulaw";
/** At most this many terminals per player (the nearest). */
export const VOICE_MAX_TERMINALS = 4;
/** At most this many players per terminal (the nearest). */
export const VOICE_MAX_PLAYERS = 3;
/** The level gate: a chunk louder than this (RMS, dBFS) opens it. */
export const VOICE_GATE_DBFS = -42;
/** The gate stays open this long after the last loud chunk. */
export const VOICE_HANG_MS = 400;
/** Half-duplex: no sending until this long after incoming voice stops playing. */
export const VOICE_TAIL_MS = 300;
/** A source is "talking" if it sent within this. */
export const VOICE_FRESH_MS = 1500;
/** D5b, the games' barge-in: while a terminal's voice plays in a game (+
 *  `VOICE_TAIL_MS`) the player's gate rises to this instead of closing, so
 *  a player speaking up is still heard over a room that never goes quiet.
 *  The terminals keep the hard hold (`VoiceGate.holdUntil`). */
export const VOICE_BARGE_DBFS = -28;
/** An incoming voice quieter than this gain is too faint to echo back into
 *  a headset's mic: it raises no gate (D5b). */
export const VOICE_BARGE_MIN_GAIN = 0.2;
/** The playback buffer each client aims for (the terminals use 250). */
export const VOICE_JITTER_TARGET_MS = 200;
/** More queued than this and the client skips ahead to the target. */
export const VOICE_JITTER_MAX_MS = 400;

// --- G.711 μ-law -------------------------------------------------------------

/** The bias added to the 14-bit magnitude (0x84 at 16 bits). */
const BIAS14 = 0x84 >> 2;
/** The largest 14-bit magnitude before the bias. */
const CLIP14 = 8159;
/** Each segment's upper bound (biased 14-bit magnitude). */
const SEG_END = [0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff, 0x1fff];

/**
 * One sample: a float in [-1, 1] (clamped; NaN = 0) → its μ-law byte. The
 * 14-bit magnitude is `floor(|x| · 8192 + 0.5)` (sign-symmetric, so every
 * port rounds alike), clipped at 8159, biased, segmented, then bit-inverted
 * — ITU G.711 / Sun's `linear2ulaw`. 0 → 0xFF, 1 → 0x80, −1 → 0x00.
 */
export function mulawByte(x: number): number {
  const neg = x < 0;
  let s = Math.floor(Math.min(Math.abs(x) || 0, 1) * 8192 + 0.5);
  if (s > CLIP14) s = CLIP14;
  s += BIAS14;
  let seg = 0;
  while (seg < 8 && s > SEG_END[seg]!) seg++;
  const mask = neg ? 0x7f : 0xff;
  if (seg >= 8) return 0x7f ^ mask;
  return ((seg << 4) | ((s >> (seg + 1)) & 0x0f)) ^ mask;
}

/** One μ-law byte → its 16-bit linear value (Sun's `ulaw2linear`), ±32124 at most. */
export function mulawLinear(byte: number): number {
  const u = ~byte & 0xff;
  let t = ((u & 0x0f) << 3) + 0x84;
  t <<= (u & 0x70) >> 4;
  return u & 0x80 ? 0x84 - t : t - 0x84;
}

let DECODE: Float32Array | null = null;

/** The decode table, built on first use (no work at import time). */
function decodeTable(): Float32Array {
  if (DECODE === null) {
    DECODE = new Float32Array(256);
    for (let b = 0; b < 256; b++) DECODE[b] = mulawLinear(b) / 32768;
  }
  return DECODE;
}

/** Float samples in [-1, 1] → μ-law bytes, one per sample. */
export function mulawEncode(samples: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = mulawByte(samples[i]!);
  return out;
}

/** μ-law bytes → float samples (`linear / 32768`, exact in a Float32Array). */
export function mulawDecode(bytes: ArrayLike<number>): Float32Array {
  const table = decodeTable();
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = table[bytes[i]! & 0xff]!;
  return out;
}

// --- resampling ----------------------------------------------------------------

/**
 * A linear-interpolating resampler that keeps its phase across chunks: the
 * output of any split of a signal is the output of the whole. Output `k`
 * sits at source position `k · from / to`, tracked in integers (rates are
 * rounded to whole Hz), so nothing drifts over a night. The first output is
 * the first input sample; between chunks the last input sample is kept to
 * interpolate across the boundary.
 */
export class Resampler {
  readonly from: number;
  readonly to: number;
  /** The next output's source position × `to`, relative to the next chunk's first sample. */
  private num = 0;
  /** The previous chunk's last sample (source index −1). */
  private last = 0;

  constructor(fromRate: number, toRate: number) {
    this.from = Math.round(fromRate);
    this.to = Math.round(toRate);
    if (!(this.from > 0) || !(this.to > 0)) throw new RangeError(`bad rates ${fromRate} → ${toRate}`);
  }

  /** Resample one chunk; returns the outputs it completes. */
  push(input: ArrayLike<number>): Float32Array {
    const n = input.length;
    if (n === 0) return new Float32Array(0);
    const { from, to } = this;
    // Outputs at positions num/to ≤ n − 1.
    const limit = (n - 1) * to;
    const count = this.num > limit ? 0 : Math.floor((limit - this.num) / from) + 1;
    const out = new Float32Array(count);
    let num = this.num;
    for (let k = 0; k < count; k++) {
      const i = Math.floor(num / to);
      const rem = num - i * to;
      const a = i < 0 ? this.last : input[i]!;
      out[k] = rem === 0 ? a : a + (input[i + 1]! - a) * (rem / to);
      num += from;
    }
    this.num = num - n * to;
    this.last = input[n - 1]!;
    return out;
  }

  /** Forget the phase and the held sample (a new stream). */
  reset(): void {
    this.num = 0;
    this.last = 0;
  }
}

/** Resample a whole signal (one `Resampler` chunk). Same rates: a copy. */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (Math.round(fromRate) === Math.round(toRate)) return new Float32Array(input);
  return new Resampler(fromRate, toRate).push(input);
}

/** A chunk's RMS level in dBFS (full scale = 1.0); silence or nothing = −Infinity. */
export function rmsDbfs(samples: ArrayLike<number>): number {
  if (samples.length === 0) return -Infinity;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  if (sum === 0) return -Infinity;
  return 10 * Math.log10(sum / samples.length);
}

// --- the gate --------------------------------------------------------------------

export interface VoiceGateOptions {
  /** Default `VOICE_GATE_DBFS`. */
  gateDbfs?: number;
  /** Default `VOICE_HANG_MS`. */
  hangMs?: number;
}

/**
 * The open-mic gate (D5). Feed it every captured chunk with its level and
 * the clock; it answers the chunks to send now. A chunk over the gate opens
 * it (and sends the one quiet chunk before it — the pre-roll, so a word's
 * onset isn't clipped); it stays open `hangMs` after the last loud chunk.
 * `holdUntil(ms)` is the software half-duplex: until then every chunk is
 * dropped, the gate closes and the pre-roll is forgotten (it may hold the
 * voice being played back) — the terminals' rule. `raiseUntil(ms, dbfs)` is
 * the games' barge-in (D5b): until then a chunk must be louder than `dbfs`
 * (or the gate, whichever is higher) to open the gate, and no pre-roll is
 * kept. A hold beats a raise. Generic over the chunk type.
 */
export class VoiceGate<T = Uint8Array> {
  readonly gateDbfs: number;
  readonly hangMs: number;
  private openUntil = -Infinity;
  private open = false;
  private held = -Infinity;
  private raised = -Infinity;
  private raisedDbfs = -Infinity;
  private preroll: T | null = null;

  constructor(opts: VoiceGateOptions = {}) {
    this.gateDbfs = opts.gateDbfs ?? VOICE_GATE_DBFS;
    this.hangMs = opts.hangMs ?? VOICE_HANG_MS;
  }

  /** Send nothing before `ms` (incoming voice / own speech + `VOICE_TAIL_MS`). Only ever extends. */
  holdUntil(ms: number): void {
    if (ms > this.held) this.held = ms;
  }

  /** Whether `now` is inside a half-duplex hold. */
  holding(now: number): boolean {
    return now < this.held;
  }

  /** Until `ms`, only a chunk louder than `dbfs` opens the gate (the games'
   *  barge-in, D5b). The time only ever extends; the level is the last asked. */
  raiseUntil(ms: number, dbfs: number): void {
    if (ms > this.raised) this.raised = ms;
    this.raisedDbfs = dbfs;
  }

  /** Whether `now` is inside a barge-in raise. */
  raisedAt(now: number): boolean {
    return now < this.raised;
  }

  /** The level a chunk must beat at `now`. */
  thresholdAt(now: number): number {
    return now < this.raised ? Math.max(this.gateDbfs, this.raisedDbfs) : this.gateDbfs;
  }

  /** Whether the last chunk left the gate open. */
  get isOpen(): boolean {
    return this.open;
  }

  /** One chunk, its level (dBFS) and the time it was captured → the chunks to send now. */
  push(chunk: T, dbfs: number, now: number): T[] {
    if (now < this.held) {
      this.open = false;
      this.openUntil = -Infinity;
      this.preroll = null;
      return [];
    }
    const raised = now < this.raised;
    if (dbfs > this.thresholdAt(now)) {
      const wasOpen = this.open;
      this.open = true;
      this.openUntil = now + this.hangMs;
      const pre = !wasOpen && this.preroll !== null ? [this.preroll] : [];
      this.preroll = null;
      return [...pre, chunk];
    }
    if (this.open && now <= this.openUntil) return [chunk];
    this.open = false;
    // Under a raise a quiet chunk may hold the voice being played back.
    this.preroll = raised ? null : chunk;
    return [];
  }

  /** Close the gate and forget the pre-roll (the mic stopped). The hold stands. */
  reset(): void {
    this.open = false;
    this.openUntil = -Infinity;
    this.preroll = null;
  }
}

/**
 * Collects resampled 16 kHz samples and hands back whole chunks of `size`
 * samples (default `VOICE_CHUNK_BYTES`, 200 ms), keeping the remainder.
 */
export class ChunkAssembler {
  readonly size: number;
  private buf: Float32Array;
  private fill = 0;

  constructor(size = VOICE_CHUNK_BYTES) {
    if (!(size > 0) || !Number.isInteger(size)) throw new RangeError(`bad chunk size ${size}`);
    this.size = size;
    this.buf = new Float32Array(size);
  }

  /** Samples held toward the next chunk. */
  get pending(): number {
    return this.fill;
  }

  push(samples: ArrayLike<number>): Float32Array[] {
    const out: Float32Array[] = [];
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.fill++] = samples[i]!;
      if (this.fill === this.size) {
        out.push(this.buf);
        this.buf = new Float32Array(this.size);
        this.fill = 0;
      }
    }
    return out;
  }

  reset(): void {
    this.fill = 0;
  }
}

// --- playback jitter -------------------------------------------------------------

/** What to do with an incoming chunk (`jitterPlan`). All times are ms from now. */
export interface JitterPlan {
  /** `start`: nothing queued (first chunk, or an underrun) — start at the
   *  target with a fade-in. `queue`: play right after what is queued.
   *  `skip`: too much queued — drop `drop` ms of it (fade the cut), then
   *  play this at the target with a fade-in. */
  action: "start" | "queue" | "skip";
  /** When this chunk starts playing. */
  at: number;
  /** Queued audio to discard first (`skip` only, else 0). */
  drop: number;
  fadeIn: boolean;
}

export interface JitterOptions {
  /** Default `VOICE_JITTER_TARGET_MS`. */
  targetMs?: number;
  /** Default `VOICE_JITTER_MAX_MS`. */
  maxMs?: number;
}

/** Given how much of a source is queued (ms, ≤ 0 = nothing), plan its next chunk. */
export function jitterPlan(bufferedMs: number, opts: JitterOptions = {}): JitterPlan {
  const target = opts.targetMs ?? VOICE_JITTER_TARGET_MS;
  const max = Math.max(target, opts.maxMs ?? VOICE_JITTER_MAX_MS);
  if (!(bufferedMs > 0)) return { action: "start", at: target, drop: 0, fadeIn: true };
  if (bufferedMs > max) return { action: "skip", at: target, drop: bufferedMs - target, fadeIn: true };
  return { action: "queue", at: bufferedMs, drop: 0, fadeIn: false };
}

// --- who hears whom --------------------------------------------------------------

/** A player as the router sees them. `room` is the room they count as being
 *  in — the server passes the presence room (`presenceRoom`, wave 26); a
 *  missing `room` is `locate`d. `floor` is informational. */
export interface VoicePlayer {
  p: Vec3;
  floor?: string;
  room?: string | null;
}

export interface HeardTerminal {
  spot: string;
  gain: number;
}

export interface HeardPlayer {
  session: string;
  gain: number;
}

/** What the router asks of a rule besides the map and the listener. */
export interface VoiceRouteOptions {
  /** Candidates allowed at all (`hearsTerminals`: the spots with a live
   *  microphone on the stream; `hearsPlayers`: the sessions whose mic can be
   *  heard); absent = every one. */
  only?: ReadonlySet<string>;
}

/** The room the router judges a player by: theirs, else `locate`'s. */
function roomOf(house: HouseMap, who: VoicePlayer): string | null {
  return who.room !== undefined ? who.room : locate(house, who.p).room;
}

const plan = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Nearest first; ties by id in code-unit order (every port sorts alike). */
function nearest<T extends { d: number; id: string }>(rows: T[], most: number): T[] {
  return rows.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, most);
}

/**
 * The terminals a player hears (wave 26, R5): voice on, in the player's
 * room (`room === player.room`; a player in no room hears none), never a
 * `view: "reinstall"` terminal (the tent station is never linked, T3 —
 * even with `voice: true` on the map), gain 1;
 * the `VOICE_MAX_TERMINALS` nearest in plan, nearest first. No reach and
 * nothing through a wall: the doorway hysteresis is the presence room's
 * (`presenceRoom`). `opts.only` limits the candidates (the live mics).
 */
export function hearsTerminals(house: HouseMap, player: VoicePlayer, opts: VoiceRouteOptions = {}): HeardTerminal[] {
  const room = roomOf(house, player);
  if (room === null) return [];
  const rows: Array<{ id: string; d: number }> = [];
  for (const t of house.terminals) {
    if (t.room !== room || t.view === "reinstall" || !voiceOn(house, t)) continue;
    if (opts.only !== undefined && !opts.only.has(t.id)) continue;
    rows.push({ id: t.id, d: plan(t.pos, player.p) });
  }
  return nearest(rows, VOICE_MAX_TERMINALS).map((r) => ({ spot: r.id, gain: 1 }));
}

/**
 * The players a terminal hears (wave 26, R5): voice on at the terminal
 * (never a `view: "reinstall"` one, T3), the players whose room is the
 * terminal's room, gain 1; the
 * `VOICE_MAX_PLAYERS` nearest its `pos` in plan, nearest first.
 * `opts.only` limits the sessions.
 */
export function hearsPlayers(
  house: HouseMap,
  spot: SpotRef,
  players: ReadonlyArray<VoicePlayer & { session: string }>,
  opts: VoiceRouteOptions = {},
): HeardPlayer[] {
  const t = spotOf(house, spot);
  if (!t || t.view === "reinstall" || !voiceOn(house, t)) return [];
  const rows: Array<{ id: string; d: number }> = [];
  for (const pl of players) {
    if (roomOf(house, pl) !== t.room) continue;
    if (opts.only !== undefined && !opts.only.has(pl.session)) continue;
    rows.push({ id: pl.session, d: plan(t.pos, pl.p) });
  }
  return nearest(rows, VOICE_MAX_PLAYERS).map((r) => ({ session: r.id, gain: 1 }));
}
