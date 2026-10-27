//! Byte ranges for the built apps' media files (wave 33: the reinstallation
//! intro video — a browser seeks with `Range`, Safari plays none without it).

import { describe, expect, it } from "vitest";

import { RANGED_EXTENSIONS, byteRange } from "../server/static-cache.ts";

describe("byteRange", () => {
  it("reads the one span asked for", () => {
    expect(byteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(byteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(byteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
    expect(byteRange("bytes=990-5000", 1000)).toEqual({ start: 990, end: 999 }); // clamped to the end
  });

  it("past the end is unsatisfiable (416)", () => {
    expect(byteRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(byteRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });

  it("no header, several spans, another unit or junk: the whole file", () => {
    expect(byteRange(undefined, 1000)).toBeNull();
    expect(byteRange("bytes=0-1,5-9", 1000)).toBeNull();
    expect(byteRange("items=0-1", 1000)).toBeNull();
    expect(byteRange("bytes=-", 1000)).toBeNull();
    expect(byteRange("bytes=9-3", 1000)).toBeNull();
  });

  it("covers the video", () => {
    expect(RANGED_EXTENSIONS.has(".mp4")).toBe(true);
    expect(RANGED_EXTENSIONS.has(".js")).toBe(false);
  });
});
