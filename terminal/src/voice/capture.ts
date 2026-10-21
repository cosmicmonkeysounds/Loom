//! The microphone → wire chunks (wave 19, D2 + D5): the room at the
//! context's rate, resampled to 16 kHz (`@loom/house` `Resampler`), cut
//! into 200 ms chunks, passed through the level gate, then μ-law.
//!
//! **Half-duplex in software.** Nothing on a tablet cancels its own speaker
//! out of its microphone (Web Audio and speech output are outside every
//! browser's echo canceller), so a terminal sends nothing while it is
//! making a sound itself — a player's voice, the character's speech, an
//! effect, a jingle, the chime — and for `VOICE_TAIL_MS` after: the caller
//! says when each ends (`quietUntil`), and the gate holds until then.
//!
//! Captured with a `ScriptProcessorNode` (Safari 14.0 has no AudioWorklet),
//! wired through a zero gain to the destination (Chrome fires
//! `onaudioprocess` only on a node that reaches it). It fires only while the
//! context runs, so capture starts with the page's first tap (or at once on
//! the TV's Chrome, which runs without one).

import { ChunkAssembler, Resampler, VOICE_RATE, VOICE_TAIL_MS, VoiceGate, mulawEncode, rmsDbfs } from "@loom/house";

/** The capture node's buffer (frames): ~85 ms at 48 kHz. */
export const CAPTURE_FRAMES = 4096;

/** Resample → chunk → gate → μ-law, one capture buffer at a time. Pure. */
export class MicPipeline {
  private readonly resampler: Resampler;
  private readonly chunks = new ChunkAssembler();
  private readonly gate = new VoiceGate<Float32Array>();

  constructor(readonly rate: number) {
    this.resampler = new Resampler(rate, VOICE_RATE);
  }

  /** This page makes a sound until `endMs` (its clock): send nothing until `VOICE_TAIL_MS` after it. */
  quietUntil(endMs: number): void {
    if (Number.isFinite(endMs)) this.gate.holdUntil(endMs + VOICE_TAIL_MS);
  }

  /** Whether the half-duplex hold is on at `now`. */
  holding(now: number): boolean {
    return this.gate.holding(now);
  }

  /** One capture buffer at `rate`, captured at `now` (ms) → the μ-law chunks to send. */
  push(input: ArrayLike<number>, now: number): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (const chunk of this.chunks.push(this.resampler.push(input))) {
      for (const c of this.gate.push(chunk, rmsDbfs(chunk), now)) out.push(mulawEncode(c));
    }
    return out;
  }

  /** The microphone stopped: forget the partial chunk and close the gate (the hold stands). */
  reset(): void {
    this.resampler.reset();
    this.chunks.reset();
    this.gate.reset();
  }
}

/** The slice of an `AudioContext` capture uses (tests hand in a fake). */
export type CaptureContext = Pick<AudioContext, "sampleRate" | "destination" | "createGain" | "createMediaStreamSource" | "createScriptProcessor">;

/**
 * Tap `stream` on `ctx`: every capture buffer (mono, the context's rate) to
 * `onFrames`. Returns the stopper. Throws when the context can't (the caller
 * reports it).
 */
export function startCapture(ctx: CaptureContext, stream: MediaStream, onFrames: (samples: Float32Array) => void, frames = CAPTURE_FRAMES): () => void {
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(frames, 1, 1);
  const zero = ctx.createGain();
  zero.gain.value = 0;
  proc.onaudioprocess = (e: AudioProcessingEvent) => {
    // Copied: the browser reuses the input buffer.
    onFrames(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  src.connect(proc);
  proc.connect(zero);
  zero.connect(ctx.destination);
  return () => {
    proc.onaudioprocess = null;
    for (const n of [src, proc, zero]) {
      try {
        n.disconnect();
      } catch {
        /* already */
      }
    }
  };
}
