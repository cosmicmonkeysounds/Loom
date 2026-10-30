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
    // A wall with slides on still shows it (what the tent did before wave 26).
    const wall = screenLayers(s, T0, { piloting: false });
    expect(wall.slide?.value).toBe("bingo");
    const walking = screenLayers(s, T0, { piloting: true, slides: false });
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

  it("the app layers the tent with no slides (wave 26, T3)", () => {
    const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/const station = config\.view === "reinstall";/u);
    expect(app).toMatch(/screenLayers\(screenState\.state, Date\.now\(\), \{ piloting, peek, room: bare, slides: !station, dreamReady \}\)/u);
    expect(app).toMatch(/<LiveScreenLayer [^\n]*slides=\{!station\}/u);
  });
});

describe("the tent between walks (wave 26, T3): a scan kiosk", () => {
  const slide = { ...shot("bingo", T0 - 1000), kind: "slide" as const, persist: true };

  it("takes no story slide, no countdown corner and no Y2K clock", () => {
    const s = state({ slide: { ...shot("y2k", T0 - 1000), kind: "slide" as const, persist: true } });
    const idle = screenLayers(s, T0, { piloting: false, slides: false });
    expect(idle).toMatchObject({ slide: null, corner: null, y2k: null });
    expect(screenLayers(state({ slide }), T0, { piloting: false, slides: false }).slide).toBeNull();
  });

  it("still takes the overlays and the glitch", () => {
    const s = state({ slide, overlay: shot("alarm", T0 - 500, 2), glitch: shot("glitch", T0 - 100, 4) }, { firstNow: T0 - 60_000 });
    const l = screenLayers(s, T0, { piloting: false, slides: false });
    expect(l.overlay).toBe("alarm");
    expect(l.glitch?.seq).toBe(4);
  });

  it("still plays the beat cutscenes (it is not bare between walks)", () => {
    const def: SceneDef = { id: "m", when: [{ moment: "beat", name: "majority reached" }], ms: 10_000, tv: () => null, wall: () => null };
    const s = state({}, { moments: [{ seq: 1, at: T0, kind: "beat", name: "majority reached", who: null, kept: false }] });
    const q = new MomentQueue();
    q.update(s, T0 + 10, [def], "wall");
    const layers = screenLayers(s, T0 + 10, { piloting: false, slides: false });
    expect(pickScene({ state: s, now: T0 + 10, layers, bare: false, target: "wall", scenes: [def], queue: q }).top?.def.id).toBe("m");
  });

  it("the kiosk: one centred card with the camera, the typed field and the picks; no world pane, no modal wizard", () => {
    const station = readFileSync(new URL("../src/reinstall/ReinstallTerminal.tsx", import.meta.url), "utf8");
    expect(station).toMatch(/<IdleShow [^\n]*quiet \/>/u);
    expect(station).toMatch(/className="ri-station"/u);
    expect(station).toMatch(/<TypedFallback config=\{config\} focus=\{typingFocus\} scope=\{card\} clearOnPick/u);
    expect(station).toMatch(/const typingFocus = step\.kind === "idle"/u);
    expect(station).not.toMatch(/worldSlot|paneSimulation|ScanBox/u);
    expect(station).toMatch(/\{wizardUp && <WizardStatus \/>\}/u);
    expect(station).toMatch(/countsLine\(\{ total: reinstalling, here: 0 \}, false\)/u);
    const css = readFileSync(new URL("../src/reinstall/reinstall.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.ri-pick \{ min-height: 48px; min-width: 48px;/u);
    expect(css).toMatch(/\.idle-show\[data-quiet\] \{ opacity: 0\.35; \}/u);
    // The wizard is a line in the card, not a fixed modal over the scanner.
    const wiz = /\.ri-wizard \{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(wiz).not.toMatch(/position: absolute|z-index/u);
  });

  it("the kiosk's camera gives up its height before the rows under it clip (1366x768, picks + wizard line up)", () => {
    const css = readFileSync(new URL("../src/reinstall/reinstall.css", import.meta.url), "utf8");
    const body = /\.ri-station-body \{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(body).toMatch(/display: flex; flex-direction: column;/u);
    expect(body).toMatch(/min-height: 0/u);
    // Every row keeps its height; only the camera shrinks, from 44vh down to a floor.
    expect(css).toMatch(/\.ri-station-body > \* \{ flex: none; \}/u);
    expect(css).toMatch(/\.ri-station-body > \.ri-station-cam \{ flex: 1 1 44vh; \}/u);
    const cam = /^\.ri-station-cam \{([^}]*)\}/mu.exec(css)?.[1] ?? "";
    expect(cam).toMatch(/min-height: 140px; max-height: 44vh;/u);
    expect(cam).not.toMatch(/(^|[;\s])height: 44vh/u);
    // No auto side margins: in a column they would shrink the camera to nothing.
    expect(cam).not.toMatch(/margin: 0 auto/u);
  });
});
