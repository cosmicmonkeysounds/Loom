//! How a finger (or a mouse) moves a piece — pure, so it tests without a
//! DOM. `Board.tsx` feeds it the board's rectangle and pointer points.
//!
//! Two ways to move, both always on:
//!
//!   drag — press a piece, slide it, let go on a square. The legal squares
//!          show as dots the moment the piece is pressed. A drop anywhere
//!          else puts the piece back (still picked up, its dots still up).
//!   tap  — tap a piece, then tap one of its dots. Tapping the picked-up
//!          piece again puts it down; tapping elsewhere drops the pick.
//!
//! A press becomes a drag once it travels `DRAG_SLOP` px; less is a tap
//! (a shaky finger on a phone must still tap).

import type { Square } from "./rules.ts";

/** A press that travels this far (px) is a drag, not a tap. */
export const DRAG_SLOP = 6;

export interface BoardRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const FILES = "abcdefgh";

/** The square under a point (White at the bottom), or null off the board. */
export function squareAt(rect: BoardRect, x: number, y: number): Square | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const col = Math.floor(((x - rect.left) / rect.width) * 8);
  const row = Math.floor(((y - rect.top) / rect.height) * 8);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return `${FILES[col]}${8 - row}` as Square;
}

/** A square's column (0 = a) and row from the top (0 = rank 8). */
export function cellOf(sq: Square): { col: number; row: number } {
  return { col: FILES.indexOf(sq[0]!), row: 8 - Number(sq[1]) };
}

/** What the board asks of the game while a piece is handled. */
export interface Rules {
  /** May the player pick this square's piece up (theirs, their turn, a legal move)? */
  liftable(sq: Square): boolean;
  /** Where the piece on `sq` may go. */
  targets(sq: Square): readonly Square[];
}

export type Handled =
  | { kind: "move"; from: Square; to: Square }
  /** The picked-up piece after the gesture (null: none). */
  | { kind: "select"; selected: Square | null };

/** A press on `sq`: which piece is picked up while the finger is down. */
export function onPress(selected: Square | null, sq: Square, rules: Rules): Square | null {
  if (selected !== null && rules.targets(selected).includes(sq)) return selected; // about to tap a dot
  return rules.liftable(sq) ? sq : selected;
}

/** A tap (press + release with no drag) on `sq`; `before` is the pick before the press. */
export function onTap(before: Square | null, sq: Square, rules: Rules): Handled {
  if (before !== null && rules.targets(before).includes(sq)) return { kind: "move", from: before, to: sq };
  if (before === sq) return { kind: "select", selected: null };
  return { kind: "select", selected: rules.liftable(sq) ? sq : null };
}

/** A drag of the piece from `from`, let go over `over` (null: off the board). */
export function onDrop(from: Square, over: Square | null, rules: Rules): Handled {
  if (over !== null && over !== from && rules.targets(from).includes(over)) return { kind: "move", from, to: over };
  return { kind: "select", selected: from };
}

/** Has a press travelled far enough to be a drag? */
export function isDrag(x0: number, y0: number, x: number, y: number, slop = DRAG_SLOP): boolean {
  const dx = x - x0;
  const dy = y - y0;
  return dx * dx + dy * dy >= slop * slop;
}
