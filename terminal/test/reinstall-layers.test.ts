//! What plays over a walk on the tent laptop (wave 18b, Q4): while the
//! reinstall flow is up the station reports busy, the app counts it as
//! piloting, and so story slides and beat cutscenes stand aside; a story
//! overlay (blackout / alarm / go to the living room) still covers the
//! screen, and it **holds** the walk (`held`), never ends it.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MomentQueue, NO_PICK, pickScene } from "../src/cutscene/pick.ts";
import type { SceneDef } from "../src/cutscene/types.ts";
import { EMPTY_NIGHT, type ScreenProgram, type ScreenState } from "../src/screen.ts";
import { screenLayers } from "../src/slides.ts";

const T0 = 2_000_000;
const shot = (value: string, at: number, seq = 1) => ({ value, cue: `screens_${value}`, seq, at });

function state(program: Partial<ScreenProgram> = {}, over: Partial<ScreenState> = {}): ScreenState {
  return {
    now: T0,
    receivedAt: T0,
    night: EMPTY_NIGHT,
    moments: [],
    cues: {},
    character: { id: "Trabolta", hidden: false, awake: true, online: true, hold: false },
    attract: false,
    countdown: "y2k",
    remaining: 600,
    chart: null,
    target: "terminals",
    voice: null,
    room: null,
    announce: null,
    announces: [],
    identify: false,
    identifyLeft: null,
    announceEpoch: null,
    king: null,
    reinstalling: 1,
    ...over,
    program: { slide: null, overlay: null, blackout: null, flicker: null, ...program },
  };
}

describe("a walk on the tent laptop", () => {
  const slide = { ...shot("bingo", T0 - 1000), kind: "slide" as const, persist: true };

  it("story slides and the countdown corner stand aside while it walks", () => {
    const s = state({ slide });
    const idle = screenLayers(s, T0, { piloting: false });
    expect(idle.slide?.value).toBe("bingo");
    const walking = screenLayers(s, T0, { piloting: true });
    expect(walking.slide).toBeNull();
    expect(walking.corner).toBeNull();
  });

  it("an overlay still covers it (the app's takeover, which holds the walk)", () => {
    for (const value of ["alarm", "go_to_living_room"]) {
      const s = state({ slide, overlay: shot(value, T0 - 500, 2) });
      expect(screenLayers(s, T0, { piloting: true }).overlay, value).toBe(value);
    }
    const dark = state({ blackout: shot("blackout", T0 - 200, 3) });
    expect(screenLayers(dark, T0, { piloting: true }).overlay).toBe("blackout");
  });

  it("beat cutscenes stand aside too (a pilot is bare: no scene, no moment)", () => {
    const def: SceneDef = { id: "m", when: [{ moment: "beat", name: "majority reached" }], ms: 10_000, tv: () => null, wall: () => null };
    const s = state({}, { moments: [{ seq: 1, at: T0, kind: "beat", name: "majority reached", who: null, kept: false }] });
    const queued = () => {
      const q = new MomentQueue();
      q.update(s, T0 + 10, [def], "wall");
      return q;
    };
    const open = pickScene({ state: s, now: T0 + 10, layers: { overlay: null, slide: null }, bare: false, target: "wall", scenes: [def], queue: queued() });
    expect(open.top?.def.id).toBe("m");
    expect(pickScene({ state: s, now: T0 + 10, layers: { overlay: null, slide: null }, bare: true, target: "wall", scenes: [def], queue: queued() })).toEqual(NO_PICK);
  });

  it("the app wires it so: busy is piloting, the overlay is the walk's hold", () => {
    const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/const piloting = [^;]*\(config\.view === "reinstall" && reinstallBusy\)/u);
    const branch = app.slice(app.indexOf('if (config.view === "reinstall") {'), app.indexOf('if (config.view === "mirror"'));
    expect(branch).toMatch(/takeover=\{takeover\}/u);
    expect(branch).toMatch(/onBusy=\{setReinstallBusy\}/u);
    const station = readFileSync(new URL("../src/reinstall/ReinstallTerminal.tsx", import.meta.url), "utf8");
    expect(station).toMatch(/held=\{takeover\}/u);
    // Nothing on the station ends a walk because of an overlay.
    expect(station).not.toMatch(/takeover[^\n]*(exit|end|quit)\(/u);
  });
});
