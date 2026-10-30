import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  applyMixChanges,
  clampMixDb,
  effectiveDb,
  formatMixDb,
  meterFill,
  mixChangeOf,
  mixKey,
  mixLevelsOf,
  mixerRooms,
  mixerScopes,
  mixerSources,
  musicCommandOf,
  parseMixKey,
  peakOf,
  scopeKeys,
  scopeStrips,
  type MixLevel,
  type MixTarget,
  type MixerView,
} from "../src/house-mixer.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/house-mixer.json", import.meta.url), "utf8")) as {
  cases: Array<{ name: string; levels: Record<string, MixLevel>; target: MixTarget; want: number | null }>;
};

describe("house mixer: effectiveDb (the fixture stagehand mirrors)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(effectiveDb(c.levels, c.target)).toBe(c.want);
    });
  }
});

describe("house mixer: keys", () => {
  it("builds and parses every scope", () => {
    const cases: Array<[Parameters<typeof mixKey>[0], string | undefined, string]> = [
      [{ kind: "all" }, undefined, "master"],
      [{ kind: "all" }, "music", "src:music"],
      [{ kind: "room", room: "desktop" }, undefined, "room:desktop"],
      [{ kind: "room", room: "desktop" }, "in:trabolta", "room:desktop/src:in:trabolta"],
      [{ kind: "speaker", speaker: "living-sub" }, undefined, "spk:living-sub"],
    ];
    for (const [scope, source, key] of cases) {
      expect(mixKey(scope, source)).toBe(key);
      expect(parseMixKey(key)).toEqual({ scope, source: source ?? null });
    }
  });

  it("refuses keys outside the grammar", () => {
    for (const key of ["", "Master", "src:", "src:drums", "src:in:", "room:", "room:a/b", "room:a/src:nope", "spk:", "spk:a b", "room:x/y/src:music", `room:${"x".repeat(65)}`]) {
      expect(parseMixKey(key), key).toBeNull();
    }
  });
});

describe("house mixer: changes", () => {
  it("clamps to the fader's grid", () => {
    expect(clampMixDb(3.26)).toBe(3.5);
    expect(clampMixDb(-99)).toBe(-60);
    expect(clampMixDb(40)).toBe(10);
    expect(clampMixDb(Number.NaN)).toBe(0);
  });

  it("reads a change or says why not", () => {
    expect(mixChangeOf({ key: "src:music", db: -6.2 })).toEqual({ key: "src:music", db: -6 });
    expect(mixChangeOf({ key: "spk:living-sub", mute: true })).toEqual({ key: "spk:living-sub", mute: true });
    expect(mixChangeOf({ key: "master", reset: true, db: 3 })).toEqual({ key: "master", reset: true });
    expect(typeof mixChangeOf({ key: "src:drums", db: 1 })).toBe("string");
    expect(typeof mixChangeOf({ key: "master" })).toBe("string");
    expect(typeof mixChangeOf({ key: "master", db: "loud" })).toBe("string");
    expect(typeof mixChangeOf({ key: "master", mute: "yes" })).toBe("string");
    expect(typeof mixChangeOf({ key: "master", reset: false })).toBe("string");
    expect(typeof mixChangeOf(null)).toBe("string");
  });

  it("applies in order and drops a level back at unity", () => {
    let levels = applyMixChanges({}, [{ key: "src:music", db: -6 }, { key: "src:music", mute: true }]);
    expect(levels).toEqual({ "src:music": { db: -6, mute: true } });
    levels = applyMixChanges(levels, [{ key: "src:music", mute: false }, { key: "spk:living-sub", db: 3 }]);
    expect(levels).toEqual({ "src:music": { db: -6, mute: false }, "spk:living-sub": { db: 3, mute: false } });
    levels = applyMixChanges(levels, [{ key: "src:music", db: 0 }, { key: "spk:living-sub", reset: true }]);
    expect(levels).toEqual({});
  });

  it("reads a stored mix, dropping what is not sound", () => {
    expect(mixLevelsOf({ master: { db: -3 }, "src:drums": { db: 1 }, "spk:a": { db: 0, mute: false }, "room:b": "x", "src:sfx": { db: 99, mute: true } })).toEqual({
      master: { db: -3, mute: false },
      "src:sfx": { db: 10, mute: true },
    });
    expect(mixLevelsOf(null)).toEqual({});
  });
});

describe("house mixer: music commands", () => {
  it("reads each action", () => {
    expect(musicCommandOf({ action: "next" })).toEqual({ action: "next" });
    expect(musicCommandOf({ action: "next", playlist: "fan_closet" })).toEqual({ action: "next", playlist: "fan_closet" });
    expect(musicCommandOf({ action: "scene", scene: "act_2" })).toEqual({ action: "scene", scene: "act_2" });
    expect(musicCommandOf({ action: "stop" })).toEqual({ action: "stop" });
    expect(musicCommandOf({ action: "story" })).toEqual({ action: "story" });
  });

  it("refuses the rest", () => {
    for (const raw of [null, {}, { action: "pause" }, { action: "scene" }, { action: "scene", scene: "a b" }, { action: "next", playlist: 3 }]) {
      expect(typeof musicCommandOf(raw), JSON.stringify(raw)).toBe("string");
    }
  });
});

describe("house mixer: the show's sources and rooms", () => {
  const audio = JSON.parse(readFileSync(new URL("../examples/trapped-in-the-internet/audio.json", import.meta.url), "utf8"));

  it("has the five buses, Trabolta's TV as a fader and Clippy's mic as a meter", () => {
    const sources = mixerSources(audio);
    expect(sources.map((s) => s.id)).toEqual(["music", "tracks", "sfx", "steps", "announce", "in:clippy", "in:trabolta"]);
    expect(sources.find((s) => s.id === "steps")).toMatchObject({ label: "Footsteps", kind: "bus", meterOnly: false });
    expect(sources.find((s) => s.id === "in:trabolta")).toMatchObject({ kind: "input", ch: 3, meterOnly: false });
    expect(sources.find((s) => s.id === "in:clippy")).toMatchObject({ kind: "input", ch: 1, meterOnly: true });
  });

  it("groups the speakers by room, named from the map", () => {
    const rooms = mixerRooms(audio, (id) => (id === "desktop" ? "The Desktop" : null));
    expect(rooms.map((r) => r.id)).toEqual(["desktop", "start-bar", "optical-drive"]);
    expect(rooms[0]).toMatchObject({ name: "The Desktop" });
    expect(rooms[0]!.speakers.map((s) => s.id)).toEqual(["living-l", "living-r", "living-sub"]);
    expect(rooms[1]!.name).toBe("start-bar");
  });

  it("a speaker with no room is Unplaced", () => {
    const rooms = mixerRooms({ inputs: [], speakers: [{ id: "a", out: [1] }] });
    expect(rooms).toEqual([{ id: "", name: "Unplaced", speakers: [{ id: "a", name: "a", out: [1] }] }]);
  });
});

describe("house mixer: meters and labels", () => {
  it("fills a meter from −60 to 0 dBFS", () => {
    expect(meterFill(-60)).toBe(0);
    expect(meterFill(-30)).toBe(0.5);
    expect(meterFill(3)).toBe(1);
    expect(meterFill(null)).toBe(0);
  });

  it("takes the loudest of a speaker's outputs", () => {
    const m = { at: 0, outputs: { "9": -20, "10": -12 }, inputs: {}, sources: {} };
    expect(peakOf(m, [9, 10])).toBe(-12);
    expect(peakOf(m, [3])).toBeNull();
    expect(peakOf(null, [9])).toBeNull();
  });

  it("labels dB", () => {
    expect(formatMixDb(0)).toBe("0.0");
    expect(formatMixDb(3)).toBe("+3.0");
    expect(formatMixDb(-12.5)).toBe("−12.5");
    expect(formatMixDb(-60)).toBe("−∞");
  });
});

describe("house mixer: a scope's strips", () => {
  const audio = JSON.parse(readFileSync(new URL("../examples/trapped-in-the-internet/audio.json", import.meta.url), "utf8"));
  const view = (levels: Record<string, MixLevel> = {}): MixerView => ({
    mix: { seq: 3, levels },
    sources: mixerSources(audio),
    rooms: mixerRooms(audio),
    meters: { at: 0, outputs: { "3": -30, "1": -12, "2": -18, "5": -40 }, inputs: { "1": -25, "3": -9 }, sources: {}, buses: { music: { "1": -14, "5": -41 } } },
    music: null,
    router: { online: true, lastSeen: 0, name: "desk" },
    now: 0,
  });

  it("offers everywhere and each room", () => {
    expect(mixerScopes(view()).map((s) => s.id)).toEqual(["all", "room:desktop", "room:start-bar", "room:optical-drive"]);
  });

  it("everywhere: master, each source, Clippy as a meter", () => {
    const strips = scopeStrips(view({ master: { db: -2, mute: false }, "src:music": { db: -4, mute: false } }), { kind: "all" });
    expect(strips.map((s) => [s.kind, s.key])).toEqual([
      ["scope", "master"],
      ["source", "src:music"],
      ["source", "src:tracks"],
      ["source", "src:sfx"],
      ["source", "src:steps"],
      ["source", "src:announce"],
      ["meter", null],
      ["source", "src:in:trabolta"],
    ]);
    expect(strips[0]).toMatchObject({ effective: -2, meterDb: -12 });
    expect(strips[1]).toMatchObject({ effective: -6, meterDb: -14 });
    expect(strips[6]).toMatchObject({ meterDb: -25, source: "in:clippy" });
    expect(strips[7]).toMatchObject({ meterDb: -9 });
  });

  it("an older router that sends no steps bus just shows an idle Footsteps strip", () => {
    const steps = scopeStrips(view(), { kind: "all" }).find((s) => s.source === "steps");
    expect(steps).toMatchObject({ key: "src:steps", label: "Footsteps", kind: "source", effective: 0, meterDb: null });
  });

  it("a room: its own keys, its speakers, its outputs' meters", () => {
    const strips = scopeStrips(view({ "room:desktop": { db: -3, mute: false }, "spk:living-sub": { db: 4, mute: false } }), { kind: "room", room: "desktop" });
    expect(strips[0]).toMatchObject({ key: "room:desktop", effective: -3, meterDb: -12 });
    expect(strips[1]).toMatchObject({ key: "room:desktop/src:music", effective: -3, meterDb: -14 });
    const sub = strips.find((s) => s.speaker === "living-sub")!;
    expect(sub).toMatchObject({ key: "spk:living-sub", kind: "speaker", effective: 1, meterDb: -30 });
    const kitchen = scopeStrips(view(), { kind: "room", room: "start-bar" });
    expect(kitchen[1]).toMatchObject({ meterDb: -41 });
  });

  it("a muted scope silences what is under it", () => {
    const strips = scopeStrips(view({ "room:desktop": { db: 0, mute: true } }), { kind: "room", room: "desktop" });
    expect(strips.every((s) => s.kind === "meter" || s.effective === null)).toBe(true);
  });

  it("a scope's reset clears only the keys it holds", () => {
    const v = view({ master: { db: -2, mute: false }, "room:desktop/src:sfx": { db: 2, mute: false }, "spk:living-sub": { db: 1, mute: false }, "room:start-bar": { db: -1, mute: false } });
    expect(scopeKeys(v, { kind: "room", room: "desktop" })).toEqual(["room:desktop/src:sfx", "spk:living-sub"]);
    expect(scopeKeys(v, { kind: "all" })).toEqual(["master"]);
  });
});
