import { describe, expect, it } from "vitest";
import { audioHash, defaultAudio, resolveTargets, validateAudio } from "@loom/house";
import type { AudioConfig, HouseMap } from "@loom/house";
import starter from "../../../core/examples/trapped-in-the-internet/audio.json";
import {
  addSpeaker,
  addZone,
  aimSpeaker,
  audioDownload,
  audioProblemList,
  cellGain,
  cellsOf,
  coverageRadius,
  cueRows,
  duplicateSpeaker,
  followHouse,
  freeOutput,
  moveSpeaker,
  normalizeAudio,
  outputLabel,
  outputUsers,
  patchInput,
  patchOutput,
  patchSpeaker,
  patchZone,
  placeSpeaker,
  rebaseHistory,
  removeSpeaker,
  removeZone,
  renameSpeaker,
  rotateSpeaker,
  routesOf,
  sameAudio,
  saveAllPlan,
  setAnnounce,
  setCell,
  setCueGain,
  setCueTargets,
  setDevice,
  setSpeakerHeight,
  setSpeakerYaw,
  setTvVoice,
  setZoneMember,
  SPEAKER_HEIGHT,
  speakerFloor,
  speakerSavePlan,
  speakersDropped,
  speakersIn,
  targetChip,
  targetOptions,
  toggleCell,
  toggleSpeakerOutput,
  withSpeakersText,
  zonesOf,
} from "../src/map/audio.ts";
import { moveRectEdge, moveRoom } from "../src/map/edit.ts";
import { emptyHistory, pushed, redone, undone } from "../src/map/history.ts";
import { addRoom, blankHouse, patchFloor, removeRoom, renameRoom } from "../src/map/structure.ts";
import { commitPending, floorOfSelection, selectionExists } from "../src/map/tools.ts";
import { SHOW, STAIR, TWO_ROOMS } from "./houses.ts";

/** Two speakers in TWO_ROOMS: `speaker-1` in a (2, 1.5) on out 1, `speaker-2` in b (5.5, 1.5) on out 2. */
const twoSpeakers = (h: HouseMap = TWO_ROOMS()): AudioConfig => {
  const a = addSpeaker(defaultAudio(), h, "a").audio;
  return addSpeaker(a, h, "b", [5.5, 1.5]).audio;
};

describe("placing a speaker", () => {
  it("adds one in a room's middle, hung up, facing north, on the next free output", () => {
    const h = TWO_ROOMS();
    const before = defaultAudio();
    const r = addSpeaker(before, h, "a");
    expect(before.speakers).toEqual([]); // never mutated
    const s = r.audio.speakers[0]!;
    expect(r.id).toBe("speaker-1");
    expect(s).toMatchObject({ room: "a", floor: "f", yaw: 0, out: [1], pos: { x: 2, y: SPEAKER_HEIGHT, z: 1.5 } });
    expect(validateAudio(r.audio, h).ok).toBe(true);
    const r2 = addSpeaker(r.audio, h, "b");
    expect(r2.audio.speakers[1]!.out).toEqual([2]);
    expect(addSpeaker(before, h, "nope")).toEqual({ audio: before, id: "" });
  });

  it("places on a click inside a room on the floor, never outside", () => {
    const h = TWO_ROOMS();
    const r = placeSpeaker(defaultAudio(), h, "f", [6, 2])!;
    expect(r.audio.speakers[0]).toMatchObject({ room: "b", pos: { x: 6, z: 2 } });
    expect(placeSpeaker(defaultAudio(), h, "f", [20, 20])).toBeNull();
  });

  it("stands at its floor's elevation + the hanging height", () => {
    const h = STAIR();
    const cellar = h.rooms.find((r) => r.floor !== h.rooms[h.rooms.length - 1]!.floor) ?? h.rooms[0]!;
    const r = addSpeaker(defaultAudio(), h, cellar.id);
    const elev = h.floors.find((f) => f.id === cellar.floor)!.elevation;
    expect(r.audio.speakers[0]!.pos.y).toBeCloseTo(elev + SPEAKER_HEIGHT);
  });

  it("finds no free output once every output has a speaker", () => {
    let a = setDevice(defaultAudio(), { outputs: 2 });
    const h = TWO_ROOMS();
    a = addSpeaker(a, h, "a").audio;
    a = addSpeaker(a, h, "b").audio;
    expect(freeOutput(a)).toEqual([]);
    expect(addSpeaker(a, h, "a").audio.speakers[2]!.out).toEqual([]);
  });
});

describe("moving, turning, editing a speaker", () => {
  it("moves on the plan and its room follows", () => {
    const h = TWO_ROOMS();
    const a = twoSpeakers(h);
    const m = moveSpeaker(a, h, "speaker-1", [6, 1]);
    expect(m.speakers[0]).toMatchObject({ room: "b", pos: { x: 6, y: SPEAKER_HEIGHT, z: 1 } });
    expect(moveSpeaker(m, h, "speaker-1", [6, 1])).toBe(m);
    expect(a.speakers[0]!.room).toBe("a");
  });

  it("turns, aims and rotates (wrapped, half degrees)", () => {
    const a = twoSpeakers();
    expect(setSpeakerYaw(a, "speaker-1", 190).speakers[0]!.yaw).toBe(-170);
    expect(rotateSpeaker(a, "speaker-1", 15).speakers[0]!.yaw).toBe(15);
    // From (2, 1.5) toward the east: yaw −90 (yaw 0 = north, +z south).
    const east = aimSpeaker(a, "speaker-1", [5, 1.5], 15).speakers[0]!.yaw;
    expect(Math.abs(east)).toBe(90);
    expect(setSpeakerYaw(a, "speaker-1", 0)).toBe(a);
  });

  it("sets the height, name, outputs and gain", () => {
    const a = twoSpeakers();
    expect(setSpeakerHeight(a, "speaker-1", 1.2345).speakers[0]!.pos.y).toBe(1.235);
    const p = patchSpeaker(a, "speaker-1", { name: "Left", out: [3, 1, 3, 99, 0], gain: -6 });
    expect(p.speakers[0]).toMatchObject({ name: "Left", out: [1, 3], gain: -6 });
    expect(patchSpeaker(p, "speaker-1", { gain: 0 }).speakers[0]!.gain).toBeUndefined();
    expect(patchSpeaker(p, "speaker-1", { gain: 40 }).speakers[0]!.gain).toBe(12);
    expect(toggleSpeakerOutput(p, "speaker-1", 1).speakers[0]!.out).toEqual([3]);
    expect(toggleSpeakerOutput(p, "speaker-1", 2).speakers[0]!.out).toEqual([1, 2, 3]);
  });

  it("renames its id everywhere it is named; refuses a taken / reserved / empty id", () => {
    let a = twoSpeakers();
    a = addZone(a, "Front", ["speaker-1"]).audio;
    a = setCueTargets(a, "zip", ["speaker-1", "front"]);
    a = setAnnounce(a, ["speaker-1"]);
    a = setTvVoice(a, ["speaker-1"]);
    const r = renameSpeaker(a, "speaker-1", "living-l");
    expect(r.speakers[0]!.id).toBe("living-l");
    expect(r.zones[0]!.speakers).toEqual(["living-l"]);
    expect(r.cues["zip"]!.to).toEqual(["living-l", "front"]);
    expect(r.announce!.to).toEqual(["living-l"]);
    expect(r.voice!.tv).toEqual(["living-l"]);
    for (const bad of ["speaker-2", "Everywhere", " "]) expect(renameSpeaker(a, "speaker-1", bad)).toBe(a);
  });

  it("deletes with its zone memberships and targets", () => {
    let a = twoSpeakers();
    a = addZone(a, "Both", ["speaker-1", "speaker-2"]).audio;
    a = setCueTargets(a, "zip", ["speaker-1"]);
    const r = removeSpeaker(a, "speaker-1");
    expect(r.speakers.map((s) => s.id)).toEqual(["speaker-2"]);
    expect(r.zones[0]!.speakers).toEqual(["speaker-2"]);
    expect(r.cues["zip"]!.to).toEqual([]);
    expect(removeSpeaker(r, "speaker-1")).toBe(r);
  });

  it("duplicates beside itself with a fresh id and the next free output", () => {
    const h = TWO_ROOMS();
    const a = twoSpeakers(h);
    const d = duplicateSpeaker(a, h, "speaker-1", 0.25)!;
    expect(d.id).toBe("speaker-3");
    expect(d.audio.speakers[2]).toMatchObject({ name: `${a.speakers[0]!.name} copy`, out: [3], pos: { x: 2.25, z: 1.75 }, room: "a" });
    expect(duplicateSpeaker(a, h, "nope", 1)).toBeNull();
  });

  it("is a selection: its floor is its room's, it exists while the config has it", () => {
    const h = TWO_ROOMS();
    const a = twoSpeakers(h);
    expect(floorOfSelection(h, { kind: "speaker", id: "speaker-2" }, a)).toBe("f");
    expect(floorOfSelection(h, { kind: "speaker", id: "speaker-2" })).toBe("");
    expect(selectionExists(h, { kind: "speaker", id: "speaker-2" }, a)).toBe(true);
    expect(selectionExists(h, { kind: "speaker", id: "speaker-2" }, removeSpeaker(a, "speaker-2"))).toBe(false);
    expect(speakerFloor(h, a.speakers[0]!)).toBe("f");
  });
});

describe("speakers follow the map", () => {
  it("a moved room carries its speakers (only its own)", () => {
    const h = TWO_ROOMS();
    const a = twoSpeakers(h);
    const after = moveRoom(h, "b", 1, 2);
    const f = followHouse(h, after, a);
    expect(f.speakers[1]!.pos).toMatchObject({ x: 6.5, z: 3.5 });
    expect(f.speakers[0]).toEqual(a.speakers[0]);
    expect(validateAudio(f, after).ok).toBe(true);
  });

  it("a dragged edge carries the speakers on that wall, the rest stay", () => {
    const h = TWO_ROOMS();
    let a = twoSpeakers(h);
    a = moveSpeaker(a, h, "speaker-2", [7, 1.5]); // on b's east wall
    a = addSpeaker(a, h, "b", [5, 1]).audio; // in the middle
    const after = moveRectEdge(h, "b", "e", 8);
    const f = followHouse(h, after, a);
    expect(f.speakers[1]!.pos.x).toBe(8);
    expect(f.speakers[2]!.pos.x).toBe(5);
  });

  it("follows a renamed room and a raised floor", () => {
    const h = TWO_ROOMS();
    const a = twoSpeakers(h);
    const renamed = followHouse(h, renameRoom(h, "a", "kitchen"), a);
    expect(renamed.speakers[0]!.room).toBe("kitchen");
    const raised = followHouse(h, patchFloor(h, "f", { elevation: 0.5 }), a);
    expect(raised.speakers[0]!.pos.y).toBeCloseTo(SPEAKER_HEIGHT + 0.5);
  });

  it("a deleted room takes its speakers (and their zone places); the count rides the confirm", () => {
    const h = TWO_ROOMS();
    let a = twoSpeakers(h);
    a = addZone(a, "All", ["speaker-1", "speaker-2"]).audio;
    expect(speakersIn(a, ["b"])).toEqual(["speaker-2"]);
    const out = removeRoom(h, "b");
    if ("error" in out) throw new Error(out.error);
    const f = followHouse(h, out.house, a);
    expect(f.speakers.map((s) => s.id)).toEqual(["speaker-1"]);
    expect(f.zones[0]!.speakers).toEqual(["speaker-1"]);
    expect(withSpeakersText("Delete the room “B” with 1 door?", 1)).toBe("Delete the room “B” with 1 door and 1 speaker?");
    expect(withSpeakersText("Delete the room “B”?", 2)).toBe("Delete the room “B” with 2 speakers?");
    expect(withSpeakersText("Delete it?", 0)).toBe("Delete it?");
  });

  it("is the same config when no speaker moved", () => {
    const h = TWO_ROOMS();
    const a = twoSpeakers(h);
    const r = addRoom(h, "f", [10, 0, 12, 2]);
    expect(followHouse(h, r.house, a)).toBe(a);
    expect(followHouse(h, h, a)).toBe(a);
  });

  it("is one undo step with the map: the history holds {house, audio}", () => {
    const h = TWO_ROOMS();
    const a = twoSpeakers(h);
    const moved = moveRoom(h, "b", 1, 0);
    const doc = { house: moved, audio: followHouse(h, moved, a) };
    const hist = pushed(emptyHistory<{ house: HouseMap; audio: AudioConfig }>(), { house: h, audio: a });
    const u = undone(hist, doc)!;
    expect(u.present.house).toBe(h);
    expect(u.present.audio).toBe(a);
  });
});

describe("the interface", () => {
  it("grows and shrinks the device, trimming channels, cells and outputs", () => {
    const h = TWO_ROOMS();
    let a = twoSpeakers(h);
    a = patchSpeaker(a, "speaker-2", { out: [2, 16] });
    a = setCell(a, 16, 16, -3);
    a = setCell(a, 1, 2, 0);
    const small = setDevice(a, { inputs: 8, outputs: 8, name: "MOTU" });
    expect(small.device).toMatchObject({ name: "MOTU", inputs: 8, outputs: 8 });
    expect(small.inputs).toHaveLength(8);
    expect(small.outputs).toHaveLength(8);
    expect(small.speakers[1]!.out).toEqual([2]);
    expect(small.routes).toEqual([{ in: 1, out: [2] }]);
    const big = setDevice(small, { outputs: 10 });
    expect(big.outputs.map((o) => o.ch)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(setDevice(a, { outputs: 999 }).device.outputs).toBe(64);
    expect(setDevice(a, { rate: 44100 }).device.rate).toBe(44100);
    expect(setDevice(a, { rate: null }).device.rate).toBeUndefined();
    expect(validateAudio(small, h).ok).toBe(true);
  });

  it("labels inputs (and their kind) and outputs", () => {
    const a = defaultAudio();
    const p = patchInput(a, 7, { label: "Host mic", kind: "mic" });
    expect(p.inputs[6]).toEqual({ ch: 7, label: "Host mic", kind: "mic" });
    expect(patchInput(a, 99, { label: "x" })).toBe(a);
    expect(patchInput(a, 1, { kind: "bogus" as never })).toBe(a);
    const o = patchOutput(a, 3, { label: "Kitchen L" });
    expect(outputLabel(o, 3)).toBe("Kitchen L");
    expect(outputLabel({ ...o, outputs: [] }, 3)).toBe("Out 3");
  });

  it("knows which speakers an output feeds", () => {
    const a = patchSpeaker(twoSpeakers(), "speaker-2", { out: [1, 2] });
    expect(outputUsers(a, 1).map((s) => s.id)).toEqual(["speaker-1", "speaker-2"]);
    expect(outputUsers(a, 9)).toEqual([]);
  });
});

describe("the routing matrix", () => {
  it("toggles a cell at 0 dB and off again", () => {
    const a = defaultAudio();
    const on = toggleCell(a, 1, 3);
    expect(on.routes).toEqual([{ in: 1, out: [3] }]);
    expect(cellGain(on, 1, 3)).toBe(0);
    expect(toggleCell(on, 1, 3).routes).toEqual([]);
    expect(cellGain(a, 1, 3)).toBeNull();
  });

  it("keeps a gain per cell, grouped into sparse rows the same way every time", () => {
    let a = defaultAudio();
    a = setCell(a, 2, 5, 0);
    a = setCell(a, 2, 1, 0);
    a = setCell(a, 2, 9, -6);
    a = setCell(a, 1, 4, 3);
    expect(a.routes).toEqual([
      { in: 1, out: [4], gain: 3 },
      { in: 2, out: [1, 5] },
      { in: 2, out: [9], gain: -6 },
    ]);
    expect(validateAudio(a).ok).toBe(true);
    // The same matrix built another way is the same JSON (and version).
    let b = defaultAudio();
    b = setCell(b, 1, 4, 3);
    b = setCell(b, 2, 9, -6);
    b = setCell(b, 2, 1, 0);
    b = setCell(b, 2, 5, 0);
    expect(audioHash(b)).toBe(audioHash(a));
    expect(setCell(a, 2, 9, -100).routes.find((r) => r.out.includes(9))!.gain).toBe(-60);
    expect(setCell(a, 2, 9, -6)).toBe(a);
    expect(setCell(a, 17, 1, 0)).toBe(a);
  });

  it("reads a hand-written matrix's cells (first gain wins) and writes them back", () => {
    const cells = cellsOf({ ...defaultAudio(), routes: [{ in: 3, out: [1, 2], gain: -3 }] });
    expect([...cells]).toEqual([
      ["3>1", -3],
      ["3>2", -3],
    ]);
    expect(routesOf(cells)).toEqual([{ in: 3, out: [1, 2], gain: -3 }]);
  });
});

describe("zones", () => {
  it("adds (slugged, never 'everywhere'), renames, sets members in file order, deletes", () => {
    let a = twoSpeakers();
    const z = addZone(a, "Living Room", ["speaker-2", "ghost"]);
    expect(z.id).toBe("living-room");
    a = z.audio;
    expect(a.zones[0]!.speakers).toEqual(["speaker-2"]);
    expect(addZone(a, "Everywhere").id).toBe("zone");
    expect(addZone(a, "Living room").id).toBe("living-room-2");
    a = setZoneMember(a, "living-room", "speaker-1", true);
    expect(a.zones[0]!.speakers).toEqual(["speaker-1", "speaker-2"]);
    expect(setZoneMember(a, "living-room", "speaker-1", true)).toBe(a);
    expect(zonesOf(a, "speaker-1")).toEqual(["living-room"]);
    a = patchZone(a, "living-room", { name: "Lounge" });
    expect(a.zones[0]!.name).toBe("Lounge");
    a = setCueTargets(a, "zip", ["living-room", "everywhere"]);
    const r = removeZone(a, "living-room");
    expect(r.zones).toEqual([]);
    expect(r.cues["zip"]!.to).toEqual(["everywhere"]);
    expect(validateAudio(r).ok).toBe(true);
  });
});

describe("cues and targets", () => {
  it("lists every story sound, then cues the story doesn't play", () => {
    const a = setCueTargets(defaultAudio(), "old_sound", ["everywhere"]);
    const rows = cueRows(a, ["zip", "beans_spill"]);
    expect(rows.map((r) => [r.name, r.inStory, r.cue !== null])).toEqual([
      ["beans_spill", true, false],
      ["zip", true, false],
      ["old_sound", false, true],
    ]);
  });

  it("the announcement chime's row is not a cue: it rings with the announcements (LA-2)", () => {
    const rows = cueRows(defaultAudio(), ["announce_chime", "zip"]);
    expect(rows.map((r) => [r.name, r.chime])).toEqual([
      ["announce_chime", true],
      ["zip", false],
    ]);
  });

  it("sets targets (empty drops the cue) and a gain", () => {
    let a = setCueTargets(defaultAudio(), "zip", ["everywhere", " everywhere", ""]);
    expect(a.cues["zip"]).toEqual({ to: ["everywhere"] });
    a = setCueGain(a, "zip", -4);
    expect(a.cues["zip"]!.gain).toBe(-4);
    expect(setCueGain(a, "zip", 0).cues["zip"]!.gain).toBeUndefined();
    expect(setCueTargets(a, "zip", []).cues["zip"]).toBeUndefined();
    expect(setCueTargets(defaultAudio(), "zip", [])).toEqual(defaultAudio());
  });

  it("sets announce + TV voice targets (empty drops them)", () => {
    let a = setAnnounce(defaultAudio(), ["everywhere"], true);
    expect(a.announce).toEqual({ to: ["everywhere"], chime: true });
    a = setAnnounce(a, [], undefined);
    expect(a.announce).toEqual({ to: [], chime: true });
    expect(setAnnounce(defaultAudio(), []).announce).toBeUndefined();
    a = setTvVoice(a, ["living"]);
    expect(a.voice).toEqual({ tv: ["living"] });
    expect(setTvVoice(a, []).voice).toBeUndefined();
  });

  it("offers everywhere, zones, LOCATIONs, rooms and speakers — and names each chip", () => {
    const h = SHOW();
    const a = normalizeAudio(starter);
    const opts = targetOptions(a, h, ["The Desktop", "The Start Bar"]);
    expect(opts[0]!.kind).toBe("everywhere");
    expect(opts.filter((o) => o.kind === "zone").map((o) => o.value)).toEqual(["living"]);
    expect(opts.filter((o) => o.kind === "location").map((o) => o.value)).toEqual(["The Desktop", "The Start Bar"]);
    expect(opts.filter((o) => o.kind === "room")).toHaveLength(h.rooms.length);
    expect(opts.filter((o) => o.kind === "speaker").map((o) => o.value)).toEqual(["living-l", "living-r", "kitchen-l", "kitchen-r", "optical-drive"]);
    expect(targetChip(opts, "everywhere")).toEqual({ text: "🌐 everywhere", kind: "everywhere" });
    expect(targetChip(opts, "living")).toEqual({ text: "◎ Living room", kind: "zone" });
    expect(targetChip(opts, "the_desktop")).toEqual({ text: "📍 The Desktop", kind: "location" });
    expect(targetChip(opts, "living-l").kind).toBe("speaker");
    expect(targetChip(opts, "start-bar").kind).toBe("room");
    expect(targetChip(opts, "the moon")).toEqual({ text: "⚠ the moon", kind: null });
    // Without the story's LOCATIONs, the map's own.
    expect(targetOptions(a, h, null).some((o) => o.kind === "location" && o.value === "The Server Room")).toBe(true);
  });
});

describe("the starter config in the editor", () => {
  it("loads clean against the show's map and resolves the same targets", () => {
    const h = SHOW();
    const a = normalizeAudio(starter);
    const p = audioProblemList(a, h);
    expect(p.errors).toEqual([]);
    expect(resolveTargets(a, h, ["living"]).outputs).toEqual([1, 2]);
    // A speaker moved out of its room is an error that selects it; output warnings open the Audio tab.
    const out = { ...a, speakers: a.speakers.map((s) => (s.id === "kitchen-r" ? { ...s, pos: { ...s.pos, x: 99 } } : s)) };
    const bad = audioProblemList(out, h);
    expect(bad.errors[0]!.sel).toEqual({ kind: "speaker", id: "kitchen-r" });
    expect(bad.errors[0]!.text.startsWith("🔊 ")).toBe(true);
    const free = bad.warnings.find((w) => /outputs 5, 6, .* have no speaker/.test(w.text))!;
    expect(free.sel).toBeNull();
    expect(free.tab).toBe("audio");
    expect(bad.warnings.filter((w) => /(has|have) no speaker/.test(w.text))).toHaveLength(1);
  });

  it("normalizes a partial file and a non-object to something editable", () => {
    expect(normalizeAudio(null)).toEqual(defaultAudio());
    const n = normalizeAudio({ version: 1, device: { name: "X", inputs: 2, outputs: 2 }, note: "hi" });
    expect(n).toMatchObject({ note: "hi", speakers: [], zones: [], routes: [], cues: {} });
    expect(n.inputs).toHaveLength(16); // the default labels until the director trims the device
  });

  it("downloads as audio.json and compares by content", () => {
    const a = normalizeAudio(starter);
    expect(audioDownload(a).name).toBe("audio.json");
    expect(JSON.parse(audioDownload(a).text)).toEqual(a);
    expect(sameAudio(a, normalizeAudio(starter))).toBe(true);
    expect(sameAudio(a, removeSpeaker(a, "living-l"))).toBe(false);
  });

  it("draws a coverage ring that grows with gain, within bounds", () => {
    expect(coverageRadius(undefined)).toBe(3);
    expect(coverageRadius(6)).toBeCloseTo(5.99, 1);
    expect(coverageRadius(-60)).toBe(0.8);
    expect(coverageRadius(12)).toBe(8);
  });
});

describe("review fixes (wave 17)", () => {
  it("counts the speakers a delete takes, a yard's included", () => {
    const blank = blankHouse("T");
    const y = addRoom(blank, "ground", [20, 0, 30, 10], { outdoor: true });
    const a = addSpeaker(defaultAudio(), y.house, y.id, [25, 5]).audio;
    expect(a.speakers[0]!.room).toBe(y.id);
    const out = removeRoom(y.house, y.id);
    if ("error" in out) throw new Error(out.error);
    // speakersIn zeroed for a yard; the real drop is one speaker.
    expect(speakersDropped(y.house, out.house, a)).toEqual([a.speakers[0]!.id]);
    expect(followHouse(y.house, out.house, a).speakers).toEqual([]);
    // A room delete: the same count speakersIn gave.
    const h = TWO_ROOMS();
    const two = twoSpeakers(h);
    const gone = removeRoom(h, "b");
    if ("error" in gone) throw new Error(gone.error);
    expect(speakersDropped(h, gone.house, two)).toEqual(["speaker-2"]);
    expect(speakersDropped(h, moveRoom(h, "b", 1, 0), two)).toEqual([]);
  });

  it("rebases the history onto adopted speakers: map steps stay, speaker-only steps go", () => {
    const h0 = TWO_ROOMS();
    const a0 = twoSpeakers(h0);
    const h1 = addRoom(h0, "f", [10, 0, 12, 2]).house;
    const a1 = patchSpeaker(a0, "speaker-1", { name: "Mine" });
    const h2 = addRoom(h1, "f", [13, 0, 15, 2]).house;
    // past: h0/a0 → (map) h1/a0 → (speaker) h1/a1 → (map) present h2/a1; a redo of a speaker step ahead.
    let hist = pushed(emptyHistory<{ house: HouseMap; audio: AudioConfig }>(), { house: h0, audio: a0 });
    hist = pushed(hist, { house: h1, audio: a0 });
    hist = pushed(hist, { house: h1, audio: a1 });
    const present = { house: h2, audio: a1 };
    hist = { ...hist, future: [{ house: h2, audio: patchSpeaker(a1, "speaker-2", { name: "Redo" }) }] };
    const theirs = patchSpeaker(a0, "speaker-2", { name: "Theirs" });
    const r = rebaseHistory(hist, present, theirs);
    expect(r.past.map((d) => d.house)).toEqual([h0, h1]);
    expect(r.past.every((d) => d.audio === theirs)).toBe(true);
    // The speaker-only redo is gone (the same map as the present).
    expect(r.future).toEqual([]);
    const u = undone(r, { house: h2, audio: theirs })!;
    expect(u.present.house).toBe(h1);
    expect(u.present.audio).toBe(theirs);
    expect(redone(u.history, u.present)!.present.house).toBe(h2);
    // A map redo ahead survives.
    const ahead = rebaseHistory({ past: [], future: [{ house: h2, audio: a0 }] }, { house: h1, audio: a0 }, theirs);
    expect(ahead.future.map((d) => d.house)).toEqual([h2]);
    expect(ahead.future[0]!.audio).toBe(theirs);
  });

  it("saves the speakers alone only against the saved map; with the map when only the draft fits", () => {
    const base = { audioDirty: true, status: "ok" as const, mapDirty: false, mapSaveable: true, validDraft: true, validSaved: true };
    expect(speakerSavePlan({ ...base, audioDirty: false })).toEqual({ alone: false, withMap: false, why: null });
    expect(speakerSavePlan(base)).toEqual({ alone: true, withMap: false, why: null });
    // A speaker in a room drawn but not saved: the server would answer 400 to a save alone.
    const drawn = speakerSavePlan({ ...base, mapDirty: true, validSaved: false });
    expect(drawn).toEqual({ alone: false, withMap: true, why: null });
    expect(speakerSavePlan({ ...base, mapDirty: true, mapSaveable: false, validSaved: false }).why).toMatch(/fix the map first/);
    expect(speakerSavePlan({ ...base, validDraft: false, validSaved: false }).why).toMatch(/speaker problems/);
    expect(speakerSavePlan({ ...base, status: "missing" }).why).toMatch(/predates wave 17/);
    expect(speakerSavePlan({ ...base, status: "error" }).why).toMatch(/out of reach/);
    // 💾: a valid map saves whatever the speakers say; the speakers follow only when they fit the map the server will hold.
    const bad = speakerSavePlan({ ...base, status: "error" });
    expect(saveAllPlan({ mapDirty: true, mapSaveable: true, speakers: bad })).toEqual({ map: true, speakers: false });
    expect(saveAllPlan({ mapDirty: true, mapSaveable: true, speakers: drawn })).toEqual({ map: true, speakers: true });
    // Valid against the saved map only: the map save would strand them, so they wait.
    const old = speakerSavePlan({ ...base, mapDirty: true, validDraft: false });
    expect(saveAllPlan({ mapDirty: true, mapSaveable: true, speakers: old })).toEqual({ map: true, speakers: false });
    expect(saveAllPlan({ mapDirty: true, mapSaveable: false, speakers: old })).toEqual({ map: false, speakers: true });
    expect(saveAllPlan({ mapDirty: false, mapSaveable: true, speakers: speakerSavePlan(base) })).toEqual({ map: false, speakers: true });
  });

  it("a text field leaving the page never lands a commit it already made", () => {
    expect(commitPending("renamed", "old", null)).toBe(true);
    // The id rename re-keys the inspector: the blur committed, then the field unmounts.
    expect(commitPending("renamed", "old", "renamed")).toBe(false);
    expect(commitPending("same", "same", null)).toBe(false);
    expect(commitPending("again", "old", "renamed")).toBe(true);
  });
});
