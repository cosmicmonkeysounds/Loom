import { describe, expect, it } from "vitest";
import { SessionStore } from "../server/session.ts";

describe("SessionStore — composable capabilities", () => {
  it("a performer can scan but not moderate", () => {
    const s = new SessionStore();
    s.set("p", { character: "Recruiter", admin: false, host: false });
    expect(s.canScan("p")).toBe(true);
    expect(s.canModerate("p")).toBe(false);
    expect(s.characterOf("p")).toBe("Recruiter");
  });

  it("a headless admin can scan + moderate, with no character", () => {
    const s = new SessionStore();
    s.set("a", { character: null, admin: true, host: false });
    expect(s.canScan("a")).toBe(true);
    expect(s.canModerate("a")).toBe(true);
    expect(s.characterOf("a")).toBeNull();
  });

  it("a performer upgrades to performer+admin on the SAME token", () => {
    const s = new SessionStore();
    s.set("p", { character: "Recruiter", admin: false, host: false });
    expect(s.grant("p", { admin: true })).toBe(true);
    expect(s.canModerate("p")).toBe(true);
    expect(s.characterOf("p")).toBe("Recruiter"); // kept
  });

  it("an admin can pick up a character (symmetric compose)", () => {
    const s = new SessionStore();
    s.set("a", { character: null, admin: true, host: false });
    s.grant("a", { character: "Sentinel" });
    expect(s.characterOf("a")).toBe("Sentinel");
    expect(s.canModerate("a")).toBe(true);
  });

  it("grant on an unknown token fails; capabilities reject unknown tokens", () => {
    const s = new SessionStore();
    expect(s.grant("ghost", { admin: true })).toBe(false);
    expect(s.canScan("ghost")).toBe(false);
    expect(s.canScan(undefined)).toBe(false);
    expect(s.canModerate(undefined)).toBe(false);
  });

  it("round-trips through entries()/load() for persistence", () => {
    const s = new SessionStore();
    s.set("p", { character: "Recruiter", admin: true, host: false });
    s.set("a", { character: null, admin: true, host: false });
    const restored = new SessionStore();
    restored.load(s.entries());
    expect(restored.get("p")).toEqual({ character: "Recruiter", admin: true, host: false });
    expect(restored.get("a")).toEqual({ character: null, admin: true, host: false });
  });

  it("host (wave 13): granted, never moderation; canHost covers admin too", () => {
    const s = new SessionStore();
    s.set("h", { character: "Task Manager", admin: false, host: false });
    expect(s.canHost("h")).toBe(false);
    s.grant("h", { host: true });
    expect(s.canHost("h")).toBe(true);
    expect(s.canModerate("h")).toBe(false);
    s.set("a", { character: null, admin: true, host: false });
    expect(s.canHost("a")).toBe(true);
    expect(s.canHost(undefined)).toBe(false);
  });

  it("revokeHost drops host and keeps admin", () => {
    const s = new SessionStore();
    s.set("h", { character: "Task Manager", admin: true, host: true });
    s.revokeHost("h");
    expect(s.get("h")).toEqual({ character: "Task Manager", admin: true, host: false });
  });

  it("dropCharacter: an admin keeps admin headless; a performer or host session is deleted", () => {
    const s = new SessionStore();
    s.set("a", { character: "Clippy", admin: true, host: true });
    s.set("h", { character: "Task Manager", admin: false, host: true });
    s.set("p", { character: "Norton", admin: false, host: false });
    s.dropCharacter("a");
    s.dropCharacter("h");
    s.dropCharacter("p");
    s.dropCharacter("ghost");
    expect(s.get("a")).toEqual({ character: null, admin: true, host: false });
    expect(s.has("h")).toBe(false);
    expect(s.has("p")).toBe(false);
  });

  it("persists host; an old entry with no host reads false", () => {
    const s = new SessionStore();
    s.set("h", { character: "Task Manager", admin: false, host: true });
    const restored = new SessionStore();
    restored.load(s.entries());
    expect(restored.get("h")).toEqual({ character: "Task Manager", admin: false, host: true });
    const old = new SessionStore();
    old.load([["o", { character: "Norton", admin: false } as never]]);
    expect(old.get("o")).toEqual({ character: "Norton", admin: false, host: false });
  });
});
