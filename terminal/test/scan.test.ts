import { describe, expect, it } from "vitest";
import { matchName, parseScan } from "../src/scan.ts";

describe("parseScan", () => {
  it("reads a guest pass (the id the play app's pass sheet renders)", () => {
    expect(parseScan("g-3f9a1c")).toEqual({ kind: "guest", id: "g-3f9a1c" });
    expect(parseScan("  G-3F9A1C\n")).toEqual({ kind: "guest", id: "g-3f9a1c" });
    expect(parseScan("p-ab12cd")).toEqual({ kind: "guest", id: "p-ab12cd" }); // an editor persona
  });
  it("recognises the wall codes (join + codex links) so it can say so", () => {
    expect(parseScan("http://10.0.0.5:7000/?code=EVT111&unlock=SANDY-1997")).toEqual({ kind: "wall", unlock: "SANDY-1997" });
    expect(parseScan("https://app.example.com/?code=EVT111")).toEqual({ kind: "wall", unlock: null });
  });
  it("accepts a pass link carrying the id", () => {
    expect(parseScan("https://app.example.com/terminal/?pass=g-3f9a1c")).toEqual({ kind: "guest", id: "g-3f9a1c" });
  });
  it("everything else is unknown", () => {
    expect(parseScan("")).toEqual({ kind: "unknown", text: "" });
    expect(parseScan("hello")).toEqual({ kind: "unknown", text: "hello" });
    expect(parseScan("g-12")).toEqual({ kind: "unknown", text: "g-12" });
    expect(parseScan("https://example.com/")).toEqual({ kind: "unknown", text: "https://example.com/" });
  });
});

describe("matchName", () => {
  const roster = [
    { id: "g-000001", name: "Microsoft Excel" },
    { id: "g-000002", name: "MS Paint" },
    { id: "g-000003", name: "Minesweeper" },
    { id: "g-000004", name: "Excel Online" },
  ];
  it("matches a name exactly, folding case / spaces / dashes", () => {
    expect(matchName("microsoft excel", roster)).toEqual({ kind: "one", id: "g-000001", name: "Microsoft Excel" });
    expect(matchName("MS-Paint", roster)).toEqual({ kind: "one", id: "g-000002", name: "MS Paint" });
    expect(matchName("mspaint", roster)).toEqual({ kind: "one", id: "g-000002", name: "MS Paint" });
  });
  it("accepts a typed id outright", () => {
    expect(matchName("G-000003", roster)).toEqual({ kind: "one", id: "g-000003", name: "Minesweeper" });
  });
  it("falls back to a unique substring, else lists the candidates", () => {
    expect(matchName("mine", roster)).toEqual({ kind: "one", id: "g-000003", name: "Minesweeper" });
    expect(matchName("excel", roster)).toEqual({ kind: "many", names: ["Microsoft Excel", "Excel Online"] });
    expect(matchName("m", roster).kind).toBe("many");
    expect(matchName("zzz", roster)).toEqual({ kind: "none" });
    expect(matchName("   ", roster)).toEqual({ kind: "none" });
  });
});
