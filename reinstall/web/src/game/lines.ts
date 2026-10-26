//! What the story says inside the game (wave 26, C6 "In-game speech"): the
//! lines a moment's answer carries (`POST /api/spatial/moment` — the void,
//! the heart, the virus disk) are captioned one at a time in a Win98 caption
//! window and spoken by the device's own voice. Each holds for its reading
//! time (or as long as the voice takes, capped), with `IN_GAME_LINE_GAP_MS`
//! between lines. The caption shows the display text; the voice says the
//! pronounced one (`pronounce`, the shared table, C10). While a line plays
//! the game holds its own mic (`speaking`), so the terminals never hear it.
//!
//! `LinePlayer` is the timing, every effect injected (node-tested);
//! `deviceSpeaker()` is the browser half — the terminal's device voice
//! ladder (`@loom/terminal/speech/engine.ts`: speechSynthesis → Fully →
//! silent), sharing the page's voice floor, so on the tent laptop the game
//! never talks over the terminal around it.

import table from "@loom/terminal/speech/pronounce.json";
import { DeviceEngine, readingMs, SpeechQueue } from "@loom/terminal/speech/engine.ts";
import { CHARACTER_VOICE } from "@loom/terminal/speech/pick-voice.ts";
import { splitSentences } from "@loom/terminal/speech/split.ts";
import type { MomentLine } from "../api.ts";

/** The pause between two in-game lines (ms) — the terminal's `LINE_GAP_MS`
 *  (C11), held here until the voice lane's constant is on master. */
export const IN_GAME_LINE_GAP_MS = 700;

/** A voice that never ends is cut after this (ms): a caption never wedges. */
export const LINE_SPEAK_CAP_MS = 12_000;

// --- the pronunciation table (C10) ---------------------------------------------

export interface PronounceTable {
  version: number;
  words: ReadonlyArray<{ word: string; say: string }>;
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9]/.test(c);

/**
 * What the voice says for `text` (C10): every whole-word, case-insensitive
 * match of a table `word` is replaced by its `say`, as written. A word
 * boundary is any character that is not `[A-Za-z0-9]` (so "Anti-Virus"
 * never matches "Antivirus", and the possessive "Antivirus'" does); the
 * longest word wins. No regex lookbehind (Chrome 87 / Safari 14). Display
 * text is never passed through this.
 */
export function pronounce(text: string, t: PronounceTable = table): string {
  const words = [...t.words].filter((w) => w.word !== "").sort((a, b) => b.word.length - a.word.length);
  if (words.length === 0) return text;
  const lower = text.toLowerCase();
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (!isWordChar(text[i - 1])) {
      const hit = words.find((w) => lower.startsWith(w.word.toLowerCase(), i) && !isWordChar(text[i + w.word.length]));
      if (hit !== undefined) {
        out += hit.say;
        i += hit.word.length;
        continue;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

// --- the timing ----------------------------------------------------------------

export interface LinePlayerOptions {
  /** Say this (already pronounced) text; resolves when the voice is done. */
  speak(text: string): Promise<void>;
  /** The caption: a line, or null to clear it. */
  show(line: MomentLine | null): void;
  sleep(ms: number): Promise<void>;
  /** A line is playing (true) / the queue went quiet (false): hold the mic. */
  speaking?(on: boolean): void;
}

/** Plays moment lines one at a time, in order; `play` queues behind what is playing. */
export class LinePlayer {
  private readonly o: LinePlayerOptions;
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private gen = 0;

  constructor(o: LinePlayerOptions) {
    this.o = o;
  }

  /** Something is playing or waiting. */
  get busy(): boolean {
    return this.pending > 0;
  }

  /** Queue `lines`; resolves when they (and everything queued before them) have played. */
  play(lines: readonly MomentLine[]): Promise<void> {
    const real = lines.filter((l) => l.text.trim() !== "");
    if (real.length === 0) return this.tail;
    const g = this.gen;
    if (this.pending++ === 0) this.o.speaking?.(true);
    const run = this.tail.then(() => this.run(real, g));
    this.tail = run.then(
      () => this.settle(),
      () => this.settle(),
    );
    return this.tail;
  }

  /** Drop everything (the session ended): what is queued never plays. */
  stop(): void {
    this.gen += 1;
    this.o.show(null);
  }

  private settle(): void {
    if (--this.pending === 0) this.o.speaking?.(false);
  }

  private async run(lines: readonly MomentLine[], g: number): Promise<void> {
    for (let i = 0; i < lines.length && g === this.gen; i++) {
      if (i > 0) await this.o.sleep(IN_GAME_LINE_GAP_MS);
      if (g !== this.gen) return;
      const line = lines[i]!;
      this.o.show(line);
      const said = this.o.speak(pronounce(line.text)).catch(() => {});
      const capped = Promise.race([said, this.o.sleep(LINE_SPEAK_CAP_MS)]);
      // The reading time is the floor: a silent device still shows it that long.
      await Promise.all([capped, this.o.sleep(readingMs(line.text))]);
      if (g === this.gen) this.o.show(null);
    }
    // Two batches back to back keep the gap between them too.
    if (g === this.gen) await this.o.sleep(IN_GAME_LINE_GAP_MS);
  }
}

// --- the browser half ------------------------------------------------------------

/** The device's own voice (the character's lean: male first), one queue on
 *  the page's voice floor. `speak` resolves when the text has been said. */
export function deviceSpeaker(): { speak(text: string): Promise<void>; stop(): void } {
  const waiting = new Map<number, () => void>();
  let next = 1;
  const queue = new SpeechQueue(
    { primary: new DeviceEngine({ voice: "", speed: 1, prefer: CHARACTER_VOICE }), fallback: null },
    {
      level: () => {},
      chunk: () => {},
      done: (id) => {
        waiting.get(id)?.();
        waiting.delete(id);
      },
      idle: () => {},
    },
  );
  return {
    speak(text: string): Promise<void> {
      const chunks = splitSentences(text);
      if (chunks.length === 0) return Promise.resolve();
      const id = next++;
      return new Promise<void>((resolve) => {
        waiting.set(id, resolve);
        queue.say({ id, chunks });
      });
    },
    stop(): void {
      queue.stop();
      for (const r of waiting.values()) r();
      waiting.clear();
    },
  };
}

/** From the gesture that starts the game (the Play here tap): a silent
 *  utterance, so the device voice may speak later unattended (Safari). */
export function primeSpeech(): void {
  try {
    if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch {
    /* no voice here: captions only */
  }
}
