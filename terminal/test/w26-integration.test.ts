// Wave 26 integration (contract §3.4): the wiring between lanes that no lane
// could apply on its own branch. Source pins, because the TV and the app are
// React components with no DOM test dependency here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { roomOccupied } from "../src/world/presence.ts";
import { DEFAULT_GAPS, gapsFor } from "../src/speech/engine.ts";

const src = (name: string) => readFileSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), "utf8");

describe("I1: the TV's world pane links by room (R5)", () => {
  const tv = src("Tv.tsx");
  it("gates the pane on useRoomLinked(spot, inSimulation), not the house-wide rule", () => {
    expect(tv).toMatch(/import \{ useRoomLinked \} from "\.\/world\/presence\.ts";/u);
    expect(tv).toMatch(/const linked = useRoomLinked\(state\?\.spot, inSimulation\);/u);
    expect(tv).toMatch(/const showWorld = canDraw && linked && !attract;/u);
    expect(tv).not.toMatch(/const showWorld = canDraw && inSimulation/u);
  });
  it("the gate: here > 0 when the server sends it, the old rule only when it is absent", () => {
    expect(roomOccupied({ here: 0 }, true)).toBe(false);
    expect(roomOccupied({ here: 2 }, false)).toBe(true);
    expect(roomOccupied({}, true)).toBe(true);
    expect(roomOccupied(null, false)).toBe(false);
  });
});

describe("I2: every app.tsx SpeechQueue takes the config's pauses (V2)", () => {
  const app = src("app.tsx");
  it("passes voiceFloor and gapsFor(config) at each construction", () => {
    const made = app.match(/new SpeechQueue\(/gu) ?? [];
    expect(made.length).toBeGreaterThan(0);
    const withGaps = app.match(/\}, voiceFloor, gapsFor\(config\)\);/gu) ?? [];
    expect(withGaps.length).toBe(made.length);
  });
  it("gapsFor scales the defaults by pause", () => {
    expect(gapsFor({ pause: 2 })).toEqual({ chunk: DEFAULT_GAPS.chunk * 2, line: DEFAULT_GAPS.line * 2 });
    expect(gapsFor({})).toEqual(DEFAULT_GAPS);
  });
  it("the room terminal captions a spoken line when he starts it", () => {
    expect(app).toMatch(/\}, room !== null \? speech : null, \{ captionOnStart: true \}\),/u);
    expect(app).toMatch(/speak: \(line, started\) =>/u);
    expect(app).toMatch(/starts\.current\.set\(line\.seq, started\);/u);
    // The queue's first chunk of that line fires it.
    expect(app).toMatch(/if \(i === 0\) \{\n {10}starts\.current\.get\(id\)\?\.\(\);/u);
  });
});
