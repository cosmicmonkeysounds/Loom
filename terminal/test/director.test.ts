import { describe, expect, it } from "vitest";
import { DEFAULT_SPOT_FOV, type TerminalSpot, type Vec3 } from "@loom/house";
import {
  CHASE_HEIGHT,
  MIN_HOLD,
  MIN_PULL,
  CELEBRATE_HOLD,
  MOUNT_FOV,
  SWITCH_GAP,
  chooseShot,
  direct,
  firstHit,
  followCamera,
  insideHead,
  mountCamera,
  shotFloor,
  windowPose,
  type Director,
  type DirectorInput,
  type DirectorPlayer,
} from "../src/world/director.ts";
import { twoRooms, wallsOf } from "./world-fixture.ts";

const house = twoRooms();
const walls = wallsOf(house);
const spot = house.terminals[0]!;

function player(session: string, p: Vec3, over: Partial<DirectorPlayer> = {}): DirectorPlayer {
  return { session, name: `Prog ${session}`, p, yaw: 0, pitch: 0, room: p[0] < 4 ? "a" : "b", floor: "g", lastActive: 0, foundAt: null, ...over };
}
function input(players: DirectorPlayer[], now: number, over: Partial<DirectorInput> = {}): DirectorInput {
  return { house, walls, spot, players, now, dt: 1 / 30, ...over };
}
/** An unplaced terminal (no spot on the map): the follow / orbit director. */
const loose = (players: DirectorPlayer[], now: number) => input(players, now, { spot: null });
const inRoom = (p: Vec3, [x0, z0, x1, z1]: [number, number, number, number]) => p[0] > x0 && p[0] < x1 && p[2] > z0 && p[2] < z1;

describe("director — choosing the shot", () => {
  it("a placed terminal is always the window: mounted with nobody playing, nobody in its room, or someone in it", () => {
    const window = windowPose(house, spot);
    // Nobody in the simulation.
    let d = direct(input([], 12_345), null);
    expect(d.shot).toEqual({ kind: "mount", spot: "ta", room: "a", subject: null });
    expect(d.cam).toEqual(window);
    // Someone in its room: they are the subject; the camera never moves.
    d = direct(input([player("s1", [2, 0, 2])], 13_000), d);
    expect(d.shot).toEqual({ kind: "mount", spot: "ta", room: "a", subject: "s1" });
    expect(d.cam).toEqual(window);
    // They walk out into B and play on for a long time: still the window, no follow, no orbit.
    for (const t of [14_000, 20_000, 60_000]) {
      d = direct(input([player("s1", [6, 0, 2], { lastActive: t })], t), d);
      expect(d.shot).toEqual({ kind: "mount", spot: "ta", room: "a", subject: null });
      expect(d.cam).toEqual(window);
    }
    expect(d.cutAt).toBe(12_345); // never a cut
  });

  it("a find never moves a window's camera", () => {
    const d = direct(input([player("A", [7, 0, 2], { foundAt: 1000, lastActive: 1000 })], 1000 + CELEBRATE_HOLD / 2), null);
    expect(d.shot.kind).toBe("mount");
    expect(d.cam).toEqual(windowPose(house, spot));
  });

  it("keeps the subject named first among those in its room", () => {
    let d = direct(input([player("A", [1, 0, 1], { lastActive: 10 }), player("B", [3, 0, 3], { lastActive: 5 })], 10), null);
    expect(d.shot).toMatchObject({ subject: "A" });
    d = direct(input([player("A", [1, 0, 1], { lastActive: 10 }), player("B", [3, 0, 3], { lastActive: 50 })], 50), d);
    expect(d.shot).toMatchObject({ subject: "A" });
    d = direct(input([player("A", [6, 0, 1], { lastActive: 60 }), player("B", [3, 0, 3], { lastActive: 50 })], 60), d);
    expect(d.shot).toMatchObject({ subject: "B" });
  });

  it("an unplaced terminal orbits the spawn room when nobody plays", () => {
    const d = direct(loose([], 12_345), null);
    expect(d.shot).toEqual({ kind: "orbit", room: "a" });
    expect(inRoom(d.cam.pos, [0, 0, 4, 4])).toBe(true);
    expect(d.cam.pos[1]).toBeLessThan(2.5);
  });

  it("never mounts an unplaced terminal", () => {
    expect(chooseShot(loose([player("s1", [2, 0, 2])], 0), null)).toEqual({ kind: "follow", subject: "s1", room: "a" });
  });

  it("an unplaced terminal follows the freshest player, holding them until another is clearly fresher", () => {
    const a = (t: number) => player("A", [5, 0, 1], { lastActive: t });
    const b = (t: number) => player("B", [7, 0, 3], { lastActive: t });
    let d = direct(loose([a(1000), b(0)], 1000), null);
    expect(d.shot).toMatchObject({ kind: "follow", subject: "A" });
    // B moves just after the cut: held.
    d = direct(loose([a(1000), b(2000)], 2000), d);
    expect(d.shot).toMatchObject({ subject: "A" });
    // Past the hold but B is barely fresher: still A.
    d = direct(loose([a(1000 + MIN_HOLD), b(1000 + MIN_HOLD + SWITCH_GAP - 1)], 1000 + MIN_HOLD + SWITCH_GAP), d);
    expect(d.shot).toMatchObject({ subject: "A" });
    // A has stood still; B is clearly fresher: cut to B.
    const t = 1000 + MIN_HOLD + SWITCH_GAP + 10;
    d = direct(loose([a(1000 + MIN_HOLD), b(t)], t), d);
    expect(d.shot).toMatchObject({ subject: "B" });
    expect(d.cutAt).toBe(t);
    // B leaves: straight back to A, hold or not.
    d = direct(loose([a(1000 + MIN_HOLD)], t + 1), d);
    expect(d.shot).toMatchObject({ subject: "A" });
  });

  it("a player who just found the duck takes an unplaced terminal's camera", () => {
    const prev = direct(loose([player("A", [5, 0, 1], { lastActive: 900 }), player("B", [7, 0, 2])], 1000), null);
    expect(prev.shot).toMatchObject({ subject: "A" });
    const d = direct(loose([player("A", [5, 0, 1], { lastActive: 1100 }), player("B", [7, 0, 2], { foundAt: 1050 })], 1100), prev);
    expect(d.shot).toMatchObject({ kind: "follow", subject: "B" });
  });

  it("names the floor of the shot", () => {
    expect(shotFloor(house, { kind: "orbit", room: "a" }, [])).toBe("g");
    expect(shotFloor(house, { kind: "follow", subject: "s1", room: "b" }, [{ session: "s1", floor: "g" }])).toBe("g");
  });
});

describe("director — framing", () => {
  it("the mounted camera is the terminal: at the screen, along its yaw, pitched down, its fov", () => {
    const cam = mountCamera(spot);
    expect(cam.pos[0]).toBeCloseTo(0.15);
    expect(cam.pos[1]).toBeCloseTo(1.4);
    expect(cam.pos[2]).toBeCloseTo(2);
    expect(cam.look[0]).toBeGreaterThan(cam.pos[0] + 3); // facing east, into the room
    expect(cam.look[1]).toBeLessThan(cam.pos[1]); // a little down (−8°)
    expect(cam.fov).toBe(DEFAULT_SPOT_FOV); // unset = the contract's 70° vertical
    expect(MOUNT_FOV).toBe(DEFAULT_SPOT_FOV);
    const custom: TerminalSpot = { ...spot, pitch: 0, fov: 50 };
    expect(mountCamera(custom).look[1]).toBeCloseTo(1.4);
    expect(mountCamera(custom).fov).toBe(50);
  });

  it("chases over the right shoulder in the open", () => {
    // Facing north in the middle of B: behind is south, right is east.
    const cam = followCamera(house, walls, { p: [6, 0, 1], yaw: 0, room: "b" });
    expect(cam.pos[0]).toBeCloseTo(6.45);
    expect(cam.pos[1]).toBeCloseTo(CHASE_HEIGHT);
    expect(cam.pos[2]).toBeCloseTo(3.4);
    expect(cam.look[2]).toBeLessThan(1.5);
  });

  it("pulls in short of a wall, but looks through a doorway", () => {
    // Facing north near B's south wall: the camera would be outside the house.
    const pulled = followCamera(house, walls, { p: [6, 0, 2.5], yaw: 0, room: "b" });
    expect(pulled.pos[2]).toBeLessThan(4);
    expect(pulled.pos[2]).toBeGreaterThan(2.5);
    // Facing east just through the door: the camera stays back in A, in view through the gap.
    const through = followCamera(house, walls, { p: [5, 0, 2], yaw: -90, room: "b" });
    expect(through.pos[0]).toBeCloseTo(2.6);
    expect(through.pos[2]).toBeCloseTo(2.45);
    // The same, off the door's line: the wall between the rooms stops it.
    const blocked = followCamera(house, walls, { p: [5, 0, 1], yaw: -90, room: "b" });
    expect(blocked.pos[0]).toBeGreaterThan(4);
  });

  it("turns to frame the duck once the player is close to it", () => {
    // Facing north in B, the duck 2 m east: the camera goes behind them on the
    // line to the duck (west of them) and looks at the duck, not ahead.
    const cam = followCamera(house, walls, { p: [6, 0, 2], yaw: 0, room: "b", duck: [8, 0, 2] });
    expect(cam.pos[0]).toBeLessThan(6);
    expect(cam.look[0]).toBeCloseTo(8);
    expect(cam.look[1]).toBeCloseTo(0.25);
    expect(cam.look[2]).toBeCloseTo(2);
    // Far from it (or on another floor), the usual over-the-shoulder chase.
    const far = followCamera(house, walls, { p: [6, 0, 1], yaw: 0, room: "b", duck: [6, 0, 9] });
    expect(far.look[2]).toBeLessThan(1);
    const below = followCamera(house, walls, { p: [6, 0, 1], yaw: 0, room: "b", duck: [6.5, -2.7, 1] });
    expect(below.look[1]).toBeCloseTo(1.2);
  });

  it("never ends up in or past a wall's slab, even with the player's back to it", () => {
    const face = 4 - 0.1 / 2; // B's south wall at z = 4, 0.1 thick
    // A web player against the wall (collision radius 0.25), square and turned a little.
    for (const yaw of [0, 10, -10, 15, -15, 30, -30]) {
      const cam = followCamera(house, walls, { p: [6, 0, 3.75], yaw, room: "b" });
      expect(cam.pos[2]).toBeLessThanOrEqual(face);
    }
    // A VR head leaning nearer than the body could stand.
    const vr = followCamera(house, walls, { p: [6, 0, 3.9], yaw: 0, room: "b" });
    expect(vr.pos[2]).toBeLessThanOrEqual(face);
    // With no room behind at all, the camera is the player's eyes (their ghost hidden).
    expect(insideHead(vr, [6, 0, 3.9])).toBe(true);
    // A chase that had room keeps the ghost.
    const open = followCamera(house, walls, { p: [6, 0, 1], yaw: 0, room: "b" });
    expect(insideHead(open, [6, 0, 1])).toBe(false);
  });

  it("a little room behind: a raised chase rather than a camera in the head", () => {
    const cam = followCamera(house, walls, { p: [6, 0, 3.55], yaw: 0, room: "b" });
    expect(cam.pos[2]).toBeLessThanOrEqual(4 - 0.05);
    expect(insideHead(cam, [6, 0, 3.55])).toBe(false);
    expect(Math.hypot(cam.pos[0] - 6, cam.pos[1] - 1.5, cam.pos[2] - 3.55)).toBeGreaterThanOrEqual(MIN_PULL - 1e-9);
  });

  it("treats walls as slabs: the hit is at the near face plus the clearance", () => {
    // A's south wall at z = 4: from z = 2 toward z = 6, the face (+0.11 clear) is at 3.89.
    expect(firstHit(walls, [2, 1, 2], [2, 1, 6], 0.08, 0.11)).toBeCloseTo((3.89 - 2) / 4);
    // Already inside the slab and heading in: hit at once; heading out: no hit.
    expect(firstHit(walls, [2, 1, 3.95], [2, 1, 6], 0.08, 0.11)).toBe(0);
    expect(firstHit(walls, [2, 1, 3.95], [2, 1, 2], 0.08, 0.11)).toBe(1);
    // Short of the face: no hit.
    expect(firstHit(walls, [2, 1, 2], [2, 1, 3.8], 0.08, 0.11)).toBe(1);
  });

  it("stays under a low ceiling", () => {
    const low = twoRooms({ heightA: 1.9 });
    const cam = followCamera(low, wallsOf(low), { p: [2, 0, 1], yaw: 0, room: "a" });
    expect(cam.pos[1]).toBeLessThanOrEqual(1.9 - 0.15 + 1e-9);
  });

  it("finds the first wall a segment crosses", () => {
    expect(firstHit(walls, [2, 1, 2], [2, 1, 6])).toBeCloseTo(0.5); // A's south wall at z = 4
    expect(firstHit(walls, [2, 1, 2], [3, 1, 3])).toBe(1); // nothing in between
    expect(firstHit(walls, [3, 1, 2], [5, 1, 2])).toBe(1); // through the door
    expect(firstHit(walls, [3, 2.2, 2], [5, 2.2, 2])).toBeCloseTo(0.5); // …but not over it (the lintel)
  });

  it("smooths within a shot and cuts between shots (unplaced)", () => {
    const first = direct(loose([player("A", [6, 0, 1])], 0), null);
    const target = followCamera(house, walls, { p: [6, 0, 0.5], yaw: 0, room: "b" });
    const next: Director = direct(loose([player("A", [6, 0, 0.5])], 33), first);
    expect(next.cam.pos[2]).toBeLessThan(first.cam.pos[2]);
    expect(next.cam.pos[2]).toBeGreaterThan(target.pos[2]);
    const cut = direct(loose([], 66), next);
    expect(cut.shot.kind).toBe("orbit");
    expect(cut.cutAt).toBe(66);
  });

  it("the window pose is the mount camera, kept under a low ceiling", () => {
    expect(windowPose(house, spot)).toEqual(mountCamera(spot));
    const low = twoRooms({ heightA: 1.5 });
    const lowSpot = low.terminals[0]!;
    const cam = windowPose(low, lowSpot);
    expect(cam.pos[1]).toBeCloseTo(1.5 - 0.15);
    expect(cam.look[1] - cam.pos[1]).toBeCloseTo(mountCamera(lowSpot).look[1] - mountCamera(lowSpot).pos[1]);
  });
});

describe("director — stays pure", () => {
  it("imports no three.js (the shadow view takes its window pose without the renderer)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["director.ts", "label-point.ts", "overlay.ts", "minimap.ts"]) {
      const src = readFileSync(new URL(`../src/world/${f}`, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/from\s+["'](three|@loom\/house\/three)/);
    }
  });
});
