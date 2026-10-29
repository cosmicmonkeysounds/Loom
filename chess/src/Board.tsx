//! The 8×8 board: drag a piece to a square, or tap a piece then tap a dot
//! (`drag.ts` decides; this draws it and reads the pointer). Built for a
//! phone first: the dragged piece is drawn bigger and lifted above the
//! finger, the square under the finger is ringed, and the page never
//! scrolls or zooms under a drag. A move made by tapping, and every one of
//! the King's, slides into place. No hint highlight: the dots are only the
//! picked-up piece's legal squares. White (the player) at the bottom;
//! pieces are Unicode glyphs on a classic brown / cream board.

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { board, describe, glyphOf, targets as targetsOf, type Cell, type Chess, type Square } from "./rules.ts";
import { cellOf, isDrag, onDrop, onPress, onTap, squareAt, type BoardRect, type Handled, type Rules } from "./drag.ts";

export interface BoardProps {
  game: Chess;
  lastMove: { from: Square; to: Square } | null;
  disabled: boolean;
  /** The player moved `from → to` (always a legal move). */
  onMove: (from: Square, to: Square) => void;
  /** The piece picked up when the board is first drawn (tests). */
  initialSelected?: Square | null;
}

/** A tap's click that follows a handled pointer release is ignored for this long. */
const CLICK_AFTER_POINTER_MS = 700;
/** The slide of a tapped move or one of the King's. */
const SLIDE_MS = 200;

interface Press {
  pointer: number;
  sq: Square;
  /** The pick before the press (a tap on it again puts it down). */
  before: Square | null;
  /** The piece this press may drag (null: a tap only). */
  lift: Square | null;
  x0: number;
  y0: number;
  rect: BoardRect;
  touch: boolean;
  dragging: boolean;
}

export function Board({ game, lastMove, disabled, onMove, initialSelected = null }: BoardProps) {
  const cells = board(game);
  const fen = game.fen();
  const [selected, setSelected] = useState<Square | null>(initialSelected);
  const [drag, setDrag] = useState<{ from: Square; over: Square | null } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const point = useRef({ x: 0, y: 0 });
  const lastPointerUp = useRef(0);
  /** The move the player just dropped (it lands where the finger left it: no slide). */
  const dropped = useRef<string | null>(null);

  const rules: Rules = {
    liftable: (sq) => {
      if (disabled || game.turn() !== "w") return false;
      const p = game.get(sq);
      return p !== undefined && p !== null && p.color === "w" && targetsOf(game, sq).length > 0;
    },
    targets: (sq) => targetsOf(game, sq),
  };

  // A new position or a locked board drops whatever was in hand.
  const seen = useRef({ fen, disabled });
  useEffect(() => {
    const was = seen.current;
    seen.current = { fen, disabled };
    if (was.fen === fen && (was.disabled || !disabled)) return;
    setSelected(null);
    setDrag(null);
    press.current = null;
  }, [fen, disabled]);

  // iOS Safari scrolls / rubber-bands under a touch unless its touchmove is cancelled.
  useEffect(() => {
    const node = el.current;
    if (node === null) return;
    const stop = (e: TouchEvent) => {
      if (press.current !== null && e.cancelable) e.preventDefault();
    };
    node.addEventListener("touchmove", stop, { passive: false });
    return () => node.removeEventListener("touchmove", stop);
  }, []);

  // A tapped move and every King's move slide from their square.
  const moveKey = lastMove === null ? null : `${lastMove.from}${lastMove.to}`;
  useLayoutEffect(() => {
    if (lastMove === null || moveKey === null) return;
    if (dropped.current === moveKey) {
      dropped.current = null;
      return;
    }
    slide(el.current, lastMove.from, lastMove.to);
  }, [moveKey, fen]);

  const apply = (h: Handled, viaDrop: boolean) => {
    if (h.kind === "move") {
      setSelected(null);
      if (viaDrop) dropped.current = `${h.from}${h.to}`;
      onMove(h.from, h.to);
    } else setSelected(h.selected);
  };

  const placeGhost = (p: Press) => {
    const g = ghost.current;
    if (g === null) return;
    const s = p.rect.width / 8;
    const lift = p.touch ? s * 0.55 : 0;
    const scale = p.touch ? 1.6 : 1.15;
    g.style.width = `${s}px`;
    g.style.height = `${s}px`;
    g.style.transform = `translate3d(${point.current.x - p.rect.left - s / 2}px, ${point.current.y - p.rect.top - s / 2 - lift}px, 0) scale(${scale})`;
  };
  useLayoutEffect(() => {
    if (drag !== null && press.current !== null) placeGhost(press.current);
  }, [drag !== null]);

  const innerRect = (node: HTMLDivElement): BoardRect => {
    const r = node.getBoundingClientRect();
    return { left: r.left + node.clientLeft, top: r.top + node.clientTop, width: node.clientWidth, height: node.clientHeight };
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    const node = el.current;
    if (node === null || disabled || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const rect = innerRect(node);
    const sq = squareAt(rect, e.clientX, e.clientY);
    if (sq === null) return;
    e.preventDefault();
    try {
      node.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    const held = onPress(selected, sq, rules);
    press.current = { pointer: e.pointerId, sq, before: selected, lift: held === sq ? sq : null, x0: e.clientX, y0: e.clientY, rect, touch: e.pointerType !== "mouse", dragging: false };
    point.current = { x: e.clientX, y: e.clientY };
    setSelected(held);
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p === null || e.pointerId !== p.pointer) return;
    point.current = { x: e.clientX, y: e.clientY };
    if (!p.dragging) {
      if (p.lift === null || !isDrag(p.x0, p.y0, e.clientX, e.clientY)) return;
      p.dragging = true;
    }
    const over = squareAt(p.rect, e.clientX, e.clientY);
    placeGhost(p);
    setDrag((d) => (d !== null && d.from === p.lift && d.over === over ? d : { from: p.lift!, over }));
  };

  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p === null || e.pointerId !== p.pointer) return;
    press.current = null;
    lastPointerUp.current = Date.now();
    setDrag(null);
    if (p.dragging && p.lift !== null) apply(onDrop(p.lift, squareAt(p.rect, e.clientX, e.clientY), rules), true);
    else apply(onTap(p.before, p.sq, rules), false);
  };

  const cancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p === null || e.pointerId !== p.pointer) return;
    press.current = null;
    setDrag(null);
  };

  // Keyboard (and screen readers): a square's own click is a tap.
  const click = (sq: Square) => {
    if (disabled || Date.now() - lastPointerUp.current < CLICK_AFTER_POINTER_MS) return;
    apply(onTap(selected, sq, rules), false);
  };

  const shown = selected !== null ? rules.targets(selected) : [];
  const held = drag !== null ? game.get(drag.from) : null;
  return (
    <div
      ref={el}
      className={`board${drag !== null ? " dragging" : ""}`}
      role="grid"
      aria-label="chess board"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {cells.map((cell, i) => (
        <BoardSquare
          key={cell.square}
          cell={cell}
          dark={((i % 8) + Math.floor(i / 8)) % 2 === 1}
          selected={selected === cell.square}
          target={shown.includes(cell.square)}
          last={lastMove !== null && (lastMove.from === cell.square || lastMove.to === cell.square)}
          lifted={drag !== null && drag.from === cell.square}
          over={drag !== null && drag.over === cell.square}
          disabled={disabled}
          onClick={click}
        />
      ))}
      {drag !== null && held !== undefined && held !== null && (
        <div ref={ghost} className={`ghost piece ${held.color === "w" ? "white" : "black"}`} aria-hidden="true">
          {glyphOf(held.color, held.type)}
        </div>
      )}
    </div>
  );
}

function BoardSquare({
  cell,
  dark,
  selected,
  target,
  last,
  lifted,
  over,
  disabled,
  onClick,
}: {
  cell: Cell;
  dark: boolean;
  selected: boolean;
  target: boolean;
  last: boolean;
  lifted: boolean;
  over: boolean;
  disabled: boolean;
  onClick: (sq: Square) => void;
}) {
  const cls = ["square", dark ? "dark" : "light", selected ? "selected" : "", target ? "target" : "", last ? "last" : "", over ? "over" : ""].filter(Boolean).join(" ");
  return (
    <button type="button" role="gridcell" className={cls} data-sq={cell.square} aria-label={describe(cell)} aria-selected={selected} disabled={disabled} onClick={() => onClick(cell.square)}>
      {cell.piece !== null && (
        <span className={`piece ${cell.piece.color === "w" ? "white" : "black"}${lifted ? " lifted" : ""}`} aria-hidden="true">
          {glyphOf(cell.piece.color, cell.piece.type)}
        </span>
      )}
      {target && <span className="dot" aria-hidden="true" />}
    </button>
  );
}

/** Slide the piece now on `to` in from `from` (skipped under reduced motion or without WAAPI). */
function slide(root: HTMLElement | null, from: Square, to: Square) {
  if (root === null || typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const square = root.querySelector<HTMLElement>(`[data-sq="${to}"]`);
  const piece = square?.querySelector<HTMLElement>(".piece");
  if (square === null || square === undefined || piece === null || piece === undefined || typeof piece.animate !== "function") return;
  const a = cellOf(from);
  const b = cellOf(to);
  const s = square.offsetWidth;
  const dx = (a.col - b.col) * s;
  const dy = (a.row - b.row) * s;
  // Old tablets centre the glyph with a transform of its own (board.css): keep it under the slide.
  const own = window.getComputedStyle(piece).transform;
  const base = own === "none" || own === "" ? "" : `${own} `;
  square.classList.add("arriving");
  const anim = piece.animate([{ transform: `${base}translate(${dx}px, ${dy}px)` }, { transform: `${base}translate(0px, 0px)` }], { duration: SLIDE_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  const done = () => square.classList.remove("arriving");
  anim.onfinish = done;
  anim.oncancel = done;
}
