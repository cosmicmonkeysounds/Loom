import { describe, expect, it } from "vitest";
import {
  DUCK_MAX_RISE,
  HEART_INSET_M,
  HEART_SIGNAL,
  PICKUP_REACH_M,
  PICKUP_SIGNAL,
  PICKUP_SLACK_M,
  heartProps,
  heartReached,
  momentProp,
  pickupProps,
  pickupReach,
  propSignal,
  propSolid,
  validateHouse,
} from "../src/index.ts";
import type { HouseMap, Prop } from "../src/index.ts";
import { fixture } from "./golden.ts";

const heart: Prop = { id: "heart", room: "b", kind: "heart", pos: [5.5, 0, 1.5], size: [0.5, 1.4, 0.5] };
const disk: Prop = { id: "disk", room: "a", kind: "pickup", item: "virus", pos: [1, 0, 2.5], size: [0.09, 0.003, 0.094] };

function withMoments(): HouseMap {
  const h = fixture("two-rooms");
  const v = validateHouse({ ...h, props: [heart, disk] });
  expect(v.problems).toEqual([]);
  return v.house!;
}

describe("the moment constants (wave 26 C5)", () => {
  it("pins the contract's values", () => {
    expect([HEART_SIGNAL, PICKUP_SIGNAL]).toEqual(["simulation heart reached", "simulation pickup taken"]);
    expect([HEART_INSET_M, PICKUP_REACH_M, PICKUP_SLACK_M]).toEqual([0.3, 0.9, 0.3]);
  });

  it("neither new kind collides by default", () => {
    expect(propSolid(heart)).toBe(false);
    expect(propSolid(disk)).toBe(false);
    expect(propSolid({ ...heart, solid: true })).toBe(true);
  });
});

describe("heartReached", () => {
  const h = withMoments();
  it("is the heart's room, at least HEART_INSET_M inside its walls", () => {
    expect(heartReached(h, [5.5, 0, 1.5], heart)).toBe(true);
    expect(heartReached(h, [4 + HEART_INSET_M, 0, 1.5], heart)).toBe(true);
    expect(heartReached(h, [4.2, 0, 1.5], heart)).toBe(false); // in the doorway
    expect(heartReached(h, [6.9, 0, 1.5], heart)).toBe(false); // against the far wall
    expect(heartReached(h, [2, 0, 1.5], heart)).toBe(false); // room a
    expect(heartReached(h, [10, 0, 1.5], heart)).toBe(false); // outside
  });
  it("judges the room, not the distance to the prop", () => {
    expect(heartReached(h, [6.6, 0, 2.6], heart)).toBe(true);
  });
});

describe("pickupReach", () => {
  const h = withMoments();
  it("plan reach on the same floor", () => {
    expect(pickupReach(h, [1, 0, 2.5], disk)).toBe(true);
    expect(pickupReach(h, [1 + PICKUP_REACH_M, 0, 2.5], disk)).toBe(true);
    expect(pickupReach(h, [1 + PICKUP_REACH_M + 0.01, 0, 2.5], disk)).toBe(false);
  });
  it("the server's slack reaches a little further", () => {
    expect(pickupReach(h, [1 + PICKUP_REACH_M + 0.2, 0, 2.5], disk, PICKUP_SLACK_M)).toBe(true);
    expect(pickupReach(h, [1 + PICKUP_REACH_M + PICKUP_SLACK_M + 0.01, 0, 2.5], disk, PICKUP_SLACK_M)).toBe(false);
  });
  it("within DUCK_MAX_RISE in height, never from another floor", () => {
    const shelf: Prop = { ...disk, pos: [1, DUCK_MAX_RISE, 2.5] };
    expect(pickupReach(h, [1, 0, 2.5], shelf)).toBe(true);
    expect(pickupReach(h, [1, -0.3, 2.5], { ...disk, pos: [1, DUCK_MAX_RISE, 2.5] })).toBe(false);
    const stair = fixture("stair");
    const lower = stair.floors.reduce((a, b) => (a.elevation < b.elevation ? a : b));
    const upper = stair.floors.find((f) => f.id !== lower.id)!;
    const on: Prop = { ...disk, room: stair.rooms.find((r) => r.floor === upper.id)!.id, pos: [0.5, upper.elevation, 0.5] };
    expect(pickupReach(stair, [0.5, upper.elevation, 0.5], on)).toBe(true);
    expect(pickupReach(stair, [0.5, lower.elevation, 0.5], on)).toBe(false);
  });
});

describe("momentProp / propSignal", () => {
  const h = withMoments();
  it("finds a prop only by its kind", () => {
    expect(momentProp(h, "heart", "heart")?.id).toBe("heart");
    expect(momentProp(h, "disk", "pickup")?.item).toBe("virus");
    expect(momentProp(h, "disk", "heart")).toBeNull();
    expect(momentProp(h, "nope", "pickup")).toBeNull();
    expect(heartProps(h).map((p) => p.id)).toEqual(["heart"]);
    expect(pickupProps(h).map((p) => p.id)).toEqual(["disk"]);
  });
  it("posts the prop's own signal, else the kind's default; nothing for other kinds", () => {
    expect(propSignal(heart)).toBe(HEART_SIGNAL);
    expect(propSignal(disk)).toBe(PICKUP_SIGNAL);
    expect(propSignal({ ...heart, signals: { reached: "beat" } })).toBe("beat");
    expect(propSignal({ ...disk, signals: { taken: "grab" } })).toBe("grab");
    expect(propSignal({ ...disk, signals: { taken: " " } })).toBe(PICKUP_SIGNAL);
    expect(propSignal({ ...heart, signals: { taken: "wrong key" } })).toBe(HEART_SIGNAL);
    expect(propSignal({ id: "k", room: "a", kind: "king", pos: [0, 0, 0], size: [1, 1, 1] })).toBe("");
  });
});
