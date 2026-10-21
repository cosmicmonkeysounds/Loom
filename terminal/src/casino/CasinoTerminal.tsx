//! The casino (wave 15, `view=casino`) — a terminal in the upstairs bedroom
//! where a program bets its own Truthcoin on three primitive games (the
//! coin, under / over 7, the one-armed bandit; `core/src/casino.ts`). A lazy
//! chunk; the screens are `session.ts`'s (pure), the calls `post.ts`'s.
//!
//! Awake all night like the King's board (it belongs to no room and speaks
//! for no character). A pass scan (or the typed fallback) seats the player:
//! their balance, the lobby, then a game's table — a stake chip, a pick, and
//! the house rolls. The server throws every die; this screen spins for
//! `SPIN_MS` and then shows what it threw. Every bet lands in the player's
//! own Wallet room on their phone at once, so cashing out (the button, or a
//! minute with no touch) loses nothing. An overlay (blackout / alarm) covers
//! the table and holds the leash.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import "./casino.css";
import type { TerminalConfig } from "../config.ts";
import type { ScreenState } from "../screen.ts";
import { useIdleTimeout } from "../idle.ts";
import { Scanner, cameraProblem, type CameraState } from "../scanner.tsx";
import { Gear, TypedFallback } from "../controls.tsx";
import { unlock } from "../speech/engine.ts";
import { playNotes } from "../sound/bus.ts";
import { CASINO_GAMES, CASINO_INFO, REEL, multiplier, pickLabel, rollText, type CasinoGame } from "../../../core/src/casino.ts";
import { ChallengerError, fetchPlayer, placeBet } from "./post.ts";
import { CASINO_IDLE_MS, CASINO_WARN_MS, INITIAL, SPIN_MS, betProblem, cashOutLine, chipsFor, reduce, type BetResult, type CasinoSession } from "./session.ts";

type Seated = Extract<CasinoSession, { kind: "seated" }>;

export function CasinoTerminal({ config, state, polled, takeover, onSetup }: { config: TerminalConfig; state: ScreenState | null; polled: boolean; takeover: boolean; onSetup: () => void }) {
  const [s, dispatch] = useReducer(reduce, INITIAL);
  const [camera, setCamera] = useState<CameraState>("starting");
  const [typedOpen, setTypedOpen] = useState(false);
  const seatedRef = useRef<Seated | null>(null);
  seatedRef.current = s.kind === "seated" ? s : null;

  // Notices clear on their own.
  const timed = (s.kind === "attract" || s.kind === "seated") && s.notice !== null;
  useEffect(() => {
    if (!timed) return;
    const t = window.setInterval(() => dispatch({ type: "tick", now: Date.now() }), 500);
    return () => window.clearInterval(t);
  }, [timed]);

  // --- a scanned pass: who is it, what do they hold? ---
  const checkingId = s.kind === "checking" ? s.id : null;
  useEffect(() => {
    if (checkingId === null) return;
    let alive = true;
    void fetchPlayer(config, checkingId).then(
      (player) => alive && dispatch({ type: "resolved", player, now: Date.now() }),
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

  // --- a bet: the house rolls; the screen spins at least SPIN_MS ---
  const bet = useCallback(
    (pick: string) => {
      const seat = seatedRef.current;
      if (seat === null || seat.game === null || seat.betting !== null || seat.player.balance < seat.stake) return;
      unlock();
      const game = seat.game;
      const started = Date.now();
      dispatch({ type: "bet", pick });
      void placeBet(config, seat.player.id, game, pick, seat.stake).then(async (answer) => {
        const wait = SPIN_MS - (Date.now() - started);
        if (wait > 0) await new Promise((r) => window.setTimeout(r, wait));
        if (answer.ok) {
          dispatch({ type: "settled", result: answer.result, balance: answer.balance });
          sound(answer.result.net > 0 ? (multiplier(game, pick, answer.result.roll) >= 10 ? "jackpot" : "win") : answer.result.net < 0 ? "lose" : "push");
          return;
        }
        // Not settled here: re-read the balance (a lost answer may still have landed).
        const balance = await fetchPlayer(config, seat.player.id).then(
          (p) => p.balance,
          () => undefined,
        );
        dispatch({ type: "failed", text: betProblem(answer.status, answer.error), balance, now: Date.now() });
      });
    },
    [config],
  );

  // --- the leash: a minute with no touch cashes out (held while the house rolls or an overlay is up) ---
  const seated = s.kind === "seated";
  const leave = useCallback((why: "timeout" | "cash out") => {
    const seat = seatedRef.current;
    const line = seat === null ? undefined : why === "timeout" ? `NO INPUT — ${cashOutLine(seat)}` : cashOutLine(seat);
    dispatch({ type: "leave", notice: line, now: Date.now() });
  }, []);
  const { touch, warning } = useIdleTimeout({ active: seated, busy: (s.kind === "seated" && s.betting !== null) || takeover, onTimeout: () => leave("timeout"), limit: CASINO_IDLE_MS, warnMs: CASINO_WARN_MS });
  useEffect(() => {
    if (!seated) return;
    const on = () => touch();
    window.addEventListener("pointerdown", on);
    window.addEventListener("keydown", on);
    return () => {
      window.removeEventListener("pointerdown", on);
      window.removeEventListener("keydown", on);
    };
  }, [seated, touch]);

  const player = s.kind === "seated" ? s.player : null;

  return (
    <div className={`terminal casino ${s.kind}${warning !== null && seated ? " warning" : ""}`}>
      <header className="bar">
        <span className="bar-left">
          <span className="dot" data-on={String(polled)} />
          {config.title ? `${config.title} · ` : ""}TERMINAL {config.name.toUpperCase()}
        </span>
        <span className="bar-mid">THE CASINO</span>
        <span className="bar-right">
          {player !== null && (
            <span className="pilot">
              {player.name.toUpperCase()} · {player.balance} {player.unit.toUpperCase()}
            </span>
          )}
          {!seated && <Gear onOpen={onSetup} label="Set up this terminal" />}
        </span>
      </header>

      {s.kind === "attract" || s.kind === "checking" ? (
        <main className="casino-attract">
          <section className="casino-marquee">
            <div className="casino-sign">
              <span className="bulbs" aria-hidden="true" />
              <div className="casino-title">CASINO</div>
              <div className="casino-sub">TRUTHCOIN TAKEN HERE</div>
            </div>
            <ul className="casino-menu">
              {CASINO_GAMES.map((g) => (
                <li key={g}>
                  <span className="casino-menu-title">{CASINO_INFO[g].title}</span>
                  <span className="casino-menu-odds">{CASINO_INFO[g].picks.map((p) => `${p.label} ${p.odds.replace(/^.*·\s*/u, "")}`).join(" · ")}</span>
                </li>
              ))}
            </ul>
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
                  <div className="big">SCAN YOUR PASS TO PLAY</div>
                  <div className="small">open the app · tap 🎟 Pass · hold it to the camera</div>
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
      ) : s.game === null ? (
        <Lobby s={s} onGame={(game) => dispatch({ type: "game", game })} onLeave={() => leave("cash out")} />
      ) : (
        <Table s={s} game={s.game} onStake={(stake) => dispatch({ type: "stake", stake })} onBet={bet} onBack={() => dispatch({ type: "game", game: null })} onLeave={() => leave("cash out")} />
      )}

      {(s.kind === "attract" || s.kind === "seated") && s.notice !== null && <div className="flash">{s.notice.text}</div>}
      {seated && warning !== null && <div className="leash">STILL THERE? {warning} — TOUCH THE SCREEN TO KEEP PLAYING</div>}
      <div className="scanlines" aria-hidden="true" />
    </div>
  );
}

// --- the lobby -------------------------------------------------------------------

function Lobby({ s, onGame, onLeave }: { s: Seated; onGame: (g: CasinoGame) => void; onLeave: () => void }) {
  const broke = s.player.balance < 1;
  return (
    <main className="casino-lobby">
      <div className="casino-balance">
        <span className="small">WELCOME, {s.player.name.toUpperCase()}</span>
        <span className="casino-coins">{s.player.balance}</span>
        <span className="small">{s.player.unit.toUpperCase()} IN YOUR WALLET</span>
      </div>
      {broke ? (
        <div className="casino-broke">YOU HAVE NOTHING TO BET. EARN SOME {s.player.unit.toUpperCase()} AND COME BACK.</div>
      ) : (
        <div className="casino-cabinets">
          {CASINO_GAMES.map((g) => (
            <button key={g} type="button" className={`casino-cabinet ${g}`} onClick={() => onGame(g)}>
              <span className="cabinet-art" aria-hidden="true">
                {g === "coin" ? "◉" : g === "dice" ? <Die n={5} /> : "7 7 7"}
              </span>
              <span className="cabinet-title">{CASINO_INFO[g].title}</span>
              <span className="cabinet-blurb">{CASINO_INFO[g].blurb}</span>
            </button>
          ))}
        </div>
      )}
      <button type="button" className="casino-leave" onClick={onLeave}>
        CASH OUT
      </button>
    </main>
  );
}

// --- a game's table ---------------------------------------------------------------

function Table({ s, game, onStake, onBet, onBack, onLeave }: { s: Seated; game: CasinoGame; onStake: (n: number) => void; onBet: (pick: string) => void; onBack: () => void; onLeave: () => void }) {
  const info = CASINO_INFO[game];
  const rolling = s.betting !== null;
  const last = s.last !== null && s.last.game === game ? s.last : null;
  const chips = chipsFor(s.player.balance);
  const short = s.player.balance < s.stake || s.player.balance < 1;
  return (
    <main className={`casino-table ${game}`}>
      <section className="casino-stage">
        <div className="casino-game-title">{info.title}</div>
        <Display game={game} rolling={rolling} last={last} />
        <ResultLine game={game} rolling={rolling} pick={s.betting} last={last} unit={s.player.unit} />
      </section>
      <section className="casino-side">
        <div className="casino-balance compact">
          <span className="casino-coins">{s.player.balance}</span>
          <span className="small">{s.player.unit.toUpperCase()}</span>
        </div>
        <div className="casino-stake">
          <span className="small">STAKE</span>
          <div className="chips">
            {chips.length === 0 ? (
              <span className="small">NOTHING TO STAKE</span>
            ) : (
              chips.map((c) => (
                <button key={c} type="button" className={`chip${c === s.stake ? " on" : ""}`} disabled={rolling} onClick={() => onStake(c)}>
                  {c}
                </button>
              ))
            )}
          </div>
        </div>
        <div className={`casino-picks n${info.picks.length}`}>
          {info.picks.map((p) => (
            <button key={p.id} type="button" className={`pick${s.betting === p.id ? " on" : ""}`} disabled={rolling || short} onClick={() => onBet(p.id)}>
              <span className="pick-label">{p.label}</span>
              <span className="pick-odds">{p.odds}</span>
            </button>
          ))}
        </div>
        <div className="casino-blurb small">{info.blurb}</div>
        <div className="casino-nav">
          <button type="button" className="casino-leave" disabled={rolling} onClick={onBack}>
            ◄ GAMES
          </button>
          <button type="button" className="casino-leave" disabled={rolling} onClick={onLeave}>
            CASH OUT
          </button>
        </div>
        {s.bets > 0 && (
          <div className={`casino-session small ${s.net > 0 ? "up" : s.net < 0 ? "down" : ""}`}>
            THIS SITTING: {s.net > 0 ? "+" : ""}
            {s.net} · {s.bets} {s.bets === 1 ? "BET" : "BETS"}
          </div>
        )}
      </section>
    </main>
  );
}

function ResultLine({ game, rolling, pick, last, unit }: { game: CasinoGame; rolling: boolean; pick: string | null; last: BetResult | null; unit: string }) {
  if (rolling) return <div className="casino-result blink">{game === "slots" ? "SPINNING…" : game === "coin" ? `${pickLabel(game, pick ?? "")}… FLIPPING` : `${pickLabel(game, pick ?? "")}… ROLLING`}</div>;
  if (last === null) return <div className="casino-result muted">PICK A STAKE · PLACE YOUR BET</div>;
  const what = rollText(game, last.roll);
  if (last.net > 0)
    return (
      <div className="casino-result won" key={`${last.roll.join()}-${last.payout}`}>
        {what} — YOU WIN {last.payout} {unit.toUpperCase()}!
      </div>
    );
  if (last.net === 0) return <div className="casino-result push">{what} — YOUR STAKE BACK</div>;
  return (
    <div className="casino-result lost">
      {what} — THE HOUSE WINS {last.stake}
    </div>
  );
}

// --- the coin, the dice, the reels -------------------------------------------------

/** A random frame while the house rolls (the screen's own; never the outcome). */
function useSpin(rolling: boolean, make: () => number[]): number[] | null {
  const [frame, setFrame] = useState<number[] | null>(null);
  const makeRef = useRef(make);
  makeRef.current = make;
  useEffect(() => {
    if (!rolling) {
      setFrame(null);
      return;
    }
    setFrame(makeRef.current());
    const t = window.setInterval(() => setFrame(makeRef.current()), 90);
    return () => window.clearInterval(t);
  }, [rolling]);
  return frame;
}

const rnd = (n: number) => Math.floor(Math.random() * n);

function Display({ game, rolling, last }: { game: CasinoGame; rolling: boolean; last: BetResult | null }) {
  const spin = useSpin(rolling, () => (game === "dice" ? [1 + rnd(6), 1 + rnd(6)] : game === "slots" ? [rnd(5), rnd(5), rnd(5)] : [rnd(2)]));
  const roll = spin ?? last?.roll ?? null;
  const tone = rolling || last === null ? "" : last.net > 0 ? " won" : last.net < 0 ? " lost" : " push";
  if (game === "coin") {
    const face = roll === null ? null : roll[0] === 2 ? "edge" : roll[0] === 0 ? "H" : "T";
    return (
      <div className={`casino-display coin${tone}`}>
        <div className={`coin-face${rolling ? " flipping" : ""}${face === "edge" ? " edge" : ""}`}>{face === "edge" ? "" : (face ?? "?")}</div>
        <div className="small">{face === "edge" ? "ON ITS EDGE" : face === "H" ? "HEADS" : face === "T" ? "TAILS" : "CALL IT"}</div>
      </div>
    );
  }
  if (game === "dice") {
    const [a, b] = roll ?? [6, 1];
    return (
      <div className={`casino-display dice${tone}${rolling ? " rolling" : ""}`}>
        <Die n={a ?? 1} />
        <Die n={b ?? 1} />
        <div className="dice-sum">{roll === null ? "?" : (a ?? 0) + (b ?? 0)}</div>
      </div>
    );
  }
  const reels = roll ?? [0, 0, 0];
  return (
    <div className={`casino-display slots${tone}`}>
      {reels.map((i, k) => (
        <div key={k} className={`reel${rolling ? " spinning" : ""}`}>
          <span className={`sym s${i}`}>{REEL[i] ?? "?"}</span>
        </div>
      ))}
    </div>
  );
}

/** Pip positions on a 3 × 3 grid, per face. */
const PIPS: Readonly<Record<number, readonly number[]>> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Die({ n }: { n: number }) {
  const on = PIPS[n] ?? [];
  return (
    <div className="die" role="img" aria-label={String(n)}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={on.includes(i) ? "pip" : "pip off"} />
      ))}
    </div>
  );
}

// --- sound ------------------------------------------------------------------------

/** A few square-wave notes on the sound bus: the arcade's own (silent until a tap unlocked audio). */
function sound(kind: "win" | "jackpot" | "lose" | "push"): void {
  const notes: Array<[number, number]> =
    kind === "jackpot"
      ? [
          [523, 0.09],
          [659, 0.09],
          [784, 0.09],
          [1047, 0.09],
          [784, 0.09],
          [1047, 0.09],
          [1319, 0.3],
        ]
      : kind === "win"
        ? [
            [523, 0.08],
            [659, 0.08],
            [784, 0.08],
            [1047, 0.22],
          ]
        : kind === "lose"
          ? [
              [196, 0.16],
              [147, 0.3],
            ]
          : [[440, 0.15]];
  playNotes(notes, { wave: "square", peak: 0.06, attack: 0.01 });
}
