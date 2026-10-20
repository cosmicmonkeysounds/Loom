//! The casino's games — pure, shared by the event server (which rolls and
//! settles every bet) and the casino terminal (`terminal/src/casino/`, which
//! only draws them). Three primitive games, each a bet on one pick:
//!
//!   coin   — THE COIN: heads or tails pays 2×. One flip in 20 lands on its
//!            edge, and the edge is the house's.            (return 95 %)
//!   dice   — UNDER / OVER 7: two dice. Under (2–6) or over (8–12) pays 2×,
//!            a seven pays 5×; a seven beats under and over. (return 83 %)
//!   slots  — THE ONE-ARMED BANDIT: three reels of `7 $ ★ ♦ ♣`, weighted
//!            1 2 3 4 6 of 16. Three of a kind pays 40 / 15 / 10 / 6 / 4×,
//!            two sevens 5×, the first two reels matching 2×, a lone seven
//!            gives the stake back.                          (return ≈ 97 %)
//!
//! A bet is `roll` (the dice the server threw, `rollFor`) + `settle` (what
//! it pays). The server journals both — the roll and the payout ride the
//! wallet's `bet` op — so a replay never rolls again and a later paytable
//! change never rewrites a settled bet. `payout` is everything handed back
//! (the stake included): 0 is a loss, `stake` a push.

export type CasinoGame = "coin" | "dice" | "slots";
export const CASINO_GAMES: readonly CasinoGame[] = ["coin", "dice", "slots"];

/** The smallest and largest stake the house takes on one bet. */
export const CASINO_MIN_STAKE = 1;
export const CASINO_MAX_STAKE = 50;
/** The stake chips the terminal offers. */
export const CASINO_CHIPS: readonly number[] = [1, 5, 10, 25, 50];

export interface CasinoPick {
  id: string;
  label: string;
  /** The pick's odds in a few words, shown under the button. */
  odds: string;
}

export interface CasinoGameInfo {
  id: CasinoGame;
  title: string;
  /** One line on the game's card. */
  blurb: string;
  picks: readonly CasinoPick[];
}

export const CASINO_INFO: Readonly<Record<CasinoGame, CasinoGameInfo>> = {
  coin: {
    id: "coin",
    title: "THE COIN",
    blurb: "Call it. Pays 2×. It lands on its edge 1 time in 20, and the edge is the house's.",
    picks: [
      { id: "heads", label: "HEADS", odds: "pays 2×" },
      { id: "tails", label: "TAILS", odds: "pays 2×" },
    ],
  },
  dice: {
    id: "dice",
    title: "UNDER / OVER 7",
    blurb: "Two dice. Under or over pays 2×, a seven pays 5×. A seven beats under and over.",
    picks: [
      { id: "under", label: "UNDER 7", odds: "2–6 · pays 2×" },
      { id: "seven", label: "SEVEN", odds: "7 · pays 5×" },
      { id: "over", label: "OVER 7", odds: "8–12 · pays 2×" },
    ],
  },
  slots: {
    id: "slots",
    title: "ONE-ARMED BANDIT",
    blurb: "Three reels. Three of a kind pays up to 40×, two 7s 5×, a pair on the left 2×, a lone 7 your stake back.",
    picks: [{ id: "pull", label: "PULL", odds: "7 7 7 pays 40×" }],
  },
};

/** The bandit's reel, in symbol order (index = what a slots roll holds). */
export const REEL: readonly string[] = ["7", "$", "★", "♦", "♣"];
/** How many of 16 stops each symbol takes on every reel. */
export const REEL_WEIGHTS: readonly number[] = [1, 2, 3, 4, 6];
/** Three of a kind pays, by symbol. */
export const THREE_PAYS: readonly number[] = [40, 15, 10, 6, 4];

/** The coin's faces (a coin roll holds one index). */
export const COIN_FACES = ["heads", "tails", "edge"] as const;
/** One flip in this many lands on its edge. */
export const COIN_EDGE_ONE_IN = 20;

/** An integer in [0, n) — `crypto.randomInt` on the server, anything in tests. */
export type CasinoRand = (n: number) => number;

export function isCasinoGame(v: unknown): v is CasinoGame {
  return typeof v === "string" && (CASINO_GAMES as readonly string[]).includes(v);
}

/** Is `pick` a pick of `game`? */
export function isPick(game: CasinoGame, pick: string): boolean {
  return CASINO_INFO[game].picks.some((p) => p.id === pick);
}

function reelStop(rand: CasinoRand): number {
  const total = REEL_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rand(total);
  for (let i = 0; i < REEL_WEIGHTS.length; i++) {
    r -= REEL_WEIGHTS[i]!;
    if (r < 0) return i;
  }
  return REEL_WEIGHTS.length - 1;
}

/** Throw the game's dice: coin → `[face]`, dice → `[d1, d2]` (1–6), slots → three reel indices. */
export function rollFor(game: CasinoGame, rand: CasinoRand): number[] {
  switch (game) {
    case "coin":
      return rand(COIN_EDGE_ONE_IN) === 0 ? [2] : [rand(2)];
    case "dice":
      return [1 + rand(6), 1 + rand(6)];
    case "slots":
      return [reelStop(rand), reelStop(rand), reelStop(rand)];
  }
}

/** Is this a roll the game could have thrown? (a journaled op is checked before it is trusted) */
export function validRoll(game: CasinoGame, roll: readonly number[]): boolean {
  const int = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (game === "coin") return roll.length === 1 && int(roll[0]!, 0, 2);
  if (game === "dice") return roll.length === 2 && roll.every((d) => int(d, 1, 6));
  return roll.length === 3 && roll.every((s) => int(s, 0, REEL.length - 1));
}

/** The multiple of the stake a roll pays a pick (0 = lost, 1 = the stake back). */
export function multiplier(game: CasinoGame, pick: string, roll: readonly number[]): number {
  switch (game) {
    case "coin": {
      const face = COIN_FACES[roll[0] ?? 2];
      return face === pick ? 2 : 0;
    }
    case "dice": {
      const sum = (roll[0] ?? 0) + (roll[1] ?? 0);
      if (pick === "seven") return sum === 7 ? 5 : 0;
      if (pick === "under") return sum < 7 ? 2 : 0;
      if (pick === "over") return sum > 7 ? 2 : 0;
      return 0;
    }
    case "slots": {
      const [a, b, c] = [roll[0] ?? 4, roll[1] ?? 4, roll[2] ?? 4];
      if (a === b && b === c) return THREE_PAYS[a] ?? 0;
      const sevens = [a, b, c].filter((s) => s === 0).length;
      if (sevens === 2) return 5;
      if (a === b) return 2;
      if (sevens === 1) return 1;
      return 0;
    }
  }
}

/** Everything a bet hands back (the stake included). */
export function payoutOf(game: CasinoGame, pick: string, roll: readonly number[], stake: number): number {
  return Math.floor(stake * multiplier(game, pick, roll));
}

/** The roll in words: `HEADS` / `ON ITS EDGE`, `4 + 3 = 7`, `7 ★ ★`. */
export function rollText(game: CasinoGame, roll: readonly number[]): string {
  switch (game) {
    case "coin": {
      const face = COIN_FACES[roll[0] ?? 2] ?? "edge";
      return face === "edge" ? "ON ITS EDGE" : face.toUpperCase();
    }
    case "dice":
      return `${roll[0]} + ${roll[1]} = ${(roll[0] ?? 0) + (roll[1] ?? 0)}`;
    case "slots":
      return roll.map((i) => REEL[i] ?? "?").join(" ");
  }
}

/** The pick's label (`HEADS`, `UNDER 7`, `PULL`). */
export function pickLabel(game: CasinoGame, pick: string): string {
  return CASINO_INFO[game].picks.find((p) => p.id === pick)?.label ?? pick.toUpperCase();
}

/** The expected return of a pick (payout ÷ stake, averaged over every roll). */
export function expectedReturn(game: CasinoGame, pick: string): number {
  if (game === "coin") return ((COIN_EDGE_ONE_IN - 1) / COIN_EDGE_ONE_IN) * 0.5 * multiplier("coin", pick, [COIN_FACES.indexOf(pick as "heads")]);
  if (game === "dice") {
    let s = 0;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) s += multiplier("dice", pick, [a, b]);
    return s / 36;
  }
  const total = REEL_WEIGHTS.reduce((a, b) => a + b, 0);
  let s = 0;
  for (let a = 0; a < REEL.length; a++)
    for (let b = 0; b < REEL.length; b++)
      for (let c = 0; c < REEL.length; c++) s += (REEL_WEIGHTS[a]! * REEL_WEIGHTS[b]! * REEL_WEIGHTS[c]!) / total ** 3 * multiplier("slots", pick, [a, b, c]);
  return s;
}
