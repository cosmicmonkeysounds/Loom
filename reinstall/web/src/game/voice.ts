//! The voice link in the game (wave 19, `docs/loom-reinstall.md` §2.4): the
//! people standing by a wall terminal are heard at that terminal's screen in
//! the virtual house, and the player's own mic is heard on the terminals
//! near them. Opt-in per device (`config.voice`, off on the tent laptop).
//!
//! Down: one SSE stream (`/api/spatial/voice/stream`, the session token)
//! carries only what this player can hear — `voice` chunks of 16 kHz μ-law
//! with the server's gain, `bye` when a terminal drops out of earshot,
//! `listen {on}` when somebody can hear this player. Each terminal plays
//! through its own `PannerNode` at its screen, in house metres (equalpower,
//! no distance roll-off: the server's gain is the volume, the panner only
//! the direction), the listener at the player's eye every frame, behind a
//! ~200 ms jitter buffer (`jitterPlan`), resampled up in JS to the context's
//! rate (never a 16 kHz `AudioBuffer`: old WebKit refuses one).
//!
//! Up: the mic (opened in the **Play here** tap, the gesture) → resampled to
//! 16 kHz → 200 ms chunks → the level gate → μ-law → `POST
//! /api/spatial/voice?seq=`, one at a time, only while somebody listens and
//! the player hasn't muted. Half-duplex in software: nothing goes up while a
//! terminal's voice plays here (+ `VOICE_TAIL_MS`), so a laptop's speakers
//! never loop back into the house.
//!
//! The codec, the gate, the chunker, the resampler, the jitter rule and the
//! routing are `@loom/house`'s; this file is the imperative loop, with every
//! effect injected (the fetcher, the `EventSource`, the audio sink, the mic,
//! the clocks), so node vitest drives it end to end. The browser halves
//! (`createVoiceSink`, `requestMic`, `micSourceOf`) sit at the bottom.

import {
  ChunkAssembler,
  forward,
  hearsPlayers,
  jitterPlan,
  mulawDecode,
  mulawEncode,
  Resampler,
  rmsDbfs,
  styleOf,
  VOICE_CODEC,
  VOICE_RATE,
  VOICE_TAIL_MS,
  VoiceGate,
  voiceOn,
} from "@loom/house";
import type { HouseMap, TerminalSpot, Vec3, VoicePlayer } from "@loom/house";
import { postVoice, voiceStreamUrl } from "../api.ts";
import { reopenDelay, type SpatialSource } from "../spatial.ts";

/** At most this many chunks wait to go up (600 ms); older ones are dropped. */
export const VOICE_UP_QUEUE = 3;
/** The fade-in at the head of a chunk that starts (or restarts) a voice, ms. */
export const VOICE_FADE_MS = 8;
/** How long a voice fades out on `bye`, ms. */
export const VOICE_BYE_MS = 60;
/** The screen's face sits this far in front of the wall line (the scene's 3.5 cm). */
const SCREEN_OUT = 0.035;

/** The mic as the HUD says it: on and sending when loud, muted by the
 *  player, not there (refused, insecure, none), or still being opened. */
export type MicState = "live" | "muted" | "none" | "starting";

/** What the HUD shows of the link. */
export interface VoiceHud {
  mic: MicState;
  /** Somebody at a terminal can hear this player now (`listen {on}`). */
  listening: boolean;
  /** Terminals playing into this game now. */
  hearing: number;
}

/** The voice link as the game's HUD shows it: plus how many terminals hear
 *  this player (`earsFor`, counted only while the server says one does). */
export interface VoiceHudState extends VoiceHud {
  ears: number;
}

/** The status line's "N can hear you": while the server says a terminal
 *  hears this player and the mic is live, else nothing. */
export function earsLine(voice: VoiceHudState): string | null {
  if (!voice.listening || voice.ears <= 0 || voice.mic !== "live") return null;
  return voice.ears === 1 ? "🎤 a terminal can hear you" : `🎤 ${voice.ears} terminals can hear you`;
}

// --- pure placement ------------------------------------------------------------

/** Where a voice comes from: a point in house metres and the way it faces. */
export interface ScreenPose {
  pos: Vec3;
  fwd: Vec3;
}

/**
 * A terminal's screen in house metres — where the scene hangs it
 * (`@loom/house/three`'s `terminalGroup`): the spot pushed out of the wall
 * along its yaw / pitch by half the wall plus the screen's 3.5 cm.
 */
export function screenPose(house: HouseMap, spot: TerminalSpot): ScreenPose {
  const fwd = forward(spot.yaw, spot.pitch ?? 0);
  const out = styleOf(house).wallThickness / 2 + SCREEN_OUT;
  return { pos: [spot.pos[0] + fwd[0] * out, spot.pos[1] + fwd[1] * out, spot.pos[2] + fwd[2] * out], fwd };
}

/** The listener's axes for a head at `yaw` / `pitch` (degrees, house frame):
 *  forward, and up square to it (WebAudio wants the two). */
export function listenerAxes(yaw: number, pitch: number): { fwd: Vec3; up: Vec3 } {
  return { fwd: forward(yaw, pitch), up: forward(yaw, pitch + 90) };
}

/** How many voice-on terminals would hear `session` by the server's rule
 *  (`hearsPlayers`) — the HUD's "N can hear you", told only while the
 *  server says somebody does. */
export function earsFor(house: HouseMap, session: string, players: ReadonlyArray<VoicePlayer & { session: string }>): number {
  let n = 0;
  for (const t of house.terminals) {
    if (voiceOn(house, t) && hearsPlayers(house, t, players).some((h) => h.session === session)) n++;
  }
  return n;
}

/** Base64 → bytes (the `voice` frame's `data`). */
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A linear fade over the first `ms` of `samples` (in place). */
export function fadeIn(samples: Float32Array, rate: number, ms = VOICE_FADE_MS): Float32Array {
  const n = Math.min(samples.length, Math.round((rate * ms) / 1000));
  for (let i = 0; i < n; i++) samples[i]! *= i / n;
  return samples;
}

// --- the injected halves ---------------------------------------------------------

/** The mic, captured: mono blocks at `rate`. */
export interface MicSource {
  readonly rate: number;
  /** Set by the link: called with every captured block. */
  onSamples: ((samples: Float32Array) => void) | null;
  /** The track on / off (a muted or hidden game captures silence). */
  setEnabled(on: boolean): void;
  /** Stop the tracks for good (the browser's mic light goes out). */
  stop(): void;
}

/** One terminal's voice in the scene. */
export interface VoiceChannel {
  place(at: ScreenPose): void;
  /** The server's gain, 0…1. */
  volume(gain: number): void;
  /** Play `samples` (at the sink's rate) at audio time `at`, seconds. */
  play(samples: Float32Array, at: number): void;
  /** Drop everything scheduled (a skip ahead). */
  flush(): void;
  /** Fade out and let go. */
  close(): void;
}

/** Where voices play. */
export interface VoiceSink {
  /** The output rate (the context's). */
  readonly rate: number;
  /** The audio clock, seconds. */
  time(): number;
  /** The listener at the eye, house metres. */
  listener(eye: Vec3, fwd: Vec3, up: Vec3): void;
  channel(): VoiceChannel;
}

export interface VoiceLinkOptions {
  /** The event-scoped API base (`/e/<id>`). */
  base: string;
  /** The game's session token. */
  token: string;
  /** The map being played now (it changes on a remap). */
  house(): HouseMap;
  sink: VoiceSink;
  /** The mic being opened (null: none asked for, or none to be had). */
  mic: Promise<MicSource | null> | null;
  /** Anything the HUD shows changed. */
  onChange?: () => void;
  fetcher?: typeof fetch;
  source?: (url: string) => SpatialSource;
  /** Wall clock, ms. */
  now?: () => number;
  /** `setTimeout` stand-in: returns the cancel. */
  later?: (fn: () => void, ms: number) => () => void;
}

/** `EventSource.CLOSED` (not a global under node). */
const CLOSED = 2;

/** A probe status that ends the link: the session is over (401 / 410), the
 *  token refused (403), or no such route (404: an old server). */
export function voiceGone(status: number | null): boolean {
  return status === 401 || status === 403 || status === 404 || status === 410;
}

interface Heard {
  channel: VoiceChannel;
  spot: string;
  /** Audio time the queued voice runs out, seconds. */
  end: number;
  seq: number;
  up: Resampler;
}

const defaultLater = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

/** The loop. `setActive(true)` while someone plays on screen; `stop()` for good. */
export class VoiceLink {
  private readonly o: VoiceLinkOptions;
  private readonly gate = new VoiceGate<Uint8Array>();
  private readonly chunks = new ChunkAssembler();
  private down: Resampler | null = null;
  private mic: MicSource | null = null;
  private micState: MicState;
  private muted = false;
  private listening = false;
  private active = false;
  private dead = false;
  private es: SpatialSource | null = null;
  private retry: (() => void) | null = null;
  private attempt = 0;
  private readonly heard = new Map<string, Heard>();
  private readonly queue: Uint8Array[] = [];
  private sending = false;
  private upDead = false;
  private seq = 0;

  constructor(opts: VoiceLinkOptions) {
    this.o = opts;
    this.micState = opts.mic === null ? "none" : "starting";
    opts.mic?.then(
      (m) => this.adoptMic(m),
      () => this.adoptMic(null),
    );
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private changed(): void {
    this.o.onChange?.();
  }

  /** What the HUD shows. */
  get hud(): VoiceHud {
    return { mic: this.micState, listening: this.listening, hearing: this.heard.size };
  }

  /** Chunks sent up so far (tests). */
  get sent(): number {
    return this.seq;
  }

  /** Hear and be heard while on (the game is on screen and playing). */
  setActive(on: boolean): void {
    if (on === this.active || (on && this.dead)) return;
    this.active = on;
    if (on) this.open();
    else this.hush();
    this.syncMic();
    this.changed();
  }

  /** The 🎤 button / M: mute or unmute this player's mic. */
  toggleMute(): void {
    if (this.mic === null || this.dead) return;
    this.muted = !this.muted;
    this.micState = this.muted ? "muted" : "live";
    if (this.muted) this.queue.length = 0;
    this.syncMic();
    this.changed();
  }

  /** The listener at the player's eye (every frame). */
  listen(eye: Vec3, yaw: number, pitch: number): void {
    if (!this.active) return;
    const { fwd, up } = listenerAxes(yaw, pitch);
    this.o.sink.listener(eye, fwd, up);
  }

  /** The map changed: re-hang every voice at its screen, drop any whose
   *  terminal is gone or no longer takes part. */
  remap(): void {
    const house = this.o.house();
    for (const [from, h] of this.heard) {
      const spot = house.terminals.find((t) => t.id === h.spot);
      if (spot === undefined || !voiceOn(house, spot)) this.drop(from);
      else h.channel.place(screenPose(house, spot));
    }
    this.changed();
  }

  /** Stop for good: the stream, every voice, the mic's tracks. */
  stop(): void {
    if (this.dead) return;
    this.setActive(false);
    this.dead = true;
    if (this.mic !== null) {
      this.mic.onSamples = null;
      this.mic.stop();
    }
    this.micState = this.mic === null ? "none" : this.micState;
    this.changed();
  }

  // --- the mic -------------------------------------------------------------------

  private adoptMic(m: MicSource | null): void {
    if (this.dead) {
      m?.stop();
      return;
    }
    this.mic = m;
    this.micState = m === null ? "none" : this.muted ? "muted" : "live";
    if (m !== null) m.onSamples = (s) => this.capture(s);
    this.syncMic();
    this.changed();
  }

  private syncMic(): void {
    this.mic?.setEnabled(this.active && !this.muted && !this.dead);
  }

  /** One captured block: resample, chunk, gate, encode, queue. */
  private capture(samples: Float32Array): void {
    const mic = this.mic;
    if (mic === null || !this.active || this.dead) return;
    if (this.down === null || this.down.from !== Math.round(mic.rate)) this.down = new Resampler(mic.rate, VOICE_RATE);
    const now = this.now();
    for (const chunk of this.chunks.push(this.down.push(samples))) {
      const out = this.gate.push(mulawEncode(chunk), rmsDbfs(chunk), now);
      if (!this.listening || this.muted || this.upDead) continue;
      this.queue.push(...out);
    }
    while (this.queue.length > VOICE_UP_QUEUE) this.queue.shift();
    void this.pump();
  }

  /** Send the queue up, one POST at a time. */
  private async pump(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length > 0 && this.active && !this.dead && !this.upDead) {
        const bytes = this.queue.shift()!;
        const seq = this.seq++;
        const r = await postVoice(this.o.base, this.o.token, seq, bytes, this.o.fetcher);
        if (this.dead) return;
        if (r.status === 401 || r.status === 410) {
          this.stop(); // the session is over
          return;
        }
        if (r.status === 403 || r.status === 404) {
          this.upDead = true; // refused, or a server without the route: hear only
          this.queue.length = 0;
          return;
        }
        if (r.status === 200 && r.listening !== null) this.setListening(r.listening);
      }
    } finally {
      this.sending = false;
    }
  }

  private setListening(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    if (!on) this.queue.length = 0;
    this.changed();
  }

  // --- the stream ----------------------------------------------------------------

  private open(): void {
    if (this.es !== null || this.dead) return;
    const make = this.o.source ?? ((u: string) => new EventSource(u) as SpatialSource);
    const url = voiceStreamUrl(this.o.base, this.o.token);
    const es = make(url);
    this.es = es;
    const on = (name: string, fn: (data: Record<string, unknown>) => void): void =>
      es.addEventListener(name, (e) => {
        if (this.es !== es) return;
        let data: unknown;
        try {
          data = JSON.parse((e as MessageEvent<string>).data);
        } catch {
          return;
        }
        if (typeof data === "object" && data !== null) fn(data as Record<string, unknown>);
      });
    on("hello", (d) => {
      if (d["codec"] !== VOICE_CODEC || d["rate"] !== VOICE_RATE) {
        this.stop(); // a wire this build can't play
        return;
      }
      this.attempt = 0;
      // A (re)connect starts over: the server re-sends whatever is audible.
      for (const from of [...this.heard.keys()]) this.drop(from);
      this.setListening(d["listen"] === true);
      this.changed();
    });
    on("listen", (d) => this.setListening(d["on"] === true));
    on("voice", (d) => this.voice(d));
    on("bye", (d) => {
      if (typeof d["from"] === "string") this.drop(d["from"]);
      this.changed();
    });
    es.onopen = () => (this.attempt = 0);
    es.onerror = () => {
      if (this.es !== es || es.readyState !== CLOSED) return; // the browser retries a drop itself
      es.close();
      this.es = null;
      this.setListening(false);
      void this.probe(url).then((status) => {
        if (this.dead || !this.active || this.es !== null) return;
        if (voiceGone(status)) {
          this.stop();
          return;
        }
        this.retry = (this.o.later ?? defaultLater)(() => {
          this.retry = null;
          if (this.active) this.open();
        }, reopenDelay(this.attempt++));
      });
    };
  }

  /** Why the stream closed: its own status, read once and let go. */
  private async probe(url: string): Promise<number | null> {
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    try {
      const r = await (this.o.fetcher ?? fetch)(url, { cache: "no-store", ...(ac !== null ? { signal: ac.signal } : {}) });
      return r.status;
    } catch {
      return null;
    } finally {
      ac?.abort();
    }
  }

  /** Off screen: no stream, no voices, nothing queued (the mic goes quiet in `syncMic`). */
  private hush(): void {
    this.retry?.();
    this.retry = null;
    this.es?.close();
    this.es = null;
    for (const from of [...this.heard.keys()]) this.drop(from);
    this.queue.length = 0;
    this.listening = false;
    this.gate.reset();
    this.chunks.reset();
    this.down = null;
  }

  private drop(from: string): void {
    const h = this.heard.get(from);
    if (h === undefined) return;
    this.heard.delete(from);
    h.channel.close();
  }

  /** One `voice` frame: a terminal's chunk, into its jitter buffer at its screen. */
  private voice(d: Record<string, unknown>): void {
    if (!this.active || this.dead) return;
    const from = d["from"];
    const spotId = d["spot"];
    const data = d["data"];
    const seq = typeof d["seq"] === "number" ? d["seq"] : -1;
    const gain = typeof d["gain"] === "number" && Number.isFinite(d["gain"]) ? Math.max(0, Math.min(1, d["gain"])) : 0;
    // A player hears terminals only (D3); the tent's never (D7).
    if (d["kind"] !== "terminal" || typeof from !== "string" || typeof spotId !== "string" || typeof data !== "string") return;
    const house = this.o.house();
    const spot = house.terminals.find((t) => t.id === spotId);
    if (spot === undefined || !voiceOn(house, spot)) return;
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(data);
    } catch {
      return;
    }
    if (bytes.length === 0) return;
    const sink = this.o.sink;
    let h = this.heard.get(from);
    if (h !== undefined && seq >= 0 && seq <= h.seq) return; // stale or repeated
    if (h === undefined) {
      h = { channel: sink.channel(), spot: spotId, end: 0, seq: -1, up: new Resampler(VOICE_RATE, sink.rate) };
      this.heard.set(from, h);
      this.changed();
    }
    h.seq = seq;
    h.spot = spotId;
    const time = sink.time();
    const plan = jitterPlan((h.end - time) * 1000);
    if (plan.action !== "queue") h.up.reset();
    if (plan.action === "skip") h.channel.flush();
    const samples = h.up.push(mulawDecode(bytes));
    if (plan.fadeIn) fadeIn(samples, sink.rate);
    const at = time + plan.at / 1000;
    h.channel.place(screenPose(house, spot));
    h.channel.volume(gain);
    h.channel.play(samples, at);
    h.end = at + samples.length / sink.rate;
    // Half-duplex: nothing goes up until this voice (and its echo) is over.
    this.gate.holdUntil(this.now() + (h.end - time) * 1000 + VOICE_TAIL_MS);
    this.queue.length = 0;
  }
}

// --- the browser halves ------------------------------------------------------------

/** Ask for the mic — call it inside the tap that starts the game (Safari
 *  wants the gesture). Null when there is none to be had: refused, an
 *  insecure page (plain http off localhost), no device. */
export function requestMic(): Promise<MediaStream | null> {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (md === undefined || typeof md.getUserMedia !== "function") return Promise.resolve(null);
  try {
    return md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

/** Stop every track of a stream (the mic light goes out). */
export function stopStream(stream: MediaStream | null | undefined): void {
  for (const t of stream?.getTracks() ?? []) t.stop();
}

/**
 * The mic captured on the game's context: a `ScriptProcessorNode` (Safari
 * 14.0 has no AudioWorklet), wired to the destination through a zero gain
 * (Chrome only runs one that is connected). Blocks arrive at `ctx.sampleRate`.
 */
export function micSourceOf(ctx: AudioContext, stream: MediaStream): MicSource {
  const input = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const silent = ctx.createGain();
  silent.gain.value = 0;
  input.connect(proc);
  proc.connect(silent);
  silent.connect(ctx.destination);
  const mic: MicSource = {
    rate: ctx.sampleRate,
    onSamples: null,
    setEnabled(on) {
      for (const t of stream.getAudioTracks()) t.enabled = on;
    },
    stop() {
      proc.onaudioprocess = null;
      try {
        input.disconnect();
        proc.disconnect();
        silent.disconnect();
      } catch {
        /* a closed context */
      }
      stopStream(stream);
    },
  };
  proc.onaudioprocess = (e) => {
    const fn = mic.onSamples;
    if (fn !== null) fn(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  return mic;
}

type Params3 = [AudioParam, AudioParam, AudioParam];

/** Set a position / direction through the AudioParams when there are any
 *  (Chrome, Safari 14.1), else the old setter (Safari 14.0). */
function setTriple(params: Params3 | null, v: Vec3, fallback: () => void): void {
  if (params === null) return fallback();
  params[0].value = v[0];
  params[1].value = v[1];
  params[2].value = v[2];
}

/**
 * Voices on the game's context: a `PannerNode` per terminal (equalpower,
 * `rolloffFactor` 0 — the server's gain is the distance), each chunk an
 * `AudioBufferSourceNode` at the context's own rate, into `out`.
 */
export function createVoiceSink(ctx: AudioContext, out: AudioNode): VoiceSink {
  const bus = ctx.createGain();
  bus.gain.value = 1;
  bus.connect(out);
  const l = ctx.listener;
  const lpos: Params3 | null = l.positionX ? [l.positionX, l.positionY, l.positionZ] : null;
  const lfwd: Params3 | null = l.forwardX ? [l.forwardX, l.forwardY, l.forwardZ] : null;
  const lup: Params3 | null = l.upX ? [l.upX, l.upY, l.upZ] : null;
  return {
    rate: ctx.sampleRate,
    time: () => ctx.currentTime,
    listener(eye, fwd, up) {
      setTriple(lpos, eye, () => l.setPosition(eye[0], eye[1], eye[2]));
      if (lfwd !== null && lup !== null) {
        setTriple(lfwd, fwd, () => {});
        setTriple(lup, up, () => {});
      } else l.setOrientation(fwd[0], fwd[1], fwd[2], up[0], up[1], up[2]);
    },
    channel() {
      const panner = ctx.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "inverse";
      panner.refDistance = 1;
      panner.rolloffFactor = 0;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(panner);
      panner.connect(bus);
      const ppos: Params3 | null = panner.positionX ? [panner.positionX, panner.positionY, panner.positionZ] : null;
      const live = new Set<AudioBufferSourceNode>();
      let first = true;
      const flush = (): void => {
        for (const s of live) {
          try {
            s.stop();
          } catch {
            /* not started */
          }
        }
        live.clear();
      };
      return {
        place(at) {
          setTriple(ppos, at.pos, () => panner.setPosition(at.pos[0], at.pos[1], at.pos[2]));
        },
        volume(g) {
          if (first) gain.gain.value = g;
          else gain.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
          first = false;
        },
        play(samples, at) {
          if (samples.length === 0) return;
          const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
          buf.getChannelData(0).set(samples);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(gain);
          src.onended = () => {
            live.delete(src);
            src.disconnect();
          };
          live.add(src);
          src.start(Math.max(at, ctx.currentTime));
        },
        flush,
        close() {
          gain.gain.setTargetAtTime(0, ctx.currentTime, VOICE_BYE_MS / 3000);
          setTimeout(() => {
            flush();
            gain.disconnect();
            panner.disconnect();
          }, VOICE_BYE_MS * 3);
        },
      };
    },
  };
}
