//! `audio.json` (wave 17): `validateAudio` problems + warnings, with and
//! without a house, and the shared `resolveTargets` cases stagehand's router
//! mirrors in Python (`test/fixtures/audio-resolve.json`).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AUDIO_FILE, audioHash, defaultAudio, foldTarget, resolveTargets, validateAudio, validateHouse } from "../src/index.ts";
import type { AudioConfig, HouseMap } from "../src/index.ts";
import { FIXTURES } from "./golden.ts";

const load = <T>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
const HOUSE = load<HouseMap>("audio-house.json");
const AUDIO = load<AudioConfig>("audio-basic.json");
const fresh = (): AudioConfig => JSON.parse(JSON.stringify(AUDIO)) as AudioConfig;

/** Validate a copy of the basic config after `mutate`, on the fixture house. */
function check(mutate: (a: AudioConfig & Record<string, unknown>) => void, house: HouseMap | null = HOUSE) {
  const a = fresh() as AudioConfig & Record<string, unknown>;
  mutate(a);
  return validateAudio(a, house);
}

describe("the audio fixtures", () => {
  it("the house is a valid map and the config validates clean on it", () => {
    expect(validateHouse(HOUSE).problems).toEqual([]);
    const v = validateAudio(AUDIO, HOUSE);
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    // Output 5 hangs on two speakers; outputs 1–6 are all used.
    expect(v.warnings).toEqual(["output 5 feeds 2 speakers (down-hall, studio)"]);
  });

  it("the file is audio.json; the default is a labelled 16 / 16 interface with nothing placed", () => {
    expect(AUDIO_FILE).toBe("audio.json");
    const d = defaultAudio();
    expect(d.device).toMatchObject({ inputs: 16, outputs: 16 });
    expect(d.inputs).toHaveLength(16);
    expect(d.outputs.map((o) => o.ch)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    const v = validateAudio(d, HOUSE);
    expect(v.problems).toEqual([]);
    expect(v.warnings).toHaveLength(16); // every output has no speaker
  });

  it("the hash is a stable 8-hex content hash", () => {
    expect(audioHash(AUDIO)).toMatch(/^[0-9a-f]{8}$/u);
    expect(audioHash(fresh())).toBe(audioHash(AUDIO));
    const b = fresh();
    b.speakers[0]!.gain = -1;
    expect(audioHash(b)).not.toBe(audioHash(AUDIO));
  });
});

describe("validateAudio — problems", () => {
  it("refuses a non-object, a wrong version and a broken device", () => {
    expect(validateAudio(null).problems).toEqual(["audio.json must be an object"]);
    expect(check((a) => void ((a as Record<string, unknown>)["version"] = 2)).problems).toEqual(["version must be 1"]);
    expect(check((a) => void (a.device.outputs = 0)).problems[0]).toMatch(/device\.outputs must be a whole number from 1 to 64/u);
    expect(check((a) => void (a.device.inputs = 65)).problems[0]).toMatch(/device\.inputs/u);
    expect(check((a) => void (a.device.rate = 12.5)).problems).toEqual(["device.rate must be a sample rate in Hz (8000 to 384000)"]);
  });

  it("channels are 1-based, unique and within the device", () => {
    expect(check((a) => a.inputs.push({ ch: 3, label: "again", kind: "mic" })).problems).toEqual(["inputs[3]: channel 3 is listed twice"]);
    expect(check((a) => a.outputs.push({ ch: 17, label: "x" })).problems).toEqual(["outputs[6].ch must be a channel from 1 to 16"]);
    expect(check((a) => void ((a.inputs[0] as unknown as Record<string, unknown>)["kind"] = "guitar")).problems[0]).toMatch(/inputs\[0\]\.kind must be "software" \| "mic" \| "line"/u);
    expect(check((a) => void (a.device.outputs = 4)).problems).toEqual([
      "outputs[4].ch must be a channel from 1 to 4",
      "outputs[5].ch must be a channel from 1 to 4",
      'speakers[4] "down-hall".out: 5 is not an output from 1 to 4',
      'speakers[5] "studio".out: 6 is not an output from 1 to 4',
      'speakers[5] "studio".out: 5 is not an output from 1 to 4',
    ]);
  });

  it("speakers: ids, outputs, gain, position", () => {
    expect(check((a) => a.speakers.push({ ...a.speakers[0]!, out: [7] })).problems).toEqual(['speakers[6] "living-l": the id is used twice']);
    expect(check((a) => void (a.speakers[0]!.out = [1, 1])).problems).toEqual(['speakers[0] "living-l".out: output 1 is listed twice']);
    expect(check((a) => void (a.speakers[0]!.gain = 20)).problems).toEqual(['speakers[0] "living-l".gain must be dB from -60 to +12']);
    expect(check((a) => void ((a.speakers[0] as unknown as Record<string, unknown>)["pos"] = [0, 0, 0])).problems).toEqual(['speakers[0] "living-l".pos must be {x, y, z} in metres']);
    expect(check((a) => void (a.speakers[0]!.id = "Everywhere")).problems).toContain('speakers[0] "Everywhere": "everywhere" is reserved');
  });

  it("with a house: the room exists, the floor is the room's, the speaker stands inside it (± 0.05 m)", () => {
    expect(check((a) => void (a.speakers[0]!.room = "attic")).problems).toEqual(['speakers[0] "living-l": unknown room "attic"']);
    expect(check((a) => void (a.speakers[1]!.floor = "basement")).problems).toEqual(['speakers[1] "living-r": floor "basement" is not room "desktop"\'s floor "main"']);
    expect(check((a) => void (a.speakers[0]!.pos.x = -0.04)).problems).toEqual([]);
    expect(check((a) => void (a.speakers[0]!.pos.x = -0.2)).problems).toEqual(['speakers[0] "living-l": [-0.2, 0.3] is outside room "desktop" (± 0.05 m)']);
    // Without a house nothing is placed, so nothing is checked.
    expect(check((a) => void (a.speakers[0]!.room = "attic"), null).problems).toEqual([]);
  });

  it("zones: no redefined everywhere, known speakers; the matrix routes each cell once", () => {
    expect(check((a) => a.zones.push({ id: "everywhere", name: "All", speakers: [] })).problems).toEqual(['zones[2] "everywhere": "everywhere" is every speaker already and may not be redefined']);
    expect(check((a) => a.zones[0]!.speakers.push("ghost")).problems).toEqual(['zones[0] "living": unknown speaker "ghost"']);
    expect(check((a) => a.routes.push({ in: 3, out: [2, 4] })).problems).toEqual(["routes[1]: input 3 → output 2 is routed twice"]);
    expect(check((a) => a.routes.push({ in: 17, out: [1], gain: -80 })).problems).toEqual(["routes[1].in must be an input from 1 to 16", "routes[1].gain must be dB from -60 to +12"]);
    // Another gain for another cell of the same input is fine.
    expect(check((a) => a.routes.push({ in: 3, out: [4], gain: 0 })).problems).toEqual([]);
  });

  it("cues, announce and the TV voice are target lists", () => {
    expect(check((a) => void ((a.cues as Record<string, unknown>)["zip"] = { to: "The Tube" })).problems).toEqual(['cues["zip"].to must be a list of zones, rooms, LOCATIONs or speakers']);
    expect(check((a) => void ((a as Record<string, unknown>)["cues"] = [])).problems).toEqual(["cues must be an object {sound name: {to}}"]);
    expect(check((a) => void (a.announce = { to: ["everywhere"], chime: "yes" as unknown as boolean })).problems).toEqual(["announce.chime must be true or false"]);
  });
});

describe("validateAudio — warnings", () => {
  it("a shared output, a speaker with no output, an output with no speaker, a target that reaches nobody", () => {
    const v = check((a) => {
      a.speakers[2]!.out = [];
      a.cues["ghost"] = { to: ["The Attic"] };
      a.voice = { tv: [] };
    });
    expect(v.problems).toEqual([]);
    expect(v.warnings).toEqual([
      'speakers[2] "kitchen" has no output: nothing will play on it',
      "output 5 feeds 2 speakers (down-hall, studio)",
      "output 3 has no speaker",
      'cues["ghost"].to: "The Attic" reaches no speaker',
      "voice.tv names nothing",
    ]);
  });
});

describe("validateAudio — wave 18b: device.expect and announce.terminals", () => {
  it("device.expect is the counts the device reports: whole numbers from 1 to 64, never fewer than ours", () => {
    expect(check((a) => void (a.device.expect = { inputs: 32, outputs: 30 })).problems).toEqual([]);
    expect(check((a) => void (a.device.expect = { inputs: 0, outputs: 65 })).problems).toEqual([
      "device.expect.inputs must be a whole number from 1 to 64",
      "device.expect.outputs must be a whole number from 1 to 64",
    ]);
    expect(check((a) => void ((a.device as unknown as Record<string, unknown>)["expect"] = 32)).problems).toEqual(["device.expect must be an object {inputs, outputs}"]);
    const fewer = check((a) => void (a.device.expect = { inputs: 1, outputs: a.device.outputs }));
    expect(fewer.problems).toEqual([]);
    expect(fewer.warnings[0]).toMatch(/^device\.expect\.inputs \(1\) is fewer than device\.inputs/u);
  });

  it("announce.terminals lists terminal spot ids; with a house an unknown one is a warning", () => {
    const spot = HOUSE.terminals[0]?.id ?? "kitchen";
    expect(check((a) => void (a.announce = { to: ["everywhere"], terminals: [spot] })).problems).toEqual([]);
    expect(check((a) => void (a.announce = { to: ["everywhere"], terminals: "kitchen" as unknown as string[] })).problems).toEqual(["announce.terminals must be a list of terminal spot ids"]);
    expect(check((a) => void (a.announce = { to: ["everywhere"], terminals: [""] })).problems).toEqual(["announce.terminals must be a list of terminal spot ids"]);
    const unknown = check((a) => void (a.announce = { to: ["everywhere"], terminals: ["nowhere-spot"] }));
    expect(unknown.problems).toEqual([]);
    expect(unknown.warnings).toContain('announce.terminals: "nowhere-spot" is no terminal spot on the house map');
    // No house: nothing to check the ids against.
    expect(check((a) => void (a.announce = { to: ["everywhere"], terminals: ["nowhere-spot"] }), null).warnings.some((w) => w.startsWith("announce.terminals"))).toBe(false);
  });
});

describe("resolveTargets — the shared cases (stagehand mirrors these)", () => {
  const file = load<{ cases: Array<{ to: string[]; house?: false; speakers: string[]; outputs: number[] }> }>("audio-resolve.json");
  for (const c of file.cases) {
    it(`${JSON.stringify(c.to)}${c.house === false ? " (no house)" : ""}`, () => {
      expect(resolveTargets(AUDIO, c.house === false ? null : HOUSE, c.to)).toEqual({ speakers: c.speakers, outputs: c.outputs });
    });
  }

  it("folds case, _ / - and spaces", () => {
    expect(foldTarget("  The_Start--Bar ")).toBe("the start bar");
    expect(foldTarget("start-bar")).toBe(foldTarget("Start Bar"));
  });
});
