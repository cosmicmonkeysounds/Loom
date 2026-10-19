//! The 8×8 board — pure presentation, tap-tap moves (no drag: the door
//! terminal's tablet has a coarse pointer). No hint highlight: the King is
//! played with no help. White (the player) at the bottom; pieces
//! are Unicode glyphs on a classic brown / cream board.

import { board, describe, glyphOf, type Cell, type Square } from "./rules.ts";
import type { Chess } from "chess.js";

export interface BoardProps {
  game: Chess;
  selected: Square | null;
  targets: readonly Square[];
  lastMove: { from: Square; to: Square } | null;
  disabled: boolean;
  onSquare: (sq: Square) => void;
}

export function Board({ game, selected, targets, lastMove, disabled, onSquare }: BoardProps) {
  const cells = board(game);
  return (
    <div className="board" role="grid" aria-label="chess board">
      {cells.map((cell, i) => (
        <BoardSquare
          key={cell.square}
          cell={cell}
          dark={((i % 8) + Math.floor(i / 8)) % 2 === 1}
          selected={selected === cell.square}
          target={targets.includes(cell.square)}
          last={lastMove !== null && (lastMove.from === cell.square || lastMove.to === cell.square)}
          disabled={disabled}
          onSquare={onSquare}
        />
      ))}
    </div>
  );
}

function BoardSquare({
  cell,
  dark,
  selected,
  target,
  last,
  disabled,
  onSquare,
}: {
  cell: Cell;
  dark: boolean;
  selected: boolean;
  target: boolean;
  last: boolean;
  disabled: boolean;
  onSquare: (sq: Square) => void;
}) {
  const cls = ["square", dark ? "dark" : "light", selected ? "selected" : "", target ? "target" : "", last ? "last" : ""].filter(Boolean).join(" ");
  return (
    <button type="button" role="gridcell" className={cls} aria-label={describe(cell)} aria-selected={selected} disabled={disabled} onClick={() => onSquare(cell.square)}>
      {cell.piece !== null && (
        <span className={`piece ${cell.piece.color === "w" ? "white" : "black"}`} aria-hidden="true">
          {glyphOf(cell.piece.color, cell.piece.type)}
        </span>
      )}
      {target && <span className="dot" aria-hidden="true" />}
    </button>
  );
}
