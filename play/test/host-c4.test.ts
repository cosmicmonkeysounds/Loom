//! C4 (wave 13): a booth takes the host capability from the latest view.

import { describe, expect, it } from "vitest";
import { hostOf } from "../src/session/prime.ts";

describe("C4: the host capability from the latest view", () => {
  it("view.host ?? auth.host", () => {
    expect(hostOf(true, false)).toBe(true);
    expect(hostOf(true, undefined)).toBe(true);
    expect(hostOf(undefined, true)).toBe(true);
    expect(hostOf(undefined, undefined)).toBe(false);
    expect(hostOf(false, true)).toBe(false);
  });
});
