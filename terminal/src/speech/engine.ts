//! The voice. Two engines behind one contract, plus the queue that feeds
//! them one chunk at a time and reports loudness for the face:
//!
//! - `server` — the show laptop's neural voice through `/api/mod/tts`
//!   (Kokoro-FastAPI or any OpenAI-compatible speech endpoint; see
//!   `core/server/tts.ts`). Audio comes back as bytes, is decoded with Web
//!   Audio and played through an `AnalyserNode`, so the mouth follows the
//!   real waveform. The next chunk is fetched while the current one plays.
//! - `browser` — `speechSynthesis`, the tablet's own voices (ranked by
//!   `pick-voice.ts`). No waveform access, so loudness is synthesised
//!   from word-boundary events + a syllable-rate flutter.
//!
//! Playback on a tablet needs one user gesture before any sound: `unlock()`
//! is called from the first tap (the setup screen, the wake overlay).

import { pickVoice } from "./pick-voice.ts";

export interface SpeechEngine {
  readonly kind: "server" | "browser";
  /** Prepare a chunk (fetch / decode). May resolve to null when this engine can't say it. */
  prepare(text: string): Promise<Prepared | null>;
  /** Play a prepared chunk; resolves when it ends (or is cancelled). */
  play(p: Prepared, onLevel: (level: number) => void): Promise<void>;
  /** Stop whatever is playing now. */
  stop(): void;
}

export type Prepared = { kind: "server"; buffer: AudioBuffer } | { kind: "browser"; text: string };

// --- audio context (shared, unlocked by a gesture) --------------------------

let ctx: AudioContext | null = null;
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
  const c = audioContext();
  if (c !== null && c.state !== "running") {
    try {
      await c.resume();
    } catch {
      /* not from a gesture */
    }
  }
  // A silent utterance from a gesture lets later ones play unattended.
  if (typeof speechSynthesis !== "undefined") {
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

// --- server engine -----------------------------------------------------------

export class ServerEngine implements SpeechEngine {
  readonly kind = "server" as const;
  private current: { src: AudioBufferSourceNode; done: () => void } | null = null;
  constructor(
    private readonly opts: { base: string; token: string; voice: string; speed: number },
  ) {}

  async prepare(text: string): Promise<Prepared | null> {
    const c = audioContext();
    if (c === null) return null;
    const res = await fetch(`${this.opts.base}/api/mod/tts`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-loom-token": this.opts.token },
      body: JSON.stringify({ text, voice: this.opts.voice || undefined, speed: this.opts.speed }),
    });
    if (!res.ok) {
      // 503 = no server voice configured; 502 = the laptop is down. Either
      // way the queue falls back to the browser voice for this chunk.
      return null;
    }
    const bytes = await res.arrayBuffer();
    try {
      const buffer = await c.decodeAudioData(bytes.slice(0));
      return { kind: "server", buffer };
    } catch {
      return null;
    }
  }

  play(p: Prepared, onLevel: (level: number) => void): Promise<void> {
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

// --- browser engine ----------------------------------------------------------

export class BrowserEngine implements SpeechEngine {
  readonly kind = "browser" as const;
  private stopCurrent: (() => void) | null = null;
  constructor(
    private readonly opts: { voice: string; speed: number; pitch?: number },
  ) {}

  static available(): boolean {
    return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
  }

  async prepare(text: string): Promise<Prepared | null> {
    return BrowserEngine.available() ? { kind: "browser", text } : null;
  }

  play(p: Prepared, onLevel: (level: number) => void): Promise<void> {
    if (p.kind !== "browser" || !BrowserEngine.available()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(p.text);
      const voice = pickVoice(speechSynthesis.getVoices(), this.opts.voice || null);
      if (voice !== null) u.voice = voice;
      u.rate = this.opts.speed;
      u.pitch = this.opts.pitch ?? 0.85;
      // No waveform here: fake a level that flutters at syllable rate
      // while a word is being said, and dips between words.
      let speaking = false;
      let wordAt = 0;
      let raf = 0;
      const tick = () => {
        if (speaking) {
          const t = (performance.now() - wordAt) / 1000;
          const flutter = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 5.5); // ~5.5 syllables/s
          onLevel(0.08 + 0.22 * flutter);
        } else onLevel(0);
        raf = requestAnimationFrame(tick);
      };
      const finish = () => {
        cancelAnimationFrame(raf);
        onLevel(0);
        this.stopCurrent = null;
        resolve();
      };
      u.onstart = () => {
        speaking = true;
        wordAt = performance.now();
      };
      u.onboundary = () => {
        wordAt = performance.now();
        speaking = true;
      };
      u.onend = finish;
      u.onerror = finish;
      this.stopCurrent = () => {
        speechSynthesis.cancel();
        finish();
      };
      raf = requestAnimationFrame(tick);
      speechSynthesis.speak(u);
      // Some engines (Chrome) pause long utterances after ~15 s; a resume
      // nudge keeps them going.
      const nudge = window.setInterval(() => {
        if (!speechSynthesis.speaking) window.clearInterval(nudge);
        else if (speechSynthesis.paused) speechSynthesis.resume();
      }, 5000);
    });
  }

  stop(): void {
    this.stopCurrent?.();
    if (BrowserEngine.available()) speechSynthesis.cancel();
  }
}

// --- the queue ---------------------------------------------------------------

export interface Utterance {
  /** The message this belongs to (so the transcript can follow along). */
  id: number;
  chunks: string[];
}

/**
 * Says utterances in order, one chunk at a time, prefetching the next chunk
 * while the current one plays. The primary engine handles a chunk unless it
 * can't (no server voice, the laptop is down), in which case the fallback
 * takes that chunk — so a terminal never goes mute mid-sentence.
 */
export class SpeechQueue {
  private queue: Utterance[] = [];
  private running = false;
  private cancelled = false;
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
      engine?: (kind: SpeechEngine["kind"]) => void;
    },
  ) {}

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
    this.cancelled = true;
    this.queue = [];
    this.engines.primary.stop();
    this.engines.fallback?.stop();
  }

  private async prepare(text: string): Promise<{ engine: SpeechEngine; p: Prepared } | null> {
    try {
      const p = await this.engines.primary.prepare(text);
      if (p !== null) return { engine: this.engines.primary, p };
    } catch {
      /* fall through */
    }
    const fb = this.engines.fallback;
    if (fb === null) return null;
    try {
      const p = await fb.prepare(text);
      return p === null ? null : { engine: fb, p };
    } catch {
      return null;
    }
  }

  private async run(): Promise<void> {
    this.running = true;
    this.cancelled = false;
    while (this.queue.length > 0 && !this.cancelled) {
      const u = this.queue.shift()!;
      let next = this.prepare(u.chunks[0]!);
      for (let i = 0; i < u.chunks.length && !this.cancelled; i++) {
        const ready = await next;
        if (i + 1 < u.chunks.length) next = this.prepare(u.chunks[i + 1]!);
        if (this.cancelled) break;
        this.on.chunk(u.id, i);
        if (ready === null) {
          // Nothing can say it: pace the transcript as if it were spoken.
          await new Promise((r) => setTimeout(r, Math.min(4000, 60 * u.chunks[i]!.length)));
          continue;
        }
        this.on.engine?.(ready.engine.kind);
        await ready.engine.play(ready.p, this.on.level);
      }
      this.on.done(u.id);
    }
    this.running = false;
    this.on.level(0);
    this.on.idle();
  }
}
