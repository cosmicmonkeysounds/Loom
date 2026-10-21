import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
