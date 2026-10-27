//! The path to Gerald appears after a minute (wave 26, R2): for the first
//! `PATH_REVEAL_MS` of a session the chevron trail, the compass pip, the
//! distance and the warmer / colder ladder are hidden and the HUD reads
//! just FIND GERALD; then a short notice and the trail draws at once. The
//! quack is not a path indicator: it is never delayed. Driven on a bare
//! Game (no canvas), as `king-game.test.ts` does.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PATH_REVEAL_MS as HOUSE_PATH_REVEAL_MS } from "@loom/house";
import type { Vec3 } from "@loom/house";
import { Game } from "../src/game/engine.ts";
import { duckMovedNotice, FIND_GERALD, PATH_REVEAL_MS, PATH_REVEAL_NOTICE, pathShown } from "../src/game/hud.ts";
import { TWO_ROOMS } from "./houses.ts";

const house = TWO_ROOMS();

type Bare = {
  pathRevealed: boolean;
  lastTrailAt: number;
  path: Vec3[];
  refreshTrail(now: number): void;
  revealPath(): void;
  emitHud(now: number): void;
  maybeQuack(now: number): void;
  adoptDuck(incoming: unknown): void;
};

function game(revealed = false) {
  const g = Object.create(Game.prototype) as Record<string, unknown>;
  const said: string[] = [];
  const drawn: Vec3[][] = [];
  const huds: Array<Record<string, unknown>> = [];
  const quacks: number[] = [];
  Object.assign(g, {
    phase: "playing",
    tutorial: null, // wave 33: no intro tutorial (its own tests: intro.test.ts)
    mouseLocked: false,
    map: house,
    trailHouse: house,
    pathRevealed: revealed,
    lastTrailAt: 0,
    path: [],
    distance: 0,
    distHistory: [],
    notice: null,
    startedAt: 0,
    nextQuackAt: 0,
    live: true,
    players: new Map(),
    body: { p: [0.5, 0, 1.5] as Vec3, yaw: 0, pitch: 0, vy: 0 },
    duckSpot: { id: "d", room: "b", pos: [6, 0, 1.5] as Vec3 },
    duck: { state: "idle", object: { position: { set: () => {} } } },
    trail: { set: (p: Vec3[]) => drawn.push(p) },
    leash: { warning: () => null },
    voice: null,
    kingProp: null,
    kingState: null,
    o: { assignment: { session: "s-1" }, sfx: { quack: (v: number) => quacks.push(v) }, onHud: (h: Record<string, unknown>) => huds.push(h) },
    say: (line: string) => said.push(line),
  });
  return { g: g as unknown as Bare, said, drawn, huds, quacks };
}

describe("the path reveal (wave 26, R2)", () => {
  it("is @loom/house's minute, hidden until it is up", () => {
    expect(PATH_REVEAL_MS).toBe(HOUSE_PATH_REVEAL_MS);
    expect(PATH_REVEAL_MS).toBe(60_000);
    expect(pathShown(0)).toBe(false);
    expect(pathShown(59_999)).toBe(false);
    expect(pathShown(60_000)).toBe(true);
    expect(pathShown(3_600_000)).toBe(true);
  });

  it("before the reveal the trail is routed (distance, autopilot) but nothing is drawn", () => {
    const { g, drawn } = game(false);
    g.refreshTrail(500);
    expect(g.path.length).toBeGreaterThan(1);
    expect(drawn).toEqual([[]]);
  });

  it("the reveal says so once and draws the trail at once", () => {
    const { g, drawn, said } = game(false);
    g.revealPath();
    expect(g.pathRevealed).toBe(true);
    expect(g.lastTrailAt).toBe(Number.NEGATIVE_INFINITY); // the next frame refreshes it
    expect(said).toEqual([PATH_REVEAL_NOTICE]);
    expect(PATH_REVEAL_NOTICE).toBe("The way to Gerald lights up.");
    g.refreshTrail(600);
    expect(drawn.at(-1)!.length).toBeGreaterThan(1);
    expect(drawn.at(-1)).toEqual(g.path);
  });

  it("the HUD hides the pip, the distance and the heat before the reveal; shows them after", () => {
    const before = game(false);
    before.g.refreshTrail(100);
    before.g.emitHud(200);
    expect(before.huds[0]).toMatchObject({ path: false, pip: null });
    const after = game(true);
    after.g.refreshTrail(100);
    after.g.emitHud(200);
    expect(after.huds[0]).toMatchObject({ path: true });
    expect(after.huds[0]!["pip"]).not.toBeNull();
  });

  it("Gerald's quack is not a path: it plays before the reveal", () => {
    const { g, quacks } = game(false);
    g.maybeQuack(10); // 5.5 m away, same floor, inside the 7 m quack range
    expect(quacks.length).toBe(1);
  });

  it("'Gerald moved.' names no arrows before the reveal; the old line after", () => {
    expect(duckMovedNotice(false)).toBe("Gerald moved.");
    expect(duckMovedNotice(true)).toBe("Gerald moved — follow the golden arrows.");
    const { g, said } = game(false);
    g.adoptDuck({ id: "d2", room: "b", pos: [7, 0, 2] });
    expect(said).toEqual(["Gerald moved."]);
  });

  it("the HUD's heat box reads FIND GERALD before the reveal, and the help card promises no arrows", () => {
    const play = readFileSync(new URL("../src/game/Play.tsx", import.meta.url), "utf8");
    expect(FIND_GERALD).toBe("FIND GERALD");
    expect(play).toContain("{FIND_GERALD}");
    expect(play).toContain("Find Gerald, the golden duck.</span>");
    expect(play).not.toContain("Find Gerald, the golden duck. Follow the golden arrows.");
  });
});

