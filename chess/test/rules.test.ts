import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { board, describe as describeCell, GLYPH, glyphOf, newGame, outcome, PAWNS_ONLY_FEN, play, START_FEN, startFen, targets } from "../src/rules.ts";

describe("the pawns-only start", () => {
  it("PAWNS_ONLY_FEN is valid for chess.js and has a lone black king + 8 pawns against a full white army", () => {
    const g = new Chess(PAWNS_ONLY_FEN);
    expect(g.fen()).toBe(PAWNS_ONLY_FEN);
    const cells = board(g);
    const black = cells.filter((c) => c.piece?.color === "b").map((c) => c.piece!.type).sort();
    expect(black).toEqual(["k", "p", "p", "p", "p", "p", "p", "p", "p"]);
    expect(cells.filter((c) => c.piece?.color === "w")).toHaveLength(16);
    expect(g.turn()).toBe("w");
    expect(g.moves().length).toBe(20);
  });

  it("startFen / newGame pick it only for the pawns stage", () => {
    expect(startFen("pawns")).toBe(PAWNS_ONLY_FEN);
    for (const s of ["grandmaster", "club", "beginner", "dizzy"] as const) expect(startFen(s)).toBe(START_FEN);
    expect(newGame("club").fen()).toBe(START_FEN);
    expect(newGame("pawns").fen()).toBe(PAWNS_ONLY_FEN);
  });
});

describe("outcome", () => {
  it("fool's mate is lost, a back-rank mate for White is won, a stalemate is drawn, an open game is null", () => {
    const fools = new Chess();
    for (const m of ["f3", "e5", "g4", "Qh4"]) fools.move(m);
    expect(outcome(fools)).toBe("lost");
    const backRank = new Chess("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1");
    expect(outcome(backRank)).toBeNull();
    backRank.move("Ra8");
    expect(outcome(backRank)).toBe("won");
    expect(outcome(new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"))).toBe("drawn"); // stalemate
    expect(outcome(new Chess("7k/8/6K1/8/8/8/8/8 w - - 0 1"))).toBe("drawn"); // bare kings
    expect(outcome(new Chess())).toBeNull();
  });
});

describe("play / targets", () => {
  it("targets lists the legal destinations of a square (promotions folded)", () => {
    const g = new Chess();
    expect(targets(g, "e2").sort()).toEqual(["e3", "e4"]);
    expect(targets(g, "g1").sort()).toEqual(["f3", "h3"]);
    expect(targets(g, "e1")).toEqual([]);
    expect(targets(g, "e7")).toEqual([]); // not White's
    const promo = new Chess("8/P6k/8/8/8/8/8/K7 w - - 0 1");
    expect(targets(promo, "a7")).toEqual(["a8"]);
  });

  it("plays a legal move, auto-queens, and refuses an illegal one without touching the game", () => {
    const g = new Chess();
    expect(play(g, "e2", "e5")).toBeNull();
    expect(play(g, "e7", "e5")).toBeNull();
    expect(g.fen()).toBe(START_FEN);
    const m = play(g, "e2", "e4")!;
    expect(m).not.toBeNull();
    expect(m.san).toBe("e4");
    const promo = new Chess("8/P6k/8/8/8/8/8/K7 w - - 0 1");
    const q = play(promo, "a7", "a8")!;
    expect(q.promotion).toBe("q");
    expect(promo.get("a8")?.type).toBe("q");
  });
});

describe("board / glyphs", () => {
  it("lists 64 cells a8 first with pieces, and names them for a screen reader", () => {
    const cells = board(new Chess());
    expect(cells).toHaveLength(64);
    expect(cells[0]).toEqual({ square: "a8", piece: { type: "r", color: "b" } });
    expect(cells[63]).toEqual({ square: "h1", piece: { type: "r", color: "w" } });
    expect(cells[36]!.square).toBe("e4");
    expect(cells[36]!.piece).toBeNull();
    expect(describeCell(cells[52]!)).toBe("e2, white pawn");
    expect(describeCell(cells[36]!)).toBe("e4, empty");
  });

  it("has a glyph for every piece of both colours", () => {
    expect(Object.keys(GLYPH)).toHaveLength(12);
    expect(glyphOf("w", "k")).toBe("♔");
    expect(glyphOf("b", "p")).toBe("♟");
    expect(new Set(Object.values(GLYPH)).size).toBe(12);
  });
});
