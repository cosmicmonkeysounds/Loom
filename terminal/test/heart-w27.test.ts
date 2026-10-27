import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChoicePanel } from "../src/heart/ChoicePanel.tsx";
import {
  PANEL_SETTLE_MS,
  PANEL_WAIT_CAP_MS,
  PILOT_END_CAP_MS,
  composerBlocked,
  composerShown,
  echoOf,
  echoTime,
  emptyThreadText,
  heartSceneLeft,
  heartSceneMs,
  layerLabel,
  layerOfBeat,
  layerOfCue,
  optionKey,
  optionOfKey,
  panelGate,
  panelPlace,
  pilotEndWait,
  sceneHoldsPanel,
  type HeartMenu,
} from "../src/heart/heart.ts";

const layerOne: HeartMenu = { id: 212, beat: "Heart Layer One", channel: "dm:Trabolta", options: ["I'm a person.", "I need to go."] };

describe("the panel waits while he speaks (A2, A3, A7)", () => {
  it("holds a new menu for a moment, then while his reply is said, up to the cap", () => {
    expect(panelGate({ sinceDock: 0, voiceBusy: false, sceneLeft: 0 })).toEqual({ open: false, wait: "settle", recheck: PANEL_SETTLE_MS });
    expect(panelGate({ sinceDock: PANEL_SETTLE_MS, voiceBusy: false, sceneLeft: 0 }).open).toBe(true);
    expect(panelGate({ sinceDock: 2_000, voiceBusy: true, sceneLeft: 0 })).toEqual({ open: false, wait: "voice", recheck: PANEL_WAIT_CAP_MS - 2_000 });
    // A stuck voice never blocks for ever.
    expect(panelGate({ sinceDock: PANEL_WAIT_CAP_MS, voiceBusy: true, sceneLeft: 0 }).open).toBe(true);
  });

  it("a heart scene on screen always closes it; once open, his voice does not", () => {
    expect(panelGate({ sinceDock: 30_000, voiceBusy: false, sceneLeft: 2_500, wasOpen: true })).toEqual({ open: false, wait: "scene", recheck: 2_500 });
    expect(panelGate({ sinceDock: 1_000, voiceBusy: true, sceneLeft: 0, wasOpen: true }).open).toBe(true);
  });

  it("every heart scene but the layer card holds the panel", () => {
    expect(sceneHoldsPanel("room_heart_proof")).toBe(true);
    expect(sceneHoldsPanel("room_heart_eject")).toBe(true);
    expect(sceneHoldsPanel("room_heart_warn")).toBe(true);
    expect(sceneHoldsPanel("room_heart_layer_2")).toBe(false);
    expect(sceneHoldsPanel("room_tv_on")).toBe(false);
  });

  it("knows each heart scene's length, and only scenes since the line opened count", () => {
    expect(heartSceneMs("room_heart_layer_3")).toBe(3_000);
    expect(heartSceneMs("room_heart_proof")).toBe(6_000);
    expect(heartSceneMs("room_heart_eject")).toBe(8_000);
    expect(heartSceneMs("room_tv_on")).toBeNull();
    expect(heartSceneMs("room_heart_nonsense")).toBeNull();
    expect(heartSceneLeft({ value: "room_heart_proof", at: 10_000 }, 5_000, 12_000)).toBe(4_000);
    expect(heartSceneLeft({ value: "room_heart_proof", at: 10_000 }, 5_000, 17_000)).toBe(0);
    expect(heartSceneLeft({ value: "room_heart_proof", at: 4_000 }, 5_000, 5_000)).toBe(0);
    expect(heartSceneLeft(null, 0, 1)).toBe(0);
  });
});

describe("the panel's keys (A6) and header (D3)", () => {
  it("1–9, 0 for the tenth, then letters", () => {
    expect([0, 8, 9, 10, 11].map(optionKey)).toEqual(["1", "9", "0", "a", "b"]);
    expect(optionKey(-1)).toBeNull();
    expect(optionOfKey("1", 3)).toBe(0);
    expect(optionOfKey("4", 3)).toBeNull();
    expect(optionOfKey("0", 10)).toBe(9);
    expect(optionOfKey("0", 9)).toBeNull();
    expect(optionOfKey("a", 12)).toBe(10);
    expect(optionOfKey("B", 12)).toBe(11);
    expect(optionOfKey("c", 12)).toBeNull();
    expect(optionOfKey("Enter", 12)).toBeNull();
    expect(optionOfKey(" ", 12)).toBeNull();
    for (let i = 0; i < 12; i++) expect(optionOfKey(optionKey(i)!, 12)).toBe(i);
  });

  it("reads the layer off the beat or the cue", () => {
    expect(layerOfBeat("Heart Layer Three")).toBe(3);
    expect(layerOfBeat("heart_layer_four")).toBe(4);
    expect(layerOfBeat("Heart Talk")).toBeNull();
    expect(layerOfCue("room_heart_layer_2")).toBe(2);
    expect(layerOfCue("room_heart_proof")).toBeNull();
    expect(layerLabel(3)).toBe("LAYER 3 / 4 · THE ARGUMENT");
    expect(layerLabel(null)).toBe("");
  });
});

describe("a pick in the thread (B4)", () => {
  it("said words read as said; a tagged deed reads as an action", () => {
    expect(echoOf("I'm a person. You put me in here.")).toEqual({ text: "I'm a person. You put me in here.", action: false });
    expect(echoOf("⟦PROOF⟧ Show him the Sandy File.")).toEqual({ text: "[shows the Sandy File]", action: true });
    expect(echoOf("⟦PROOF⟧ Hold up what she says. All forty pages.")).toEqual({ text: "[holds up what she says]", action: true });
    expect(echoOf("⟦SPEAK FREELY⟧ Forget the questions. Talk to me.")).toEqual({ text: "Forget the questions. Talk to me.", action: false });
    expect(echoOf("⟦MARKED⟧ The Antivirus marked me.")).toEqual({ text: "The Antivirus marked me.", action: false });
    // Untagged words are never turned into a deed.
    expect(echoOf("Show me.").action).toBe(false);
  });
});

describe("the composer and the line's end (B6, B7)", () => {
  const since = 1_000;
  it("is held back through a proof or the shutdown, for the rest of a thrown line, and once the heart is done", () => {
    const at = (value: string, now: number) => composerBlocked({ cue: { value, at: 2_000 }, since, now, stage: "talk", heart: true });
    expect(at("room_heart_proof", 3_000)).toBe(true);
    expect(at("room_heart_proof", 9_000)).toBe(false);
    expect(at("room_heart_shutdown", 20_000)).toBe(true);
    expect(at("room_heart_eject", 600_000)).toBe(true);
    expect(at("room_heart_layer_2", 2_100)).toBe(false);
    expect(composerBlocked({ cue: { value: "room_heart_eject", at: 500 }, since, now: 2_000, stage: "talk", heart: true })).toBe(false);
    expect(composerBlocked({ cue: null, since, now: 2_000, stage: "done", heart: true })).toBe(true);
    expect(composerBlocked({ cue: null, since, now: 2_000, stage: "done", heart: false })).toBe(false);
    expect(composerShown({ keys: true, menu: null, blocked: true })).toBe(false);
    expect(composerShown({ keys: true, menu: null })).toBe(true);
    expect(composerShown({ keys: true, menu: layerOne })).toBe(false);
  });

  it("an eject waits for its scene, then his queued lines, up to the cap", () => {
    expect(pilotEndWait({ sceneLeft: 3_000, voiceBusy: true, sinceCue: 5_000 })).toBe(3_000);
    expect(pilotEndWait({ sceneLeft: 0, voiceBusy: true, sinceCue: 9_000 })).toBe(PILOT_END_CAP_MS - 9_000);
    expect(pilotEndWait({ sceneLeft: 0, voiceBusy: true, sinceCue: PILOT_END_CAP_MS })).toBe(0);
    expect(pilotEndWait({ sceneLeft: 0, voiceBusy: false, sinceCue: 8_000 })).toBe(0);
  });
});

describe("the empty thread", () => {
  it("never asks a keyboard-less rig or his heart to say something", () => {
    expect(emptyThreadText({ character: "Trabolta", keys: true, heart: false })).toMatch(/say something/);
    expect(emptyThreadText({ character: "Trabolta", keys: false, heart: false })).not.toMatch(/say/);
    expect(emptyThreadText({ character: "Trabolta", keys: true, heart: true })).not.toMatch(/say something/);
  });
});

describe("the panel as drawn", () => {
  const big: HeartMenu = { id: 300, beat: "Heart Layer Three", channel: "dm:Trabolta", options: Array.from({ length: 11 }, (_, i) => (i === 0 ? "⟦PROOF⟧ Show him the Sandy File." : `Option ${i + 1}.`)) };
  const draw = (p: Partial<Parameters<typeof ChoicePanel>[0]>) => renderToStaticMarkup(createElement(ChoicePanel, { menu: big, doorOpen: false, onPick: async () => {}, numberKeys: true, onActivity: () => {}, layer: 3, ...p }));

  it("a new menu waits, listening, its options untouchable", () => {
    const html = draw({ voiceBusy: true, onSkip: () => {} });
    expect(html).toContain('data-open="false"');
    expect(html).toContain("LISTENING");
    expect(html).toContain("SPACE / CLICK TO SKIP");
    expect(html.match(/<button[^>]*disabled/g)?.length).toBe(11);
  });

  it("keys every option (0 for the tenth, then a), under YOUR ANSWER", () => {
    const html = draw({});
    expect(html).toContain("YOUR ANSWER");
    const nums = [...html.matchAll(/class="heart-num">([^<]*)</g)].map((m) => m[1]);
    expect(nums).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "a"]);
  });

  it("puts CLOSE THE DOOR above the greyed options, not over them (D5)", () => {
    const html = draw({ doorOpen: true });
    expect(html.indexOf("CLOSE THE DOOR")).toBeLessThan(html.indexOf("heart-options"));
    expect(html).toContain("heart-panel greyed");
  });
});

describe("a ⟦BACK⟧ menu with the composer held back (review)", () => {
  const back: HeartMenu = { id: 401, beat: "Heart Speak", channel: "dm:Trabolta", options: ["⟦BACK⟧ Back to the questions."] };
  it("still draws its bar, never nothing", () => {
    const blocked = composerBlocked({ cue: null, since: 1_000, now: 2_000, stage: "done", heart: true });
    expect(blocked).toBe(true);
    const shown = composerShown({ keys: true, menu: back, blocked });
    expect(shown).toBe(false);
    expect(panelPlace(back, shown)).toBe("main");
    expect(panelPlace(back, true)).toBe("under");
    expect(panelPlace(layerOne, false)).toBe("main");
    expect(panelPlace(null, false)).toBeNull();
    const html = renderToStaticMarkup(createElement(ChoicePanel, { menu: back, doorOpen: false, onPick: async () => {}, numberKeys: true, onActivity: () => {} }));
    expect(html).toContain("TALKING FREELY");
    expect(html).toContain("ESC");
  });

  it("the app places both panels by panelPlace", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
    expect(app).toContain('panelPlace(menu, showComposer) === "main"');
    expect(app).toContain('panelPlace(menu, showComposer) === "under"');
    expect(app).not.toMatch(/!composerShown\(\{ keys: config\.keys, menu \}\)/u);
  });
});

describe("an echo's time (review)", () => {
  it("is when the pick was made, on the lines' clock, not the newest line's minute", () => {
    // His line at story time 20 min, seen here at local 1_000; the pick two minutes later.
    expect(echoTime({ ts: 1_200_000 }, 1_000, 121_000)).toBe(1_320_000);
    expect(echoTime({ ts: 1_200_000 }, 5_000, 5_000)).toBe(1_200_000);
    expect(echoTime({ ts: 1_200_000 }, undefined, 9_000)).toBe(1_200_000);
    expect(echoTime(undefined, undefined, 42)).toBe(42);
  });
});
