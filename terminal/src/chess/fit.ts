//! The board's size on any screen (pure): the chess pane is measured
//! (`ChessTerminal.tsx` `useFit`) and the board takes the largest square
//! that fits, in whole-pixel squares so the grid lines stay crisp.

/** The board's border, both sides (`@loom/chess/board.css`: 2 px). */
export const BOARD_EDGE = 4;

/** The largest board (its border included) that fits w × h px; null when under 8 px a square. */
export function boardSide(w: number, h: number): number | null {
  const inner = Math.floor((Math.min(w, h) - BOARD_EDGE) / 8) * 8;
  return inner >= 64 ? inner + BOARD_EDGE : null;
}
