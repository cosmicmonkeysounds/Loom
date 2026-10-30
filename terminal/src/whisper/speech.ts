//! Spoken answers, the pure parts (wave 52): the WAV whisper.cpp reads, when
//! somebody has finished talking, and its answer read back as words.

export const WHISPER_URL = "http://127.0.0.1:8178";

/** Is whisper up? */
export async function whisperUp(fetchFn: typeof fetch = fetch, url = WHISPER_URL): Promise<boolean> {
  try {
    return (await fetchFn(`${url}/health`)).ok;
  } catch {
    return false;
  }
}

/** A 16-bit mono WAV of `samples` (-1 to 1). */
export function wavOf(samples: ArrayLike<number>, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  tag(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

export function rmsOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

/** The room's level is measured for this long before anyone can have spoken (ms):
 *  its quietest moment, because the button that started this clicks in it. */
export const FLOOR_MS = 300;
/** Speech is this many times the room's level, and never under `MIN_SPEECH`. */
export const SPEECH_OVER = 3;
export const MIN_SPEECH = 0.012;
/** Speech for this long counts as somebody talking (ms): a "no" does, a thud on the desk doesn't. */
export const SPEECH_MS = 250;
/** This much quiet after speech is the end of it (ms). */
export const QUIET_MS = 1400;
/** Nobody spoke for this long (ms). */
export const NOTHING_MS = 8000;
/** The longest answer (ms). */
export const MAX_MS = 20_000;

export type HearStep = "listening" | "finished" | "nothing";

/** Listens to levels and says when an answer has ended. */
export class EndOfSpeech {
  private at = 0;
  private floor = Infinity;
  private threshold: number | null = null;
  private loud = 0;
  private quiet = 0;
  heard = false;

  /** One buffer's level, `ms` long. */
  push(rms: number, ms: number): HearStep {
    this.at += ms;
    if (this.at <= FLOOR_MS) {
      this.floor = Math.min(this.floor, rms);
      return "listening";
    }
    this.threshold ??= Math.max(MIN_SPEECH, this.floor * SPEECH_OVER);
    if (rms >= this.threshold) {
      this.loud += ms;
      this.quiet = 0;
      if (this.loud >= SPEECH_MS) this.heard = true;
    } else {
      this.quiet += ms;
      if (!this.heard) this.loud = 0;
    }
    if (this.heard && this.quiet >= QUIET_MS) return "finished";
    if (!this.heard && this.at >= NOTHING_MS) return "nothing";
    return this.at >= MAX_MS ? "finished" : "listening";
  }
}

/**
 * whisper.cpp's text as an answer: one line, without what it hears that isn't
 * speech (`[BLANK_AUDIO]`, `(door closes)`, `*coughs*`). "" = nothing was said.
 */
export function cleanText(raw: string): string {
  const text = raw
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return /\p{L}/u.test(text) ? text : "";
}

/** What he says back (DRAFT w52). */
export function parrotLine(text: string): string {
  return `You said: ${/[.!?]$/u.test(text) ? text : `${text}.`} Is that right?`;
}

/** The prompt's words (DRAFT w52). */
export const VOICE_COPY = {
  speak: "SPEAK TO HIM",
  listening: "LISTENING — SPEAK NOW",
  done: "DONE",
  back: "B — BACK",
  thinking: "HEARING YOU…",
  said: "YOU SAID",
  yes: "YES — SAY IT",
  no: "NO — TRY AGAIN",
  nothing: "I HEARD NOTHING — TRY AGAIN",
  offline: "YOUR VOICE ISN'T REACHING HIM — TRY AGAIN",
  noMic: "NO MICROPHONE — TELL A TECHNICIAN",
} as const;
