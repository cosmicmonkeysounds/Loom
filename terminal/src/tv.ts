//! The TV's room voice, the pure parts (OCT31 K-18 + N-04b). The house Mac
//! runs `view=tv` in Chrome full screen over the long HDMI: the character's
//! face, speaking every line it says in the TV's room (`The Desktop`), so his
//! presentations are heard and not only read.
//!
//! The screen poll (`screen.ts`) carries the room's new lines after this
//! screen's cursor. `planVoice` decides, per line:
//!
//! - **spoken** — said by the character (scripted, or a director's `say` as
//!   him: those have no beat), not muted, not on a song beat;
//! - **text only** — a song beat (`Song Ending`, `Sad Confession`, `The Hand
//!   Jive`: QLab plays the sung track, a TTS voice would talk over it), the
//!   director's mute, or a speaker who is lore and never voiced (Sandy, #28);
//! - **dropped** — any other character (the performers speak for themselves),
//!   and everything while the screen is on attract (the character hidden or
//!   asleep: fail closed, nothing of his is said early).
//!
//! A screen that just booted starts at the room's head (no backlog), and a
//! cursor past the head means the server restarted: it resyncs silently.
//! `LinePlayer` then plays the lines strictly in order — caption, speech (or
//! a reading pause for a text-only line) — so a Sandy line lands between the
//! Trabolta lines around it.

import { baseOf, type TerminalConfig } from "./config.ts";
import type { SpeechEvent } from "./cutscene/speech-bus.ts";
import type { ScreenState, ScreenVoice, VoiceLine } from "./screen.ts";

/** Beats whose lines are sung in the QLab track: captioned, never spoken. */
export const TV_SILENT_BEATS: readonly string[] = ["Song Ending", "Sad Confession", "The Hand Jive"];
/** Speakers shown as text on the TV, never voiced (Sandy is lore, decision #28). */
export const TV_TEXT_ONLY: readonly string[] = ["Sandy"];

/** Names compare like the story does: case, `_`, `-` and spaces folded. */
export function foldTvName(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/gu, " ").trim();
}

/** May a screen draw the character's nameplate? Only once the server says
 *  the character is out of hiding: no state, no character (before the doors)
 *  or a hidden one never shows the name (livetv-2). */
export function showsNameplate(state: Pick<ScreenState, "character"> | null): boolean {
  return state !== null && state.character !== null && state.character.hidden === false;
}

/**
 * (wave 58) May the TV show the mirror through attract? The TV keeps the
 * screensaver until he is introduced, but Clippy's "We can follow their
 * progress!" comes before that: the host's 📺 sets `Night.screen` to the mirror,
 * and a walker linked to this room then shows, full screen. Only before he is
 * revealed (a later attract, an ending's, keeps the screensaver), and never his
 * face: a hidden character is never drawn.
 */
export function mirrorBeforeHim(state: Pick<ScreenState, "character" | "night"> | null, attract: boolean, linked: boolean): boolean {
  return attract && linked && state?.night?.screen === "mirror" && state.character?.hidden === true;
}

export type TvLineMode = "speak" | "song" | "muted" | "text";

export interface TvLine extends VoiceLine {
  mode: TvLineMode;
}

export function isSilentBeat(beat: string | null): boolean {
  if (beat === null) return false;
  const b = foldTvName(beat);
  return TV_SILENT_BEATS.some((s) => foldTvName(s) === b);
}

/**
 * What to do with a poll's voice block. Returns the new cursor and the lines
 * to play (oldest first); `cursor` null = this screen has handled nothing yet.
 */
export function planVoice(
  voice: ScreenVoice,
  cursor: number | null,
  o: { character: string; muted: boolean; attract: boolean },
): { cursor: number; lines: TvLine[] } {
  if (cursor === null || voice.head < cursor) return { cursor: voice.head, lines: [] };
  const next = Math.max(cursor, voice.head);
  if (o.attract) return { cursor: next, lines: [] };
  const me = foldTvName(o.character);
  const textOnly = new Set(TV_TEXT_ONLY.map(foldTvName));
  const lines: TvLine[] = [];
  for (const l of voice.lines) {
    if (l.seq <= cursor) continue;
    const who = foldTvName(l.from);
    if (who === me) lines.push({ ...l, mode: isSilentBeat(l.beat) ? "song" : o.muted ? "muted" : "speak" });
    else if (textOnly.has(who)) lines.push({ ...l, mode: "text" });
  }
  return { cursor: next, lines };
}

/**
 * A room terminal's cursor while it sleeps (wave 7): it follows the room's
 * head, so the lines that arrive *with* the wake — the door cutscene, which
 * opens the room and speaks in it in one go — are after the cursor and are
 * spoken, never resynced away as backlog. Nothing is played while asleep.
 */
export function cursorWhileAsleep(voice: ScreenVoice, cursor: number | null): number {
  return planVoice(voice, cursor, { character: "", muted: true, attract: true }).cursor;
}

/** A gap this long between two answers means the TV was away (offline, asleep,
 *  a frozen tab): what it missed is stale, so it resyncs to the head rather
 *  than reading out minutes of backlog. */
export const TV_STALE_MS = 15_000;

/** The cursor to plan with: forgotten (→ resync) after a gap of `TV_STALE_MS`. */
export function cursorAfterGap(cursor: number | null, lastAt: number | null, at: number): number | null {
  return lastAt !== null && at - lastAt > TV_STALE_MS ? null : cursor;
}

/** How long a text-only line stays up before the next one (ms). */
export function readingMs(text: string): number {
  return Math.min(6000, Math.max(1800, 60 * text.length));
}

export interface LinePlayerIo {
  /** Put this line up as the caption (null clears it). */
  caption(line: TvLine | null): void;
  /** Say it; resolves when it has been said (or was cut). `started` is
   *  called when he begins it (its first sentence, after the queue's pause
   *  between lines): a `captionOnStart` player captions it then. */
  speak(line: TvLine, started: () => void): Promise<void>;
  /** Stop whatever is being said now (the pending `speak` must resolve). */
  cancel(): void;
  sleep(ms: number): Promise<void>;
  /** The player ran out of lines. */
  idle(): void;
}

/** What a `LinePlayer` tells the room-speech model (wave 25, `speech/said.ts`
 *  `RoomSpeech`): the spoken lines it queued, each it finished, a drop. */
export interface LinePlayerSpeech {
  queued(seqs: readonly number[]): void;
  finished(seq: number): void;
  cleared(): void;
}

/** Plays lines one at a time, in order. Only `speak` lines are reported to
 *  `speech`: a muted, song or text-only line is never spoken, so it counts
 *  as finished at once (its reading pause holds nothing back).
 *
 *  `captionOnStart` (the TV, wave 26 V1): a spoken line is captioned when
 *  he starts saying it, not when it is handed to the voice, so the
 *  caption never runs ahead of him through the pause between lines (the
 *  last line stays up meanwhile). */
export class LinePlayer {
  private pending: TvLine[] = [];
  private running = false;
  private gen = 0;
  constructor(
    private readonly io: LinePlayerIo,
    private readonly speech: LinePlayerSpeech | null = null,
    private readonly opts: { captionOnStart?: boolean } = {},
  ) {}

  get busy(): boolean {
    return this.running || this.pending.length > 0;
  }

  push(lines: readonly TvLine[]): void {
    if (lines.length === 0) return;
    this.pending.push(...lines);
    this.speech?.queued(lines.filter((l) => l.mode === "speak").map((l) => l.seq));
    if (!this.running) void this.run();
  }

  /** Drop everything queued and cut the line being said (the mute). */
  stop(): void {
    this.gen++;
    this.pending = [];
    this.io.cancel();
    this.speech?.cleared();
  }

  private async run(): Promise<void> {
    this.running = true;
    const g = this.gen;
    while (this.pending.length > 0 && g === this.gen) {
      const line = this.pending.shift()!;
      const onStart = line.mode === "speak" && this.opts.captionOnStart === true;
      if (!onStart) this.io.caption(line);
      if (line.mode === "speak") {
        let captioned = !onStart;
        const started = () => {
          if (captioned || g !== this.gen) return;
          captioned = true;
          this.io.caption(line);
        };
        try {
          await this.io.speak(line, started);
        } finally {
          if (g === this.gen) this.speech?.finished(line.seq);
        }
      } else await this.io.sleep(readingMs(line.text));
    }
    this.running = false;
    if (this.pending.length > 0) void this.run();
    else this.io.idle();
  }
}

/**
 * (wave 26, V1) What the TV's voice does, told to the cutscenes (the speech
 * bus, `cutscene/speech-bus.ts`) and to the poll (`RoomSpeech` → `sp=`).
 * Pure: the clock (`now`, server ms) and the outlets are injected. Only
 * `speak` lines are fed: a muted, song or text-only line never reaches it.
 */
export class TvSpeechFeed {
  private readonly lines = new Map<number, { beat: string | null; texts: readonly string[]; done: boolean }>();
  constructor(
    private readonly io: {
      emit(e: SpeechEvent): void;
      /** The server's clock now. */
      now(): number;
      /** The room speech the poll reports (`sp=`). */
      room?: { speaking(seq: number, chunk: number): void; spoke(seq: number): void } | null;
    },
  ) {}

  /** The TV took in a line it will say: its sentences' caption texts
   *  (`captionChunks`). A seq it already finished is a new line: room seqs
   *  start over when the story restarts (Run → Restart, Go live), and
   *  `planVoice` only hands a seq out again after such a resync. */
  queued(line: Pick<TvLine, "seq" | "beat" | "mode">, texts: readonly string[]): void {
    if (line.mode !== "speak" || texts.length === 0 || this.lines.get(line.seq)?.done === false) return;
    this.lines.delete(line.seq);
    this.lines.set(line.seq, { beat: line.beat, texts, done: false });
    this.io.emit({ kind: "queued", seq: line.seq, beat: line.beat, chunks: texts.length, at: this.io.now() });
    // Forget old lines (the bus keeps its own ring).
    if (this.lines.size > 64) for (const k of [...this.lines.keys()].slice(0, this.lines.size - 64)) this.lines.delete(k);
  }

  /** Sentence `index` of line `seq` starts (the queue's `chunk`). */
  chunk(seq: number, index: number): void {
    const l = this.lines.get(seq);
    if (l === undefined || l.done) return;
    const at = this.io.now();
    if (index === 0) this.io.emit({ kind: "line", seq, beat: l.beat, chunks: l.texts.length, texts: l.texts, at });
    this.io.emit({ kind: "chunk", seq, index, at });
    this.io.room?.speaking(seq, index);
  }

  /** Line `seq` is said (the queue's `done`), or was `cut`. */
  done(seq: number, cut = false): void {
    const l = this.lines.get(seq);
    if (l === undefined || l.done) return;
    l.done = true;
    this.io.emit(cut ? { kind: "done", seq, at: this.io.now(), cut: true } : { kind: "done", seq, at: this.io.now() });
    this.io.room?.spoke(seq);
  }

  /** Everything queued is dropped (the mute, attract, unmount): each line is
   *  done, cut. Call it before stopping the queue, so its own `done` for the
   *  line being said comes second (and is dropped). */
  cancelAll(): void {
    for (const seq of [...this.lines.keys()]) this.done(seq, true);
  }
}

/** Post the director's mute; resolves to the server's state (null on failure). */
export async function postVoiceMute(config: Pick<TerminalConfig, "eventId" | "token">, muted: boolean, fetchFn: typeof fetch = fetch): Promise<boolean | null> {
  try {
    const res = await fetchFn(`${baseOf(config)}/api/mod/screen/voice`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-loom-token": config.token },
      body: JSON.stringify({ muted }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { muted?: unknown };
    return typeof body.muted === "boolean" ? body.muted : null;
  } catch {
    return null;
  }
}
