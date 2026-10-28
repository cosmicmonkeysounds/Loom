//! The Audio tab, wave 38: an input's *Ducks as* role and its reach (the
//! router's sidechain, contract `docs/loom-w38-contract.md` C1.1) — the pure
//! ops and the rendered row.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultAudio, validateAudio } from "@loom/house";
import type { AudioConfig } from "@loom/house";
import starter from "../../../core/examples/trapped-in-the-internet/audio.json";
import { AudioPanel } from "../src/map/AudioPanel.tsx";
import { addSpeaker, inputReachSpeakers, normalizeAudio, removeSpeaker, removeZone, renameSpeaker, roleAllowed, setCell, setDevice, setInputReach, setInputRole } from "../src/map/audio.ts";
import { SHOW, TWO_ROOMS } from "./houses.ts";

const START = (): AudioConfig => normalizeAudio(starter);
const input = (a: AudioConfig, ch: number) => a.inputs.find((i) => i.ch === ch);

describe("setInputRole", () => {
  it("sets a known or custom role, folded to lower case, and validates", () => {
    const a = setInputRole(defaultAudio(), 2, "trabolta");
    expect(input(a, 2)).toEqual({ ch: 2, label: "In 2", kind: "line", role: "trabolta" });
    expect(input(setInputRole(a, 4, "  DJ_Booth-2 "), 4)?.role).toBe("dj_booth-2");
    expect(validateAudio(setInputRole(a, 4, "dj"), null).problems).toEqual([]);
  });

  it("refuses a malformed or reserved role, an unknown channel, and a no-op (same object back)", () => {
    const a = defaultAudio();
    for (const bad of ["announce", "takeover", "2mic", "a b", "x".repeat(33)]) expect(setInputRole(a, 1, bad)).toBe(a);
    expect(setInputRole(a, 0, "clippy")).toBe(a);
    expect(setInputRole(a, 17, "clippy")).toBe(a);
    expect(setInputRole(a, 1, null)).toBe(a);
    const on = setInputRole(a, 1, "clippy");
    expect(setInputRole(on, 1, "clippy")).toBe(on);
    expect(roleAllowed("clippy")).toBe(true);
    expect(roleAllowed("announce")).toBe(false);
  });

  it("none (null or blank) drops the role and its reach", () => {
    const on = setInputReach(setInputRole(defaultAudio(), 1, "clippy"), 1, ["everywhere"]);
    expect(input(on, 1)?.reach).toEqual(["everywhere"]);
    const none = setInputRole(on, 1, null);
    expect(input(none, 1)).toEqual({ ch: 1, label: "In 1", kind: "line" });
    expect(input(setInputRole(on, 1, "  "), 1)).toEqual({ ch: 1, label: "In 1", kind: "line" });
  });

  it("adds an unlisted channel's row (as patchInput does)", () => {
    const a = { ...defaultAudio(), inputs: [] };
    const b = setInputRole(a, 3, "clippy");
    expect(b.inputs).toEqual([{ ch: 3, label: "In 3", kind: "line", role: "clippy" }]);
  });
});

describe("setInputReach", () => {
  it("sets a deduplicated, trimmed target list; empty drops it (the default)", () => {
    const a = setInputRole(defaultAudio(), 1, "clippy");
    const r = setInputReach(a, 1, ["living", " living ", "", "The Desktop"]);
    expect(input(r, 1)?.reach).toEqual(["living", "The Desktop"]);
    expect(input(setInputReach(r, 1, []), 1)).toEqual({ ch: 1, label: "In 1", kind: "line", role: "clippy" });
    expect(setInputReach(a, 1, [])).toBe(a);
    expect(setInputReach(a, 99, ["living"])).toBe(a);
  });

  it("a shrunk device drops the inputs past it, roles and all", () => {
    const a = setInputRole(defaultAudio(), 12, "trabolta");
    expect(input(setDevice(a, { inputs: 8 }), 12)).toBeUndefined();
  });
});

describe("inputReachSpeakers (what the plan lights on hover)", () => {
  const two = () => {
    const h = TWO_ROOMS();
    const a = addSpeaker(defaultAudio(), h, "a").audio;
    return { h, a: addSpeaker(a, h, "b", [5.5, 1.5]).audio };
  };

  it("its reach, else the speakers on its routes' outputs, else every speaker", () => {
    const { h, a } = two();
    expect(inputReachSpeakers(a, h, 1)).toEqual(["speaker-1", "speaker-2"]);
    const routed = setCell(a, 1, 2, 0);
    expect(inputReachSpeakers(routed, h, 1)).toEqual(["speaker-2"]);
    expect(inputReachSpeakers(setInputReach(setInputRole(routed, 1, "clippy"), 1, ["a"]), h, 1)).toEqual(["speaker-1"]);
  });

  it("the show: Clippy's mic ducks the living room; the TV ducks every speaker (its reach is everywhere, the sub too)", () => {
    const a = START();
    const h = SHOW();
    expect(inputReachSpeakers(a, h, 1)).toEqual(["living-l", "living-r", "living-sub"]);
    expect(inputReachSpeakers(a, h, 3)).toEqual(["living-l", "living-r", "living-sub", "kitchen-l", "kitchen-r", "optical-drive"]);
  });
});

describe("the Inputs section renders the picker and the reach", () => {
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

  /** One cell of the rendered page, by its test id. */
  const cell = (out: string, id: string): string => {
    const at = out.indexOf(`data-testid="${id}"`);
    expect(at).toBeGreaterThan(-1);
    return out.slice(at, out.indexOf("</td>", at));
  };

  it("the show's two sidechain inputs: Clippy with the living room, the TV everywhere", () => {
    const out = html(START());
    expect(out).toContain("2 duck the music");
    const clippy = cell(out, "input-ducks-1");
    expect(clippy).toContain('aria-label="Input 1 ducks the music as"');
    expect(clippy).toMatch(/<option value="clippy" selected="">ducks as clippy<\/option>/u);
    expect(cell(out, "input-reach-1")).toContain("◎ Living room");
    const tv = cell(out, "input-ducks-3");
    expect(tv).toMatch(/<option value="trabolta" selected="">/u);
    expect(cell(out, "input-reach-3")).toMatch(/k-everywhere[^>]*>[^<]*everywhere/u);
    // An input with no role: the picker reads none and there is no reach list.
    const two = cell(out, "input-ducks-2");
    expect(two).toMatch(/<option value="" selected="">ducks nothing<\/option>/u);
    expect(out).not.toContain('data-testid="input-reach-2"');
  });

  it("a custom role shows its text field; an unrouted input's default is everywhere", () => {
    const out = html(setInputRole(START(), 4, "dj"));
    const dj = cell(out, "input-ducks-4");
    expect(dj).toContain('aria-label="Input 4 custom role"');
    expect(dj).toContain('value="dj"');
    expect(dj).toContain("(everywhere)");
  });

  it("read-only when not editing", () => {
    const out = html(START(), false);
    expect(cell(out, "input-ducks-1")).toMatch(/<select[^>]*disabled=""[^>]*aria-label="Input 1 ducks the music as"/u);
    expect(cell(out, "input-reach-1")).not.toContain("+ add…");
  });
});

describe("a reach follows the speakers and zones it names", () => {
  it("removing the living zone drops Clippy's reach (the router's default, not a stale name that ducks nothing)", () => {
    const a = START();
    expect(input(a, 1)?.reach).toEqual(["living"]);
    const b = removeZone(a, "living");
    expect(input(b, 1)?.reach).toBeUndefined();
    expect(input(b, 1)?.role).toBe("clippy");
    expect(validateAudio(b, null).warnings.filter((w) => /^inputs/u.test(w))).toEqual([]);
  });

  it("renaming a reached speaker renames it in the reach; removing it drops it", () => {
    const a = setInputReach(START(), 1, ["living-l", "living"]);
    expect(input(renameSpeaker(a, "living-l", "living-left"), 1)?.reach).toEqual(["living-left", "living"]);
    expect(inputReachSpeakers(renameSpeaker(a, "living-l", "living-left"), SHOW(), 1)).toContain("living-left");
    expect(input(removeSpeaker(a, "living-l"), 1)?.reach).toEqual(["living"]);
    const only = setInputReach(START(), 1, ["living-l"]);
    expect(input(removeSpeaker(only, "living-l"), 1)?.reach).toBeUndefined();
  });

  it("an everywhere reach is untouched", () => {
    const a = START();
    expect(input(removeZone(a, "living"), 3)?.reach).toEqual(["everywhere"]);
  });
});
