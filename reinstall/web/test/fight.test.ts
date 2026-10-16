import { describe, expect, it } from "vitest";
import type { Prop, Vec3 } from "@loom/house";
import { canHit, fell, hearts, hit, HIT_COOLDOWN_MS, HIT_REACH, KING_HP, newFight, stageFor, STAGE_LINE } from "../src/game/fight.ts";
import { SHOW } from "./houses.ts";

const house = SHOW();
const king = house.props.find((p) => p.kind === "king") as Prop;
// Yaw: 0 = north, 90 = west, −90 = east. The King stands in the hall, east of the door at x = −3.
const WEST = 90;
const EAST = -90;

describe("stageFor", () => {
  it("walks grandmaster → club → beginner → dizzy → pawns over 4 hp", () => {
    expect([4, 3, 2, 1, 0].map((hp) => stageFor(hp, 4))).toEqual(["grandmaster", "club", "beginner", "dizzy", "pawns"]);
  });

  it("scales another max (round(4·hp/max))", () => {
    expect(stageFor(9, 9)).toBe("grandmaster");
    expect(stageFor(5, 9)).toBe("beginner"); // 2.2 → 2
    expect(stageFor(2, 9)).toBe("dizzy"); // 0.9 → 1
    expect(stageFor(1, 9)).toBe("pawns"); // 0.44 → 0
    expect(stageFor(1, 1)).toBe("grandmaster");
    expect(stageFor(0, 1)).toBe("pawns");
    expect(stageFor(7, 4)).toBe("grandmaster"); // clamped
  });

  it("every stage has a line", () => {
    for (const s of ["grandmaster", "club", "beginner", "dizzy", "pawns"] as const) expect(STAGE_LINE[s]).toMatch(/King/);
  });
});

describe("newFight / hit / fell / hearts", () => {
  it("deals the prop's hp (default 4, clamped to 1–9)", () => {
    expect(newFight()).toEqual({ hp: KING_HP, max: KING_HP, hits: 0, lastHitAt: Number.NEGATIVE_INFINITY, fallen: false });
    expect(newFight(7).max).toBe(7);
    expect(newFight(0).max).toBe(KING_HP);
    expect(newFight(12).max).toBe(9);
    expect(newFight(2.5).max).toBe(KING_HP);
  });

  it("hit never goes below 0, counts hits, stamps the time", () => {
    let f = newFight(2);
    f = hit(f, 1000);
    expect(f).toMatchObject({ hp: 1, hits: 1, lastHitAt: 1000 });
    f = hit(f, 3000);
    f = hit(f, 5000);
    expect(f).toMatchObject({ hp: 0, hits: 3, lastHitAt: 5000, fallen: false });
    expect(fell(f).fallen).toBe(true);
    expect(f.fallen).toBe(false); // pure
  });

  it("hearts: ♥ per point left, ♡ per point lost, nothing at 0", () => {
    expect(hearts(newFight(4))).toBe("♥♥♥♥");
    expect(hearts(hit(newFight(4), 0))).toBe("♥♥♥♡");
    expect(hearts({ ...newFight(4), hp: 1 })).toBe("♥♡♡♡");
    expect(hearts({ ...newFight(4), hp: 0 })).toBe("");
  });
});

describe("canHit (on the show's map)", () => {
  const feet = (dx: number, dz = 0): Vec3 => [king.pos[0] + dx, king.pos[1], king.pos[2] + dz];
  const near = feet(0.7); // 0.7 m east of him, facing west

  it("fallen / other floor / too far / not facing / cooldown / ok, in that order", () => {
    const f = newFight();
    expect(canHit(fell(f), 0, house, near, WEST, king)).toBe("fallen");
    expect(canHit(f, 0, house, [near[0], 0, near[2]], WEST, king)).toBe("floor"); // on the main floor, right above him
    expect(canHit(f, 0, house, feet(HIT_REACH + 0.05), WEST, king)).toBe("far");
    expect(canHit(f, 0, house, near, EAST, king)).toBe("facing"); // back to him
    expect(canHit(f, 0, house, near, WEST + 50, king)).toBe("ok"); // inside the 55° cone
    expect(canHit(f, 0, house, near, WEST + 60, king)).toBe("facing");
    const just = hit(f, 10_000);
    expect(canHit(just, 10_000 + HIT_COOLDOWN_MS - 1, house, near, WEST, king)).toBe("cooldown");
    expect(canHit(just, 10_000 + HIT_COOLDOWN_MS, house, near, WEST, king)).toBe("ok");
    expect(canHit(f, 0, house, near, WEST, king)).toBe("ok");
  });

  it("a fallen king is never hittable, whatever else is true", () => {
    expect(canHit(fell(newFight()), 0, house, feet(5), EAST, king)).toBe("fallen");
  });

  it("reach is measured on the plan to his base centre", () => {
    expect(canHit(newFight(), 0, house, feet(HIT_REACH - 0.01), WEST, king)).toBe("ok");
    expect(canHit(newFight(), 0, house, feet(0.5, 0.5), WEST, king)).toBe("ok"); // 0.71 m, diagonal
    expect(canHit(newFight(), 0, house, feet(0.9, 0.9), WEST, king)).toBe("far"); // 1.27 m
  });
});
