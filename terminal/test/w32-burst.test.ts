//! Wave 32 on the walls and the TV: the glitch shot's own words (C5) and the
//! ad burst — a ⚡ in a talk scene, or its timer, from the ad attack on —
//! drawn as a short popup storm over whatever is up instead of the 8 s
//! takeover, live only (never history, never a reload's, never a late page's).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScreenLayer } from "../src/ScreenLayer.tsx";
import { BURST_BEATS, BURST_POPUPS, AdBurst, burstMessages } from "../src/cutscene/kit/ad-burst.tsx";
import { AD_MESSAGES } from "../src/cutscene/scenes/act1.tsx";
import { EMPTY_NIGHT, GLITCH_TEXT_MAX, programOf, type ScreenMoment, type ScreenProgram, type ScreenState } from "../src/screen.ts";
import { BURST_MOMENTS, BURST_MS, BURST_WITH_MS, GLITCH_MS, GLITCH_TEXT, burstLayer, glitchLayer, glitchText, isBurst, screenLayers } from "../src/slides.ts";

const T0 = 1_000_000;
const LINE = "CALL NOW. There is no number. Do not call.";
const MAIN = fileURLToPath(new URL("../../core/examples/trapped-in-the-internet/main.loom", import.meta.url));

const shot = (value: string, at: number, seq = 1, text?: string) => ({ value, cue: `screens_${value}`, seq, at, ...(text !== undefined ? { text } : {}) });
const moment = (kind: ScreenMoment["kind"], name: string, at: number, seq = 50): ScreenMoment => ({ seq, at, kind, name, who: null, kept: false });

function state(over: { program?: Partial<ScreenProgram>; moments?: ScreenMoment[]; firstNow?: number; glitchSeen?: number } = {}): ScreenState {
  return {
    now: T0,
    receivedAt: T0,
    night: EMPTY_NIGHT,
    moments: over.moments ?? [],
    cues: {},
    character: null,
    attract: false,
    countdown: null,
    remaining: null,
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
    reinstalling: 0,
    firstNow: over.firstNow ?? T0 - 60_000,
    ...(over.glitchSeen !== undefined ? { glitchSeen: over.glitchSeen } : {}),
    program: { slide: null, overlay: null, blackout: null, flicker: null, ...over.program },
  } as ScreenState;
}
const layersAt = (s: ScreenState, ms: number, o: Partial<{ piloting: boolean; peek: boolean; room: boolean; slides: boolean }> = {}) => screenLayers(s, s.receivedAt + ms, { piloting: false, ...o });

describe("the glitch shot's own words (wave 32, C5)", () => {
  it("parses `text` off the wire: trimmed, clipped, left out when empty", () => {
    expect(programOf({ glitch: { value: "glitch", cue: "screens_glitch", seq: 4, at: 1234, text: `  ${LINE}  ` } }).glitch).toEqual({ value: "glitch", cue: "screens_glitch", seq: 4, at: 1234, text: LINE });
    expect(programOf({ glitch: { value: "glitch", cue: "screens_glitch", seq: 4, at: 1234, text: "  " } }).glitch).not.toHaveProperty("text");
    expect(programOf({ glitch: { value: "glitch", cue: "screens_glitch", seq: 4, at: 1234, text: 7 } }).glitch).not.toHaveProperty("text");
    expect(programOf({ glitch: { value: "glitch", cue: "screens_glitch", seq: 4, at: 1234, text: "x".repeat(300) } }).glitch?.text).toHaveLength(GLITCH_TEXT_MAX);
  });

  it("the takeover shows the shot's words, else the hijack's zeroes", () => {
    expect(glitchText(null)).toBe(GLITCH_TEXT);
    expect(glitchText({})).toBe(GLITCH_TEXT);
    expect(glitchText({ text: " " })).toBe(GLITCH_TEXT);
    expect(glitchText({ text: LINE })).toBe(LINE);
    const withText = layersAt(state({ program: { glitch: shot("glitch", T0, 9, "WHO BROUGHT THE MALWARE IN") } }), 1200);
    expect(withText.glitch).toMatchObject({ seq: 9, text: "WHO BROUGHT THE MALWARE IN" });
    const html = renderToStaticMarkup(createElement(ScreenLayer, { layers: withText, gear: null }));
    expect(html).toContain("WHO BROUGHT THE MALWARE IN");
    expect(html).not.toContain(GLITCH_TEXT);
    expect(html).toContain("data-long");
    // The 📺 hijack: no text (or the zeroes): exactly as before.
    const old = renderToStaticMarkup(createElement(ScreenLayer, { layers: layersAt(state({ program: { glitch: shot("glitch", T0, 9) } }), 1200), gear: null }));
    expect(old).toContain(GLITCH_TEXT);
    expect(old).not.toContain("data-long");
  });
});

describe("the ad burst (wave 32)", () => {
  const burst = (marks: ScreenMoment[], over: Parameters<typeof state>[0] = {}) => state({ program: { glitch: shot("glitch", T0, 9, LINE) }, moments: marks, ...over });

  it("is the server's `light` glitch, else (an older server) one cued with the burst's own sound; never the 📺 hijack's", () => {
    // The server says so: no moment needed, so the ring rolling over never changes the answer.
    expect(isBurst({ at: T0, light: true }, [])).toBe(true);
    expect(isBurst({ at: 0, light: true }, [])).toBe(false); // history
    expect(programOf({ glitch: { value: "glitch", cue: "screens_glitch", seq: 4, at: 1234, light: true } }).glitch).toMatchObject({ light: true });
    expect(programOf({ glitch: { value: "glitch", cue: "screens_glitch", seq: 4, at: 1234, light: "yes" } }).glitch).not.toHaveProperty("light");
    // An older server: the burst's sound only.
    expect(BURST_MOMENTS).toEqual([{ kind: "sfx", name: "truther_glitch" }]);
    expect(isBurst({ at: T0 }, [moment("sfx", "truther_glitch", T0)])).toBe(true);
    expect(isBurst({ at: T0 }, [moment("sfx", "Truther Glitch", T0 + BURST_WITH_MS)])).toBe(true);
    // A timed burst is a story `fire` (no signal): its sound marks it.
    expect(isBurst({ at: T0 }, [moment("sfx", "truther_glitch", T0 - 500)])).toBe(true);
    // The 📺 rule: its own jingle, a big broadcast — no burst.
    expect(isBurst({ at: T0 }, [moment("sfx", "ad_jingle", T0), moment("big", "000. 000. 000. A SPECIAL OFFER FOR YOU.", T0), moment("signal", "second_hunt_preview", T0)])).toBe(false);
    // A ⚡ flicker (intro, bottle) pressed just before the 📺: its signal never makes the hijack a burst.
    expect(isBurst({ at: T0 }, [moment("signal", "ad_burst", T0 - 1500), moment("sfx", "ad_jingle", T0)])).toBe(false);
    // Too far from the cue (the Truther Download's sound), or history.
    expect(isBurst({ at: T0 }, [moment("sfx", "truther_glitch", T0 - BURST_WITH_MS - 1)])).toBe(false);
    expect(isBurst({ at: 0 }, [moment("sfx", "truther_glitch", 0)])).toBe(false);
  });

  it("a ⚡ flicker just before the 📺: the hijack keeps its full takeover and holds its slide", () => {
    const slide = { ...shot("ad_hijack", T0 + 1, 3), kind: "slide" as const, persist: true };
    const s = state({ program: { glitch: shot("glitch", T0, 9, "000. 000. 000."), slide }, moments: [moment("signal", "ad_burst", T0 - 1500), moment("sfx", "ad_jingle", T0)] });
    expect(layersAt(s, 100)).toMatchObject({ burst: null, glitch: { seq: 9 }, slide: { value: "ad_hijack", at: T0 + GLITCH_MS } });
  });

  it("the story's burst rule plays the sound this keys on, and the 📺 rule doesn't", () => {
    const main = readFileSync(MAIN, "utf8");
    const rule = main.slice(main.indexOf("when ad_burst:"), main.indexOf("// The scene glitches on its own too"));
    expect(rule).toContain("cue screens_glitch");
    expect(rule).toContain("sound truther_glitch");
    expect(rule).toContain('set Night.glitch_kind = "burst"');
    const hijack = main.slice(main.indexOf("when second_hunt_preview:"));
    const body = hijack.slice(0, hijack.indexOf("\nwhen ", 10));
    expect(body).toContain("cue screens_glitch");
    expect(body).not.toContain("truther_glitch");
    expect(main).toMatch(/INTERACTION ad_burst\n[^\n]*\n\s+who: admin/u);
  });

  it("plays BURST_MS over whatever is up, in place of the takeover; the takeover is for the hijack", () => {
    const s = burst([moment("sfx", "truther_glitch", T0)]);
    expect(layersAt(s, 0)).toMatchObject({ glitch: null, burst: { seq: 9, at: T0, t: 0, text: LINE } });
    expect(layersAt(s, 2000).burst).toMatchObject({ t: 2000 });
    expect(layersAt(s, BURST_MS - 1).burst).not.toBeNull();
    expect(layersAt(s, BURST_MS).burst).toBeNull();
    expect(layersAt(s, BURST_MS).glitch).toBeNull(); // never the takeover's tail either
    expect(BURST_MS).toBeGreaterThanOrEqual(3000);
    expect(BURST_MS).toBeLessThanOrEqual(4000);
    expect(BURST_MS).toBeLessThan(GLITCH_MS);
    // The same cue with no burst mark: the takeover, with the shot's words.
    expect(layersAt(burst([]), 0)).toMatchObject({ burst: null, glitch: { seq: 9, text: LINE } });
    // A burst is no cover: the idle show and a pilot run on under it.
    expect(glitchLayer(s, T0, false)).toBeNull();
  });

  it("is live only: never history, never one a reload or a late page saw, and a blackout beats it", () => {
    const marks = [moment("sfx", "truther_glitch", T0)];
    expect(burstLayer({ ...burst(marks), program: { ...burst(marks).program, glitch: shot("glitch", 0, 9, LINE) } }, T0, false)).toBeNull();
    expect(layersAt(burst(marks, { firstNow: T0 + 500 }), 1000).burst).toBeNull();
    expect(layersAt(burst(marks, { glitchSeen: T0 + 5000 }), 5000).burst).toBeNull();
    expect(burstLayer(burst(marks), T0 + 100, true)).toBeNull();
    // Every view that draws scenes, a pilot or a peek or the tent too.
    for (const o of [{ piloting: true }, { peek: true }, { room: true }, { slides: false }]) expect(layersAt(burst(marks), 100, o).burst, JSON.stringify(o)).not.toBeNull();
  });

  it("never holds the slide under it: a slide cued with a burst runs from its own cue", () => {
    const slide = { ...shot("trivia_2", T0 + 1, 3), kind: "slide" as const, persist: false };
    const s = state({ program: { glitch: shot("glitch", T0, 9, LINE), slide }, moments: [moment("sfx", "truther_glitch", T0)] });
    expect(layersAt(s, 100).slide).toMatchObject({ value: "trivia_2", at: T0 + 1 });
    // The hijack's takeover still holds its slide's clock (unchanged).
    const h = state({ program: { glitch: shot("glitch", T0, 9), slide: { ...slide, value: "ad_hijack", persist: true } } });
    expect(layersAt(h, 100).slide).toMatchObject({ value: "ad_hijack", at: T0 + GLITCH_MS });
  });

  it("draws the hijack's popups, its own line first and slammed across the middle, then goes", () => {
    expect(burstMessages(LINE)[0]).toMatchObject({ text: LINE });
    expect(burstMessages(LINE).slice(1)).toEqual([...AD_MESSAGES]);
    const draw = (t: number, reduced = false) => renderToStaticMarkup(createElement(AdBurst, { t, seq: 9, text: LINE, reduced }));
    const mid = draw(BURST_BEATS.banner + BURST_POPUPS.span);
    expect(mid).toContain('data-burst="9"');
    expect(mid).toContain("ad-burst-banner");
    expect(mid).toContain(LINE);
    expect(mid).toContain("kit-storm");
    expect(mid.match(/kit-win/gu)?.length ?? 0).toBeGreaterThanOrEqual(BURST_POPUPS.count);
    expect(draw(0)).not.toContain("ad-burst-banner");
    expect(draw(BURST_MS)).toBe("");
    expect(draw(1500, true)).toContain(LINE);
    expect(draw(1500, true)).not.toContain("ad-burst-tear");
    // It takes no taps and sits under the overlays (32) and the ⚙ (40).
    const css = readFileSync(fileURLToPath(new URL("../src/cutscene/cutscene.css", import.meta.url)), "utf8");
    expect(css).toMatch(/\.cutscene-stage\.cutscene-burst \{ z-index: 31; pointer-events: none;/u);
  });

  it("the cutscene layer draws it over the scene, keyed on its cue, with nothing else up", async () => {
    const { CutsceneLayer } = await import("../src/cutscene/CutsceneLayer.tsx");
    const { fakeState } = await import("../src/cutscene/fake.ts");
    const now = Date.now();
    const draw = (b: { seq: number; at: number; t: number; text: string } | null) => renderToStaticMarkup(createElement(CutsceneLayer, { state: fakeState({ now }), layers: { overlay: null, slide: null, burst: b }, bare: true, card: null, gear: null, scenes: [], target: "wall" }));
    const html = draw({ seq: 12, at: now - 1500, t: 1500, text: LINE });
    expect(html).toContain('data-burst="12"');
    expect(html).toContain(LINE);
    expect(draw(null)).not.toContain("data-burst");
    expect(draw({ seq: 12, at: now - BURST_MS - 10, t: BURST_MS + 10, text: LINE })).not.toContain("data-burst");
  });

  it("the story's burst lines are digit-free but for the hijack's zeroes (C2), and fit the screen", () => {
    const main = readFileSync(MAIN, "utf8");
    const lines = [...main.matchAll(/set Night\.glitch_text = "([^"]*)"/gu)].map((m) => m[1]!).filter((l) => l !== "000. 000. 000.");
    expect(lines.length).toBeGreaterThanOrEqual(7);
    for (const l of lines) {
      expect(l, l).not.toMatch(/\d/u);
      expect(l.length, l).toBeLessThanOrEqual(GLITCH_TEXT_MAX);
    }
  });
});
