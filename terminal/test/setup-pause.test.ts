import { describe, expect, it } from "vitest";
import { pauseLabel } from "../src/Setup.tsx";

describe("⚙ pauses slider (wave 26, V2)", () => {
  it("reads the multiplier and the two pauses it makes", () => {
    expect(pauseLabel(1)).toBe("1.00× (0.30 s · 0.70 s)");
    expect(pauseLabel(0)).toBe("0.00× (0.00 s · 0.00 s)");
    expect(pauseLabel(2.5)).toBe("2.50× (0.75 s · 1.75 s)");
  });
});
