//! The run reset (wave 59) — pure. A player stuck on geometry holds R for
//! `RESET_HOLD_MS`: a bar fills, letting go empties it, and at the top the game
//! puts them back at the spawn with Gerald somewhere new. No video, no
//! training, no level, no penalty, no bonus. The VR port is `HoldMeter`
//! (`reinstall/vr/game/hold_meter.gd`), both triggers + A.

/** How long the key is held before the walk resets. */
export const RESET_HOLD_MS = 5000;

/** The key that holds it (a `KeyboardEvent.code`). */
export const RESET_KEY = "KeyR";

/** DRAFT w59 (UI copy): over the bar, and the notice once it has happened. */
export const RESET_HOLDING = "Keep holding R to go back to the start";
export const RESET_DONE = "Back at the start.";

/** A hold that fills over `ms`, once per press: it must be let go before it can fill again. */
export class HoldMeter {
  private since: number | null = null;
  private spent = false;

  constructor(private readonly ms: number = RESET_HOLD_MS) {}

  /** One frame: is it down now? Returns the fill, 0 to 1. */
  update(down: boolean, now: number): number {
    if (!down) {
      this.since = null;
      this.spent = false;
      return 0;
    }
    if (this.spent) return 0;
    if (this.since === null) this.since = now;
    return Math.min(1, (now - this.since) / this.ms);
  }

  /** The fill was acted on: nothing more until it is let go. */
  spend(): void {
    this.spent = true;
    this.since = null;
  }
}

/** The element a key event came from, through a shadow root (the tent laptop's): at the window `target` is only the host. */
export function keyTarget(e: Pick<Event, "target"> & Partial<Pick<Event, "composedPath">>): unknown {
  return e.composedPath?.()[0] ?? e.target;
}

/** Is that somewhere text is being typed? */
export function typingIn(target: unknown): boolean {
  const t = target as { tagName?: string; isContentEditable?: boolean } | null;
  return t !== null && t !== undefined && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable === true);
}
