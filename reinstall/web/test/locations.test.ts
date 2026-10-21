import { describe, expect, it } from "vitest";
import { locationsOf } from "../src/api.ts";

describe("the story's LOCATIONs for the map editor's room check (LA-3)", () => {
  it("an empty list before the doors is unknown, never 'the story has none'", () => {
    expect(locationsOf({ phase: "idle", locations: [] })).toBeNull();
    expect(locationsOf({ locations: [] })).toBeNull();
    expect(locationsOf({ phase: "open", locations: [] })).toEqual([]);
    expect(locationsOf({ phase: "idle", locations: [{ id: "The Desktop", label: null }, { nope: 1 }] })).toEqual([{ id: "The Desktop", label: null }]);
    expect(locationsOf({})).toBeNull();
  });
});
