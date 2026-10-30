import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeKey, TEST_CODE, TEST_CODE_GAP_MS, TestCode } from "../src/game/test-code.ts";

function type(c: TestCode, keys: string, from = 1000, gap = 100): boolean {
  let hit = false;
  [...keys].forEach((k, i) => {
    hit = c.press(k as "A" | "B", from + i * gap) || hit;
  });
  return hit;
}

describe("the test code", () => {
  it("is the headset's code, with its pause", () => {
    const gd = readFileSync(new URL("../../vr/game/test_combo.gd", import.meta.url), "utf8");
    expect(gd).toContain(`const SEQUENCE := "${TEST_CODE}"`);
    expect(gd).toContain(`const GAP := ${TEST_CODE_GAP_MS / 1000}`);
    expect(TEST_CODE).toBe("BBAABABAABB");
  });

  it("fires on the last press and not before", () => {
    const c = new TestCode();
    expect(type(c, TEST_CODE.slice(0, -1))).toBe(false);
    expect(c.press("B", 2000)).toBe(true);
  });

  it("a wrong start doesn't spoil it, and it fires again after", () => {
    const c = new TestCode();
    expect(type(c, `AB${TEST_CODE}`)).toBe(true);
    expect(type(c, TEST_CODE, 5000)).toBe(true);
  });

  it("a pause too long starts it over", () => {
    const c = new TestCode();
    type(c, TEST_CODE.slice(0, 5));
    expect(type(c, TEST_CODE.slice(5), 1400 + TEST_CODE_GAP_MS + 1)).toBe(false);
  });

  it("reads the A and B keys, never a held key's repeats", () => {
    expect(codeKey({ code: "KeyA", repeat: false })).toBe("A");
    expect(codeKey({ code: "KeyB", repeat: false })).toBe("B");
    expect(codeKey({ code: "KeyA", repeat: true })).toBeNull();
    expect(codeKey({ code: "KeyW", repeat: false })).toBeNull();
  });
});
