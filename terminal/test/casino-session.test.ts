import { describe, expect, it } from "vitest";
import { INITIAL, MARKED_NOTICE, NOTICE_MS, betProblem, cashOutLine, chipsFor, clampStake, openingStake, reduce, type CasinoSession } from "../src/casino/session.ts";

const player = (balance: number, extra: Partial<{ restricted: boolean; wallet: boolean }> = {}) => ({ id: "g-abc123", name: "Winamp", balance, unit: "Truthcoin", restricted: false, wallet: true, ...extra });

function seat(balance = 100): CasinoSession {
  const checking = reduce(INITIAL, { type: "scan", text: "g-abc123", now: 0 });
  return reduce(checking, { type: "resolved", player: player(balance), now: 0 });
}

describe("the casino session", () => {
  it("a pass seats the player in the lobby with an opening stake", () => {
    const s = seat(100);
    expect(s).toMatchObject({ kind: "seated", game: null, stake: 5, betting: null, player: { name: "Winamp", balance: 100 } });
    expect(seat(3)).toMatchObject({ stake: 3 });
  });

  it("refuses a wall code, a marked program and a story with no currency", () => {
    expect(reduce(INITIAL, { type: "scan", text: "https://x/?code=ABC&unlock=XYZ", now: 0 })).toMatchObject({ kind: "attract", notice: { text: "THAT'S A WALL CODE — SHOW ME YOUR PASS" } });
    const checking = reduce(INITIAL, { type: "scan", text: "g-abc123", now: 10 });
    expect(reduce(checking, { type: "resolved", player: player(100, { restricted: true }), now: 10 })).toEqual({ kind: "attract", notice: { text: MARKED_NOTICE, until: 10 + NOTICE_MS } });
    expect(reduce(checking, { type: "resolved", player: player(100, { wallet: false }), now: 10 })).toMatchObject({ kind: "attract" });
    // A different pass's answer never seats this one.
    expect(reduce(checking, { type: "resolved", player: { ...player(100), id: "g-ffffff" }, now: 10 })).toBe(checking);
  });

  it("a bet holds the table until the house answers; the balance and the sitting follow", () => {
    let s = reduce(seat(100), { type: "game", game: "coin" });
    s = reduce(s, { type: "stake", stake: 25 });
    s = reduce(s, { type: "bet", pick: "heads" });
    expect(s).toMatchObject({ betting: "heads" });
    // Nothing moves while the house rolls.
    expect(reduce(s, { type: "stake", stake: 1 })).toBe(s);
    expect(reduce(s, { type: "bet", pick: "tails" })).toBe(s);
    expect(reduce(s, { type: "game", game: null })).toBe(s);
    s = reduce(s, { type: "settled", result: { game: "coin", pick: "heads", stake: 25, roll: [0], payout: 50, net: 25 }, balance: 125 });
    expect(s).toMatchObject({ betting: null, player: { balance: 125 }, net: 25, bets: 1, last: { payout: 50 } });
    s = reduce(s, { type: "bet", pick: "tails" });
    s = reduce(s, { type: "settled", result: { game: "coin", pick: "tails", stake: 25, roll: [0], payout: 0, net: -25 }, balance: 100 });
    expect(s).toMatchObject({ net: 0, bets: 2 });
    expect(cashOutLine(s as Extract<CasinoSession, { kind: "seated" }>)).toBe("WINAMP BROKE EVEN");
  });

  it("a stake never outgrows the balance; a refused bet keeps the player seated with a notice", () => {
    let s = reduce(seat(30), { type: "game", game: "dice" });
    s = reduce(s, { type: "stake", stake: 50 });
    expect(s).toMatchObject({ stake: 30 });
    s = reduce(s, { type: "bet", pick: "seven" });
    s = reduce(s, { type: "failed", text: "NOT ENOUGH", balance: 10, now: 0 });
    expect(s).toMatchObject({ kind: "seated", betting: null, stake: 10, player: { balance: 10 }, notice: { text: "NOT ENOUGH" } });
    expect(reduce(s, { type: "tick", now: NOTICE_MS })).toMatchObject({ notice: null });
  });

  it("no bet without a game, or above the balance", () => {
    const lobby = seat(100);
    expect(reduce(lobby, { type: "bet", pick: "heads" })).toBe(lobby);
    const broke = reduce(reduce(seat(0), { type: "game", game: "coin" }), { type: "bet", pick: "heads" });
    expect(broke).toMatchObject({ betting: null });
  });

  it("cashing out says how it went", () => {
    let s = reduce(seat(100), { type: "game", game: "slots" });
    s = reduce(s, { type: "bet", pick: "pull" });
    s = reduce(s, { type: "settled", result: { game: "slots", pick: "pull", stake: 5, roll: [0, 0, 0], payout: 200, net: 195 }, balance: 295 });
    expect(cashOutLine(s as Extract<CasinoSession, { kind: "seated" }>)).toBe("WINAMP WALKS AWAY 195 TRUTHCOIN UP");
    expect(reduce(s, { type: "leave", notice: "BYE", now: 0 })).toMatchObject({ kind: "attract", notice: { text: "BYE" } });
  });

  it("stakes and chips", () => {
    expect(openingStake(100)).toBe(5);
    expect(clampStake(80, 1000)).toBe(50);
    expect(clampStake(0, 100)).toBe(1);
    expect(chipsFor(12)).toEqual([1, 5, 10]);
    expect(chipsFor(0)).toEqual([]);
  });

  it("refusals in the house's words", () => {
    expect(betProblem(null, "")).toMatch(/CHECK YOUR WALLET/u);
    expect(betProblem(409, "insufficient funds")).toBe("NOT ENOUGH IN YOUR WALLET FOR THAT STAKE");
    expect(betProblem(403, "marked programs can't gamble")).toBe("MARKED PROGRAMS CAN'T GAMBLE");
    expect(betProblem(403, "moderators only")).toBe("THIS TERMINAL LOST ITS ACCESS — TELL A HOST");
    expect(betProblem(429, "again")).toBe("ONE BET AT A TIME");
  });
});
