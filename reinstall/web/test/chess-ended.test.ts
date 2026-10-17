//! A checkmate once the night has ended (W8 review of S1-04): a board dealt
//! during the Y2K hour cached "FOR THE CODE"; if the ending plays mid-game,
//! the checkmate's own read says the night is over and the tablet promises
//! nothing — not the cached badge's door code. Driven on a bare Game, as
//! chess-result.test.ts does, with the map rebuild a checkmate does stubbed.
import { describe, expect, it, vi } from "vitest";
import { Game } from "../src/game/engine.ts";
import { newFight, NIGHT_ENDED, WIN_CODE, type ArmedRead } from "../src/game/fight.ts";

vi.mock("../src/game/physics.ts", async (orig) => ({ ...(await orig<object>()), buildPhysicsWorld: () => ({}) }));
vi.mock("../src/game/trail.ts", async (orig) => ({ ...(await orig<object>()), trailMap: () => ({}) }));

function checkmateAfter(armedState: boolean | null, read: ArmedRead) {
  const g = Object.create(Game.prototype) as Record<string, unknown>;
  const said: string[] = [];
  Object.assign(g, {
    phase: "chess",
    fight: newFight(),
    armedState,
    leash: { touch: () => {} },
    kingProp: { id: "king", kind: "king", pos: [0, 0, 0], label: "THE KING", armed: { path: "Night.step", min: 14 }, signals: {} },
    house: { walls: [] },
    openGuardedDoors: () => {},
    physicsOptions: () => ({}),
    say: (line: string) => said.push(line),
    o: {
      sfx: { buzz: () => {}, fanfare: () => {} },
      onChess: () => {},
      signal: async () => true,
      armed: async () => read,
    },
  });
  (g as unknown as { chessResult: (r: string) => void }).chessResult("won");
  return { g, said };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("a checkmate after the ending", () => {
  it("promises no code though the badge said FOR THE CODE, and forgets the badge", async () => {
    const { g, said } = checkmateAfter(true, NIGHT_ENDED);
    await settle();
    await settle();
    expect(said).toEqual(["CHECKMATE — the King falls."]);
    expect(g.armedState).toBeNull();
  });

  it("an unknown read still falls back to the badge (the uplink blinked mid-show)", async () => {
    const { said } = checkmateAfter(true, null);
    await settle();
    await settle();
    expect(said).toEqual(["CHECKMATE — the King falls.", WIN_CODE]);
  });
});
