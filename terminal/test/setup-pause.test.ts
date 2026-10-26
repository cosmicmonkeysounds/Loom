import { describe, expect, it } from "vitest";
import { defaultConfig, TV_SPEED } from "../src/config.ts";
import { paceForView, pauseLabel, setupPace } from "../src/Setup.tsx";

describe("⚙ pauses slider (wave 26, V2)", () => {
  it("reads the multiplier and the two pauses it makes", () => {
    expect(pauseLabel(1)).toBe("1.00× (0.30 s · 0.70 s)");
    expect(pauseLabel(0)).toBe("0.00× (0.00 s · 0.00 s)");
    expect(pauseLabel(2.5)).toBe("2.50× (0.75 s · 1.75 s)");
  });
});

describe("⚙ pace on a first-time TV (wave 26, V2)", () => {
  const tv = (speed: number) => ({ ...defaultConfig({ eventId: "e", token: "t", title: "", character: "Trabolta" }), view: "tv" as const, speed });
  it("an untouched slider gets the TV's pace; a pace the crew chose stays, even 1.00×", () => {
    expect(setupPace(tv(1), { first: true, speedTouched: false }).speed).toBe(TV_SPEED);
    expect(setupPace(tv(1), { first: true, speedTouched: true }).speed).toBe(1);
    expect(setupPace(tv(1.2), { first: true, speedTouched: false }).speed).toBe(1.2);
    expect(setupPace(tv(1), { first: false, speedTouched: false }).speed).toBe(1); // already set up
    expect(setupPace({ ...tv(1), view: "face" as const }, { first: true, speedTouched: false }).speed).toBe(1);
  });
  it("picking the TV as the screen type moves an untouched slider to its pace", () => {
    expect(paceForView("tv", { first: true, speedTouched: false })).toBe(TV_SPEED);
    expect(paceForView("", { first: true, speedTouched: false })).toBe(1);
    expect(paceForView("tv", { first: true, speedTouched: true })).toBeNull();
    expect(paceForView("tv", { first: false, speedTouched: false })).toBeNull();
  });
});
