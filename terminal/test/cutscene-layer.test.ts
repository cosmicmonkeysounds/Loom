import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ScreenLayer } from "../src/ScreenLayer.tsx";
import { CutsceneSlot } from "../src/cutscene/slot.tsx";
import { drawsSlides } from "../src/cutscene/load.ts";
import { ACTS, SCENES, duplicateIds } from "../src/cutscene/registry.ts";
import { NO_LAYERS, type ScreenLayers } from "../src/slides.ts";

const layers: ScreenLayers = { ...NO_LAYERS, slide: { value: "trivia_1", cue: "screens_trivia_1", seq: 3, at: 1000 } };

describe("the cutscene slot", () => {
  it("shows the slide's card until the chunk has loaded (a server render never loads it)", () => {
    const html = renderToStaticMarkup(createElement(ScreenLayer, { layers, gear: null, cutscene: (card) => createElement(CutsceneSlot, { state: null, layers, bare: false, card, gear: null }) }));
    expect(html).toContain("TRABOLTA TRIVIA · ROUND 1");
    expect(html).toContain('class="slide-tap"');
    expect(html).not.toContain("data-peekable"); // no tap handler: no peek
  });

  it("keeps the wrapper standing with no slide (the layer under it is never remounted)", () => {
    const html = renderToStaticMarkup(createElement(ScreenLayer, { layers: NO_LAYERS, gear: null, onSlideTap: () => {}, cutscene: () => null }));
    expect(html).toBe('<div class="slide-tap" data-peekable=""></div>');
  });

  it("only screens that draw slides draw cutscenes", () => {
    for (const v of ["auto", "world", "face", "mirror", "tv", "shadow"]) expect(drawsSlides(v, null), v).toBe(true);
    expect(drawsSlides("chess", null)).toBe(false);
    expect(drawsSlides("casino", null)).toBe(false);
    expect(drawsSlides("face", "The Server Room")).toBe(false);
  });
});

describe("the registry", () => {
  it("lists the four act files, with no id used twice", () => {
    expect(ACTS.map((a) => a.file)).toEqual(["act1", "act2", "act3", "moments"]);
    expect(duplicateIds(SCENES)).toEqual([]);
    expect(duplicateIds([{ id: "a", when: [], ms: 1 }, { id: "a", when: [], ms: 2 }, { id: "b", when: [], ms: 3 }])).toEqual(["a"]);
  });

  it("every scene has a trigger, a length and something to draw", () => {
    for (const s of SCENES) {
      expect(s.when.length, s.id).toBeGreaterThan(0);
      expect(s.ms === "hold" || (typeof s.ms === "number" && s.ms > 0), s.id).toBe(true);
      expect(s.tv !== undefined || s.wall !== undefined, s.id).toBe(true);
    }
  });
});

describe("the cutscene layer, drawn", () => {
  it("draws a slide's scene in the slot, a moment's over nothing, the card for a slide with none", async () => {
    // A server render warns about the kit's layout effects (they measure a canvas / a marquee): expected here.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { CutsceneLayer } = await import("../src/cutscene/CutsceneLayer.tsx");
    const { DEMO_SCENES } = await import("../src/cutscene/scenes/demo.tsx");
    const { fakeState } = await import("../src/cutscene/fake.ts");
    const now = Date.now();
    const slide = { value: "kit_demo", cue: "tv_kit_demo", seq: 9, at: now - 5500 };
    const html = renderToStaticMarkup(createElement(CutsceneLayer, { state: fakeState({ now }), layers: { overlay: null, slide }, bare: false, card: createElement("i", null, "CARD"), gear: null, scenes: DEMO_SCENES, target: "tv" }));
    expect(html).toContain('data-scene="demo"');
    expect(html).toContain('data-seq="9"');
    expect(html).toContain("Installing the Kit"); // 5.5 s in: the desktop phase
    expect(html).not.toContain("CARD");
    // A slide no scene draws: its card.
    const card = renderToStaticMarkup(createElement(CutsceneLayer, { state: fakeState({ now }), layers: { overlay: null, slide: { ...slide, value: "beans" } }, bare: false, card: createElement("i", null, "CARD"), gear: null, scenes: DEMO_SCENES, target: "wall" }));
    expect(card).toBe("<i>CARD</i>");
    // A fresh moment over no slide, with the ⚙ (no slide brought one).
    const m = fakeState({ now, target: "terminals", moments: [{ seq: 4, at: now - 13_000, kind: "signal", name: "Kit Demo", who: "Excel", kept: false }] });
    const top = renderToStaticMarkup(createElement(CutsceneLayer, { state: m, layers: { overlay: null, slide: null }, bare: false, card: null, gear: createElement("b", null, "GEAR"), scenes: DEMO_SCENES }));
    expect(top).toContain('class="cutscene-stage cutscene-moment"');
    expect(top).toContain("Windows"); // 13 s in: the blue screen
    expect(top).toContain("<b>GEAR</b>");
    // An overlay or a pilot: nothing.
    expect(renderToStaticMarkup(createElement(CutsceneLayer, { state: m, layers: { overlay: "alarm", slide: null }, bare: false, card: null, gear: null, scenes: DEMO_SCENES }))).toBe("");
    quiet.mockRestore();
  });
});
