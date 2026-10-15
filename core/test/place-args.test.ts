import { describe, expect, it } from "vitest";

import { canonicalPlaceArgs } from "../server/place-args.ts";

const LOCS = [
  { id: "The Cache", label: "kitchen" },
  { id: "The Desktop", label: null },
];

describe("canonicalPlaceArgs", () => {
  it("folds a place-shaped argument onto the declared LOCATION (name or label)", () => {
    expect(canonicalPlaceArgs({ room: "the cache" }, LOCS)).toEqual({ room: "The Cache" });
    expect(canonicalPlaceArgs({ room: "  THE_desktop " }, LOCS)).toEqual({ room: "The Desktop" });
    expect(canonicalPlaceArgs({ at: "Kitchen" }, LOCS)).toEqual({ at: "The Cache" });
  });

  it("leaves unknown places, other keys and non-strings alone (same object when nothing changes)", () => {
    const args = { room: "The Attic", text: "the cache", level: 3 };
    expect(canonicalPlaceArgs(args, LOCS)).toBe(args);
    const exact = { room: "The Cache" };
    expect(canonicalPlaceArgs(exact, LOCS)).toBe(exact);
    expect(canonicalPlaceArgs({ room: "the cache", text: "the cache" }, LOCS)).toEqual({ room: "The Cache", text: "the cache" });
  });
});
