// Wave 44 (C8): the credits scene on the TV and the walls — registered for
// the `credits` slide, held, silent, drawn from the cache's answer (or the
// fallback card), paging under Reduce Motion.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CREDITS_SLIDE, creditsRows } from "../../core/src/credits.ts";
import { creditsCache, creditsKey } from "../src/cutscene/credits-fetch.ts";
import { CREDITS_FALLBACK_END, CREDITS_FALLBACK_TITLE } from "../src/cutscene/credits-roll.ts";
import { fakeCredits, fakeState } from "../src/cutscene/fake.ts";
import { componentFor, sceneForSlide } from "../src/cutscene/pick.ts";
import { SCENES } from "../src/cutscene/registry.ts";
import { SCENES as CREDITS } from "../src/cutscene/scenes/credits.tsx";
import type { SceneProps, SceneTarget } from "../src/cutscene/types.ts";
import { SLIDE_COPY, slideCopy } from "../src/slides.ts";

const def = CREDITS[0]!;

function render(o: { t: number; seq: number; target?: SceneTarget; reduced?: boolean }): { html: string; sounds: number } {
  const target = o.target ?? "tv";
  const View = componentFor(def, target)!;
  const state = fakeState({ now: 1_000_000 + o.t, target: target === "tv" ? "tv" : "terminals" });
  let sounds = 0;
  const props: SceneProps = { t: o.t, at: 1_000_000, seq: o.seq, value: CREDITS_SLIDE, state, night: state.night, who: null, target, sfx: () => (sounds++, true), done: () => {}, reduced: o.reduced ?? false };
  return { html: renderToStaticMarkup(createElement(View, props)), sounds };
}
const key = (seq: number) => creditsKey("preview", seq);

describe("the credits scene", () => {
  it("is registered for the credits slide, held, on the TV and the walls", () => {
    expect(CREDITS_SLIDE).toBe("credits");
    expect(def.id).toBe("credits");
    expect(def.ms).toBe("hold");
    expect(def.when).toEqual([{ slide: "credits" }]);
    expect(def.tv).toBeDefined();
    expect(def.wall).toBeDefined();
    expect(def.face).toBeUndefined();
    expect(def.namesCharacter).toBeUndefined();
    for (const target of ["tv", "wall"] as const) expect(sceneForSlide(SCENES, "credits", target)?.id).toBe("credits");
  });

  it("has a plain card for when its chunk can't load", () => {
    expect(SLIDE_COPY.credits).toBeDefined();
    expect(slideCopy("credits").lines).toContain("Thank you for playing.");
  });

  it("follows the story's cue, once the story lane has it", () => {
    const story = readFileSync(fileURLToPath(new URL("../../core/examples/trapped-in-the-internet/main.loom", import.meta.url)), "utf8");
    // The story lane writes `cue screens_credits` in parallel (C3); once it is there the scene must answer it.
    if (story.includes("screens_credits")) expect(story).toMatch(/cue screens_credits\b/u);
  });

  it("draws nothing but the dark stage while it asks", () => {
    const { html } = render({ t: 2000, seq: 900 });
    expect(html).toContain('data-credits="loading"');
    expect(html).not.toContain("cr-column");
    expect(html).not.toContain("cr-end");
  });

  it("rolls every row of the answer, the TV's part beside the name", () => {
    const view = fakeCredits();
    creditsCache.seed(key(1), { status: "ready", view });
    const { html, sounds } = render({ t: 4000, seq: 1 });
    expect(html).toContain('data-credits-phase="roll"');
    expect(html).toContain("cr-tv");
    expect(html).toContain("kit-starfield");
    for (const r of creditsRows(view)) {
      if (r.kind === "person") expect(html).toContain(r.name);
      if (r.kind === "heading" || r.kind === "line" || r.kind === "title") expect(html).toContain(r.text);
    }
    expect(html).not.toContain("data-credits-end");
    expect(sounds).toBe(0);
  });

  it("holds the end card (the title and the end lines) after the roll", () => {
    const view = fakeCredits();
    creditsCache.seed(key(2), { status: "ready", view });
    const { html } = render({ t: 3_600_000, seq: 2, target: "wall" });
    expect(html).toContain("data-credits-end");
    expect(html).toContain("cr-wall");
    expect(html).not.toContain("kit-starfield");
    for (const l of view.end) expect(html).toContain(l);
    expect(html).toContain('opacity:1.000');
  });

  for (const status of ["none", "failed"] as const) {
    it(`draws the built-in fallback's title and end lines only (${status})`, () => {
      creditsCache.seed(key(3), { status });
      const { html } = render({ t: 5000, seq: 3 });
      expect(html).toContain(CREDITS_FALLBACK_TITLE);
      for (const l of CREDITS_FALLBACK_END) expect(html).toContain(l);
      expect(html).not.toContain("cr-column");
      expect(html).not.toContain("cr-page");
    });
  }

  it("pages through under Reduce Motion instead of scrolling", () => {
    const view = fakeCredits(40);
    creditsCache.seed(key(4), { status: "ready", view });
    const first = render({ t: 1000, seq: 4, reduced: true }).html;
    expect(first).toContain('data-credits-page="0"');
    expect(first).not.toContain("cr-column");
    expect(first).toContain(view.title);
    const later = render({ t: 30_000, seq: 4, reduced: true }).html;
    expect(later).not.toContain('data-credits-page="0"');
    expect(later).toContain("data-credits-page=");
  });
});
