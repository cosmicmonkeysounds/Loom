//! The board's quick tutorial (wave 43): three cards, how to move and how
//! to win. It opens by itself at a challenger's first game on this page and
//! again from ? HELP; SKIP (or PLAY on the last card) closes it. It is a
//! how-to, never a hint: no card suggests a move or names how strong the
//! King is. While it is up the leash is held.

// DRAFT w43: the tutorial's copy.

export type TutorialDemo = "drag" | "tap" | "win";

export interface TutorialStep {
  title: string;
  body: string;
  demo: TutorialDemo;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { title: "DRAG TO MOVE", body: "You are White. Press a piece and slide it. The dots show where it can go.", demo: "drag" },
  { title: "OR TAP, THEN TAP", body: "Tap a piece, then tap a dot. Tap the piece again to put it down.", demo: "tap" },
  { title: "CHECKMATE THE KING", body: "Trap his ♚ to win. A pawn that reaches the far side becomes a queen. Two minutes without a touch ends the game.", demo: "win" },
];

/** Does this challenger see the tutorial by itself? Once per guest per page. */
export function teachesFirst(taught: ReadonlySet<string>, guestId: string): boolean {
  return !taught.has(guestId);
}
