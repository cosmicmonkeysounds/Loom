//! The casino terminal's session, screen by screen — pure (a reducer fed
//! events and timestamps; `CasinoTerminal.tsx` owns the timers, the sound
//! and the network):
//!
//!   attract  — THE CASINO, the three games and their odds, "Scan your pass".
//!   checking — a pass was scanned: who is it, what do they hold?
//!   seated   — a player at the casino: their balance, and either the lobby
//!              (`game: null` — pick a game) or a game's table (a stake, the
//!              picks, the last result). `betting` while the house rolls.
//!              The leash: `CASINO_IDLE_MS` with no touch cashes them out
//!              (nothing is lost: every bet already settled into their
//!              wallet), the countdown shown for the last `CASINO_WARN_MS`.
//!
//! The server rolls every bet (`POST /api/mod/casino/bet`): the terminal
//! never decides an outcome, it only draws what the house threw. A marked
//! program is refused at the scan, and so is one with no wallet (a story
//! with no currency).

import { CASINO_CHIPS, CASINO_MAX_STAKE, CASINO_MIN_STAKE, type CasinoGame } from "../../../core/src/casino.ts";
import { parseScan } from "../scan.ts";

/** No touch for this long cashes a player out. */
export const CASINO_IDLE_MS = 60_000;
/** The "Still there?" countdown shows for this last stretch. */
export const CASINO_WARN_MS = 15_000;
/** A notice (a refused pass, a refused bet) lasts this long. */
export const NOTICE_MS = 5_000;
/** The reels / the coin / the dice spin at least this long before the result shows. */
export const SPIN_MS = 1_100;

export const MARKED_NOTICE = "⛔ MARKED PROGRAMS CAN'T GAMBLE";
/** Wave 18: a program in the Internet is in the tent (the server refuses its bets too). */
export const CAPTURED_NOTICE = "⛔ YOU'RE IN THE INTERNET — GO TO THE TENT";

export interface Player {
  id: string;
  name: string;
  balance: number;
  /** The currency's name (`Truthcoin`). */
  unit: string;
}

/** One settled bet, as the house answered it. */
export interface BetResult {
  game: CasinoGame;
  pick: string;
  stake: number;
  roll: number[];
  payout: number;
  net: number;
}

export interface Notice {
  text: string;
  until: number;
}

export type CasinoSession =
  | { kind: "attract"; notice: Notice | null }
  | { kind: "checking"; id: string }
  | {
      kind: "seated";
      player: Player;
      game: CasinoGame | null;
      stake: number;
      /** The pick in flight (the house is rolling), or null. */
      betting: string | null;
      /** The last settled bet at this table (cleared when the game changes). */
      last: BetResult | null;
      /** This sitting's running total (coin won − coin lost). */
      net: number;
      bets: number;
      notice: Notice | null;
    };

export type CasinoEvent =
  | { type: "scan"; text: string; now: number }
  | { type: "typed"; id: string }
  | { type: "resolved"; player: Player & { restricted: boolean; captured?: boolean; wallet: boolean }; now: number }
  | { type: "refused"; text: string; now: number }
  | { type: "game"; game: CasinoGame | null }
  | { type: "stake"; stake: number }
  | { type: "bet"; pick: string }
  | { type: "settled"; result: BetResult; balance: number }
  /** A bet the house turned down (or never answered); `balance` when it is known. */
  | { type: "failed"; text: string; balance?: number; now: number }
  /** Cash out (the button, or the leash): back to attract. */
  | { type: "leave"; notice?: string; now?: number }
  | { type: "tick"; now: number };

export const INITIAL: CasinoSession = { kind: "attract", notice: null };

function notice(text: string, now: number): CasinoSession {
  return { kind: "attract", notice: { text, until: now + NOTICE_MS } };
}

/** The stake a table opens on: 5, or all a player holds below that. */
export function openingStake(balance: number): number {
  return clampStake(5, balance);
}

/** A stake within the house's limits and the player's balance (at least 1). */
export function clampStake(stake: number, balance: number): number {
  return Math.max(CASINO_MIN_STAKE, Math.min(Math.floor(stake), CASINO_MAX_STAKE, Math.max(CASINO_MIN_STAKE, balance)));
}

/** The chips a player can stake now (the ones their balance covers). */
export function chipsFor(balance: number): number[] {
  return CASINO_CHIPS.filter((c) => c <= Math.min(balance, CASINO_MAX_STAKE));
}

export function reduce(s: CasinoSession, e: CasinoEvent): CasinoSession {
  switch (e.type) {
    case "scan": {
      if (s.kind !== "attract") return s;
      const hit = parseScan(e.text);
      if (hit.kind === "guest") return { kind: "checking", id: hit.id };
      return notice(hit.kind === "wall" ? "THAT'S A WALL CODE — SHOW ME YOUR PASS" : "UNREADABLE — SHOW ME YOUR PASS", e.now);
    }
    case "typed":
      return s.kind === "attract" ? { kind: "checking", id: e.id } : s;
    case "resolved": {
      if (s.kind !== "checking" || e.player.id !== s.id) return s;
      if (e.player.restricted) return notice(MARKED_NOTICE, e.now);
      if (e.player.captured === true) return notice(CAPTURED_NOTICE, e.now);
      if (!e.player.wallet) return notice("THE HOUSE TAKES NO BETS TONIGHT — THIS STORY HAS NO CURRENCY", e.now);
      const { id, name, balance, unit } = e.player;
      return { kind: "seated", player: { id, name, balance, unit }, game: null, stake: openingStake(balance), betting: null, last: null, net: 0, bets: 0, notice: null };
    }
    case "refused":
      return s.kind === "checking" || s.kind === "attract" ? notice(e.text, e.now) : s;
    case "game":
      if (s.kind !== "seated" || s.betting !== null) return s;
      return { ...s, game: e.game, last: e.game === s.game ? s.last : null, stake: clampStake(s.stake, s.player.balance), notice: null };
    case "stake":
      if (s.kind !== "seated" || s.betting !== null) return s;
      return { ...s, stake: clampStake(e.stake, s.player.balance) };
    case "bet":
      if (s.kind !== "seated" || s.game === null || s.betting !== null) return s;
      if (s.player.balance < s.stake) return s;
      return { ...s, betting: e.pick, notice: null };
    case "settled": {
      if (s.kind !== "seated" || s.betting === null) return s;
      const player = { ...s.player, balance: e.balance };
      return { ...s, player, betting: null, last: e.result, net: s.net + e.result.net, bets: s.bets + 1, stake: clampStake(s.stake, e.balance) };
    }
    case "failed": {
      if (s.kind !== "seated") return s;
      const balance = e.balance ?? s.player.balance;
      return { ...s, player: { ...s.player, balance }, betting: null, stake: clampStake(s.stake, balance), notice: { text: e.text, until: e.now + NOTICE_MS } };
    }
    case "leave":
      if (s.kind !== "seated" && s.kind !== "checking") return s;
      return e.notice === undefined ? INITIAL : notice(e.notice, e.now ?? 0);
    case "tick":
      if (s.kind === "attract" && s.notice !== null && e.now >= s.notice.until) return INITIAL;
      if (s.kind === "seated" && s.notice !== null && e.now >= s.notice.until) return { ...s, notice: null };
      return s;
  }
}

/** The goodbye on the attract screen: how the sitting went. */
export function cashOutLine(s: Extract<CasinoSession, { kind: "seated" }>): string {
  const who = s.player.name.toUpperCase();
  if (s.bets === 0) return `SEE YOU NEXT TIME, ${who}`;
  const unit = s.player.unit.toUpperCase();
  if (s.net > 0) return `${who} WALKS AWAY ${s.net} ${unit} UP`;
  if (s.net < 0) return `${who} LEFT ${-s.net} ${unit} WITH THE HOUSE`;
  return `${who} BROKE EVEN`;
}

/** What a refused bet says on the table (the server's own words, shouted). */
export function betProblem(status: number | null, error: string): string {
  if (status === null) return "THE HOUSE DIDN'T ANSWER — CHECK YOUR WALLET BEFORE YOU BET AGAIN";
  if (status === 429) return "ONE BET AT A TIME";
  if (status === 401 || status === 403) return error === "" || error === "moderators only" ? "THIS TERMINAL LOST ITS ACCESS — TELL A HOST" : error.toUpperCase();
  if (status === 409 && error === "doors are closed") return "THE DOORS ARE CLOSED";
  if (status === 409 && error === "insufficient funds") return "NOT ENOUGH IN YOUR WALLET FOR THAT STAKE";
  return (error === "" ? `THE HOUSE SAID NO (HTTP ${status})` : error).toUpperCase();
}
