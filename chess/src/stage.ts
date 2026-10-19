//! The King's strength, read off his one shared health bar (wave 11: 15 HP
//! for the whole night, knocked down one point per hit in the
//! reinstallation games). Five stages, full = grandmaster … 0 = pawns only.
//! The door terminal reads the bar when it deals a board; the stage is the
//! AI profile (`PROFILES` in `ai.ts`) and the start position (`startFen`).

export type Stage = "grandmaster" | "club" | "beginner" | "dizzy" | "pawns";

export const STAGES: readonly Stage[] = ["grandmaster", "club", "beginner", "dizzy", "pawns"];

/** The stage for `hp` of `max`: `round(4·hp/max)` → 4 grandmaster … 0 pawns. */
export function stageFor(hp: number, max: number): Stage {
  const m = Math.max(1, max);
  const k = Math.round((4 * Math.max(0, Math.min(m, hp))) / m);
  return k >= 4 ? "grandmaster" : k === 3 ? "club" : k === 2 ? "beginner" : k === 1 ? "dizzy" : "pawns";
}

/** One line under the board saying how strong he is (information, never a tip). */
export const STAGE_LINE: Record<Stage, string> = {
  grandmaster: "The King is at full strength.",
  club: "The King is rattled.",
  beginner: "The King is reeling.",
  dizzy: "The King is dizzy — he can barely see the board.",
  pawns: "The King has lost his court. Pawns only.",
};
