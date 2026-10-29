//! The King's chess board outside the server-room door (wave 11,
//! `view=chess`). A lazy chunk: chess.js + the board + the King's AI load
//! only on this one terminal. The screens are `session.ts`'s (pure); this
//! draws them, holds the board and the King's turn, and posts the result.
//!
//! Awake all night (it never follows the character's hidden / asleep: the
//! King is not Trabolta). The attract screen shows THE KING, his one shared
//! health bar (`n / 15` off the screen state's `king`) and the stakes line
//! (`king.armed`). A pass scan (or the typed fallback) deals one game at the
//! strength the bar has right then — no hints, no tips, a Give up. A piece
//! is dragged to its square or tapped then its dot tapped (`Board`); the
//! board is measured to fill the pane (a phone in portrait included). A
//! challenger's first game on this page opens the quick tutorial
//! (`Tutorial.tsx`, skippable; ? HELP opens it again). The King
//! thinks in 12 ms slices (`pickMoveAsync`), so a tap is answered at once on
//! the oldest tablet. The leash is 120 s with no touch, "Still there?" for
//! the last 20 s; it runs out silently. A game's end goes to the story as
//! `chess won | lost | drawn` (`post.ts`), and the result stays up ~10 s.
//!
//! No story slides, countdown corner or Y2K clock on this view (the app
//! layers it like a room terminal); an overlay (blackout / alarm) covers the
//! board but never ends the game — it holds the leash while it is up.

import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Board, PROFILES, type Chess, bannerOf, mulberry32, newGame, outcome, pickMoveAsync, play, type Outcome, type Square } from "@loom/chess";
import "@loom/chess/board.css";
import "./chess.css";
import type { TerminalConfig } from "../config.ts";
import type { ScreenKing, ScreenState } from "../screen.ts";
import { useIdleTimeout } from "../idle.ts";
import { Scanner, cameraProblem, type CameraState } from "../scanner.tsx";
import { Gear, TypedFallback } from "../controls.tsx";
import { SCAN_COPY } from "../idle-show/scan-copy.ts";
import { sfx } from "../sound/bus.ts";
import { Tutorial } from "./Tutorial.tsx";
import { teachesFirst } from "./tutorial.ts";
import { boardSide } from "./fit.ts";
import { ChallengerError, fetchChallenger, flushPendingChess, postChess } from "./post.ts";
import { CHESS_IDLE_MS, CHESS_WARN_MS, INITIAL, healthText, reduce, resultLine, settled, stakesLine, type ChessSession } from "./session.ts";

/** Give up asks twice: the second tap within this long gives up. */
const CONFIRM_MS = 3_000;

export function ChessTerminal({ config, state, polled, takeover, onSetup }: { config: TerminalConfig; state: ScreenState | null; polled: boolean; takeover: boolean; onSetup: () => void }) {
  const [s, dispatch] = useReducer(reduce, INITIAL);
  const king = state?.king ?? null;
  const kingRef = useRef<ScreenKing | null>(king);
  kingRef.current = king;
  const games = useRef(0);
  const [camera, setCamera] = useState<CameraState>("starting");
  const [typedOpen, setTypedOpen] = useState(false);

  // A result an earlier page left unsent (a reload mid-retry), once, fresh only.
  useEffect(() => {
    void flushPendingChess(config);
  }, [config]);

  // Notices clear and the result screen returns to attract on their own.
  const timed = (s.kind === "attract" && s.notice !== null) || settled(s);
  useEffect(() => {
    if (!timed) return;
    const t = window.setInterval(() => dispatch({ type: "tick", now: Date.now() }), 500);
    return () => window.clearInterval(t);
  }, [timed]);

  // --- a scanned pass: who is it, may they play? ---
  const checkingId = s.kind === "checking" ? s.id : null;
  useEffect(() => {
    if (checkingId === null) return;
    let alive = true;
    void fetchChallenger(config, checkingId).then(
      (guest) => alive && dispatch({ type: "resolved", guest, king: kingRef.current, game: ++games.current, now: Date.now() }),
      (e: unknown) => {
        if (!alive) return;
        const kind = e instanceof ChallengerError ? e.kind : "other";
        const text =
          kind === "unknown"
            ? "UNKNOWN PROGRAM — REGISTER ON YOUR PHONE FIRST"
            : kind === "access"
              ? "THIS TERMINAL LOST ITS ACCESS — TELL A HOST"
              : kind === "closed"
                ? "THE DOORS ARE CLOSED"
                : `CAN'T CHECK YOUR PASS — ${(e as Error).message.toUpperCase()}`;
        dispatch({ type: "refused", text, now: Date.now() });
      },
    );
    return () => {
      alive = false;
    };
  }, [checkingId, config]);

  // --- the board ---
  const board = useRef<Chess | null>(null);
  const [, redraw] = useState(0);
  const [last, setLast] = useState<{ from: Square; to: Square } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  /** The tutorial: opened by itself at a challenger's first game here, or from ? HELP. */
  const [tutorial, setTutorial] = useState<"first" | "help" | null>(null);
  const taught = useRef(new Set<string>());
  /** The game the board is dealt for (a King's move for an abandoned one never lands). */
  const dealt = useRef<number | null>(null);
  const game = s.kind === "playing" || s.kind === "over" ? s.game : null;
  const stage = s.kind === "playing" || s.kind === "over" ? s.stage : null;
  useEffect(() => {
    if (s.kind !== "playing" || dealt.current === s.game) return;
    dealt.current = s.game;
    board.current = newGame(s.stage);
    setLast(null);
    setThinking(false);
    setConfirm(false);
    const first = teachesFirst(taught.current, s.guest.id);
    taught.current.add(s.guest.id);
    setTutorial(first ? "first" : null);
    redraw((n) => n + 1);
  }, [s]);
  useEffect(() => {
    if (game === null) {
      dealt.current = null;
      board.current = null;
      setThinking(false);
      setTutorial(null);
    }
  }, [game]);

  const finish = useCallback(
    (gameId: number, guestId: string, result: Outcome) => {
      dispatch({ type: "ended", game: gameId, result });
      void postChess(config, result, guestId).then((post) => dispatch({ type: "posted", game: gameId, post, armed: kingRef.current?.armed ?? null, now: Date.now() }));
    },
    [config],
  );

  const kingTurn = useCallback(
    (g: Chess, gameId: number, guestId: string, st: NonNullable<typeof stage>) => {
      setThinking(true);
      const rng = mulberry32((Date.now() ^ (gameId * 2654435761)) >>> 0);
      void pickMoveAsync(g.fen(), PROFILES[st], rng).then((r) => {
        if (dealt.current !== gameId || board.current !== g) return; // abandoned meanwhile
        if (r.move !== null) {
          try {
            g.move(r.move);
            setLast({ from: r.move.from, to: r.move.to });
            sfx("click", { pitch: 0.8 });
          } catch {
            /* never: the move came from this position */
          }
        }
        setThinking(false);
        redraw((n) => n + 1);
        const o = outcome(g);
        if (o !== null) finish(gameId, guestId, o);
      });
    },
    [finish],
  );

  const onMove = (from: Square, to: Square) => {
    const g = board.current;
    if (s.kind !== "playing" || g === null || thinking || g.turn() !== "w") return;
    touch();
    setConfirm(false);
    const m = play(g, from, to);
    if (m === null) return;
    setLast({ from: m.from, to: m.to });
    sfx("click");
    redraw((n) => n + 1);
    const o = outcome(g);
    if (o !== null) finish(s.game, s.guest.id, o);
    else kingTurn(g, s.game, s.guest.id, s.stage);
  };

  // --- the leash: 120 s, held while the King thinks or an overlay is up ---
  const abandon = useCallback((why: "timeout" | "gave up") => {
    dealt.current = null;
    board.current = null;
    dispatch(why === "timeout" ? { type: "abandon", notice: "NO INPUT — THE GAME WAS ABANDONED", now: Date.now() } : { type: "abandon" });
  }, []);
  const playing = s.kind === "playing";
  const { touch, warning } = useIdleTimeout({ active: playing, busy: thinking || takeover || tutorial !== null, onTimeout: () => abandon("timeout"), limit: CHESS_IDLE_MS, warnMs: CHESS_WARN_MS });
  useEffect(() => {
    if (!playing) return;
    const on = () => touch();
    window.addEventListener("pointerdown", on);
    window.addEventListener("keydown", on);
    return () => {
      window.removeEventListener("pointerdown", on);
      window.removeEventListener("keydown", on);
    };
  }, [playing, touch]);
  useEffect(() => {
    if (!confirm) return;
    const t = window.setTimeout(() => setConfirm(false), CONFIRM_MS);
    return () => window.clearTimeout(t);
  }, [confirm]);

  const pane = useRef<HTMLElement>(null);
  const fit = useFit(pane, s.kind === "playing" || s.kind === "over");
  const g = board.current;
  const name = s.kind === "playing" || s.kind === "over" ? s.guest.name : null;
  const status =
    s.kind === "over"
      ? null
      : thinking
        ? "THE KING IS THINKING…"
        : g !== null && g.inCheck()
          ? "CHECK — YOUR MOVE"
          : "YOUR MOVE";

  return (
    <div className={`terminal chess ${s.kind}${warning !== null && playing ? " warning" : ""}`} data-stage={stage ?? undefined}>
      <header className="bar">
        <span className="bar-left">
          <span className="dot" data-on={String(polled)} />
          {config.title ? `${config.title} · ` : ""}TERMINAL {config.name.toUpperCase()}
        </span>
        <span className="bar-mid">THE KING</span>
        <span className="bar-right">
          {name !== null && <span className="pilot">CHALLENGER: {name.toUpperCase()}</span>}
          {!playing && s.kind !== "over" && <Gear onOpen={onSetup} label="Set up this terminal" />}
        </span>
      </header>

      {s.kind === "attract" || s.kind === "checking" ? (
        <main className="chess-attract">
          <section className="king-card">
            <div className="king-glyph" aria-hidden="true">
              ♚
            </div>
            <div className="king-title">THE KING</div>
            <HealthBar king={king} />
            {stakesLine(king?.armed) !== null && <div className="king-stakes">{stakesLine(king?.armed)}</div>}
          </section>
          <section className="line-pane">
            {s.kind === "checking" ? (
              <div className="attract">
                <div className="big blink">CHECKING YOUR PASS…</div>
              </div>
            ) : state === null ? (
              <div className="attract">
                <div className="big blink">CONNECTING TO THE HOUSE…</div>
              </div>
            ) : (
              <div className="attract">
                <div className="scan-frame">
                  <Scanner facing={config.camera} active={!takeover} onCode={(text) => dispatch({ type: "scan", text, now: Date.now() })} onState={setCamera} />
                </div>
                <div className="attract-text">
                  <div className="big">SCAN YOUR PASS TO CHALLENGE HIM</div>
                  <div className="small">{SCAN_COPY.hint}</div>
                  {cameraProblem(camera) !== null && <div className="small problem">{cameraProblem(camera)}</div>}
                  <button className="link typed-link" onClick={() => setTypedOpen((o) => !o)}>
                    no camera? type your program name
                  </button>
                  {typedOpen && (
                    <TypedFallback
                      config={config}
                      onPick={(id) => {
                        setTypedOpen(false);
                        dispatch({ type: "typed", id });
                      }}
                      onProblem={(text) => dispatch({ type: "refused", text, now: Date.now() })}
                    />
                  )}
                </div>
              </div>
            )}
          </section>
        </main>
      ) : (
        <main className="chess-stage">
          <section ref={pane} className="chess-board-pane" data-fit={fit !== null ? "" : undefined} style={fit !== null ? ({ "--chess-fit": `${fit}px` } as CSSProperties) : undefined}>
            {g !== null && <Board game={g} lastMove={last} disabled={s.kind !== "playing" || thinking || tutorial !== null} onMove={onMove} />}
          </section>
          <section className="chess-side">
            <div className="chess-vs">
              <span>{(name ?? "").toUpperCase()}</span>
              <span className="small"> vs </span>
              <span>THE KING</span>
            </div>
            <HealthBar king={king} />
            {s.kind === "playing" && (
              <>
                <div className={`chess-status${thinking ? " blink" : ""}`}>{status}</div>
                <div className="chess-actions">
                  <button type="button" className="chess-help" onClick={() => setTutorial("help")}>
                    ? HELP
                  </button>
                  <button
                    type="button"
                    className={`chess-giveup${confirm ? " confirm" : ""}`}
                    onClick={() => {
                      if (confirm) abandon("gave up");
                      else setConfirm(true);
                    }}
                  >
                    {confirm ? "TAP AGAIN TO GIVE UP" : "GIVE UP"}
                  </button>
                </div>
              </>
            )}
            {s.kind === "over" && (
              <>
                <div className={`chess-banner ${s.result}`}>{g !== null ? bannerOf(g, s.result) : s.result.toUpperCase()}</div>
                <div className={`chess-result${s.post === "sending" ? " blink" : ""}`}>{resultLine(s)}</div>
              </>
            )}
          </section>
        </main>
      )}

      {s.kind === "attract" && s.notice !== null && <div className="flash">{s.notice.text}</div>}
      {playing && tutorial !== null && <Tutorial help={tutorial === "help"} onClose={() => setTutorial(null)} />}
      {playing && warning !== null && <div className="leash">STILL THERE? {warning} — TOUCH THE SCREEN TO KEEP PLAYING</div>}
      <div className="scanlines" aria-hidden="true" />
    </div>
  );
}

/**
 * The board's side in px: the pane's content box, the smaller of its width
 * and height, rounded down to whole squares (null until measured, or with
 * no ResizeObserver: the CSS fallback sizes it then). Measured, not `vh`:
 * a phone's browser bars make `100vh` taller than the screen.
 */
function useFit(pane: RefObject<HTMLElement | null>, on: boolean): number | null {
  const [side, setSide] = useState<number | null>(null);
  useEffect(() => {
    const node = pane.current;
    if (!on || node === null || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const cs = window.getComputedStyle(node);
      const w = node.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = node.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const next = boardSide(w, h);
      setSide((was) => (was === next ? was : next));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    measure();
    return () => ro.disconnect();
  }, [pane, on]);
  return side;
}

/** The King's one shared health bar (information, not a hint). */
function HealthBar({ king }: { king: ScreenKing | null }) {
  const text = healthText(king);
  if (king === null || text === null) return null;
  const pct = Math.round((100 * king.hp) / Math.max(1, king.max));
  return (
    <div className={`king-health${king.fallen ? " fallen" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={king.max} aria-valuenow={king.hp} aria-label="the King's health">
      <div className="king-health-track">
        <div className="king-health-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="king-health-text">
        {king.fallen ? "HE KNEELS · " : ""}
        {text}
      </div>
    </div>
  );
}
