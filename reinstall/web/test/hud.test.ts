import { describe, expect, it } from "vitest";
import { bearingOf, compassPoint, formatElapsed, FOUND_DY, foundRetryMs, heat, PAUSED_NOTICE, REACH, relativeBearing, roomTitle, withinReach } from "../src/game/hud.ts";
import { SHOW, STAIR } from "./houses.ts";

describe("hud", () => {
  it("reaching the duck: within 0.9 m on the plan and on its floor", () => {
    const house = STAIR();
    const duck = house.duck.spots[0]!; // cellar, (0.5, −3, 3.5)
    expect(REACH).toBe(0.9);
    expect(withinReach(house, [0.5 + 0.85, -3, 3.5], duck)).toBe(true);
    expect(withinReach(house, [0.5 + 0.95, -3, 3.5], duck)).toBe(false);
    // Right above it, a floor up: not there yet.
    expect(withinReach(house, [0.5, 0, 3.5], duck)).toBe(false);
  });

  it("a duck raised past the server's 1.2 m is never 'in reach' (no endless refused finds)", () => {
    const house = SHOW();
    const duck = { id: "shelf", room: "kitchen", pos: [3, 1.5, 6] as [number, number, number] };
    expect(FOUND_DY).toBe(1.2);
    // Same floor by floorOf (the top floor takes any height), right underneath.
    expect(withinReach(house, [3, 0, 6], duck)).toBe(false);
    expect(withinReach(house, [3, 0, 6], { ...duck, pos: [3, 1.2, 6] })).toBe(true);
    expect(withinReach(house, [3, 0, 6], { ...duck, pos: [3, 0.9, 6] })).toBe(true);
  });

  it("names the room and its story location", () => {
    const house = SHOW();
    expect(roomTitle(house, [3, 0, 8])).toEqual({ room: "Desktop", location: "The Desktop" });
    expect(roomTitle(house, [100, 0, 100]).location).toBeNull();
  });

  it("heat: absolute when close, else the trend", () => {
    expect(heat(0.5, null)).toBe("found");
    expect(heat(1.2, 5)).toBe("burning");
    expect(heat(3, 5)).toBe("hot");
    expect(heat(8, 9)).toBe("warmer");
    expect(heat(9, 8)).toBe("colder");
    expect(heat(8, 8.1)).toBe("steady");
    expect(heat(20, null)).toBe("cold");
  });

  it("formats the clock", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65_400)).toBe("1:05");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
    expect(formatElapsed(-5)).toBe("0:00");
  });

  it("compass bearings run clockwise from north; house yaw runs the other way", () => {
    expect(bearingOf(0)).toBe(0);
    expect(bearingOf(90)).toBe(270); // + yaw turns left, to the west
    expect(bearingOf(-90)).toBe(90);
    expect(compassPoint(-45)).toBe("NE");
    expect(compassPoint(180)).toBe("S");
  });

  it("relativeBearing: the target's on-screen angle, clockwise from ahead", () => {
    expect(relativeBearing([0, 0, 0], [1, 0, 0], 0)).toBeCloseTo(90); // facing north, east is right
    expect(relativeBearing([0, 0, 0], [1, 0, 0], -90)).toBeCloseTo(0); // facing east
    expect(relativeBearing([0, 0, 0], [0, 0, -1], -90)).toBeCloseTo(-90); // north is left
    expect(Math.abs(relativeBearing([0, 0, 0], [0, 0, 1], 0))).toBeCloseTo(180);
    expect(relativeBearing([1, 0, 1], [1, 5, 1], 0)).toBe(0);
  });
});

describe("hud — asking for the find again", () => {
  it("backs off 1.5 s, 3 s, 6 s, then every 10 s", () => {
    expect([0, 1, 2, 3, 4, 9].map(foundRetryMs)).toEqual([1500, 3000, 6000, 10_000, 10_000, 10_000]);
    expect(foundRetryMs(-1)).toBe(1500);
  });

  it("a paused run says paused, not out of reach", () => {
    expect(PAUSED_NOTICE).toMatch(/paused/i);
    expect(PAUSED_NOTICE).not.toMatch(/reach/i);
  });
});
