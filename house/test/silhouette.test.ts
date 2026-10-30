import { describe, expect, it } from "vitest";
import { hiddenFloors, stairWells } from "../src/index.ts";
import { SHOW_HOUSE, fixture, loadHouse } from "./golden.ts";

describe("stairWells", () => {
  it("closes the band between a ceiling and the floor above it", () => {
    expect(stairWells(fixture("stair"))).toEqual([{ stair: "s", floor: "lower", rect: [1, 1, 4, 2], bottom: -0.5, top: 0 }]);
  });

  it("the show: both stairs, each 0.3 m", () => {
    const wells = stairWells(loadHouse(SHOW_HOUSE));
    expect(wells.map((w) => [w.stair, w.floor])).toEqual([
      ["basement-stairs", "basement"],
      ["upstairs", "main"],
    ]);
    for (const w of wells) expect(w.top - w.bottom).toBeCloseTo(0.3, 6);
  });

  it("none where a ceiling meets the floor above", () => {
    const h = fixture("stair");
    h.floors[0]!.height = 3;
    expect(stairWells(h)).toEqual([]);
  });
});

describe("hiddenFloors", () => {
  const show = loadHouse(SHOW_HOUSE);

  it("outside, the house is only its outside floor", () => {
    expect(hiddenFloors(show, null)).toEqual(["top"]);
    expect(hiddenFloors(show, "backyard")).toEqual(["top"]);
    expect(hiddenFloors(show, "tent")).toEqual(["top"]);
  });

  it("shown on an upper floor and at the foot of the stairs up", () => {
    expect(hiddenFloors(show, "upstairs-hall")).toEqual([]);
    expect(hiddenFloors(show, "graphics-card")).toEqual([]);
    expect(hiddenFloors(show, "hall")).toEqual([]);
  });

  it("never hides a floor below the outside, nor anything on a map with no exterior door", () => {
    expect(hiddenFloors(show, "server-room")).toEqual(["top"]);
    expect(hiddenFloors(fixture("stair"), null)).toEqual([]);
  });
});
