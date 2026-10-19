import { describe, expect, it } from "vitest";
import { CHESS_IDLE_MS, INITIAL, MARKED_NOTICE, NOTICE_MS, RESULT_MS, WIN_CODE, WIN_NOT_SENT, healthText, reduce, resultLine, settled, stakesLine, strengthLine, type ChessEvent, type ChessSession } from "../src/chess/session.ts";

const ada = { id: "g-aaaaaa", name: "Ada", restricted: false };
const king = (hp: number, armed: boolean | null = true) => ({ hp, max: 15, fallen: hp <= 0, armed });

function run(events: ChessEvent[], from: ChessSession = INITIAL): ChessSession {
  return events.reduce(reduce, from);
}

describe("the chess board's session", () => {
  it("a pass scan checks the guest, then deals at the bar's strength read at the deal", () => {
    let s = reduce(INITIAL, { type: "scan", text: "G-AAAAAA", now: 0 });
    expect(s).toEqual({ kind: "checking", id: "g-aaaaaa" });
    s = reduce(s, { type: "resolved", guest: ada, king: king(15), game: 1, now: 1 });
    expect(s).toMatchObject({ kind: "playing", game: 1, guest: ada, stage: "grandmaster", hp: 15, max: 15 });
    expect(run([{ type: "scan", text: "g-aaaaaa", now: 0 }, { type: "resolved", guest: ada, king: king(8), game: 2, now: 1 }])).toMatchObject({ stage: "beginner" });
    expect(run([{ type: "scan", text: "g-aaaaaa", now: 0 }, { type: "resolved", guest: ada, king: king(0), game: 3, now: 1 }])).toMatchObject({ stage: "pawns" });
    // An older server: no shared King, full strength, no bar.
    expect(run([{ type: "scan", text: "g-aaaaaa", now: 0 }, { type: "resolved", guest: ada, king: null, game: 4, now: 1 }])).toMatchObject({ stage: "grandmaster", hp: null, max: null });
  });

  it("a wall code or junk is a notice that clears itself; nothing scans mid-game", () => {
    const wall = reduce(INITIAL, { type: "scan", text: "https://x/?code=ABC&unlock=Q1", now: 100 });
    expect(wall).toMatchObject({ kind: "attract", notice: { text: expect.stringMatching(/WALL CODE/), until: 100 + NOTICE_MS } });
    expect(reduce(wall, { type: "tick", now: 100 + NOTICE_MS - 1 })).toBe(wall);
    expect(reduce(wall, { type: "tick", now: 100 + NOTICE_MS })).toEqual(INITIAL);
    expect(reduce(INITIAL, { type: "scan", text: "hello", now: 0 })).toMatchObject({ notice: { text: expect.stringMatching(/UNREADABLE/) } });
    const playing = run([{ type: "typed", id: "g-aaaaaa" }, { type: "resolved", guest: ada, king: king(15), game: 1, now: 0 }]);
    expect(reduce(playing, { type: "scan", text: "g-bbbbbb", now: 1 })).toBe(playing);
    expect(reduce(playing, { type: "typed", id: "g-bbbbbb" })).toBe(playing);
  });

  it("refuses a marked program (D5) and a pass the house can't place", () => {
    const marked = run([{ type: "scan", text: "g-aaaaaa", now: 0 }, { type: "resolved", guest: { ...ada, restricted: true }, king: king(15), game: 1, now: 5 }]);
    expect(marked).toMatchObject({ kind: "attract", notice: { text: MARKED_NOTICE } });
    expect(MARKED_NOTICE).toBe("⛔ Marked programs can't challenge the King.");
    expect(run([{ type: "scan", text: "g-aaaaaa", now: 0 }, { type: "refused", text: "UNKNOWN PROGRAM", now: 1 }])).toMatchObject({ kind: "attract", notice: { text: "UNKNOWN PROGRAM" } });
    // The typed fallback's own problem is said on attract (it runs there).
    expect(reduce(INITIAL, { type: "refused", text: "NO SUCH PROGRAM — REGISTER ON YOUR PHONE FIRST", now: 1000 })).toEqual({ kind: "attract", notice: { text: "NO SUCH PROGRAM — REGISTER ON YOUR PHONE FIRST", until: 1000 + NOTICE_MS } });
    // …but never over a game.
    const game = run([{ type: "typed", id: "g-aaaaaa" }, { type: "resolved", guest: ada, king: king(15), game: 9, now: 0 }]);
    expect(reduce(game, { type: "refused", text: "X", now: 1 })).toBe(game);
    // An answer for a different pass than the one being checked is ignored.
    const checking = reduce(INITIAL, { type: "scan", text: "g-aaaaaa", now: 0 });
    expect(reduce(checking, { type: "resolved", guest: { ...ada, id: "g-cccccc" }, king: null, game: 1, now: 1 })).toBe(checking);
  });

  it("giving up or the leash is silent: straight back to attract", () => {
    const playing = run([{ type: "typed", id: "g-aaaaaa" }, { type: "resolved", guest: ada, king: king(15), game: 1, now: 0 }]);
    expect(reduce(playing, { type: "abandon" })).toEqual(INITIAL);
    expect(reduce(playing, { type: "abandon", notice: "NO INPUT", now: 50 })).toEqual({ kind: "attract", notice: { text: "NO INPUT", until: 50 + NOTICE_MS } });
    expect(CHESS_IDLE_MS).toBe(120_000);
  });

  it("a game's end waits for the post, then shows RESULT_MS and returns to attract", () => {
    const playing = run([{ type: "typed", id: "g-aaaaaa" }, { type: "resolved", guest: ada, king: king(4), game: 7, now: 0 }]);
    // A result for another game never lands.
    expect(reduce(playing, { type: "ended", game: 6, result: "won" })).toBe(playing);
    let s = reduce(playing, { type: "ended", game: 7, result: "won" });
    expect(s).toMatchObject({ kind: "over", result: "won", post: "sending", stage: "dizzy" });
    expect(settled(s)).toBe(false);
    expect(reduce(s, { type: "tick", now: 1e9 })).toBe(s); // never leaves while sending
    s = reduce(s, { type: "posted", game: 7, post: "sent", armed: true, now: 1000 });
    expect(s).toMatchObject({ post: "sent", armed: true, settledAt: 1000 });
    expect(settled(s)).toBe(true);
    // A second post answer changes nothing.
    expect(reduce(s, { type: "posted", game: 7, post: "failed", armed: false, now: 1001 })).toBe(s);
    expect(reduce(s, { type: "tick", now: 1000 + RESULT_MS - 1 }).kind).toBe("over");
    expect(reduce(s, { type: "tick", now: 1000 + RESULT_MS })).toEqual(INITIAL);
    // Abandon does nothing on the result screen.
    expect(reduce(s, { type: "abandon" })).toBe(s);
  });
});

describe("the words", () => {
  const over = (result: "won" | "lost" | "drawn", post: "sending" | "sent" | "declined" | "failed", armed: boolean | null) => ({ kind: "over" as const, game: 1, guest: ada, stage: "club" as const, result, post, armed, settledAt: null });

  it("names the door code only once the win landed while armed", () => {
    expect(resultLine(over("won", "sent", true))).toBe(WIN_CODE);
    expect(WIN_CODE).toBe("Checkmate. The door code is in your phone's Codex.");
    expect(resultLine(over("won", "sending", true))).not.toMatch(/door code/i);
    expect(resultLine(over("won", "sent", false))).toBe("Checkmate. No prize now.");
    expect(resultLine(over("won", "sent", null))).toBe("Checkmate.");
    expect(resultLine(over("won", "failed", true))).toBe(WIN_NOT_SENT);
    expect(resultLine(over("won", "failed", null))).toBe(WIN_NOT_SENT);
    expect(resultLine(over("won", "failed", false))).toBe("Checkmate. No prize now.");
    // The story took the post but turned the win down (after truth.txt):
    // no code, even though the last poll still said armed.
    expect(resultLine(over("won", "declined", true))).toBe("Checkmate. No prize now.");
    expect(resultLine(over("won", "declined", null))).not.toMatch(/door code/i);
    expect(resultLine(over("lost", "sent", true))).toMatch(/King wins/);
    expect(resultLine(over("drawn", "failed", true))).toMatch(/draw/i);
  });

  it("the stakes line follows king.armed; the bar reads n / max; no tips anywhere", () => {
    expect(stakesLine(true)).toBe("Checkmate him and the server-room door code goes to your Codex.");
    expect(stakesLine(false)).toBe("No prize now.");
    expect(stakesLine(null)).toBeNull();
    expect(stakesLine(undefined)).toBeNull();
    expect(healthText({ hp: 9, max: 15 })).toBe("9 / 15");
    expect(healthText(null)).toBeNull();
    for (const stage of ["grandmaster", "club", "beginner", "dizzy", "pawns"] as const) expect(strengthLine(stage)).not.toMatch(/hit|hint|tip|give up|weaker/i);
    for (const r of ["won", "lost", "drawn"] as const) for (const p of ["sending", "sent", "declined", "failed"] as const) expect(resultLine(over(r, p, true))).not.toMatch(/hit|hint|weaker|practice/i);
  });
});
