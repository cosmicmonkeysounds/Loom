//! How a line is delivered to a phone (wave 13): the interrupt ladder a
//! story's `alerts:` world value picks (balloon → sticky → dialog → bsod),
//! the dialogue manners that make a line effect text, and the `~` prefix
//! that marks a broadcast as a per-person notice. Dependency-free: the play
//! app imports it by path (`../../core/src/delivery.ts`), so nothing here
//! may reach `node:*`, `server/*` or the sim.

/** The interrupt ladder, low → high (D2). */
export type AlertLevel = "balloon" | "sticky" | "dialog" | "bsod";
export const ALERT_LEVELS: readonly AlertLevel[] = ["balloon", "sticky", "dialog", "bsod"];
export const DEFAULT_ALERT_LEVEL: AlertLevel = "sticky";

/** A world value as written (`display()` output, quotes allowed) → its level; anything else → "sticky". Case-insensitive. */
export function alertLevelOf(_raw: string | null | undefined): AlertLevel {
  throw new Error("w13: not yet");
}

/** One rung lower, floored at "balloon" (a minor moment). */
export function lowerRung(_level: AlertLevel): AlertLevel {
  throw new Error("w13: not yet");
}

/** Dialogue manners that make a line effect text (folded, any word of the manner matches). */
export const EFFECT_MANNERS: ReadonlySet<string> = new Set([
  "glitch",
  "glitching",
  "glitched",
  "static",
  "corrupted",
  "corrupt",
  "scream",
  "screaming",
  "screams",
  "distorted",
  "garbled",
  "error",
  "flicker",
  "flickering",
  "bsod",
]);

/** Does this manner mark effect text? "quietly", "whispering", "weakly" → false; "glitch", "quietly, glitching" → true. */
export function isEffectManner(_manner: string | null | undefined): boolean {
  throw new Error("w13: not yet");
}

/** `~` at the start of a broadcast cue (outside or just inside its quotes) marks a per-person notice. Mirrors chat.ts `splitAlert`. */
export function splitNotice(_rawCue: string): { cue: string; notice: boolean } {
  throw new Error("w13: not yet");
}

/** A notice's collapse key: its leading emoji / symbol cluster (`✅`, `🤷`, `🎀`), else "•". */
export function noticeKey(_text: string): string {
  throw new Error("w13: not yet");
}

/** Moment classes the server stamps (§2.3). */
export type MomentClass = "major" | "minor";
