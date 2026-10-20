import { describe, expect, it } from "vitest";
import { DEFAULT_SPOT_FOV } from "@loom/house";
import { flicker, inShadow, mirroredFor, shadowCamera, spotFloor } from "../src/shadow/shadow.ts";
import { twoRooms } from "./world-fixture.ts";

describe("the shadow view", () => {
  const house = twoRooms();
  const spot = house.terminals[0]!;
  it("is the tablet's own camera", () => {
    const cam = shadowCamera(spot);
    expect(cam.fov).toBe(DEFAULT_SPOT_FOV);
    expect(cam.pos[0]).toBeGreaterThan(0); // a hair into the room (facing +x)
    expect(cam.look[0]).toBeGreaterThan(cam.pos[0]);
  });
  it("draws players on its floor in front of it", () => {
    const floor = spotFloor(house, spot);
    expect(floor).toBe("g");
    expect(inShadow(spot, floor, { p: [3, 0, 2], floor: "g" }, 16 / 10)).toBe(true);
    expect(inShadow(spot, floor, { p: [3, 0, 2], floor: "up" }, 16 / 10)).toBe(false);
    expect(inShadow(spot, floor, { p: [-2, 0, 2], floor: "g" }, 16 / 10)).toBe(false); // behind the wall
    expect(inShadow(spot, floor, { p: [0.5, 0, 6], floor: "g" }, 16 / 10)).toBe(false); // far off to the side
    expect(inShadow(spot, floor, { p: [30, 0, 2], floor: "g" }, 16 / 10)).toBe(false); // too far
  });
  it("mirrors a selfie camera, and flickers within bounds", () => {
    expect(mirroredFor("user")).toBe(true);
    expect(mirroredFor("environment")).toBe(false);
    for (let t = 0; t < 5000; t += 17) {
      const o = flicker(t, 3);
      expect(o).toBeGreaterThanOrEqual(0.15);
      expect(o).toBeLessThanOrEqual(0.85);
    }
  });
});
