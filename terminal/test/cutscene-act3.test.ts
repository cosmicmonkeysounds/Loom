// Lane tv3's scenes (wave 17): Act F–G + the house-wide moments. Every
// trigger against the show's own text, and every scene drawn at its key
// frames on both targets (the timelines: `cutscene-tv3-time.test.ts`).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HISTORY_T } from "../src/cutscene/clock.ts";
import { fakeState } from "../src/cutscene/fake.ts";
import { componentFor } from "../src/cutscene/pick.ts";
import { previewBeats } from "../src/cutscene/preview.tsx";
import { ADVICE_CHAT, CEREMONY_ROLL, SCENES as ACT3 } from "../src/cutscene/scenes/act3.tsx";
import { SCENES as MOMENTS, OVER_WORLD_MS, finderName } from "../src/cutscene/scenes/moments.tsx";
import { noteWorldShowing, worldCelebratesFinds } from "../src/cutscene/world-bus.ts";
import { CELEBRATION_MS } from "../src/world/state.ts";
import type { SceneDef, SceneTarget } from "../src/cutscene/types.ts";
import type { ScreenMoment, ScreenNight } from "../src/screen.ts";

const SHOW = join(__dirname, "../../core/examples/trapped-in-the-internet");

function loomFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...loomFiles(p));
    else if (f.endsWith(".loom")) out.push(p);
  }
  return out;
}
const STORY = loomFiles(SHOW)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

const ALL: SceneDef[] = [...ACT3, ...MOMENTS];

// --- the triggers, against the show -------------------------------------------------------

describe("tv3 triggers name the story's real cues, beats and signals", () => {
  const beatNames = new Set([...STORY.matchAll(/^== (.+)$/gmu)].map((m) => m[1]!.trim()));
  const adminCues = new Set([...STORY.matchAll(/^INTERACTION (\S+)\n(?:  .*\n)*?  who: admin/gmu)].map((m) => m[1]!));
  const screenCue = (v: string) => (v.endsWith("*") ? new RegExp(`cue (?:screens|terminals|tv)_${v.slice(0, -1)}`, "u") : new RegExp(`cue (?:screens|terminals|tv)_${v}\\b`, "u"));

  it("every trigger is real", () => {
    for (const s of ALL)
      for (const w of s.when) {
        if ("slide" in w) expect(STORY, `${s.id}: slide ${w.slide}`).toMatch(screenCue(w.slide));
        else if (w.moment === "beat") expect(beatNames.has(w.name), `${s.id}: beat ${w.name}`).toBe(true);
        else if (w.moment === "signal") expect(adminCues.has(w.name), `${s.id}: admin cue ${w.name}`).toBe(true);
        else if (w.moment === "found") expect(["golden duck", "golden duck kept"], s.id).toContain(w.name);
        else throw new Error(`${s.id}: unexpected trigger ${JSON.stringify(w)}`);
      }
  });

  it("the server names a find the way the scenes expect", () => {
    const screen = readFileSync(join(__dirname, "../../core/server/routes/screen.ts"), "utf8");
    expect(screen).toContain('"golden duck kept"');
    expect(screen).toContain('"golden duck"');
  });

  it("the clips are wall-only (the TV never gets a terminals_ cue) and match the story's play_on_the_screens", () => {
    for (const id of ["dancing_baby", "hamster_dance", "under_construction", "youve_got_mail"]) {
      const s = MOMENTS.find((d) => d.id === id)!;
      expect(s.tv, id).toBeUndefined();
      expect(s.wall, id).toBeDefined();
      expect(STORY).toContain(`cue terminals_${id}`);
    }
  });

  it("every wait the scenes loop through is a slide the server keeps up until the next cue", () => {
    const screen = readFileSync(join(__dirname, "../../core/server/routes/screen.ts"), "utf8");
    const set = /PERSISTENT_SLIDES[^=]*= new Set\(\[([^\]]*)\]\)/u.exec(screen);
    expect(set, "core's PERSISTENT_SLIDES").not.toBeNull();
    const kept = [...set![1]!.matchAll(/"([^"]+)"/gu)].map((m) => m[1]);
    for (const v of ["bobbing", "advice", "grok_prom", "banish", "truth_txt"]) expect(kept, v).toContain(v);
    expect(screen).toContain("/^(award|ceremony)/u");
  });

  it("covers every slide of Act F–G", () => {
    const slides = new Set(ACT3.flatMap((s) => s.when.flatMap((w) => ("slide" in w ? [w.slide] : []))));
    for (const v of ["final_reveal", "bobbing", "truth_txt", "song", "grok_prom", "rave", "advice", "banish", "ceremony", "award_*"]) expect(slides.has(v), v).toBe(true);
  });
});

// --- every scene, drawn ---------------------------------------------------------------------

const NIGHT: Partial<ScreenNight> = { award_winner: "Netscape Navigator", award_value: 37, help_votes: 5, thwart_votes: 2, phase: "advice" };

function draw(def: SceneDef, target: SceneTarget, t: number, o: { reduced?: boolean; introduced?: boolean; night?: Partial<ScreenNight>; value?: string; who?: string | null; moments?: ScreenMoment[]; at?: number } = {}): string {
  const View = componentFor(def, target);
  if (View === null) return "";
  const state = fakeState({ introduced: o.introduced ?? true, target: target === "tv" ? "tv" : "terminals", night: { ...NIGHT, ...o.night }, moments: o.moments });
  const value = o.value ?? (def.when[0] && "slide" in def.when[0] ? def.when[0].slide.replace(/\*$/u, "most_trusted") : (def.when[0] as { name: string }).name);
  return renderToStaticMarkup(createElement(View, { t, at: o.at ?? 1000, seq: 1, value, state, night: state.night, who: o.who === undefined ? "Winamp" : o.who, target, sfx: () => false, done: () => {}, reduced: o.reduced ?? false }));
}

const beatMoment = (name: string, at: number, seq = at): ScreenMoment => ({ seq, at, kind: "beat", name, who: null, kept: false });

describe("every tv3 scene draws", () => {
  // A server render warns about the kit's layout effects (they measure a canvas / a marquee).
  let quiet: ReturnType<typeof vi.spyOn>;
  beforeAll(() => {
    quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(() => quiet.mockRestore());

  const times = (def: SceneDef) => (typeof def.ms === "number" ? [0, 500, 1500, def.ms / 3, def.ms / 2, def.ms * 0.8, def.ms - 1] : [0, 500, 1500, 3000, 6000, 12_000, 45_000, HISTORY_T]);

  it("on both targets, at every key frame, reduced or not — and only a namesCharacter scene says the name", () => {
    for (const def of ALL)
      for (const target of ["tv", "wall"] as const)
        for (const reduced of [false, true])
          for (const t of times(def)) {
            const html = draw(def, target, t, { reduced });
            if (componentFor(def, target) === null) continue;
            expect(html.length, `${def.id} ${target} ${t}`).toBeGreaterThan(0);
            if (/Trabolta/u.test(html)) expect(def.namesCharacter, `${def.id} names him at ${t}`).toBe(true);
          }
  });

  it("every hold scene is still moving long after it started (the persistent slides loop)", () => {
    for (const def of ALL.filter((d) => d.ms === "hold"))
      for (const target of ["tv", "wall"] as const) {
        if (componentFor(def, target) === null) continue;
        const a = draw(def, target, HISTORY_T);
        const b = draw(def, target, HISTORY_T + 1700);
        expect(a === b, `${def.id} ${target} froze`).toBe(false);
      }
  });

  it("an award shows the winner's name and value off the night block, and asks them forward without one", () => {
    const award = ACT3.find((d) => d.id === "award")!;
    const up = draw(award, "tv", 6000, { value: "award_lore_hoarder" });
    expect(up).toContain("Netscape Navigator");
    expect(up).toContain("LORE HOARDER");
    expect(up).toContain("Codex entries held");
    const late = draw(award, "wall", HISTORY_T, { value: "award_duck_speedrun", night: { award_value: "2:31" } });
    expect(late).toContain("Netscape Navigator");
    expect(late).toContain("2:31");
    const none = draw(award, "tv", 6000, { night: { award_winner: null, award_value: null } });
    expect(none).toContain("Please come forward");
    expect(none).not.toContain("Trust score");
  });

  it("the ceremony's ticker names only the awards every night gives, never a bonus one", () => {
    const ceremony = ACT3.find((d) => d.id === "ceremony")!;
    const html = draw(ceremony, "tv", 12_000);
    for (const title of ["MOST TRUSTED", "LEAST TRUSTED", "FREQUENT FLYER TO THE INTERNET", "LORE HOARDER", "TRUTHCOIN TYCOON"]) {
      expect(CEREMONY_ROLL).toContain(title);
      expect(html).toContain(title);
    }
    for (const title of ["BEST LIAR", "GOLDEN DUCK SPEEDRUN", "QUEST COMPLETIONIST", "THE MILLION DOLLAR PAINTING"]) {
      expect(CEREMONY_ROLL).not.toContain(title);
      expect(html).not.toContain(title);
    }
  });

  it("the advice poll shows the live tally, and SHE SAID YES once he is helped", () => {
    const advice = ACT3.find((d) => d.id === "advice")!;
    const poll = draw(advice, "tv", 8000);
    expect(poll).toContain("Help him");
    expect(poll).toContain("7 programs have voted");
    expect(draw(advice, "tv", 8000, { night: { phase: "finale_help" } })).toContain("SHE SAID YES");
  });

  it("the duck names its finder; a kept find reads GERALD CAN'T HELP and lays no egg", () => {
    const duck = MOMENTS.find((d) => d.id === "golden_duck")!;
    const kept = MOMENTS.find((d) => d.id === "golden_duck_kept")!;
    const found = draw(duck, "tv", 6000, { who: "MS Paint" });
    expect(found).toContain("MS PAINT");
    expect(found).toContain('rx="9" ry="12"'); // the golden egg
    for (const t of [0, 2000, 5000, 8500]) {
      const html = draw(kept, "tv", t, { who: "MS Paint" });
      expect(html).not.toContain('rx="9" ry="12"');
      if (t >= 2000) expect(html).toContain("GERALD CAN&#x27;T HELP");
    }
    // The first reinstallation can come before the introduction: neither names him.
    expect(duck.namesCharacter).not.toBe(true);
    expect(kept.namesCharacter).not.toBe(true);
    expect(draw(duck, "tv", 6000, { introduced: false })).not.toMatch(/Trabolta/u);
  });

  it("over a live world view the duck is see-through: a frame round the real find, never a curtain over it", () => {
    const duck = MOMENTS.find((d) => d.id === "golden_duck")!;
    const kept = MOMENTS.find((d) => d.id === "golden_duck_kept")!;
    const bye = noteWorldShowing();
    try {
      expect(worldCelebratesFinds()).toBe(true);
      for (const target of ["tv", "wall"] as const)
        for (const t of [0, 500, 2500, 6000, OVER_WORLD_MS - 100]) {
          const live = draw(duck, target, t, { who: "MS Paint" });
          expect(live).toContain("tv3-over-frame");
          expect(live).toContain("background:transparent");
          // The world's own banner names the finder and lays the egg: not twice.
          expect(live).not.toContain("FOUND THE GOLDEN DUCK");
          expect(live).not.toContain("MS PAINT");
          expect(live).not.toContain('rx="9" ry="12"');
          const sad = draw(kept, target, t, { who: "MS Paint" });
          expect(sad).toContain("tv3-over-world kept");
          expect(sad).not.toContain('rx="9" ry="12"');
          expect(sad).not.toContain("GERALD CAN&#x27;T HELP");
        }
    } finally {
      bye();
      bye(); // a goodbye counts once
    }
    expect(worldCelebratesFinds()).toBe(false);
    expect(draw(duck, "tv", 6000, { who: "MS Paint" })).toContain("FOUND THE GOLDEN DUCK");
    // The frame outlasts the world's banner, a little.
    expect(OVER_WORLD_MS).toBeGreaterThanOrEqual(CELEBRATION_MS);
    expect(OVER_WORLD_MS).toBeLessThan(duck.ms as number);
  });

  it("only the views that celebrate a find say so (the shadow view draws no banner)", () => {
    const src = (f: string) => readFileSync(join(__dirname, "../src", f), "utf8");
    for (const f of ["world/WorldView.tsx", "raycast/RaycastView.tsx"]) {
      expect(src(f), f).toContain("noteWorldShowing()");
      expect(src(f), f).toMatch(/celebrat/u);
    }
    expect(src("shadow/ShadowView.tsx")).not.toContain("celebration");
  });

  it("the preview can play the bob's beats at their times", () => {
    expect(previewBeats("", 99_000)).toEqual([]);
    const two = "The Bag Of Truth@20000, Final Assessment@40000";
    expect(previewBeats(two, 10_000)).toEqual([]);
    expect(previewBeats(two, 30_000).map((m) => m.name)).toEqual(["The Bag Of Truth"]);
    const both = previewBeats(two, 50_000);
    expect(both.map((m) => [m.kind, m.name])).toEqual([["beat", "The Bag Of Truth"], ["beat", "Final Assessment"]]);
    expect(both[1]!.at - both[0]!.at).toBe(20_000);
  });

  it("a finder with no name is A PROGRAM", () => {
    expect(finderName(null)).toBe("A PROGRAM");
    expect(finderName("  ")).toBe("A PROGRAM");
    expect(finderName("Winamp")).toBe("WINAMP");
  });

  it("bobbing knows when the bag is up: no more searching, then the assessment, then truth.txt may be read", () => {
    const bob = ACT3.find((d) => d.id === "bobbing")!;
    for (const target of ["tv", "wall"] as const) {
      const searching = draw(bob, target, 60_000);
      expect(searching).toContain("Nothing happens until someone brings up the Bag Of Truth.");
      // The slide went up at 1000; the bag came up 50 s in: 90 s in, the hold has moved on.
      const up = draw(bob, target, 90_000, { moments: [beatMoment("The Bag Of Truth", 51_000)] });
      expect(up, target).toContain("THE BAG IS UP");
      expect(up).toContain("Do not read it yet.");
      expect(up).not.toContain("Nothing happens until");
      expect(up).not.toContain("Searching for the Bag of Truth");
      expect(up).not.toContain("Waiting: ");
      expect(up).not.toMatch(/Trabolta/u);
      const weighing = draw(bob, target, 95_000, { moments: [beatMoment("The Bag Of Truth", 51_000), beatMoment("Final Assessment", 90_000)] });
      expect(weighing).toContain("Do not read it yet.");
      const final = draw(bob, target, 120_000, { moments: [beatMoment("The Bag Of Truth", 51_000), beatMoment("Final Assessment", 90_000)] });
      expect(final).toContain("ASSESSMENT FINAL");
      expect(final).toContain("You may read truth.txt.");
    }
    // A bag from an earlier bob (before this slide went up) doesn't count; a history slide takes any.
    expect(draw(bob, "tv", 60_000, { at: 40_000, moments: [beatMoment("The Bag Of Truth", 20_000)] })).toContain("Nothing happens until");
    expect(draw(bob, "tv", HISTORY_T, { at: 0, moments: [beatMoment("the bag of truth", 20_000)] })).toContain("THE BAG IS UP");
    expect(draw(bob, "tv", HISTORY_T + 1700, { at: 0, moments: [beatMoment("The Bag Of Truth", 20_000)] })).not.toBe(draw(bob, "tv", HISTORY_T, { at: 0, moments: [beatMoment("The Bag Of Truth", 20_000)] }));
  });

  it("midnight shows the year that will not render", () => {
    const midnight = ACT3.find((d) => d.id === "midnight")!;
    expect(draw(midnight, "tv", 10_500)).toContain("the year will not render");
    expect(STORY).toContain("the year will not render");
  });
});

describe("Advice Helped quotes the story (F9)", () => {
  it("his bubble and hers are the story's lines verbatim", () => {
    const finale = readFileSync(join(__dirname, "../../core/examples/trapped-in-the-internet/beats/finale.loom"), "utf8");
    for (const l of ADVICE_CHAT) expect(finale, l.text).toContain(l.text);
  });
});
