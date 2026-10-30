//! Hearing an answer (wave 52): the webcam's microphone → 16 kHz → the local
//! whisper.cpp (`scripts/server-room/start-whisper.ps1`) → text. The audio
//! stays on this computer. https may fetch 127.0.0.1, once this site has
//! Chrome's device-access grant (`docs/trapped/kiosk.md`).

import { Resampler, VOICE_RATE } from "@loom/house";
import { startCapture } from "../voice/capture.ts";
import { mic } from "../voice/mic.ts";
import { EndOfSpeech, WHISPER_URL, cleanText, rmsOf, wavOf } from "./speech.ts";

/** A long answer takes whisper a few seconds on this CPU; this is a dead server (ms). */
export const WHISPER_TIMEOUT_MS = 20_000;
/** Names it would otherwise spell wrong. */
const WHISPER_PROMPT = "Trabolta, Clippy, Halifax.";

/** The words in a recording, "" if none; rejects if whisper can't be reached. */
export async function transcribe(wav: Uint8Array, fetchFn: typeof fetch = fetch, url = WHISPER_URL): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "answer.wav");
  form.append("response_format", "json");
  form.append("language", "en");
  form.append("prompt", WHISPER_PROMPT);
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), WHISPER_TIMEOUT_MS);
  try {
    const res = await fetchFn(`${url}/inference`, { method: "POST", body: form, signal: stop.signal });
    if (!res.ok) throw new Error(`whisper said ${res.status}`);
    const body = (await res.json()) as { text?: unknown };
    return cleanText(typeof body.text === "string" ? body.text : "");
  } finally {
    clearTimeout(timer);
  }
}

export interface Recording {
  /** End it now, keeping what was said (A, while listening). */
  finish(): void;
  /** End it, keeping nothing. */
  cancel(): void;
  /** The WAV, or null when nobody spoke. */
  done: Promise<Uint8Array | null>;
}

/** Record one answer off the microphone; rejects when there's no microphone. */
export async function record(onLevel: (rms: number) => void): Promise<Recording> {
  const stream = await mic.acquire();
  if (stream === null) {
    mic.release();
    throw new Error("no microphone");
  }
  const ctx = new AudioContext();
  await ctx.resume();
  const resampler = new Resampler(ctx.sampleRate, VOICE_RATE);
  const speech = new EndOfSpeech();
  const parts: Float32Array[] = [];
  let finished = false;
  let stopCapture = () => {};
  let settle: (wav: Uint8Array | null) => void = () => {};
  const done = new Promise<Uint8Array | null>((resolve) => {
    settle = resolve;
  });
  const end = (keep: boolean) => {
    if (finished) return;
    finished = true;
    stopCapture();
    void ctx.close();
    mic.release();
    if (!keep) return settle(null);
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    settle(wavOf(all, VOICE_RATE));
  };
  stopCapture = startCapture(ctx, stream, (frames) => {
    parts.push(resampler.push(frames));
    const rms = rmsOf(frames);
    onLevel(rms);
    const step = speech.push(rms, (frames.length / ctx.sampleRate) * 1000);
    if (step !== "listening") end(step === "finished");
  });
  return { finish: () => end(true), cancel: () => end(false), done };
}
