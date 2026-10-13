import { describe, expect, it } from "vitest";
import { PoseBuffer, labelPoint, lerpYaw, trailPoints, wallBoxes } from "../src/three/index.ts";
import { buildWalls, distanceToBoundary, pointInPolyStrict, yawToward } from "../src/index.ts";
import type { PlayerPose, Vec2, Vec3, WallSegment } from "../src/index.ts";
import { fixture } from "./golden.ts";

const pose = (p: Vec3, yaw: number, pitch = 0): PlayerPose => ({ p, yaw, pitch });

describe("PoseBuffer", () => {
  it("is empty until a pose arrives, then holds the only one", () => {
    const b = new PoseBuffer();
    expect(b.sample(1000)).toBeNull();
    b.push(1000, pose([1, 0, 2], 30, 5));
    expect(b.sample(0)).toEqual(pose([1, 0, 2], 30, 5));
    expect(b.sample(5000)).toEqual(pose([1, 0, 2], 30, 5));
  });

  it("renders `delay` behind and interpolates position + pitch linearly", () => {
    const b = new PoseBuffer({ delay: 120 });
    b.push(0, pose([0, 0, 0], 0, 0));
    b.push(100, pose([1, 0.5, -2], 0, 10));
    const s = b.sample(170)!; // target 50 → halfway
    expect(s.p).toEqual([0.5, 0.25, -1]);
    expect(s.pitch).toBeCloseTo(5);
    expect(b.sample(120)!.p).toEqual([0, 0, 0]);
    expect(b.sample(220)!.p).toEqual([1, 0.5, -2]);
  });

  it("turns the short way across ±180", () => {
    expect(lerpYaw(170, -170, 0.5)).toBeCloseTo(-180);
    expect(lerpYaw(-170, 170, 0.25)).toBeCloseTo(-175);
    expect(lerpYaw(10, -10, 0.5)).toBeCloseTo(0);
    const b = new PoseBuffer({ delay: 0 });
    b.push(0, pose([0, 0, 0], 170));
    b.push(100, pose([0, 0, 0], -170));
    expect(b.sample(25)!.yaw).toBeCloseTo(175);
    expect(b.sample(75)!.yaw).toBeCloseTo(-175);
  });

  it("extrapolates along the last velocity for maxExtrapolate, then eases back onto the newest sample", () => {
    const b = new PoseBuffer({ delay: 0, maxExtrapolate: 100 });
    b.push(0, pose([0, 0, 0], 10));
    b.push(100, pose([0.2, 0, 0], 20));
    const ahead = b.sample(150)!; // 50 past → half a step more
    expect(ahead.p[0]).toBeCloseTo(0.3);
    expect(ahead.yaw).toBeCloseTo(25);
    expect(b.sample(200)!.p[0]).toBeCloseTo(0.4); // the furthest it leads
    expect(b.sample(250)!.p[0]).toBeCloseTo(0.3); // easing back
    expect(b.sample(300)).toEqual(pose([0.2, 0, 0], 20)); // settled where they stand
    expect(b.sample(10_000)).toEqual(pose([0.2, 0, 0], 20));
  });

  it("turns the short way across ±180 while extrapolating", () => {
    const b = new PoseBuffer({ delay: 0, maxExtrapolate: 100 });
    b.push(0, pose([0, 0, 0], 170));
    b.push(100, pose([0, 0, 0], -170));
    expect(b.sample(150)!.yaw).toBeCloseTo(-160);
  });

  it("floors the velocity span: frames delivered together don't fling the ghost (regression)", () => {
    const b = new PoseBuffer({ delay: 0 });
    // 10 Hz game time, but the last two frames arrived in one chunk 0.3 ms apart.
    b.push(0, pose([0, 0, 0], 0));
    b.push(100, pose([0.18, 0, 0], 0));
    b.push(400, pose([0.36, 0, 0], 0));
    b.push(400.3, pose([0.54, 0, 0], 10));
    for (const t of [450, 500.3, 550]) {
      const s = b.sample(t)!;
      expect(s.p[0]).toBeGreaterThanOrEqual(0.54);
      expect(s.p[0]).toBeLessThanOrEqual(0.54 + 0.3 + 1e-9);
      expect(Math.abs(s.yaw - 10)).toBeLessThanOrEqual(30 + 1e-9);
    }
    // The player stopped (no newer sample): settled exactly on the last pose.
    expect(b.sample(700)).toEqual(pose([0.54, 0, 0], 10));
    expect(b.sample(5000)).toEqual(pose([0.54, 0, 0], 10));
  });

  it("caps the lead at maxLead metres and maxTurn degrees", () => {
    const b = new PoseBuffer({ delay: 0, maxExtrapolate: 100, maxLead: 0.3, maxTurn: 30 });
    b.push(0, pose([0, 0, 0], 0, 0));
    b.push(100, pose([3, 0, 4], 90, 40)); // 5 m and 90° in one frame
    const s = b.sample(200)!;
    expect(Math.hypot(s.p[0] - 3, s.p[1], s.p[2] - 4)).toBeCloseTo(0.3);
    expect(s.p[0] - 3).toBeCloseTo(0.18); // along the same direction
    expect(s.yaw).toBeCloseTo(120);
    expect(s.pitch).toBeCloseTo(70);
  });

  it("orders out-of-order pushes, replaces a duplicate time, and caps capacity", () => {
    const b = new PoseBuffer({ delay: 0, capacity: 3 });
    b.push(200, pose([2, 0, 0], 0));
    b.push(0, pose([0, 0, 0], 0));
    b.push(100, pose([9, 0, 0], 0));
    b.push(100, pose([1, 0, 0], 0));
    expect(b.size).toBe(3);
    expect(b.sample(150)!.p[0]).toBeCloseTo(1.5);
    b.push(300, pose([3, 0, 0], 0));
    expect(b.size).toBeLessThanOrEqual(3);
    expect(b.latest()!.t).toBe(300);
    expect(b.sample(250)!.p[0]).toBeCloseTo(2.5);
  });
});

describe("trailPoints", () => {
  it("puts a chevron every step, anchored at the end, pointing along each leg", () => {
    // North 3 m, then west 1.5 m (length 4.5).
    const path: Vec3[] = [
      [0, 0, 0],
      [0, 0, -3],
      [-1.5, 0, -3],
    ];
    const pts = trailPoints(path, 0.75, 0.4);
    // From the end: 0.75, 1.5, …, 3.75 back (4.5 − 3.75 = 0.75 ≥ 0.4) → 5 chevrons; 4.5 is the start itself.
    expect(pts.length).toBe(5);
    const last = pts[pts.length - 1]!;
    expect(last.p[0]).toBeCloseTo(-0.75);
    expect(last.p[2]).toBeCloseTo(-3);
    expect(last.yaw).toBeCloseTo(90); // walking west = turning left of north
    expect(pts[0]!.yaw).toBeCloseTo(0); // walking north
    expect(pts[0]!.p[2]).toBeCloseTo(-0.75);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!.p;
      const b = pts[i]!.p;
      // Straight legs: exactly a step apart, except across the corner.
      if (a[0] === 0 && b[0] === 0) expect(Math.hypot(b[0] - a[0], b[2] - a[2])).toBeCloseTo(0.75);
    }
  });

  it("keeps chevrons ahead still while the start moves", () => {
    const a = trailPoints(
      [
        [0, 0, 0],
        [0, 0, -6],
      ],
      0.75,
    );
    const b = trailPoints(
      [
        [0, 0, -0.3],
        [0, 0, -6],
      ],
      0.75,
    );
    const zs = (pts: typeof a) => pts.map((p) => +p.p[2].toFixed(6));
    expect(zs(a).slice(-6)).toEqual(zs(b).slice(-6));
    expect(a.every((p) => Math.abs(p.yaw) < 1e-9)).toBe(true);
  });

  it("drops the underfoot chevron and handles degenerate paths", () => {
    expect(trailPoints([[0, 0, 0]])).toEqual([]);
    expect(
      trailPoints([
        [0, 0, 0],
        [0, 0, -1],
      ]).length,
    ).toBe(0); // 1 − 0.75 = 0.25 < 0.4
    const yaw = yawToward([0, 0, 0], [1, 0, 1]);
    const diag = trailPoints([
      [0, 0, 0],
      [3, 0, 3],
    ]);
    expect(diag.every((p) => Math.abs(p.yaw - yaw) < 1e-9)).toBe(true);
  });
});

describe("labelPoint", () => {
  it("uses the centre of a rectangle", () => {
    expect(
      labelPoint([
        [0, 0],
        [4, 0],
        [4, 2],
        [0, 2],
      ]),
    ).toEqual([2, 1]);
  });

  it("stays inside an L whose bounds' centre is outside", () => {
    const l: Vec2[] = [
      [0, 0],
      [6, 0],
      [6, 1],
      [1, 1],
      [1, 6],
      [0, 6],
    ];
    const p = labelPoint(l);
    expect(pointInPolyStrict(l, p)).toBe(true);
    expect(distanceToBoundary(l, p)).toBeGreaterThan(0.2);
  });
});

describe("wallBoxes", () => {
  it("one box per segment, sized by kind, corners closed, door jambs not widened", () => {
    const house = fixture("two-rooms");
    const walls = buildWalls(house);
    const boxes = wallBoxes(walls, 0.1);
    expect(boxes.length).toBe(walls.length);
    walls.forEach((w, i) => {
      const b = boxes[i]!;
      const [run, across] = w.axis === "x" ? [b.size[0], b.size[2]] : [b.size[2], b.size[0]];
      expect(across).toBeCloseTo(w.kind === "rail" ? 0.05 : w.kind === "fence" ? 0.06 : 0.1);
      expect(b.size[1]).toBeCloseTo(w.top - w.bottom);
      expect(run).toBeGreaterThanOrEqual(w.hi - w.lo - 1e-9);
      expect(run).toBeLessThanOrEqual(w.hi - w.lo + 0.1 + 1e-9);
    });
    // The north wall's first piece starts at the NW corner (extended) and ends at a door (not).
    const north = walls.findIndex((w) => w.axis === "x" && w.c === 0 && w.lo === 0 && w.kind === "wall");
    const b = boxes[north]!;
    expect(b.center[0] - b.size[0] / 2).toBeCloseTo(-0.05);
    expect(b.center[0] + b.size[0] / 2).toBeCloseTo(walls[north]!.hi);
  });

  it("does not join across floors or non-overlapping heights", () => {
    const segs: WallSegment[] = [
      { floor: "a", axis: "x", c: 0, lo: 0, hi: 2, bottom: 0, top: 2.5, kind: "wall" },
      { floor: "b", axis: "z", c: 0, lo: 0, hi: 2, bottom: 0, top: 2.5, kind: "wall" },
      { floor: "a", axis: "z", c: 2, lo: 0, hi: 2, bottom: 3, top: 4, kind: "wall" },
    ];
    const [first] = wallBoxes(segs, 0.1);
    expect(first!.size[0]).toBeCloseTo(2);
  });
});
