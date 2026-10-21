//! The Audio tab, wave 18b: the tablets that also say the announcements
//! (`announce.terminals`, Q8) by room with a speaker-reach hint, and the
//! device's expected layout (`device.expect`, the 828x, Q2).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateAudio } from "@loom/house";
import type { AudioConfig } from "@loom/house";
import starter from "../../../core/examples/trapped-in-the-internet/audio.json";
import { AudioPanel } from "../src/map/AudioPanel.tsx";
import { announceTerminalRows, normalizeAudio, setAnnounce, setAnnounceTerminal, setDevice, setExpect } from "../src/map/audio.ts";
import { SHOW } from "./houses.ts";

const START = (): AudioConfig => normalizeAudio(starter);

describe("tablets that also say the announcements (Q8)", () => {
  it("the starter lists none: no room turns on by itself", () => {
    expect(START().announce?.terminals).toEqual([]);
    expect(announceTerminalRows(START(), SHOW()).every((r) => !r.on)).toBe(true);
  });

  it("ticks a spot on and off without touching where the house says them", () => {
    const on = setAnnounceTerminal(START(), "cpu", true);
    expect(on.announce).toEqual({ to: ["everywhere"], chime: true, terminals: ["cpu"] });
    expect(setAnnounceTerminal(on, "cpu", true).announce?.terminals).toEqual(["cpu"]); // once
    const two = setAnnounceTerminal(on, "hall", true);
    expect(two.announce?.terminals).toEqual(["cpu", "hall"]);
    expect(setAnnounceTerminal(two, "cpu", false).announce?.terminals).toEqual(["hall"]);
    expect(validateAudio(two, SHOW()).problems).toEqual([]);
    // No announce section yet: the router's default stays (to: []).
    const bare = normalizeAudio({ ...starter, announce: undefined });
    expect(setAnnounceTerminal(bare, "cpu", true).announce).toEqual({ to: [], terminals: ["cpu"] });
  });

  it("changing where the house says them keeps the tablets' list", () => {
    const on = setAnnounceTerminal(START(), "cpu", true);
    expect(setAnnounce(on, ["living"]).announce).toEqual({ to: ["living"], chime: true, terminals: ["cpu"] });
    expect(setAnnounce(on, ["living"], false).announce?.terminals).toEqual(["cpu"]);
    // Every list empty, no chime: the section still goes (as before).
    expect(setAnnounce(normalizeAudio({ ...starter, announce: undefined }), []).announce).toBeUndefined();
  });

  it("groups the spots by room, floor first, with a speaker-reach hint", () => {
    const rows = announceTerminalRows(setAnnounceTerminal(START(), "desktop-tv", true), SHOW());
    const house = SHOW();
    expect(rows.map((r) => r.id).sort()).toEqual(house.terminals.map((t) => t.id).sort());
    const floors = rows.map((r) => r.floor);
    expect(floors.indexOf("main")).toBeGreaterThan(floors.lastIndexOf("basement"));
    expect(floors.indexOf("top")).toBeGreaterThan(floors.lastIndexOf("main"));
    const tv = rows.find((r) => r.id === "desktop-tv")!;
    expect(tv.on).toBe(true);
    expect(tv.reached).toEqual(["Living L", "Living R"]);
    expect(tv.hint).toMatch(/say them too \(Living L, Living R\): the tablet would echo them/u);
    const cpu = rows.find((r) => r.id === "cpu")!;
    expect(cpu.speakers).toEqual([]);
    expect(cpu.hint).toMatch(/only voice/u);
  });

  it("a room with speakers the announcements skip says so", () => {
    const living = setAnnounce(START(), ["living"]);
    const bar = announceTerminalRows(living, SHOW()).find((r) => r.id === "start-bar")!;
    expect(bar.speakers).toEqual(["Kitchen L", "Kitchen R"]);
    expect(bar.reached).toEqual([]);
    expect(bar.hint).toMatch(/announcements don't play on them/u);
  });

  it("a listed id that names no spot comes last, to untick", () => {
    const stale = { ...START(), announce: { to: ["everywhere"], terminals: ["gone-spot"] } };
    const rows = announceTerminalRows(stale, SHOW());
    expect(rows.at(-1)).toMatchObject({ id: "gone-spot", on: true, room: "⚠ not on the map" });
    expect(setAnnounceTerminal(stale, "gone-spot", false).announce?.terminals).toEqual([]);
  });
});

describe("the device's expected layout (Q2)", () => {
  it("the starter is the 828x + an expander: 24 / 22 used, 32 / 30 reported", () => {
    expect(START().device).toEqual({ name: "828x", inputs: 24, outputs: 22, rate: 48000, expect: { inputs: 32, outputs: 30 } });
  });

  it("sets, clamps and clears the expected counts", () => {
    const a = setExpect(START(), { outputs: 26 });
    expect(a.device.expect).toEqual({ inputs: 32, outputs: 26 });
    expect(setExpect(a, { inputs: 999 }).device.expect).toEqual({ inputs: 64, outputs: 26 });
    expect(setExpect(a, { inputs: null }).device.expect).toBeUndefined();
    // None yet: the other count starts at the device's own.
    const bare = setDevice(normalizeAudio({ ...starter, device: { name: "828x", inputs: 24, outputs: 22 } }), {});
    expect(setExpect(bare, { inputs: 32 }).device.expect).toEqual({ inputs: 32, outputs: 22 });
    expect(validateAudio(setExpect(bare, { inputs: 32 }), SHOW()).problems).toEqual([]);
  });

  it("a device change keeps the expected counts", () => {
    expect(setDevice(START(), { outputs: 30 }).device.expect).toEqual({ inputs: 32, outputs: 30 });
  });
});

describe("the Audio tab renders them", () => {
  const html = (audio: AudioConfig, edit = true) =>
    renderToStaticMarkup(
      createElement(AudioPanel, {
        audio,
        saved: audio,
        house: SHOW(),
        view: null,
        loadedVersion: null,
        status: "ok",
        edit,
        dirty: false,
        valid: true,
        speakerSave: { alone: true, withMap: false, why: null },
        saveState: { kind: "idle" },
        commit: () => {},
        onSave: () => {},
        onSaveToProject: () => {},
        onDownload: () => {},
        onReload: () => {},
        onTest: () => {},
        onHighlight: () => {},
        onPick: () => {},
        projectStatus: null,
      }),
    );

  it("lists every terminal spot with its hint, ticked from the list", () => {
    const out = html(setAnnounceTerminal(START(), "desktop-tv", true));
    expect(out).toContain("Tablets that also say them");
    expect(out).toContain("1 of 14");
    expect(out).toContain('aria-label="TV also says the announcements" checked=""');
    expect(out).toContain("the tablet would echo them");
    expect(out).toContain("The interface must report 32 in / 30 out");
    expect(out).not.toContain("QLab");
  });
});
