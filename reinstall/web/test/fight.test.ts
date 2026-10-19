import { describe, expect, it } from "vitest";
import { doorGap, locate } from "@loom/house";
import type { Prop, Vec3 } from "@loom/house";
import { HIT_USED, keepDoorOpen, KING_REACH, kingMeter, kingReach, KNEELING_LINE, nudgeFor, stageFor, STAGE_LINE } from "../src/game/fight.ts";
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

  it("scales the show's 15 (round(4·hp/max))", () => {
    expect(stageFor(15, 15)).toBe("grandmaster");
    expect(stageFor(14, 15)).toBe("grandmaster"); // 3.73 → 4
    expect(stageFor(13, 15)).toBe("club"); // 3.47 → 3
    expect(stageFor(2, 15)).toBe("dizzy"); // 0.53 → 1
    expect(stageFor(1, 15)).toBe("pawns"); // 0.27 → 0
    expect(stageFor(0, 15)).toBe("pawns");
  });

  it("every stage has a line, and none of them is a chess tip", () => {
    for (const s of ["grandmaster", "club", "beginner", "dizzy", "pawns"] as const) {
      expect(STAGE_LINE[s]).toMatch(/King/);
      expect(STAGE_LINE[s]).not.toMatch(/board|chess|hit him|pawns only/iu);
    }
  });

  it("no standing line says he kneels — at 1 of 15 he is still up, his door shut", () => {
    for (let hp = 1; hp <= 15; hp++) expect(STAGE_LINE[stageFor(hp, 15)]).not.toMatch(/knee|kneel|open/iu);
    expect(KNEELING_LINE).toMatch(/knees/iu);
    expect(KNEELING_LINE).toMatch(/door stands open/iu);
  });
});

describe("kingMeter", () => {
  it("hearts up to nine points, n / max past that", () => {
    expect(kingMeter(4, 4)).toBe("♥♥♥♥");
    expect(kingMeter(3, 4)).toBe("♥♥♥♡");
    expect(kingMeter(0, 4)).toBe("♡♡♡♡");
    expect(kingMeter(12, 15)).toBe("12 / 15");
    expect(kingMeter(0, 15)).toBe("0 / 15");
    expect(kingMeter(99, 15)).toBe("15 / 15"); // clamped
  });
});

describe("kingReach (on the show's map)", () => {
  const feet = (dx: number, dz = 0): Vec3 => [king.pos[0] + dx, king.pos[1], king.pos[2] + dz];
  const near = feet(0.7); // 0.7 m east of him, facing west

  it("other floor / too far / not facing / ok, in that order", () => {
    expect(kingReach(house, [near[0], 0, near[2]], WEST, king)).toBe("floor"); // on the main floor, right above him
    expect(kingReach(house, feet(KING_REACH + 0.05), WEST, king)).toBe("far");
    expect(kingReach(house, near, EAST, king)).toBe("facing"); // back to him
    expect(kingReach(house, near, WEST + 50, king)).toBe("ok"); // inside the 55° cone
    expect(kingReach(house, near, WEST + 60, king)).toBe("facing");
    expect(kingReach(house, near, WEST, king)).toBe("ok");
  });

  it("reach is measured on the plan to his base centre", () => {
    expect(kingReach(house, feet(KING_REACH - 0.01), WEST, king)).toBe("ok");
    expect(kingReach(house, feet(0.5, 0.5), WEST, king)).toBe("ok"); // 0.71 m, diagonal
    expect(kingReach(house, feet(0.9, 0.9), WEST, king)).toBe("far"); // 1.27 m
  });

  it("the nudges: closer, or face him; the spent hit's line names the next visit", () => {
    expect(nudgeFor("far")).toBe("Get closer to the King.");
    expect(nudgeFor("floor")).toBe("Get closer to the King.");
    expect(nudgeFor("facing")).toBe("Face him.");
    expect(HIT_USED).toBe("You hit him. Come back on your next reinstallation.");
  });
});

describe("keepDoorOpen (a restore while a player is behind or in his door)", () => {
  const door = house.doors.find((d) => d.guard === king.id)!;
  const behind = door.a === king.room ? door.b! : door.a;
  const gap = doorGap(house, door)!;
  const y = king.pos[1];

  it("behind the door (in the Server Room): stays open, or they would be shut in", () => {
    const inside: Vec3 = [gap.c - 1.5, y, (gap.lo + gap.hi) / 2];
    expect(locate(house, inside).room).toBe(behind);
    expect(keepDoorOpen(house, king, inside)).toBe(true);
  });

  it("in the doorway, or in his box: stays open, or they would be stuck in the leaf or in him", () => {
    const mid = (gap.lo + gap.hi) / 2;
    const inGap: Vec3 = gap.axis === "z" ? [gap.c, y, mid] : [mid, y, gap.c];
    expect(keepDoorOpen(house, king, inGap)).toBe(true);
    expect(keepDoorOpen(house, king, [king.pos[0], y, king.pos[2]])).toBe(true);
  });

  it("clear of both on his side of the door: it shuts", () => {
    const clear: Vec3 = [king.pos[0] + 1.6, y, king.pos[2]];
    expect(locate(house, clear).room).toBe(king.room);
    expect(keepDoorOpen(house, king, clear)).toBe(false);
    // On another floor, right above him: nothing to be stuck in.
    expect(keepDoorOpen(house, king, [king.pos[0], 0, king.pos[2]])).toBe(false);
  });
});
