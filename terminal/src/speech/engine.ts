//! The voice. The device speaks for itself by default (decision 2026-10-15:
//! "just use the native voices on the devices") — a server voice is an
//! opt-in nobody has to run. Four engines behind one contract, plus the
//! queue that feeds them one chunk at a time and reports loudness for the
//! face:
//!
//! - `browser` — `speechSynthesis`, the device's own voices (ranked by
//!   `pick-voice.ts`; on the house Mac's Chrome, the macOS voices). No
//!   waveform access, so loudness is synthesised from word-boundary events
//!   + a syllable-rate flutter.
//! - `fully` — Fully Kiosk Browser's JavaScript Interface
//!   (`fully.textToSpeech`), Android's own TTS engine: the old tablets run
//!   in Fully, whose System WebView may not implement `speechSynthesis` at
//!   all (OCT31 K-02). Needs *Enable JavaScript Interface* in Fully's
//!   Advanced Web Settings (`docs/trapped/kiosk.md`). Synthesised mouth.
//! - `silent` — no voice at all: the transcript is revealed at reading pace
//!   and the mouth flutters, so a voiceless device never stalls the queue.
//! - `server` — opt-in: the event server's `/api/mod/tts` (Kokoro-FastAPI or
//!   any OpenAI-compatible speech endpoint, `core/server/tts.ts`). Audio is
//!   decoded with Web Audio and played through an `AnalyserNode`, so the
//!   mouth follows the real waveform. A 502/503/504 (no server voice, the
//!   box is down) **latches** the engine off for the session: every later
//!   chunk goes straight to the device voice instead of asking again.
//!
//! `DeviceEngine` is the native ladder every terminal uses unless told
//! otherwise: `browser` (speechSynthesis with voices) → `fully` → `silent`,
//! re-decided per chunk (Chrome loads its voice list late; a WebView whose
//! `speak()` never starts is written off after `START_TIMEOUT_MS` — until the
//! next tap: Safari ignores a `speak()` made before any gesture, so the
//! write-off is only as old as the last `unlock()`).
//!
//! All the queues on a page share one `VoiceFloor`, so a house announcement
//! (`announce.ts`) waits for the end of the line the character is saying,
//! and the character's next line waits for the announcement.
//!
//! Playback on a tablet needs one user gesture before any sound: `unlock()`
//! is called from the first tap (the setup screen, the wake overlay).

import type { TerminalConfig } from "../config.ts";
import { pronounce } from "./lexicon.ts";
import { CHARACTER_VOICE, pickVoice, type VoicePrefer } from "./pick-voice.ts";

export type EngineKind = "server" | "browser" | "fully" | "silent";

/** What the terminal's settings choose (`TerminalConfig.engine`). */
export type VoiceChoice = "browser" | "fully" | "silent" | "server";

/** Each engine, said plainly (setup's "TEST VOICE" names the one that spoke). */
export const ENGINE_LABEL: Record<EngineKind, string> = {
  browser: "this device's voice",
  fully: "Fully Kiosk's voice",
  silent: "no voice (text only)",
  server: "the server's voice",
};

export interface SpeechEngine {
  readonly kind: EngineKind | "device";
  /** Prepare a chunk (fetch / decode). May resolve to null when this engine can't say it. */
  prepare(text: string): Promise<Prepared | null>;
  /** Play a prepared chunk; resolves when it ends (or is cancelled).
   *  `onStart` (wave 26, V1): called once when the voice is actually heard
   *  (the utterance's start, the audio source's start), not at handover. */
  play(p: Prepared, onLevel: (level: number) => void, onStart?: () => void): Promise<void>;
  /** Stop whatever is playing now. */
  stop(): void;
}

export type Prepared = { kind: "server"; buffer: AudioBuffer } | { kind: "browser" | "fully" | "silent"; text: string };

// --- audio context (shared, unlocked by a gesture) --------------------------

/** `decodeAudioData` in either form: Safari before 14.1 (`webkitAudioContext`)
 *  has only the callback one and returns undefined; newer browsers a promise.
 *  Rejects on a failure, never resolves undefined (OB-12). */
export function decodeAudio(c: Pick<BaseAudioContext, "decodeAudioData">, buf: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = (b: AudioBuffer) => {
      if (settled) return;
      settled = true;
      if (b) resolve(b);
      else reject(new Error("no audio decoded"));
    };
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      reject(e);
    };
    try {
      const p = c.decodeAudioData(buf, ok, fail) as unknown as Promise<AudioBuffer> | undefined;
      if (p !== undefined && p !== null && typeof p.then === "function") p.then(ok, fail);
    } catch (e) {
      fail(e);
    }
  });
}

let ctx: AudioContext | null = null;

/** Bumped by every `unlock()`; a `BrowserEngine` write-off holds until the next. */
let gesture = 0;
export function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Ctor === undefined) return null;
  return (ctx ??= new Ctor());
}

/** Is sound allowed yet? (`AudioContext` running.) */
export function audioUnlocked(): boolean {
  const c = audioContext();
  return c !== null && c.state === "running";
}

/** Call from a user gesture: resume the context, prime `speechSynthesis`. */
export async function unlock(): Promise<boolean> {
  // A gesture is a fresh chance for speechSynthesis: a write-off made before
  // it (an announcement that landed before anyone tapped) is forgotten.
  gesture += 1;
  const c = audioContext();
  if (c !== null && c.state !== "running") {
    try {
      await c.resume();
    } catch {
      /* not from a gesture */
    }
  }
  // A silent utterance from a gesture lets later ones play unattended.
  if (BrowserEngine.available()) {
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch {
      /* fine */
    }
  }
  return c === null || c.state === "running";
}

// --- the synthesised mouth ---------------------------------------------------

/**
 * A mouth level for an engine with no waveform, `t` seconds into a chunk:
 * a ~5.5 Hz syllable flutter gated by a slower ~2.4 Hz word rhythm, so the
 * mouth opens and closes like speech instead of buzzing. Always in 0..0.3.
 */
export function syntheticLevel(t: number): number {
  const flutter = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 5.5);
  const word = Math.sin(t * Math.PI * 2.4) ** 2; // 0..1, dips between "words"
  return word < 0.12 ? 0 : 0.08 + 0.22 * flutter * word;
}

/** Drive `onLevel` with `syntheticLevel` until the returned stop is called. */
function flutter(onLevel: (level: number) => void, gate: () => boolean = () => true): () => void {
  const from = performance.now();
  let raf = 0;
  const tick = () => {
    onLevel(gate() ? syntheticLevel((performance.now() - from) / 1000) : 0);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    onLevel(0);
  };
}

/** How long a chunk takes to read (ms) at `speed` — the silent engine's pace,
 *  and the cap on how long a native voice may take before it is presumed stuck. */
export function readingMs(text: string, speed = 1): number {
  return Math.min(8000, Math.max(900, (62 * text.length) / Math.max(0.5, speed)));
}

// --- server engine (opt-in) --------------------------------------------------

/** Answers that mean "there is no server voice" — latch, don't ask again. */
export const LATCH_STATUSES: readonly number[] = [502, 503, 504];

export class ServerEngine implements SpeechEngine {
  readonly kind = "server" as const;
  private current: { src: AudioBufferSourceNode; done: () => void } | null = null;
  private off = false;
  constructor(
    private readonly opts: { base: string; token: string; voice: string; speed: number; fetchFn?: typeof fetch },
    private readonly onLatch: () => void = () => {},
  ) {}

  /** The server said it has no voice (or is down): every chunk goes to the device now. */
  get latched(): boolean {
    return this.off;
  }

  async prepare(text: string): Promise<Prepared | null> {
    if (this.off) return null;
    const c = audioContext();
    if (c === null) return null;
    const res = await (this.opts.fetchFn ?? fetch)(`${this.opts.base}/api/mod/tts`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-loom-token": this.opts.token },
      body: JSON.stringify({ text, voice: this.opts.voice || undefined, speed: this.opts.speed }),
    });
    if (!res.ok) {
      // 503 = no server voice configured; 502/504 = the voice box is down.
      // Latch: the rest of the session speaks with the device's own voice.
      if (LATCH_STATUSES.includes(res.status) && !this.off) {
        this.off = true;
        this.onLatch();
      }
      return null;
    }
    const bytes = await res.arrayBuffer();
    try {
      const buffer = await decodeAudio(c, bytes.slice(0));
      if (!buffer) return null;
      return { kind: "server", buffer };
    } catch {
      return null;
    }
  }

  play(p: Prepared, onLevel: (level: number) => void, onStart?: () => void): Promise<void> {
    if (p.kind !== "server") return Promise.resolve();
    const c = audioContext();
    if (c === null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const src = c.createBufferSource();
      src.buffer = p.buffer;
      const analyser = c.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      src.connect(analyser);
      analyser.connect(c.destination);
      const data = new Uint8Array(analyser.fftSize);
      let raf = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i]! - 128) / 128;
          sum += v * v;
        }
        onLevel(Math.sqrt(sum / data.length));
        raf = requestAnimationFrame(tick);
      };
      const done = () => {
        cancelAnimationFrame(raf);
        onLevel(0);
        try {
          src.disconnect();
          analyser.disconnect();
        } catch {
          /* already */
        }
        if (this.current?.src === src) this.current = null;
        resolve();
      };
      src.onended = done;
      this.current = { src, done };
      raf = requestAnimationFrame(tick);
      src.start();
      onStart?.(); // decoded already: the sound starts now
    });
  }

  stop(): void {
    const cur = this.current;
    if (cur === null) return;
    try {
      cur.src.stop();
    } catch {
      /* not started */
    }
    cur.done();
  }
}

// --- browser engine (speechSynthesis) ----------------------------------------

/** A `speak()` that hasn't started by now never will (a WebView stub). */
export const START_TIMEOUT_MS = 4000;

export class BrowserEngine implements SpeechEngine {
  readonly kind = "browser" as const;
  private stopCurrent: (() => void) | null = null;
  /** The `unlock()` generation in which a `speak()` never started here. */
  private deadAt: number | null = null;
  /** `prefer`: the lean when no voice is chosen (`CHARACTER_VOICE` /
   *  `ANNOUNCE_VOICE`, so the character never sounds like an announcement). */
  constructor(private readonly opts: { voice: string; speed: number; pitch?: number; prefer?: VoicePrefer }) {}

  /** `speak()` never started here since the last tap: a stub, or a page
   *  that hasn't been touched yet. The next `unlock()` clears it. */
  get dead(): boolean {
    return this.deadAt === gesture;
  }

  static available(): boolean {
    return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
  }

  /** How many voices the device offers right now (0 = none, or not loaded yet). */
  static voiceCount(): number {
    if (!BrowserEngine.available()) return 0;
    try {
      return speechSynthesis.getVoices().length;
    } catch {
      return 0;
    }
  }

  async prepare(text: string): Promise<Prepared | null> {
    return BrowserEngine.available() && !this.dead ? { kind: "browser", text } : null;
  }

  play(p: Prepared, onLevel: (level: number) => void, onStart?: () => void): Promise<void> {
    if (p.kind !== "browser" || !BrowserEngine.available()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(p.text);
      const voice = pickVoice(speechSynthesis.getVoices(), this.opts.voice || null, this.opts.prefer ?? {});
      if (voice !== null) u.voice = voice;
      u.rate = this.opts.speed;
      u.pitch = this.opts.pitch ?? 0.85;
      // No waveform here: the synthesised mouth, open while a word is being
      // said (boundary events where the engine sends them).
      let speaking = false;
      const stopFlutter = flutter(onLevel, () => speaking);
      let settled = false;
      const timers: number[] = [];
      let nudge = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        for (const t of timers) window.clearTimeout(t);
        window.clearInterval(nudge);
        stopFlutter();
        this.stopCurrent = null;
        resolve();
      };
      // The voice is heard: its start (or, from an engine that sends none,
      // its first word boundary). A slow first utterance after idle (some
      // macOS voices) holds the picture until here (V1).
      const started = () => {
        if (!speaking && !settled) onStart?.();
        speaking = true;
      };
      u.onstart = started;
      u.onboundary = started;
      u.onend = finish;
      u.onerror = finish;
      this.stopCurrent = () => {
        speechSynthesis.cancel();
        finish();
      };
      // Never stall the queue: a speak() that doesn't start is a stub (the
      // device is written off — the ladder moves on), and one that never
      // ends is cut after a generous reading time.
      timers.push(
        window.setTimeout(() => {
          if (speaking || settled) return;
          this.deadAt = gesture;
          speechSynthesis.cancel();
          finish();
        }, START_TIMEOUT_MS),
        window.setTimeout(() => {
          speechSynthesis.cancel();
          finish();
        }, START_TIMEOUT_MS + 3 * readingMs(p.text, this.opts.speed)),
      );
      speechSynthesis.speak(u);
      // Some engines (Chrome) pause long utterances after ~15 s; a resume
      // nudge keeps them going.
      nudge = window.setInterval(() => {
        if (speechSynthesis.paused) speechSynthesis.resume();
      }, 5000);
    });
  }

  stop(): void {
    // Only our own utterance: speechSynthesis is one queue per page, and
    // another engine's line (an announcement) may be the one speaking.
    this.stopCurrent?.();
  }
}

// --- Fully Kiosk engine --------------------------------------------------------

/** The slice of Fully Kiosk's JavaScript Interface the voice uses
 *  (fully-kiosk.com → JavaScript Interface; `queue` is ver. 1.38+). */
export interface FullyTts {
  textToSpeech(text: string, localeOrVoice?: string, engine?: string, queue?: boolean): void;
  stopTextToSpeech?(): void;
  /** `fully.bind(event, js)` — Fully evaluates the `js` string on the event. */
  bind?(event: string, js: string): void;
}

/** Fully's interface, when the page runs inside Fully with it enabled. */
export function fullyOf(w: unknown = typeof window === "undefined" ? undefined : window): FullyTts | null {
  const f = (w as { fully?: unknown } | undefined)?.fully as Partial<FullyTts> | undefined;
  return f !== undefined && f !== null && typeof f.textToSpeech === "function" ? (f as FullyTts) : null;
}

/** The global Fully's bound handlers call (Fully evaluates a string of JS). */
const FULLY_HOOK = "__loomFullyTts";
/** Fully speaks one line at a time device-wide, so one "current" is enough
 *  (the page's `VoiceFloor` keeps two engines from overlapping anyway). */
let fullyFinish: (() => void) | null = null;
let fullyBound = false;

/** Bind Fully's TTS events once per page (it has no per-call callback). */
function bindFully(f: FullyTts): void {
  if (fullyBound || f.bind === undefined) return;
  fullyBound = true;
  (window as unknown as Record<string, unknown>)[FULLY_HOOK] = () => fullyFinish?.();
  try {
    f.bind("ttsUtteranceDone", `window.${FULLY_HOOK} && window.${FULLY_HOOK}()`);
    f.bind("ttsUtteranceError", `window.${FULLY_HOOK} && window.${FULLY_HOOK}()`);
  } catch {
    /* an old Fully: the reading-time cap ends each chunk */
  }
}

export class FullyEngine implements SpeechEngine {
  readonly kind = "fully" as const;
  private finishCurrent: (() => void) | null = null;
  constructor(private readonly opts: { voice: string; speed: number }) {}

  static available(): boolean {
    return fullyOf() !== null;
  }

  async prepare(text: string): Promise<Prepared | null> {
    return FullyEngine.available() ? { kind: "fully", text } : null;
  }

  play(p: Prepared, onLevel: (level: number) => void, onStart?: () => void): Promise<void> {
    const f = fullyOf();
    if (p.kind !== "fully" || f === null) return Promise.resolve();
    bindFully(f);
    return new Promise<void>((resolve) => {
      const stopFlutter = flutter(onLevel);
      let settled = false;
      let cap = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(cap);
        stopFlutter();
        if (fullyFinish === finish) fullyFinish = null;
        this.finishCurrent = null;
        resolve();
      };
      // The done event ends the chunk; without one (events unbound, an old
      // Fully) a generous reading time does — never a stalled queue.
      cap = window.setTimeout(finish, START_TIMEOUT_MS + 2 * readingMs(p.text, this.opts.speed));
      this.finishCurrent = finish;
      fullyFinish = finish;
      try {
        // A voice name if set, else the locale. The two-argument form is the
        // oldest Fully's too; it flushes, which is right: one chunk at a time.
        f.textToSpeech(p.text, this.opts.voice || "en-US");
        onStart?.(); // Fully sends no start event: handed over is started
      } catch {
        finish();
      }
    });
  }

  stop(): void {
    if (this.finishCurrent === null) return;
    try {
      fullyOf()?.stopTextToSpeech?.();
    } catch {
      /* fine */
    }
    this.finishCurrent();
  }
}

// --- silent engine -------------------------------------------------------------

export class SilentEngine implements SpeechEngine {
  readonly kind = "silent" as const;
  private finishCurrent: (() => void) | null = null;
  constructor(private readonly opts: { speed: number } = { speed: 1 }) {}

  async prepare(text: string): Promise<Prepared | null> {
    return { kind: "silent", text };
  }

  play(p: Prepared, onLevel: (level: number) => void, onStart?: () => void): Promise<void> {
    if (p.kind !== "silent") return Promise.resolve();
    return new Promise<void>((resolve) => {
      const stopFlutter = flutter(onLevel);
      onStart?.();
      const t = window.setTimeout(() => finish(), readingMs(p.text, this.opts.speed));
      const finish = () => {
        window.clearTimeout(t);
        stopFlutter();
        this.finishCurrent = null;
        resolve();
      };
      this.finishCurrent = finish;
    });
  }

  stop(): void {
    this.finishCurrent?.();
  }
}

// --- the native ladder -----------------------------------------------------------

/** What the device can do right now (`deviceEnv()` reads it off the page). */
export interface DeviceEnv {
  /** `speechSynthesis` exists. */
  speech: boolean;
  /** Voices it lists (0 until Chrome has loaded them, or forever on a stub). */
  voices: number;
  /** A `speak()` here never started (`BrowserEngine.dead`). */
  speechDead: boolean;
  /** Fully Kiosk's JavaScript Interface is enabled. */
  fully: boolean;
}

export function deviceEnv(speechDead = false): DeviceEnv {
  return { speech: BrowserEngine.available(), voices: BrowserEngine.voiceCount(), speechDead, fully: FullyEngine.available() };
}

/**
 * Which native engine says the next chunk (pure). `browser` (speechSynthesis
 * with voices) → `fully` → `silent`; an explicit `fully` / `silent` choice
 * is honoured while it can be (Fully gone → back to the ladder).
 */
export function pickDeviceEngine(env: DeviceEnv, choice: Exclude<VoiceChoice, "server"> = "browser"): "browser" | "fully" | "silent" {
  if (choice === "silent") return "silent";
  if (choice === "fully" && env.fully) return "fully";
  if (env.speech && env.voices > 0 && !env.speechDead) return "browser";
  if (env.fully) return "fully";
  return "silent";
}

/** Resolves once the device's voice list has loaded (or after `ms`). */
export function voicesReady(ms = 1500): Promise<void> {
  if (!BrowserEngine.available() || BrowserEngine.voiceCount() > 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      window.clearTimeout(t);
      try {
        speechSynthesis.removeEventListener("voiceschanged", done);
      } catch {
        /* old engines */
      }
      resolve();
    };
    const t = window.setTimeout(done, ms);
    try {
      speechSynthesis.addEventListener("voiceschanged", done);
    } catch {
      /* old engines: the timer */
    }
  });
}

/** The device's own voice: the ladder, re-decided per chunk. */
export class DeviceEngine implements SpeechEngine {
  readonly kind = "device" as const;
  readonly browser: BrowserEngine;
  private fully: FullyEngine | null = null;
  private readonly silent: SilentEngine;
  private ready: Promise<void> | null = null;
  constructor(private readonly opts: { voice: string; speed: number; choice?: Exclude<VoiceChoice, "server">; prefer?: VoicePrefer }) {
    this.browser = new BrowserEngine(opts);
    this.silent = new SilentEngine(opts);
  }

  private engineFor(kind: "browser" | "fully" | "silent"): SpeechEngine {
    if (kind === "browser") return this.browser;
    if (kind === "fully") return (this.fully ??= new FullyEngine(this.opts));
    return this.silent;
  }

  /** Which engine would say a chunk now. */
  current(): "browser" | "fully" | "silent" {
    return pickDeviceEngine(deviceEnv(this.browser.dead), this.opts.choice ?? "browser");
  }

  async prepare(text: string): Promise<Prepared | null> {
    // The first chunk waits (briefly) for Chrome to list its voices.
    await (this.ready ??= voicesReady());
    return this.engineFor(this.current()).prepare(text);
  }

  async play(p: Prepared, onLevel: (level: number) => void, onStart?: () => void): Promise<void> {
    if (p.kind === "server") return;
    await this.engineFor(p.kind).play(p, onLevel, onStart);
    // A stub speechSynthesis was just written off: the chunk is shown at
    // reading pace instead (an announcement or the next line moves on).
    if (p.kind === "browser" && this.browser.dead) await this.engineFor(this.current()).play({ kind: this.current(), text: p.text }, onLevel, onStart);
  }

  stop(): void {
    this.browser.stop();
    this.fully?.stop();
    this.silent.stop();
  }
}

/** A terminal's engines for its voice choice: the device's ladder, or the
 *  server voice with the device's as its fallback. */
export function voiceEngines(
  o: { choice: VoiceChoice; browserVoice: string; serverVoice: string; speed: number; base: string; token: string },
  onLatch?: () => void,
): { primary: SpeechEngine; fallback: SpeechEngine | null } {
  // The character's voice: male first unless one is picked in ⚙ (never the announcements' voice).
  const device = new DeviceEngine({ voice: o.browserVoice, speed: o.speed, choice: o.choice === "server" ? "browser" : o.choice, prefer: CHARACTER_VOICE });
  if (o.choice !== "server") return { primary: device, fallback: null };
  return { primary: new ServerEngine({ base: o.base, token: o.token, voice: o.serverVoice, speed: o.speed }, onLatch), fallback: device };
}

/** The status line under the face: why this isn't the voice that was asked
 *  for (null = nothing worth saying). */
export function voiceNote(choice: VoiceChoice, used: EngineKind | null, latched: boolean): string | null {
  if (choice === "server" && latched) return "voice: this device's own (no server voice)";
  if (choice === "server" && used !== null && used !== "server") return "voice: this device's own (server voice missed)";
  if (used === "silent" && choice !== "silent") return "no voice on this device — text only";
  return null;
}

// --- the floor: one voice at a time per page -----------------------------------

/** A FIFO lock over the page's voice. A queue holds it for one whole
 *  utterance, so nothing ever cuts in mid-sentence. */
export class VoiceFloor {
  private tail: Promise<void> = Promise.resolve();
  private holders = 0;

  /** True while anyone holds or waits for the floor. */
  get busy(): boolean {
    return this.holders > 0;
  }

  acquire(): Promise<() => void> {
    this.holders++;
    let open!: () => void;
    const mine = new Promise<void>((r) => (open = r));
    const prev = this.tail;
    this.tail = prev.then(() => mine);
    let released = false;
    return prev.then(() => () => {
      if (released) return;
      released = true;
      this.holders--;
      open();
    });
  }
}

/** The page's one floor: the character's voice, the TV's, and announcements. */
export const voiceFloor = new VoiceFloor();

// --- the queue ---------------------------------------------------------------

// --- pacing (wave 26, V2) -------------------------------------------------------

/** The pause between two sentences of one line (ms). */
export const CHUNK_GAP_MS = 300;
/** The pause between two lines (ms): before the next one, never after the last. */
export const LINE_GAP_MS = 700;
/** The range of a terminal's `pause` multiplier (⚙, `pause=`). */
export const PAUSE_MIN = 0;
export const PAUSE_MAX = 3;

/** How long a `SpeechQueue` pauses between sentences (`chunk`) and lines (`line`), ms. */
export interface SpeechGaps {
  chunk: number;
  line: number;
}

/** The pauses at `pause` 1. */
export const DEFAULT_GAPS: SpeechGaps = { chunk: CHUNK_GAP_MS, line: LINE_GAP_MS };
/** A house announcement's: the chime already parts two of them. */
export const ANNOUNCE_GAPS: SpeechGaps = { chunk: 250, line: 0 };

/** A `pause` multiplier as a config may carry it: 0–3, anything unreadable is 1. */
export function pauseOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(PAUSE_MAX, Math.max(PAUSE_MIN, v)) : 1;
}

/** A terminal's pauses: both gaps scaled by its `pause` (absent: 1). */
export function gapsFor(config: Partial<Pick<TerminalConfig, "pause">> | null | undefined): SpeechGaps {
  const k = pauseOf(config?.pause);
  return { chunk: Math.round(CHUNK_GAP_MS * k), line: Math.round(LINE_GAP_MS * k) };
}

export interface Utterance {
  /** The message this belongs to (so the transcript can follow along). */
  id: number;
  chunks: string[];
  /** Runs once the floor is held, before the first chunk (an announcement's chime). */
  before?: () => Promise<void>;
}

/**
 * Says utterances in order, one chunk at a time, prefetching the next chunk
 * while the current one plays. The primary engine handles a chunk unless it
 * can't (no server voice, the box is down), in which case the fallback
 * takes that chunk — so a terminal never goes mute mid-sentence. Each
 * utterance holds the page's `VoiceFloor` from its first chunk to its last.
 *
 * Wave 26 (V2): it pauses `gaps.chunk` between two sentences and
 * `gaps.line` before a line that follows another (never after the last, so
 * a drain is reported the moment he stops), holding the floor through both;
 * `stop()` cuts a pause short. Wave 26 (V3): every engine gets the chunk as
 * it is said (`pronounce`), the callbacks still index the original chunks.
 */
export class SpeechQueue {
  private queue: Utterance[] = [];
  private running = false;
  /** Bumped by `stop()`: a run from an older generation winds down. */
  private gen = 0;
  /** When the last utterance finished playing (`Date.now()`; null: none yet, or cut). */
  private lastEndAt: number | null = null;
  /** Ends the pause in progress early (`stop()`). */
  private wake: (() => void) | null = null;
  constructor(
    private engines: { primary: SpeechEngine; fallback: SpeechEngine | null },
    private readonly on: {
      level: (level: number) => void;
      /** Chunk `index` of utterance `id` is starting. */
      chunk: (id: number, index: number) => void;
      /** Utterance `id` finished (or was cut). */
      done: (id: number) => void;
      /** The queue drained. */
      idle: () => void;
      /** Which engine spoke the last chunk (for the status line). */
      engine?: (kind: EngineKind) => void;
    },
    private readonly floor: VoiceFloor = voiceFloor,
    /** The pauses (wave 26, V2): `gapsFor(config)`; announcements `ANNOUNCE_GAPS`. */
    private gaps: SpeechGaps = DEFAULT_GAPS,
  ) {}

  setGaps(g: SpeechGaps): void {
    this.gaps = g;
  }

  setEngines(e: { primary: SpeechEngine; fallback: SpeechEngine | null }): void {
    this.engines = e;
  }

  get busy(): boolean {
    return this.running || this.queue.length > 0;
  }

  say(u: Utterance): void {
    if (u.chunks.length === 0) return;
    this.queue.push(u);
    if (!this.running) void this.run();
  }

  /** Drop everything — the session ended. */
  stop(): void {
    this.gen++;
    this.queue = [];
    this.lastEndAt = null;
    this.wake?.();
    this.engines.primary.stop();
    this.engines.fallback?.stop();
  }

  /** A pause of `ms` (none at 0), cut short by `stop()`. Holds the floor. */
  private pause(ms: number): Promise<void> {
    if (!(ms > 0)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        if (this.wake === done) this.wake = null;
        resolve();
      };
      const t = setTimeout(done, ms);
      this.wake = done;
    });
  }

  /** The engine boundary: every engine is handed the text as it is *said*
   *  (`lexicon.ts`, wave 26 V3), never the transcript's. */
  private async prepare(text: string): Promise<{ engine: SpeechEngine; p: Prepared } | null> {
    const said = pronounce(text);
    try {
      const p = await this.engines.primary.prepare(said);
      if (p !== null) return { engine: this.engines.primary, p };
    } catch {
      /* fall through */
    }
    const fb = this.engines.fallback;
    if (fb === null) return null;
    try {
      const p = await fb.prepare(said);
      return p === null ? null : { engine: fb, p };
    } catch {
      return null;
    }
  }

  private async run(): Promise<void> {
    this.running = true;
    const g = this.gen;
    while (this.queue.length > 0 && g === this.gen) {
      const u = this.queue.shift()!;
      const release = await this.floor.acquire();
      try {
        if (g !== this.gen) {
          this.on.done(u.id);
          break;
        }
        if (u.before !== undefined) await u.before().catch(() => {});
        let next = this.prepare(u.chunks[0]!);
        // The pause between lines: before this one, counted from the end of
        // the last (a line queued long after it waits for nothing).
        if (this.lastEndAt !== null) await this.pause(this.lastEndAt + this.gaps.line - Date.now());
        let spoken = false;
        for (let i = 0; i < u.chunks.length && g === this.gen; i++) {
          if (i > 0) await this.pause(this.gaps.chunk);
          if (g !== this.gen) break;
          const ready = await next;
          if (i + 1 < u.chunks.length) next = this.prepare(u.chunks[i + 1]!);
          if (g !== this.gen) break;
          if (ready === null) {
            this.on.chunk(u.id, i);
            // Nothing can say it: pace the transcript as if it were spoken.
            await new Promise((r) => setTimeout(r, readingMs(u.chunks[i]!)));
          } else {
            this.on.engine?.(ready.p.kind);
            // V1 (wave 26): `chunk` means he started the sentence — the
            // voice is heard, not merely handed the text. The trailing
            // call is the safety net: an engine that ends without ever
            // starting (a written-off stub) still reports the chunk, so a
            // scene holding on it never wedges.
            let fired = false;
            const start = () => {
              if (fired || g !== this.gen) return;
              fired = true;
              this.on.chunk(u.id, i);
            };
            await ready.engine.play(ready.p, this.on.level, start);
            start();
          }
          spoken = i === u.chunks.length - 1;
        }
        this.lastEndAt = spoken && g === this.gen ? Date.now() : null;
      } finally {
        release();
      }
      this.on.done(u.id);
    }
    this.running = false;
    this.on.level(0);
    // Something was queued after a stop() while the old run wound down.
    if (this.queue.length > 0) void this.run();
    else this.on.idle();
  }
}
