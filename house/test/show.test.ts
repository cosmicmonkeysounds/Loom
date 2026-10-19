import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forward, heightAt, inPropFootprint, locate, pickDuckSpot, propSolid, roomById, route, validateHouse } from "../src/index.ts";
import type { HouseMap, Vec2, Vec3 } from "../src/index.ts";
import { ROOT, SHOW_HOUSE, SHOW_SHED_HOUSE, loadHouse, samplePoint } from "./golden.ts";

/**
 * The show's house map (core/examples/trapped-in-the-internet/house.json)
 * and its rain variant (house.shed.json: the Internet in the shed).
 */
describe.each([
  ["tent", SHOW_HOUSE],
  ["shed", SHOW_SHED_HOUSE],
])("the show's house map (the Internet in the %s)", (variant, file) => {
  const house: HouseMap = loadHouse(file);

  it("validates with zero problems", () => {
    expect(validateHouse(JSON.parse(readFileSync(file, "utf8"))).problems).toEqual([]);
  });

  it("names only LOCATIONs the story declares", () => {
    const main = readFileSync(join(ROOT, "..", "core", "examples", "trapped-in-the-internet", "main.loom"), "utf8");
    const declared = new Set([...main.matchAll(/^LOCATION (.+)$/gm)].map((m) => m[1]!.trim()));
    for (const room of house.rooms) {
      expect(room.location, room.id).toBeDefined();
      expect(declared.has(room.location!), `${room.id}: ${room.location}`).toBe(true);
    }
  });

  it("reaches every room from the spawn — but the Server Room, whose door the King guards", () => {
    for (const room of house.rooms) {
      const [x, z] = samplePoint(house, room);
      const y = house.floors.find((f) => f.id === room.floor)!.elevation;
      const to: Vec3 = [x, y, z];
      expect(locate(house, to).room).toBe(room.id);
      const path = route(house, house.spawn.pos, to);
      if (room.id === house.spawn.room) expect(path).toHaveLength(2);
      else if (room.id === "server-room") expect(path, "the guarded door is shut for routing").toHaveLength(2);
      else expect(path.length, room.id).toBeGreaterThan(2);
    }
  });

  it("the King guards the Server Room's door: a solid king prop in the doorway, and the room routes once the guard is lifted", () => {
    const door = house.doors.find((d) => d.id === "server-door")!;
    expect(door.guard).toBe("cold-lock-king");
    const king = house.props.find((p) => p.id === door.guard)!;
    expect(king.kind).toBe("king");
    expect(king.room).toBe(door.a);
    expect(propSolid(king)).toBe(true);
    // One shared bar for the night (C1): 15 HP in the story's Night.king_hp.
    expect(king.hp).toBe(15);
    expect(king.health).toBe("Night.king_hp");
    expect(king.signals).toEqual({ won: "chess won", lost: "chess lost", drawn: "chess drawn", hit: "king hit", fallen: "king fallen" });
    expect(king.armed).toEqual({ path: "Night.king_armed", min: 1 });
    // He stands in the gap: a body (radius 0.25) can't pass on either side.
    expect(Math.hypot(king.pos[0] - door.at[0], king.pos[2] - door.at[1])).toBeLessThan(0.5);
    const inside: Vec3 = [-5, -2.7, 9.5];
    expect(route(house, house.spawn.pos, inside)).toHaveLength(2);
    const open: HouseMap = { ...house, doors: house.doors.map((d) => (d.id === door.id ? { ...d, guard: undefined } : d)), props: house.props.filter((p) => p.id !== king.id) };
    const path = route(open, open.spawn.pos, inside);
    expect(path.length).toBeGreaterThan(2);
    expect(path.some((p) => p[0] === door.at[0] && p[2] === door.at[1])).toBe(true);
    // Fallen, the same door through route()'s own option.
    const fallen = route(house, house.spawn.pos, inside, { fallen: new Set([king.id]) });
    expect(fallen.length).toBeGreaterThan(2);
    expect(fallen.some((p) => p[0] === door.at[0] && p[2] === door.at[1])).toBe(true);
  });

  it("hangs the Server Door terminal in the basement hall, facing the King and the server-room door", () => {
    const spot = house.terminals.find((t) => t.id === "server-room-door")!;
    expect(spot).toMatchObject({ name: "Server Door", room: "basement-hall" });
    const door = house.doors.find((d) => d.id === "server-door")!;
    const king = house.props.find((p) => p.id === door.guard)!;
    // Its screen looks at the door: the bearing to it is well inside the view.
    for (const target of [[door.at[0], spot.pos[1], door.at[1]], king.pos] as Vec3[]) {
      const toward = (Math.atan2(-(target[0] - spot.pos[0]), -(target[2] - spot.pos[2])) * 180) / Math.PI;
      expect(Math.abs(((toward - spot.yaw + 540) % 360) - 180)).toBeLessThan(20);
    }
    expect(locate(house, spot.pos).floor).toBe(locate(house, king.pos).floor);
  });

  it("puts every terminal on a wall, facing into its room", () => {
    for (const t of house.terminals) {
      const f = forward(t.yaw);
      const ahead: Vec3 = [t.pos[0] + f[0] * 0.5, t.pos[1], t.pos[2] + f[2] * 0.5];
      const behind: Vec3 = [t.pos[0] - f[0] * 0.5, t.pos[1], t.pos[2] - f[2] * 0.5];
      expect(locate(house, ahead).room, `${t.id} faces into its room`).toBe(t.room);
      expect(locate(house, behind).room, `${t.id} hangs on a wall`).not.toBe(t.room);
    }
    expect(house.terminals.map((t) => t.id).sort()).toEqual(
      ["bathroom-1-door", "desktop-tv", "hall", "optical-drive", "ram", "server-room", "server-room-door", "start-bar", "tent"].sort(),
    );
  });

  it("gives every terminal's mount camera a clear half metre ahead", () => {
    // The terminal's mount shot (terminal/src/world/director.ts mountCamera):
    // the camera stands 0.15 m in front of the screen, looking along its yaw.
    // No solid prop spanning the camera's height may sit within 0.5 m ahead.
    for (const t of house.terminals) {
      const f = forward(t.yaw);
      const cam: Vec3 = [t.pos[0] + f[0] * 0.15, t.pos[1], t.pos[2] + f[2] * 0.15];
      for (let k = 0; k <= 50; k++) {
        const q: Vec2 = [cam[0] + f[0] * (k / 100), cam[2] + f[2] * (k / 100)];
        const hit = house.props.find(
          (p) => propSolid(p) && p.pos[1] <= cam[1] && cam[1] <= p.pos[1] + p.size[1] && inPropFootprint(p, q),
        );
        expect(hit?.id, `${t.id}: ${k} cm ahead of the camera`).toBeUndefined();
      }
    }
  });

  it("hides the duck in every room but the Internet, the Server Room and the halls, on something to stand on", () => {
    const rooms = new Set(house.duck.spots.map((s) => s.room));
    for (const room of house.rooms) {
      const hidesOne = room.id !== variant && room.id !== "server-room" && room.location !== "The Tube";
      expect(rooms.has(room.id), room.id).toBe(hidesOne);
    }
    for (const s of house.duck.spots) {
      expect(locate(house, s.pos).room, s.id).toBe(s.room);
      expect(heightAt(house, [s.pos[0], s.pos[2]], s.pos[1]), s.id).not.toBeNull();
    }
    expect(house.spawn.room).toBe(variant);
    expect(roomById(house, variant)?.location).toBe("The Internet");
    expect(roomById(house, "server-room")?.location).toBe("The Server Room");
    // Never the spawn room.
    for (let i = 0; i < 50; i++) expect(pickDuckSpot(house, `session-${i}`).room).not.toBe(variant);
  });

  it.runIf(variant === "tent")("walks out of the tent, in by the back door, down the basement stairs and into the laundry", () => {
    const mm3 = (p: Vec3): Vec3 => p.map((v) => Math.round(v * 1000) / 1000 + 0) as Vec3;
    expect(route(house, house.spawn.pos, [-6.65, -1.85, 4.4]).map(mm3)).toEqual([
      house.spawn.pos,
      [3, 0, 20.6], // the tent flap
      [-1, 0, 12], // the hall's back door
      [-1.65, 0, 5.65], // round the stair hole's north-east corner
      [-2.45, 0, 6], // the stair's head, in the hall
      [-2.45, -2.7, 10], // its foot
      [-1.65, -2.7, 10.3], // round the King's obstacle corner (a hair short of the stair's south-east one)
      [-1.65, -2.7, 5.65], // and its north-east one
      [-3, -2.7, 4.5], // the laundry door
      [-6.65, -1.85, 4.4], // the duck on the dryer
    ]);
  });

  it.runIf(variant === "tent")("climbs the upstairs from the hall to the top floor", () => {
    const mm3 = (p: Vec3): Vec3 => p.map((v) => Math.round(v * 1000) / 1000 + 0) as Vec3;
    const path = route(house, house.spawn.pos, [5.5, 3.35, 6.6]).map(mm3);
    expect(path.slice(3)).toEqual([
      [-0.3, 0, 5.65], // round the upstairs' north-west corner
      [0.5, 0, 6], // its foot, in the hall
      [0.5, 2.8, 10], // its head, upstairs
      [3, 2.8, 11], // bedroom 2's door
      [5.5, 3.35, 6.6], // the duck on the bed
    ]);
  });
});
