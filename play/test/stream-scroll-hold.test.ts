import { describe, expect, it } from "vitest";
import { STICK_SLACK, scrollPin } from "../src/stream/list.tsx";

describe("a reader's scroll up holds the stream (the Optical Drive CAPTCHA)", () => {
  it("lets go at once on the reader's own scroll up, inside the slack too", () => {
    expect(scrollPin({ pinned: true, user: true, up: true, gap: 40 })).toBe("unpin");
    expect(scrollPin({ pinned: true, user: true, up: true, gap: STICK_SLACK + 200 })).toBe("unpin");
  });
  it("follows again on the way back down, and at the very bottom", () => {
    expect(scrollPin({ pinned: false, user: true, up: false, gap: 40 })).toBe("pin");
    expect(scrollPin({ pinned: false, user: true, up: true, gap: 0 })).toBe("pin");
  });
  it("a clamp onto the bottom (a card folding just after a tap) still follows", () => {
    expect(scrollPin({ pinned: true, user: true, up: true, gap: 1 })).toBe("pin");
  });
  it("a scroll the browser makes on its own never lets go", () => {
    expect(scrollPin({ pinned: true, user: false, up: true, gap: 300 })).toBe("stick");
    expect(scrollPin({ pinned: true, user: false, up: true, gap: 40 })).toBe("pin");
    expect(scrollPin({ pinned: false, user: false, up: false, gap: 300 })).toBe("keep");
  });
});
