//! The rules of the board — a thin, typed wrapper over chess.js (1.4,
//! BSD-2-Clause, pure JS: no `eval`, no wasm, no worker, so the tablet's
//! CSP is untouched). Everything the board UI and the AI touch is here, so
//! the rest of the game never sees chess.js's own API. The player is always
//! White; the King is Black.

import { Chess } from "chess.js";
import type { Color, Move, PieceSymbol, Square } from "chess.js";
import type { Stage } from "../game/fight.ts";

export type { Color, Move, PieceSymbol, Square };

/** From White's (the player's) side. */
export type Outcome = "won" | "lost" | "drawn";

/** chess.js's default position. */
export const START_FEN: string = new Chess().fen();
/** "Pawns only": the King keeps his eight pawns and nothing else (chess.js
 *  refuses pawns on the edge rows, so a back-rank piece can't become one). */
export const PAWNS_ONLY_FEN = "4k3/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQ - 0 1";

export function startFen(stage: Stage): string {
  return stage === "pawns" ? PAWNS_ONLY_FEN : START_FEN;
}

export function newGame(stage: Stage): Chess {
  return new Chess(startFen(stage));
}

/** The squares a piece on `from` may move to (promotions folded to one). */
export function targets(g: Chess, from: Square): Square[] {
  const out: Square[] = [];
  for (const m of g.moves({ square: from, verbose: true })) if (!out.includes(m.to)) out.push(m.to);
  return out;
}

/** Play `from → to` (a pawn reaching the last rank becomes a queen); null when illegal. */
export function play(g: Chess, from: Square, to: Square): Move | null {
  if (!targets(g, from).includes(to)) return null;
  try {
    return g.move({ from, to, promotion: "q" });
  } catch {
    return null;
  }
}

/** The game's end, if it has one: checkmate for / against the player, or a draw. */
export function outcome(g: Chess): Outcome | null {
  if (g.isCheckmate()) return g.turn() === "b" ? "won" : "lost";
  if (g.isStalemate() || g.isInsufficientMaterial() || g.isThreefoldRepetition() || g.isDrawByFiftyMoves() || g.isDraw()) return "drawn";
  return null;
}

export interface Cell {
  square: Square;
  piece: { type: PieceSymbol; color: Color } | null;
}

const FILES = "abcdefgh";

/** The 64 cells, a8 first (rank 8 left to right, then rank 7, …). */
export function board(g: Chess): Cell[] {
  const out: Cell[] = [];
  g.board().forEach((row, r) => {
    row.forEach((p, c) => {
      out.push({ square: `${FILES[c]}${8 - r}` as Square, piece: p === null ? null : { type: p.type, color: p.color } });
    });
  });
  return out;
}

export type Glyph = "wK" | "wQ" | "wR" | "wB" | "wN" | "wP" | "bK" | "bQ" | "bR" | "bB" | "bN" | "bP";

/** Unicode chess pieces. */
export const GLYPH: Record<Glyph, string> = {
  wK: "♔",
  wQ: "♕",
  wR: "♖",
  wB: "♗",
  wN: "♘",
  wP: "♙",
  bK: "♚",
  bQ: "♛",
  bR: "♜",
  bB: "♝",
  bN: "♞",
  bP: "♟",
};

export function glyphOf(color: Color, type: PieceSymbol): string {
  return GLYPH[`${color}${type.toUpperCase()}` as Glyph];
}

const NAMES: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

/** "e4, white pawn" / "e4, empty" — for screen readers. */
export function describe(cell: Cell): string {
  return cell.piece === null ? `${cell.square}, empty` : `${cell.square}, ${cell.piece.color === "w" ? "white" : "black"} ${NAMES[cell.piece.type]}`;
}
