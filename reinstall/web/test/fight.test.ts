import { describe, expect, it } from "vitest";
import { doorGap, locate } from "@loom/house";
import type { Prop, Vec3 } from "@loom/house";
import * as fight from "../src/game/fight.ts";
import { HIT_USED, hitSpentAtStart, keepDoorOpen, KING_REACH, kingReach, nudgeFor } from "../src/game/fight.ts";
import { THREE_FLOOR } from "./houses.ts";

const house = THREE_FLOOR();
const king = house.props.find((p) => p.kind === "king") as Prop;
// Yaw: 0 = north, 90 = west, −90 = east. The King stands in the hall, east of the door at x = −3.
const WEST = 90;
const EAST = -90;

// Wave 26 (R3): the HUD lost its King bar — the meter (hearts / "n / max"),
// the stage ladder line and the kneeling line. The bar over his head
// (`@loom/house/three` `drawBar`) is the only display of his points, so the
// tablet no longer carries the meter, the stage ladder or their lines.
describe("no King bar on the HUD (wave 26, R3)", () => {
  it("fight.ts carries no meter, stage ladder or stage / kneeling line any more", () => {
    const exported = Object.keys(fight);
    for (const gone of ["kingMeter", "stageFor", "STAGE_LINE", "KNEELING_LINE"]) expect(exported, gone).not.toContain(gone);
  });

  it("what stays: the hit's own lines (spent, nudges)", () => {
    expect(HIT_USED).toMatch(/hit him this reinstallation/u);
    expect(nudgeFor("far")).toBe("Get closer to the King.");
    expect(nudgeFor("facing")).toBe("Face him.");
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
    expect(HIT_USED).toBe("You hit him this reinstallation. Find Gerald before you hit him again.");
    // A re-scan before the duck is the same visit: the assignment says so.
    expect(hitSpentAtStart({ kingHit: true })).toBe(true);
    expect(hitSpentAtStart({ kingHit: false })).toBe(false);
    expect(hitSpentAtStart({})).toBe(false); // an old server
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
