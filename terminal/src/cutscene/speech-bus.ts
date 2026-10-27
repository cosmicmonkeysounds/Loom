//! The TV's speech, for the cutscenes (wave 26, V1; contract C11). The TV
//! (`Tv.tsx`) says the character's lines; the cutscene layer lives in its
//! own lazy chunk beside it, so what the voice is doing travels here, the
//! mirror of `face-bus.ts` (scene → face). Base bundle: a few lines.
//!
//! Only lines the TV really speaks (`speak` mode) are on the bus: a muted,
//! song or text-only line never is, so a scene falls back to its own clock.
//! `at` is the server's clock (`serverNow`) when it happened. The bus keeps
//! the events of the last `SPEECH_RING_LINES` lines, so a scene that mounts
//! a little late still finds the line it voices.
//!
//! - `queued` — the TV took the line in (the poll that brought it) and will
//!   say it: its beat and how many sentences (`splitSentences`).
//! - `line` — it starts saying it (its first sentence), with each
//!   sentence's caption text (the written words, `captionChunks`).
//! - `chunk` — sentence `index` starts (0 too).
//! - `done` — it finished, or was cut (the mute, attract, an unmount:
//!   `cut` true, so a scene runs on from where it was, not to his end).

/** One thing the TV's voice did. */
export type SpeechEvent =
  | { kind: "queued"; seq: number; beat: string | null; chunks: number; at: number }
  | { kind: "line"; seq: number; beat: string | null; chunks: number; texts: readonly string[]; at: number }
  | { kind: "chunk"; seq: number; index: number; at: number }
  | { kind: "done"; seq: number; at: number; cut?: boolean };

/** The bus remembers this many lines (each with all its events). */
export const SPEECH_RING_LINES = 20;

type Listener = (e: SpeechEvent) => void;
const listeners = new Set<Listener>();
/** Each line's events, oldest line first. */
let ring: Array<{ seq: number; events: SpeechEvent[] }> = [];
let live = false;
let flat: readonly SpeechEvent[] | null = null;

/** A thing the TV's voice did (the TV calls this). */
export function emitSpeech(e: SpeechEvent): void {
  let slot = ring.find((r) => r.seq === e.seq);
  // A finished seq queued again is a new line (a story restart reuses seqs).
  if (slot !== undefined && e.kind === "queued" && slot.events.some((x) => x.kind === "done")) {
    ring = ring.filter((r) => r !== slot);
    slot = undefined;
  }
  if (slot === undefined) {
    slot = { seq: e.seq, events: [] };
    ring.push(slot);
    if (ring.length > SPEECH_RING_LINES) ring = ring.slice(ring.length - SPEECH_RING_LINES);
  }
  // One `done` per line is all the clock needs.
  if (e.kind === "done" && slot.events.some((x) => x.kind === "done")) return;
  slot.events.push(e);
  flat = null;
  for (const l of [...listeners]) {
    try {
      l(e);
    } catch {
      /* a scene that went away */
    }
  }
}

/** Every remembered event, oldest line first (a stable array until the next event). */
export function recentSpeech(): readonly SpeechEvent[] {
  return (flat ??= ring.flatMap((r) => r.events));
}

/** Hear every event; returns the unsubscribe. */
export function onSpeech(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Is a TV on this page able to say his lines right now (mounted, not muted,
 *  not on attract)? Off: no scene waits for a voice. */
export function setSpeechLive(on: boolean): void {
  live = on;
}

export function speechLive(): boolean {
  return live;
}

/** Forget the remembered lines (a story restart: its seqs start over). */
export function forgetSpeech(): void {
  ring = [];
  flat = null;
}

/** Forget everything, the live flag too (tests). */
export function clearSpeech(): void {
  forgetSpeech();
  live = false;
}
