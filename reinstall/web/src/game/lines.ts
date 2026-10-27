//! What the story says inside the game (wave 26, C6 "In-game speech"): the
//! lines a moment's answer carries (`POST /api/spatial/moment` — the void,
//! the heart, the virus disk) are captioned one at a time in a Win98 caption
//! window and spoken by the device's own voice. Each holds for its reading
//! time (or as long as the voice takes, capped), with `IN_GAME_LINE_GAP_MS`
//! between lines. The caption shows the display text; the voice says the
//! pronounced one (`pronounce`, the shared table, C10). While a line plays
//! the game holds its own mic (`speaking`), so the terminals never hear it.
//! A voice that runs past the cap, or never gets the page's voice floor, is
//! cut — never left queued to be said later under another line's caption.
//!
//! `LinePlayer` is the timing, every effect injected (node-tested);
//! `deviceSpeaker()` is the browser half — the terminal's device voice
//! ladder (`@loom/terminal/speech/engine.ts`: speechSynthesis → Fully →
//! silent), sharing the page's voice floor, so on the tent laptop the game
//! never talks over the terminal around it.

import { DeviceEngine, LINE_GAP_MS, readingMs, SpeechQueue, voiceFloor } from "@loom/terminal/speech/engine.ts";
import type { SpeechEngine, VoiceFloor } from "@loom/terminal/speech/engine.ts";
import { pronounce } from "@loom/terminal/speech/lexicon.ts";
import { CHARACTER_VOICE } from "@loom/terminal/speech/pick-voice.ts";
import { splitSentences } from "@loom/terminal/speech/split.ts";
import type { MomentLine } from "../api.ts";

/** The pause between two in-game lines (ms): the terminal's `LINE_GAP_MS` (C11). */
export const IN_GAME_LINE_GAP_MS = LINE_GAP_MS;

/** A voice that never ends is cut after this (ms) from when it started: a
 *  caption never wedges, and the voice never outlasts its caption. */
export const LINE_SPEAK_CAP_MS = 12_000;

/** A line whose voice has not started after this (ms) — the page's voice
 *  floor held elsewhere, say an announcement on the tent laptop — is cut
 *  before it starts and only captioned, so it is never said later under
 *  another line's caption. */
export const LINE_START_WAIT_MS = 8_000;

// --- the pronunciation table (C10) ---------------------------------------------

/** What the voice says for `text` (C10): the terminal's own `pronounce`
 *  (`speech/lexicon.ts`, the shared `pronounce.json`: whole words, ASCII
 *  case folding, the longest word first). Display text never passes
 *  through it. `SpeechQueue.prepare` applies it again at the engine, which
 *  changes nothing: the table's output is a fixed point. */
export { pronounce };
export type { PronounceTable } from "@loom/terminal/speech/lexicon.ts";

// --- the timing ----------------------------------------------------------------

export interface LinePlayerOptions {
  /** Say this (already pronounced) text; call `started` the moment the
   *  voice begins (the floor held); resolve when it is done or cut. */
  speak(text: string, started: () => void): Promise<void>;
  /** Cut the line being said or waiting to be (the cap, or a start that
   *  never came): nothing of it is said after its caption is gone. */
  cut(): void;
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
      // The reading time is the floor: a silent device still shows it that long.
      const shown = this.o.sleep(readingMs(line.text));
      let begin!: () => void;
      const begun = new Promise<"start">((r) => (begin = () => r("start")));
      const said = this.o.speak(pronounce(line.text), begin).then(
        () => "done" as const,
        () => "done" as const,
      );
      // The caption stays up while the voice waits for the floor and while it
      // speaks; a voice that never starts, or runs past the cap, is cut — so
      // the next caption never shows over this line's voice.
      const first = await Promise.race([begun, said, this.o.sleep(LINE_START_WAIT_MS).then(() => "late" as const)]);
      if (first === "late") this.o.cut();
      else if (first === "start" && (await Promise.race([said, this.o.sleep(LINE_SPEAK_CAP_MS).then(() => "cap" as const)])) === "cap") this.o.cut();
      await shown;
      if (g === this.gen) this.o.show(null);
    }
    // Two batches back to back keep the gap between them too.
    if (g === this.gen) await this.o.sleep(IN_GAME_LINE_GAP_MS);
  }
}

// --- the browser half ------------------------------------------------------------

export interface DeviceSpeaker {
  /** Say `text`; `started` fires when its first sentence begins (the floor
   *  held). Resolves when it has been said, or cut by `stop`. */
  speak(text: string, started?: () => void): Promise<void>;
  /** Cut what this speaker is saying or waiting to say — only its own
   *  utterance, never the terminal's around it. */
  stop(): void;
}

/** The device's own voice (the character's lean: male first), one queue on
 *  the page's voice floor. The engine and the floor are injectable (tests). */
export function deviceSpeaker(o: { engine?: SpeechEngine; floor?: VoiceFloor } = {}): DeviceSpeaker {
  const waiting = new Map<number, () => void>();
  const starting = new Map<number, () => void>();
  let next = 1;
  const queue = new SpeechQueue(
    { primary: o.engine ?? new DeviceEngine({ voice: "", speed: 1, prefer: CHARACTER_VOICE }), fallback: null },
    {
      level: () => {},
      chunk: (id, index) => {
        if (index !== 0) return;
        starting.get(id)?.();
        starting.delete(id);
      },
      done: (id) => {
        starting.delete(id);
        waiting.get(id)?.();
        waiting.delete(id);
      },
      idle: () => {},
    },
    o.floor ?? voiceFloor,
  );
  return {
    speak(text: string, started?: () => void): Promise<void> {
      const chunks = splitSentences(text);
      if (chunks.length === 0) return Promise.resolve();
      const id = next++;
      return new Promise<void>((resolve) => {
        waiting.set(id, resolve);
        if (started !== undefined) starting.set(id, started);
        queue.say({ id, chunks });
      });
    },
    stop(): void {
      // A cut line still waiting for the floor is dropped when it gets it
      // (the queue's generation moved on): it is never said late.
      queue.stop();
      starting.clear();
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
