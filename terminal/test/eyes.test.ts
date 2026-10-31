import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildWalls, validateHouse, type HouseMap, type Vec3 } from "@loom/house";
import { direct, EYE_HEIGHT, EYES_FOV, EYES_SMOOTH, eyesCamera, shotFloor, shotKey, windowPose, type DirectorInput, type DirectorPlayer } from "../src/world/director.ts";
import { CLOSE_M, EyesJudge, eyesTag, IN_VIEW_M, MIRROR_HOLD_MS, seenBy, type EyesPlayer } from "../src/world/eyes.ts";
import { eyeCamera, EYES_SMOOTH as RAY_SMOOTH } from "../src/raycast/raycast.ts";
import { twoRooms, wallsOf } from "./world-fixture.ts";

/** Room A `width` × `depth`, room B 4 m beyond it, a door on z 2, the terminal on A's west wall looking +x. */
function rooms(width: number, depth = 4): HouseMap {
  const v = validateHouse({
    version: 1,
    name: "test",
    origin: "test",
    floors: [{ id: "g", label: "Ground", elevation: 0, height: 2.5 }],
    rooms: [
      { id: "a", label: "A", floor: "g", poly: [[0, 0], [width, 0], [width, depth], [0, depth]] },
      { id: "b", label: "B", floor: "g", poly: [[width, 0], [width + 4, 0], [width + 4, depth], [width, depth]] },
    ],
    doors: [{ id: "d", a: "a", b: "b", at: [width, 2], width: 0.9 }],
    stairs: [],
    terminals: [{ id: "ta", name: "A", room: "a", pos: [0, 1.4, 2], yaw: -90 }],
    duck: { spots: [{ id: "s", room: "b", pos: [width + 3, 0, 2] }] },
    spawn: { room: "a", pos: [1, 0, 1], yaw: 0 },
    props: [],
    spaces: {},
  });
  if (!v.ok || !v.house) throw new Error(v.problems.join("; "));
  return v.house;
}

function player(session: string, p: Vec3, room: string | null = "a"): EyesPlayer {
  return { session, p, room, floor: "g" };
}

describe("seenBy: close, or in view", () => {
  const house = rooms(12, 10);
  const walls = buildWalls(house);
  const spot = house.terminals[0]!;
  const cam = windowPose(house, spot).pos;
  const across = (d: number): Vec3 => [cam[0] + d, 0, cam[2]];

  it("is close nearby, wherever the terminal looks", () => {
    expect(seenBy(house, walls, spot, player("s", [0.4, 0, 2 + CLOSE_M - 0.1]))).toBe(true);
  });
  it("is in view further out only inside its lens", () => {
    expect(seenBy(house, walls, spot, player("s", across(IN_VIEW_M - 0.1)))).toBe(true);
    expect(seenBy(house, walls, spot, player("s", [0.4, 0, 2 + CLOSE_M + 0.1]))).toBe(false);
  });
  it("sees nothing past its range, or on another floor", () => {
    expect(seenBy(house, walls, spot, player("s", across(IN_VIEW_M + 0.1)))).toBe(false);
    expect(seenBy(house, walls, spot, { p: across(1), floor: "other" })).toBe(false);
  });
  it("stretches both ranges by the slack", () => {
    expect(seenBy(house, walls, spot, player("s", across(IN_VIEW_M + 0.1)), 1.25)).toBe(true);
  });
  it("sees through a doorway, never through the wall beside it", () => {
    const small = rooms(1.8);
    const smallWalls = buildWalls(small);
    expect(seenBy(small, smallWalls, small.terminals[0]!, player("s", [2.4, 0, 2], "b"))).toBe(true);
    expect(seenBy(small, smallWalls, small.terminals[0]!, player("s", [2.2, 0, 3.2], "b"))).toBe(false);
  });
});

describe("EyesJudge: whose eyes, and when the mirror", () => {
  const hall = rooms(12);
  const hallWalls = buildWalls(hall);
  const hallSpot = hall.terminals[0]!;
  const judge = () => {
    const j = new EyesJudge();
    return (players: EyesPlayer[], now: number) => j.update(hall, hallWalls, hallSpot, players, now);
  };
  const far = (s = "s1") => player(s, [9, 0, 2]);
  const near = (s = "s1") => player(s, [1.5, 0, 2]);
  const out = (s = "s1") => player(s, [14, 0, 2], "b");

  it("looks through a program in the room, never with nobody here", () => {
    const j = judge();
    expect(j([], 0)).toBe(null);
    expect(j([out()], 200)).toBe(null);
    expect(j([far()], 400)).toBe("s1");
  });
  it("goes to the mirror at once when the program comes close", () => {
    const j = judge();
    expect(j([far()], 0)).toBe("s1");
    expect(j([near()], 200)).toBe(null);
  });
  it("starts on the mirror for a program who walks in right at the terminal", () => {
    expect(judge()([near()], 0)).toBe(null);
  });
  it("holds the mirror after they walk off", () => {
    const j = judge();
    j([near()], 0);
    expect(j([far()], 200)).toBe(null);
    expect(j([far()], MIRROR_HOLD_MS - 1)).toBe(null);
    expect(j([far()], MIRROR_HOLD_MS)).toBe("s1");
  });
  it("never flickers for a walker standing just past the edge of its range", () => {
    const j = judge();
    j([near()], 0);
    const edge = player("s1", [windowPose(hall, hallSpot).pos[0] + IN_VIEW_M + 0.2, 0, 2]);
    for (let t = 200; t < 3 * MIRROR_HOLD_MS; t += 200) expect(j([edge], t)).toBe(null);
  });
  it("gives the mirror to anyone seen, whoever it was looking through", () => {
    const j = judge();
    expect(j([far("s1")], 0)).toBe("s1");
    expect(j([near("s2"), far("s1")], 200)).toBe(null);
  });
  it("keeps its wearer over a fresher program for as long as they stay", () => {
    const j = judge();
    expect(j([far("s1")], 0)).toBe("s1");
    expect(j([far("s2"), far("s1")], 200)).toBe("s1");
  });
  it("sees a wearer out of the door, then takes the next one or lets go", () => {
    const j = judge();
    expect(j([far("s1"), far("s2")], 0)).toBe("s1");
    expect(j([out("s1"), far("s2")], 200)).toBe("s1");
    expect(j([out("s1"), far("s2")], 2900)).toBe("s1");
    expect(j([out("s1"), far("s2")], 3100)).toBe("s2");
    const k = judge();
    k([far("s1")], 0);
    expect(k([out("s1")], 3100)).toBe(null);
  });
  it("lets go of a program who left the game", () => {
    const j = judge();
    j([far("s1")], 0);
    expect(j([], 200)).toBe(null);
  });
});

describe("the director's eyes shot", () => {
  const house = twoRooms();
  const walls = wallsOf(house);
  const spot = house.terminals[0]!;
  const dp = (session: string, p: Vec3): DirectorPlayer => ({ session, name: session, p, yaw: 0, pitch: 0, room: "a", floor: "g", lastActive: 0, foundAt: null });
  const input = (players: DirectorPlayer[], eyes: string | null, now = 1000, over: Partial<DirectorInput> = {}): DirectorInput => ({ house, walls, spot, players, eyes, now, dt: 1 / 30, ...over });

  it("is their eye, along their yaw and pitch, in the games' fov", () => {
    const cam = eyesCamera(house, { p: [1, 0, 1], yaw: 0, pitch: 0, room: "a" });
    expect(cam.pos).toEqual([1, EYE_HEIGHT, 1]);
    expect(cam.look[2]).toBeLessThan(cam.pos[2]); // yaw 0 = −z
    expect(cam.fov).toBe(EYES_FOV);
    const up = eyesCamera(house, { p: [1, 0, 1], yaw: 0, pitch: 30, room: "a" });
    expect(up.look[1]).toBeGreaterThan(up.pos[1]);
  });
  it("stays under a low ceiling", () => {
    expect(eyesCamera(twoRooms({ heightA: 1.5 }), { p: [1, 0, 1], yaw: 0, pitch: 0, room: "a" }).pos[1]).toBeLessThan(1.5);
  });
  it("cuts to the eyes and back to the window, and smooths inside the shot", () => {
    const s = dp("s1", [1, 0, 1]);
    let d = direct(input([s], null), null);
    expect(d.shot.kind).toBe("mount");
    d = direct(input([s], "s1", 1033), d);
    expect(d.shot).toEqual({ kind: "eyes", spot: "ta", room: "a", subject: "s1" });
    expect(d.cam.pos).toEqual([1, EYE_HEIGHT, 1]);
    d = direct(input([dp("s1", [2, 0, 1])], "s1", 1066), d);
    expect(d.cam.pos[0]).toBeGreaterThan(1);
    expect(d.cam.pos[0]).toBeLessThan(2);
    d = direct(input([s], null, 1100), d);
    expect(d.cam).toEqual(windowPose(house, spot));
  });
  it("is a new shot for a new wearer, on their floor", () => {
    const shot = { kind: "eyes", spot: "ta", room: "a", subject: "s1" } as const;
    expect(shotKey(shot)).not.toBe(shotKey({ ...shot, subject: "s2" }));
    expect(shotFloor(house, shot, [{ session: "s1", floor: "g" }])).toBe("g");
  });
  it("falls back to the window for a session it can't find; an unplaced terminal wears nobody", () => {
    expect(direct(input([dp("s1", [1, 0, 1])], "gone"), null).shot.kind).toBe("mount");
    expect(direct(input([dp("s1", [1, 0, 1])], "s1", 1000, { spot: null }), null).shot.kind).toBe("follow");
  });
});

describe("the raycaster and the copy", () => {
  it("draws the same eye", () => {
    expect(eyeCamera("g", [1, 0, 1], 20, -5)).toEqual({ pos: [1, EYE_HEIGHT, 1], yaw: 20, pitch: -5, fov: EYES_FOV, floor: "g" });
  });
  it("smooths the same", () => {
    expect(RAY_SMOOTH).toBe(EYES_SMOOTH);
  });
  it("names the program", () => {
    expect(eyesTag("Excel")).toBe("THROUGH EXCEL'S EYES");
  });
});

describe("the show's map", () => {
  const show = JSON.parse(readFileSync(new URL("../../core/examples/trapped-in-the-internet/house.json", import.meta.url), "utf8")) as HouseMap;
  const showWalls = buildWalls(show);
  const worldless = new Set(["chess", "casino", "reinstall", "face"]);

  /** The share of a terminal's room where a walker is out of its sight (a half-metre grid). */
  function eyesShare(id: string): number {
    const t = show.terminals.find((x) => x.id === id)!;
    const room = show.rooms.find((r) => r.id === t.room)!;
    const xs = room.poly.map((p) => p[0]);
    const zs = room.poly.map((p) => p[1]);
    let all = 0;
    let unseen = 0;
    for (let x = Math.min(...xs) + 0.3; x < Math.max(...xs); x += 0.5) {
      for (let z = Math.min(...zs) + 0.3; z < Math.max(...zs); z += 0.5) {
        all++;
        if (!seenBy(show, showWalls, t, { p: [x, t.pos[1] - 1.4, z], floor: room.floor })) unseen++;
      }
    }
    return unseen / all;
  }

  it("leaves a walker somewhere to be first-person in every wall's room", () => {
    for (const t of show.terminals) {
      if (t.view !== undefined && worldless.has(t.view)) continue;
      expect([t.id, eyesShare(t.id) > 0.2]).toEqual([t.id, true]);
    }
  });
});
