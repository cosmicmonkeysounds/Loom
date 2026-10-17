//! `Game.chessResult` — what a game's end does to the open board (OCT31
//! decision 6), driven on a bare Game (no canvas: the method only touches
//! the fields set here).
import { describe, expect, it, vi } from "vitest";
import { Game, type ChessContext, type ChessResult } from "../src/game/engine.ts";
import { newFight } from "../src/game/fight.ts";

type Fake = {
  phase: string;
  chessResult: (r: ChessResult) => void;
  board: Array<ChessContext | null>;
  signals: string[];
  armed: ReturnType<typeof vi.fn>;
  buzz: ReturnType<typeof vi.fn>;
};

/** A Game mid-challenge, its options stubbed; `armedNext` is what each badge fetch answers. */
function atTheBoard(armedNext: Array<boolean | null>): Fake {
  const g = Object.create(Game.prototype) as Record<string, unknown>;
  const board: Array<ChessContext | null> = [];
  const signals: string[] = [];
  const armed = vi.fn(async () => armedNext.shift() ?? null);
  const buzz = vi.fn();
  Object.assign(g, {
    phase: "chess",
    fight: newFight(),
    armedState: false,
    leash: { touch: () => {} },
    kingProp: { id: "king", kind: "king", pos: [0, 0, 0], label: "THE KING", armed: { path: "Night.step", min: 14 }, signals: {} },
    o: {
      sfx: { buzz, fanfare: () => {} },
      onChess: (c: ChessContext | null) => board.push(c),
      signal: async (name: string) => {
        signals.push(name);
        return true;
      },
      armed,
    },
  });
  return Object.assign(g, { board, signals, armed, buzz }) as unknown as Fake;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("a game's end at the King's board", () => {
  it("a re-deal fetches the badge again: the Y2K hour started while the board was open", async () => {
    const g = atTheBoard([true]);
    g.chessResult("drawn");
    await settle();
    expect(g.armed).toHaveBeenCalledWith("Night.step", 14);
    expect(g.board.at(-1)).toMatchObject({ armed: true, label: "THE KING" });
    expect(g.phase).toBe("chess");
  });
});
