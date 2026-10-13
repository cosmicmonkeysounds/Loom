import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPOT_FOV,
  IDENTITY_SPACE,
  TABLET_ASPECT,
  fnv1a32,
  forward,
  fromSpace,
  horizontalFov,
  houseHash,
  pickDuckSpot,
  spaceOf,
  toSpace,
  wrapYaw,
  yawFromSpace,
  yawToSpace,
} from "../src/index.ts";
import type { SpaceTransform, Vec3 } from "../src/index.ts";
import { fixture } from "./golden.ts";

const close = (a: Vec3, b: Vec3): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));

describe("terminal fov", () => {
  it("is vertical, 70° by default, widened by the tablet's aspect", () => {
    expect(DEFAULT_SPOT_FOV).toBe(70);
    expect(TABLET_ASPECT).toBe(1.6);
    expect(horizontalFov(DEFAULT_SPOT_FOV)).toBeCloseTo(96.4963, 3);
    expect(horizontalFov(70, 16 / 10)).toBe(horizontalFov(70));
    // Square: the same both ways; portrait: narrower.
    expect(horizontalFov(60, 1)).toBeCloseTo(60, 9);
    expect(horizontalFov(60, 0.5)).toBeLessThan(60);
  });
});

describe("space transforms", () => {
  it("defaults to the identity", () => {
    expect(toSpace(undefined, [1, 2, 3])).toEqual([1, 2, 3]);
    expect(spaceOf(fixture("two-rooms"), "vr")).toEqual(IDENTITY_SPACE);
    expect(yawToSpace(undefined, 45)).toBe(45);
  });

  it("rotates counter-clockwise seen from above, scales, then offsets", () => {
    const t: SpaceTransform = { offset: [10, 0, -2], yaw: 90, scale: 2 };
    // North (−z) turned 90° left is west (−x).
    close(toSpace({ offset: [0, 0, 0], yaw: 90, scale: 1 }, [0, 0, -1]), [-1, 0, 0]);
    close(toSpace(t, [1, 1, 0]), [10, 2, -4]);
    expect(yawToSpace(t, 135)).toBe(-135);
    expect(yawFromSpace(t, -135)).toBe(135);
  });

  it("round-trips points and yaws", () => {
    const t = spaceOf(fixture("stair"), "vr");
    for (const p of [
      [0, 0, 0],
      [1.5, -3, 2.25],
      [-7, 1.6, 12],
    ] as Vec3[]) {
      close(fromSpace(t, toSpace(t, p)), p);
    }
    for (const yaw of [-180, -90, 0, 33, 179]) expect(yawFromSpace(t, yawToSpace(t, yaw))).toBeCloseTo(wrapYaw(yaw), 9);
  });

  it("agrees with the yaw convention", () => {
    close(forward(0), [0, 0, -1]);
    close(forward(90), [-1, 0, 0]);
    close(forward(-90), [1, 0, 0]);
    close(forward(0, 90), [0, 1, 0]);
    expect(wrapYaw(180)).toBe(-180);
    expect(wrapYaw(-190)).toBe(170);
    expect(wrapYaw(720)).toBe(0);
  });
});

describe("the duck", () => {
  it("hashes FNV-1a 32 over UTF-8", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
    expect(fnv1a32("é")).toBe(fnv1a32("é"));
    expect(houseHash(fixture("tie"))).toMatch(/^[0-9a-f]{8}$/);
  });

  it("picks deterministically, outside the spawn room", () => {
    const h = fixture("two-rooms"); // spawn in "a"; spots in-a, in-b, b-corner
    for (const seed of ["s-1", "s-2", "s-3", "abc", "x"]) {
      const spot = pickDuckSpot(h, seed);
      expect(spot.room).toBe("b");
      expect(pickDuckSpot(h, seed)).toBe(spot);
      expect(spot.id).toBe(["in-b", "b-corner"][fnv1a32(seed) % 2]);
    }
  });

  it("avoids the last spot while another remains", () => {
    const h = fixture("two-rooms");
    for (const seed of ["s-1", "s-2", "s-3"]) {
      expect(pickDuckSpot(h, seed, ["in-b"]).id).toBe("b-corner");
      expect(pickDuckSpot(h, seed, ["b-corner"]).id).toBe("in-b");
      // Avoiding everything outside the spawn room leaves them as they were.
      expect(pickDuckSpot(h, seed, ["in-b", "b-corner"]).room).toBe("b");
    }
  });

  it("falls back to the spawn room's spots when they are all there is", () => {
    const h = fixture("l-room");
    expect(pickDuckSpot(h, "anything").id).toBe("foot");
    h.duck.spots = [];
    expect(() => pickDuckSpot(h, "x")).toThrow(/no duck spots/);
  });
});
