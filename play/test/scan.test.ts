import { describe, expect, it } from "vitest";
import { cameraFailure, cameraProblem, decodeSize, parseScan, repeatGate, scanProblem, typedTarget } from "../src/scan.ts";

describe("booth scan parsing", () => {
  it("reads a pass (guest or persona id), case-folded", () => {
    expect(parseScan("g-3f9a1c")).toEqual({ kind: "guest", id: "g-3f9a1c" });
    expect(parseScan("  P-ABCDEF \n")).toEqual({ kind: "guest", id: "p-abcdef" });
  });
  it("recognises wall codes and pass links", () => {
    expect(parseScan("https://app.mapsandducks.com/?code=ABCD")).toEqual({ kind: "wall", unlock: null });
    expect(parseScan("https://app.mapsandducks.com/?code=ABCD&unlock=duck")).toEqual({ kind: "wall", unlock: "duck" });
    const sign = parseScan("https://app.mapsandducks.com/?code=ABCD&checkin=the-cache");
    expect(sign).toEqual({ kind: "wall", unlock: null, checkin: "the-cache" });
    expect(scanProblem(sign)).toBe("That's a room sign — scan the guest's pass.");
    expect(scanProblem(parseScan("https://app.mapsandducks.com/?code=ABCD"))).toBe("That's the join code — scan the guest's pass.");
    expect(parseScan("https://x.test/?pass=g-00ff11")).toEqual({ kind: "guest", id: "g-00ff11" });
  });
  it("names what a non-pass is", () => {
    expect(scanProblem(parseScan("hello"))).toMatch(/isn't a guest's pass or a codex code/);
    expect(scanProblem(parseScan("https://x.test/?code=A"))).toMatch(/join code/);
    expect(scanProblem(parseScan("g-123456"))).toBeNull();
  });
  it("wave 58: a codex QR is no problem for a booth, and a blank one is just the join QR", () => {
    expect(scanProblem(parseScan("https://x.test/?code=A&unlock=b"))).toBeNull();
    expect(parseScan("https://x.test/?code=A&unlock=%20b%20")).toEqual({ kind: "wall", unlock: "b" });
    expect(parseScan("https://x.test/?code=A&unlock=")).toEqual({ kind: "wall", unlock: null });
  });
  it("normalises a typed id a phone keyboard capitalised", () => {
    expect(typedTarget(" G-1A2B3C ")).toBe("g-1a2b3c");
    expect(typedTarget(" someone ")).toBe("someone");
    expect(typedTarget("   ")).toBe("");
  });
});

describe("repeat gate", () => {
  it("reports a held pass once per window but a new pass at once (ten in a row)", () => {
    let t = 0;
    const fresh = repeatGate(4000, () => t);
    const ids = Array.from({ length: 10 }, (_, i) => `g-00000${i}`);
    for (const id of ids) {
      expect(fresh(id)).toBe(true);
      t += 50;
      expect(fresh(id)).toBe(false); // still in front of the lens
      t += 700;
    }
    t += 4000;
    expect(fresh(ids[0]!)).toBe(true);
  });
});

describe("camera states", () => {
  it("maps getUserMedia failures and explains each", () => {
    expect(cameraFailure("NotAllowedError")).toBe("denied");
    expect(cameraFailure("NotFoundError")).toBe("none");
    expect(cameraFailure("AbortError")).toBe("error");
    expect(cameraProblem("insecure")).toMatch(/https/);
    expect(cameraProblem("live")).toBeNull();
    expect(cameraProblem("off")).toBeNull();
  });
  it("decodes at most 640 px wide", () => {
    expect(decodeSize(1280, 720)).toEqual({ width: 640, height: 360 });
    expect(decodeSize(480, 640)).toEqual({ width: 480, height: 640 });
    expect(decodeSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});
