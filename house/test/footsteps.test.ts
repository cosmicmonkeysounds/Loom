import { describe, expect, it } from "vitest";
import {
  FOOTSTEP_CUT_DB,
  FOOTSTEP_FLOOR_DB,
  FOOTSTEP_PACE_MAX_S,
  FOOTSTEP_PACE_MIN_S,
  FOOTSTEP_SPEAKERS,
  FOOTSTEP_WALL_DB,
  defaultAudio,
  footstepsProblems,
  footstepsSettings,
  sameWalkers,
  stepPaceS,
  surfaceOf,
  validateAudio,
  walkerOutputs,
  walkersOf,
} from "../src/index.ts";
import type { AudioConfig, AudioSpeaker, HouseMap } from "../src/index.ts";
import { SHOW_HOUSE, loadHouse } from "./golden.ts";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const show: HouseMap = loadHouse(SHOW_HOUSE);
const showAudio = (): AudioConfig => JSON.parse(readFileSync(join(dirname(SHOW_HOUSE), "audio.json"), "utf8")) as AudioConfig;

const spk = (id: string, room: string, x: number, y: number, z: number, floor = "main"): AudioSpeaker => ({ id, name: id, room, floor, pos: { x, y, z }, yaw: 0, out: [1] });
const audio = (...speakers: AudioSpeaker[]): AudioConfig => ({ ...defaultAudio(), speakers });

describe("who carries a program's steps", () => {
  it("drops 6 dB per doubling past a metre, in the room, clear", () => {
    const a = audio(spk("s", "desktop", 0, 0, 0));
    expect(walkerOutputs(a, show, "desktop", [0, 0, 0.5])).toEqual([{ speaker: "s", db: 0, muffled: false }]);
    expect(walkerOutputs(a, show, "desktop", [0, 0, 2])).toEqual([{ speaker: "s", db: -6, muffled: false }]);
    expect(walkerOutputs(a, show, "desktop", [0, 0, 4])).toEqual([{ speaker: "s", db: -12, muffled: false }]);
  });

  it("muffles a speaker in another room, more through a floor", () => {
    const a = audio(spk("s", "start-bar", 0, 0, 0));
    expect(walkerOutputs(a, show, "desktop", [0, 0, 2])).toEqual([{ speaker: "s", db: -14, muffled: true }]);
    expect(FOOTSTEP_FLOOR_DB).toBeLessThan(FOOTSTEP_WALL_DB);
    expect(walkerOutputs(a, show, "hard-drive", [0, 0, 2])).toEqual([{ speaker: "s", db: -18, muffled: true }]);
  });

  it("stops at the reach and under the cut", () => {
    const a = audio(spk("s", "desktop", 0, 0, 0));
    expect(walkerOutputs(a, show, "desktop", [0, 0, 8])).toEqual([]);
    expect(walkerOutputs({ ...a, footsteps: { reach: 20 } }, show, "desktop", [0, 0, 10])).toHaveLength(1);
    expect(walkerOutputs({ ...a, footsteps: { reach: 20 } }, show, "desktop", [0, 0, 19])).toEqual([{ speaker: "s", db: -26, muffled: false }]);
    expect(walkerOutputs({ ...audio(spk("s", "hard-drive", 0, 0, 0)), footsteps: { reach: 20 } }, show, "desktop", [0, 0, 16])).toEqual([]);
    expect(FOOTSTEP_CUT_DB).toBe(-30);
  });

  it("adds the file's gain, and keeps only the nearest speakers, loudest first", () => {
    const a = { ...audio(spk("a", "desktop", 0, 0, 3), spk("b", "desktop", 0, 0, 1), spk("c", "desktop", 0, 0, 2), spk("d", "desktop", 0, 0, 4)), footsteps: { gain: -4 } };
    const out = walkerOutputs(a, show, "desktop", [0, 0, 0]);
    expect(out.map((o) => o.speaker)).toEqual(["b", "c", "a"]);
    expect(out).toHaveLength(FOOTSTEP_SPEAKERS);
    expect(out[0]!.db).toBe(-4);
  });

  it("skips a speaker on no output, and hears the third dimension", () => {
    expect(walkerOutputs(audio({ ...spk("s", "desktop", 0, 0, 0), out: [] }), show, "desktop", [0, 0, 0])).toEqual([]);
    expect(walkerOutputs(audio(spk("s", "desktop", 0, 4, 0)), show, "desktop", [0, 0, 0])[0]!.db).toBe(-12);
  });

  it("carries a program past the show's real speakers", () => {
    const a = showAudio();
    const kitchen = walkerOutputs(a, show, "start-bar", [3, 0, 13]);
    expect(kitchen[0]).toMatchObject({ muffled: false });
    expect(kitchen.map((o) => o.speaker)).toContain("kitchen-l");
    // Upstairs, over the kitchen: heard through the ceiling.
    expect(walkerOutputs(a, show, "bathroom-2", [2, 2.8, 14]).every((o) => o.muffled)).toBe(true);
    // Out in the tent: nothing near it.
    expect(walkerOutputs(a, show, "tent", [-4.5, 0, 26.3])).toEqual([]);
  });
});

describe("walkers", () => {
  const a = audio(spk("s", "desktop", 0, 0, 0));
  const walker = { session: "s-1", room: "desktop", p: [0, 0, 1] as [number, number, number], speed: 1.4 };

  it("is everyone moving within earshot, speed to a step", () => {
    expect(walkersOf(a, show, [walker])).toEqual([{ id: "s-1", speed: 1.5, surface: "floor", to: [{ speaker: "s", db: 0, muffled: false }] }]);
  });

  it("leaves out the still, a teleport, the far away", () => {
    expect(walkersOf(a, show, [{ ...walker, speed: 0.1 }])).toEqual([]);
    expect(walkersOf(a, show, [{ ...walker, speed: 9 }])).toEqual([]);
    expect(walkersOf(a, show, [{ ...walker, p: [0, 0, 30] }])).toEqual([]);
  });

  it("is off when the file says so", () => {
    expect(walkersOf({ ...a, footsteps: { enabled: false } }, show, [walker])).toEqual([]);
    expect(footstepsSettings(a)).toEqual({ enabled: true, reach: 7, gain: 0 });
  });

  it("compares by what is sent", () => {
    const one = walkersOf(a, show, [walker]);
    expect(sameWalkers(one, walkersOf(a, show, [{ ...walker, speed: 1.45 }]))).toBe(true);
    expect(sameWalkers(one, walkersOf(a, show, [{ ...walker, speed: 2.5 }]))).toBe(false);
    expect(sameWalkers(one, walkersOf(a, show, [{ ...walker, p: [0, 0, 5] }]))).toBe(false);
  });

  it("reads the ground from the room", () => {
    expect(surfaceOf(show, "backyard")).toBe("grass");
    expect(surfaceOf(show, "bathroom-1")).toBe("tile");
    expect(surfaceOf(show, "start-bar")).toBe("tile");
    expect(surfaceOf(show, "desktop")).toBe("floor");
    expect(surfaceOf(show, null)).toBe("floor");
  });

  it("paces a step by the speed, inside its bounds", () => {
    expect(stepPaceS(1.44)).toBeCloseTo(0.5);
    expect(stepPaceS(10)).toBe(FOOTSTEP_PACE_MIN_S);
    expect(stepPaceS(0.1)).toBe(FOOTSTEP_PACE_MAX_S);
    expect(stepPaceS(0)).toBe(FOOTSTEP_PACE_MAX_S);
  });
});

describe("audio.json footsteps", () => {
  it("is optional and checked", () => {
    expect(footstepsProblems(undefined)).toEqual([]);
    expect(footstepsProblems({ enabled: true, reach: 8, gain: -3 })).toEqual([]);
    expect(footstepsProblems([])).toHaveLength(1);
    expect(footstepsProblems({ enabled: "yes" })).toHaveLength(1);
    expect(footstepsProblems({ reach: 1 })).toHaveLength(1);
    expect(footstepsProblems({ gain: 40 })).toHaveLength(1);
    expect(validateAudio({ ...defaultAudio(), footsteps: { reach: 1 } }).ok).toBe(false);
    expect(validateAudio({ ...defaultAudio(), footsteps: { reach: 8 } }).ok).toBe(true);
  });
});
