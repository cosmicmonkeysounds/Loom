//! (wave 40) The standalone device's memory of an in-progress walk, so a
//! reload can offer "Are you NAME?". Keyed by the server base; another
//! base's walk, or a malformed entry, is ignored.

import { describe, expect, it } from "vitest";
import { clearResume, loadResume, saveResume, type StoredWalk } from "../src/resume-store.ts";

function fakeStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    _m: m,
  };
}

const WALK: StoredWalk = { token: "tok-1", name: "WINAMP", session: "s-000001", base: "/e/ev" };

describe("resume-store (wave 40)", () => {
  it("saves and loads a walk for its base", () => {
    const s = fakeStore();
    saveResume(WALK, s);
    expect(loadResume("/e/ev", s)).toEqual(WALK);
  });

  it("ignores a walk from another base", () => {
    const s = fakeStore();
    saveResume(WALK, s);
    expect(loadResume("/e/other", s)).toBeNull();
  });

  it("clears a stored walk", () => {
    const s = fakeStore();
    saveResume(WALK, s);
    clearResume(s);
    expect(loadResume("/e/ev", s)).toBeNull();
  });

  it("returns null for nothing stored, malformed JSON, or missing fields", () => {
    const s = fakeStore();
    expect(loadResume("/e/ev", s)).toBeNull();
    s.setItem("loom.reinstall.resume", "{not json");
    expect(loadResume("/e/ev", s)).toBeNull();
    s.setItem("loom.reinstall.resume", JSON.stringify({ token: "t", base: "/e/ev" })); // no name/session
    expect(loadResume("/e/ev", s)).toBeNull();
  });

  it("is a no-op (no throw) when storage is absent", () => {
    expect(() => saveResume(WALK, null)).not.toThrow();
    expect(loadResume("/e/ev", null)).toBeNull();
    expect(() => clearResume(null)).not.toThrow();
  });
});
