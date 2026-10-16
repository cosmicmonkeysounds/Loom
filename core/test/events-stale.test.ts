//! `stale` covers the project's data files too (wave 5,
//! wave2-stale-flag-maps): `snapshotDiffers` compares the project's current
//! maps + facts.json with what the event row recorded.

import { describe, expect, it } from "vitest";
import { snapshotDiffers } from "../server/events-api.ts";

const HOUSE = '{"version":1}';
const SHED = '{"version":1,"shed":true}';
const FACTS = '{"questions":[]}';

describe("snapshotDiffers", () => {
  it("is false for an old row with no record, and for the same files", () => {
    expect(snapshotDiffers({ "house.json": HOUSE }, null)).toBe(false);
    expect(snapshotDiffers({ "house.json": HOUSE }, undefined)).toBe(false);
    expect(snapshotDiffers({}, {})).toBe(false);
    expect(snapshotDiffers({ "house.json": HOUSE, "house.shed.json": SHED, "facts.json": FACTS }, { "facts.json": FACTS, "house.shed.json": SHED, "house.json": HOUSE })).toBe(false);
  });

  it("is true when a map or facts.json changed, appeared or went away", () => {
    const was = { "house.json": HOUSE, "facts.json": FACTS };
    expect(snapshotDiffers({ "house.json": SHED, "facts.json": FACTS }, was)).toBe(true);
    expect(snapshotDiffers({ "house.json": HOUSE, "facts.json": '{"questions":[1]}' }, was)).toBe(true);
    expect(snapshotDiffers({ "house.json": HOUSE }, was)).toBe(true);
    expect(snapshotDiffers({ "house.json": HOUSE, "facts.json": FACTS, "house.shed.json": SHED }, was)).toBe(true);
    expect(snapshotDiffers({ "house.json": HOUSE, "facts.json": FACTS }, {})).toBe(true);
  });

  it("ignores anything in the record that is neither a map file nor facts.json", () => {
    expect(snapshotDiffers({ "house.json": HOUSE }, { "house.json": HOUSE, "notes.txt": "x", "house.bad.json": 3 })).toBe(false);
  });
});
