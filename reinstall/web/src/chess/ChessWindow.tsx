//! The modal game against the King — a Windows 98 window over the
//! simulation. Your move (tap a piece, tap a square) → the King thinks
//! (`pickMoveAsync` for the fight's stage) → your move … until checkmate
//! (`onResult("won")` fells him and closes the board). The King winning or
//! a draw is reported too (`onResult("lost" | "drawn")`) and deals a fresh
//! board at the same stage, the window still open (`redeals`). Each end is
//! shown for a beat first. 💡 Hint highlights a good move; Give up abandons
//! (nothing changes). Every tap calls `onActivity()` so the idle leash never ends a
//! game in progress. Lazy-loaded (`React.lazy` in Play.tsx) with chess.js.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Chess } from "chess.js";
import { redeals, STAGE_LINE, type Stage } from "../game/fight.ts";
import { ProgressBar, Window } from "../wizard.tsx";
import { hint as findHint, mulberry32, pickMoveAsync, PROFILES } from "./ai.ts";
import { Board } from "./Board.tsx";
import { bannerOf, newGame, outcome, play, targets, type Outcome, type Square } from "./rules.ts";

export interface ChessWindowProps {
  stage: Stage;
  label: string;
  armed: boolean | null;
  onResult: (r: Outcome) => void;
  onAbandon: () => void;
  onActivity: () => void;
  /** A piece landed (the clack). */
  onMove?: () => void;
  rng?: () => number;
}

/** How long the final position stays before the result is reported, ms. */
export const OVER_BEAT_MS = 1200;
/** The hint shows for this long, and can't be asked again for `HINT_COOLDOWN_MS`. */
export const HINT_SHOW_MS = 2000;
export const HINT_COOLDOWN_MS = 10_000;

type Status = { kind: "your-move" } | { kind: "thinking" } | { kind: "over"; outcome: Outcome };

export function ChessWindow({ stage, label, armed, onResult, onAbandon, onActivity, onMove, rng }: ChessWindowProps) {
  // A loss or a draw deals again: a new game, the same stage.
  const [deal, setDeal] = useState(0);
  const game = useMemo<Chess>(() => newGame(stage), [stage, deal]);
  const random = useMemo(() => rng ?? mulberry32(Date.now() >>> 0), [rng]);
  // chess.js mutates in place; `fen` is the render key.
  const [fen, setFen] = useState(() => game.fen());
  useEffect(() => setFen(game.fen()), [game]);
  const [status, setStatus] = useState<Status>({ kind: "your-move" });
  const [selected, setSelected] = useState<Square | null>(null);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [hintMove, setHintMove] = useState<{ from: Square; to: Square } | null>(null);
  const [hintReadyAt, setHintReadyAt] = useState(0);
  const [giveUp, setGiveUp] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const legal = useMemo(() => (selected === null ? [] : targets(game, selected)), [game, selected, fen]);

  const settle = (o: Outcome): void => {
    setStatus({ kind: "over", outcome: o });
    window.setTimeout(() => {
      if (!alive.current) return;
      onResult(o);
      if (!redeals(o)) return;
      setDeal((d) => d + 1);
      setSelected(null);
      setLastMove(null);
      setHintMove(null);
      setGiveUp(false);
      setStatus({ kind: "your-move" });
    }, OVER_BEAT_MS);
  };

  const kingMoves = async (): Promise<void> => {
    setStatus({ kind: "thinking" });
    const r = await pickMoveAsync(game.fen(), PROFILES[stage], random);
    if (!alive.current) return;
    if (r.move !== null) {
      try {
        game.move(r.move);
      } catch {
        /* a stale position: fall through to the outcome check */
      }
      setLastMove({ from: r.move.from, to: r.move.to });
      setFen(game.fen());
      onMove?.();
    }
    const o = outcome(game);
    if (o !== null) settle(o);
    else setStatus({ kind: "your-move" });
  };

  const onSquare = (sq: Square): void => {
    onActivity();
    if (status.kind !== "your-move") return;
    setHintMove(null);
    const piece = game.get(sq);
    if (selected !== null && legal.includes(sq)) {
      const m = play(game, selected, sq);
      setSelected(null);
      if (m === null) return;
      setLastMove({ from: m.from, to: m.to });
      setFen(game.fen());
      onMove?.();
      const o = outcome(game);
      if (o !== null) settle(o);
      else void kingMoves();
      return;
    }
    // Tap a piece of ours to pick it (tap it again to drop it).
    if (piece !== undefined && piece.color === "w") setSelected(selected === sq ? null : sq);
    else setSelected(null);
  };

  const askHint = (): void => {
    onActivity();
    const now = Date.now();
    if (status.kind !== "your-move" || now < hintReadyAt) return;
    const h = findHint(game.fen(), random);
    if (h.move === null) return;
    setHintMove({ from: h.move.from, to: h.move.to });
    setHintReadyAt(now + HINT_COOLDOWN_MS);
    window.setTimeout(() => alive.current && setHintMove(null), HINT_SHOW_MS);
  };

  const thinking = status.kind === "thinking";
  const over = status.kind === "over";
  return (
    <div className="chess-modal">
      <Window title={`Challenge — ${label}`} icon="♟" className="chess-window">
        <div className="chess-head">
          <span className="chess-stage">{STAGE_LINE[stage]}</span>
          {armed !== null && <span className={`chess-badge ${armed ? "armed" : "practice"}`}>{armed ? "ARMED" : "PRACTICE"}</span>}
        </div>
        <div className="chess-status" aria-live="polite">
          {over ? <b className={`chess-banner ${status.outcome}`}>{bannerOf(game, status.outcome)}</b> : thinking ? "THE KING IS THINKING…" : game.inCheck() ? "YOUR MOVE — CHECK" : "YOUR MOVE"}
        </div>
        <Board game={game} selected={selected} targets={legal} lastMove={lastMove} hint={hintMove} disabled={thinking || over} onSquare={onSquare} />
        {thinking && <ProgressBar value={0.5} />}
        <div className="w98-actions chess-actions">
          <button type="button" className="w98-button" onClick={askHint} disabled={thinking || over || Date.now() < hintReadyAt}>
            💡 Hint
          </button>
          <span className="spacer" />
          {giveUp ? (
            <>
              <span className="chess-confirm">Really? Nothing changes.</span>
              <button
                type="button"
                className="w98-button"
                onClick={() => {
                  onActivity();
                  onAbandon();
                }}
                disabled={over}
              >
                Yes, give up
              </button>
              <button
                type="button"
                className="w98-button"
                onClick={() => {
                  onActivity();
                  setGiveUp(false);
                }}
              >
                Keep playing
              </button>
            </>
          ) : (
            <button
              type="button"
              className="w98-button"
              onClick={() => {
                onActivity();
                setGiveUp(true);
              }}
              disabled={over}
            >
              Give up
            </button>
          )}
        </div>
      </Window>
    </div>
  );
}

export default ChessWindow;
