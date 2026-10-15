import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cloneData, jsonClone } from "../src/index.ts";
import type { HouseMap } from "../src/index.ts";
import { SHOW_HOUSE } from "./golden.ts";

const show = (): HouseMap => JSON.parse(readFileSync(SHOW_HOUSE, "utf8")) as HouseMap;

describe("cloneData (old-WebView safe deep copy)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("deep-copies a house map", () => {
    const h = show();
    for (const copy of [cloneData(h), jsonClone(h)]) {
      expect(copy).toEqual(h);
      expect(copy).not.toBe(h);
      expect(copy.rooms).not.toBe(h.rooms);
      copy.rooms[0]!.label = "changed";
      expect(h.rooms[0]!.label).not.toBe("changed");
    }
  });

  it("jsonClone passes undefined and primitives through", () => {
    expect(jsonClone(undefined)).toBeUndefined();
    expect(jsonClone(3)).toBe(3);
    expect(jsonClone(null)).toBeNull();
  });

  it("normalizes and validates with no structuredClone (a Chrome < 98 WebView)", async () => {
    vi.stubGlobal("structuredClone", undefined);
    vi.resetModules();
    const house = await import("../src/index.ts");
    const h = show();
    const v = house.validateHouse(h);
    expect(v.ok).toBe(true);
    expect(v.house).not.toBe(h);
    expect(house.normalizeHouse(h)).toEqual(v.house);
  });
});
