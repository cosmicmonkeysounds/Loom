import { describe, expect, it } from "vitest";
import { DRAG_SLOP, cellOf, isDrag, onDrop, onPress, onTap, squareAt, type Rules } from "../src/drag.ts";
import { newGame, targets, type Square } from "../src/rules.ts";

const rect = { left: 10, top: 20, width: 400, height: 400 };

/** The rules of a real opening position (the player is White, to move). */
function rulesOf(fen?: string): Rules {
  const g = newGame("grandmaster");
  if (fen !== undefined) g.load(fen);
  return {
    liftable: (sq) => {
      const p = g.get(sq);
      return g.turn() === "w" && p !== undefined && p !== null && p.color === "w" && targets(g, sq).length > 0;
    },
    targets: (sq) => targets(g, sq),
  };
}

describe("squareAt", () => {
  it("maps a point to its square, White at the bottom", () => {
    expect(squareAt(rect, 11, 21)).toBe("a8");
    expect(squareAt(rect, 409, 419)).toBe("h1");
    expect(squareAt(rect, 10 + 50 * 4 + 25, 20 + 50 * 6 + 25)).toBe("e2");
  });

  it("is null off the board (a drag let go past the edge)", () => {
    expect(squareAt(rect, 9, 100)).toBeNull();
    expect(squareAt(rect, 100, 420)).toBeNull();
    expect(squareAt(rect, 410, 100)).toBeNull();
    expect(squareAt({ ...rect, width: 0 }, 100, 100)).toBeNull();
  });

  it("round-trips with cellOf", () => {
    for (const sq of ["a8", "h1", "e4", "c6"] as Square[]) {
      const { col, row } = cellOf(sq);
      expect(squareAt(rect, 10 + col * 50 + 25, 20 + row * 50 + 25)).toBe(sq);
    }
  });
});

describe("a press, a tap, a drop", () => {
  const rules = rulesOf();

  it("a press on one of the player's movable pieces picks it up (its dots show at once)", () => {
    expect(onPress(null, "e2", rules)).toBe("e2");
    expect(onPress(null, "g1", rules)).toBe("g1");
  });

  it("a press on a piece that can't move, the King's, or an empty square picks nothing up", () => {
    expect(onPress(null, "a1", rules)).toBeNull(); // a rook behind its pawn
    expect(onPress(null, "e7", rules)).toBeNull();
    expect(onPress(null, "e4", rules)).toBeNull();
  });

  it("a press on a dot keeps the piece in hand (the tap that follows moves it)", () => {
    expect(onPress("e2", "e4", rules)).toBe("e2");
  });

  it("tap, then tap a dot: a move", () => {
    expect(onTap(null, "e2", rules)).toEqual({ kind: "select", selected: "e2" });
    expect(onTap("e2", "e4", rules)).toEqual({ kind: "move", from: "e2", to: "e4" });
  });

  it("tapping the piece in hand puts it down; tapping another of yours swaps; elsewhere drops it", () => {
    expect(onTap("e2", "e2", rules)).toEqual({ kind: "select", selected: null });
    expect(onTap("e2", "d2", rules)).toEqual({ kind: "select", selected: "d2" });
    expect(onTap("e2", "e5", rules)).toEqual({ kind: "select", selected: null });
  });

  it("a drop on a legal square moves; anywhere else the piece goes back, still in hand", () => {
    expect(onDrop("g1", "f3", rules)).toEqual({ kind: "move", from: "g1", to: "f3" });
    expect(onDrop("g1", "g3", rules)).toEqual({ kind: "select", selected: "g1" });
    expect(onDrop("g1", "g1", rules)).toEqual({ kind: "select", selected: "g1" });
    expect(onDrop("g1", null, rules)).toEqual({ kind: "select", selected: "g1" });
  });

  it("on the King's turn nothing is picked up", () => {
    const theirs = rulesOf("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
    expect(onPress(null, "d2", theirs)).toBeNull();
    expect(onTap(null, "d2", theirs)).toEqual({ kind: "select", selected: null });
  });
});

describe("isDrag", () => {
  it("a shaky tap stays a tap; past the slop it is a drag", () => {
    expect(isDrag(100, 100, 103, 102)).toBe(false);
    expect(isDrag(100, 100, 100 + DRAG_SLOP, 100)).toBe(true);
    expect(isDrag(100, 100, 96, 95)).toBe(true);
  });
});
