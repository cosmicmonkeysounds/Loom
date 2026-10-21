import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fakeState } from "../src/cutscene/fake.ts";
import { HISTORY_T } from "../src/cutscene/clock.ts";
import { allowed } from "../src/cutscene/pick.ts";
import { ACT1_TRIGGERS, BINGO_CELLS, CORRUPTED_WALL_MS, FILING_MS, SCENES, bingoCues, bottleLandedCues, bingoTicks, carryAt, filingHold, freshTick } from "../src/cutscene/scenes/act1.tsx";
import { INTRO_HELLO, INTRO_LINE } from "../src/cutscene/kit/tv1-boot.tsx";
import type { SceneProps } from "../src/cutscene/types.ts";
import type { ScreenMoment } from "../src/screen.ts";

const SHOW = fileURLToPath(new URL("../../core/examples/trapped-in-the-internet", import.meta.url));

/** Every `.loom` file of the show, concatenated (the story is the source of truth for the triggers). */
function storyText(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".loom")) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(SHOW);
  return out.join("\n");
}

// A server render warns that the canvases' useLayoutEffect does nothing there: expected, not news.
beforeAll(() => {
  const error = console.error.bind(console);
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    if (typeof a[0] === "string" && a[0].includes("useLayoutEffect")) return;
    error(...a);
  });
});


describe("act 1 — the triggers are the story's", () => {
  const story = storyText();

  it("lists exactly the triggers its scenes listen for", () => {
    const slides = new Set<string>();
    const beats = new Set<string>();
    const signals = new Set<string>();
    for (const s of SCENES)
      for (const w of s.when) {
        if ("slide" in w) slides.add(w.slide);
        else if (w.moment === "beat") beats.add(w.name);
        else if (w.moment === "signal") signals.add(w.name);
        else throw new Error(`unexpected trigger kind ${w.moment}`);
      }
    expect([...slides].sort()).toEqual([...ACT1_TRIGGERS.slides].sort());
    expect([...beats].sort()).toEqual([...ACT1_TRIGGERS.beats].sort());
    expect([...signals].sort()).toEqual([...ACT1_TRIGGERS.signals].sort());
  });

  it("every slide is a screens_ / tv_ cue the story fires", () => {
    for (const v of ACT1_TRIGGERS.slides) expect(new RegExp(`cue (screens|tv)_${v}\\b`).test(story), v).toBe(true);
  });

  it("every beat is a story beat (`== Name`), every one reached without a subject", () => {
    for (const b of ACT1_TRIGGERS.beats) expect(story.includes(`== ${b}\n`), b).toBe(true);
    // Each is a story-level rule's divert (no `for program` on the fire that reaches it), or the start beat.
    expect(story).toMatch(/when first_reinstallation:\n[\s\S]*?-> Corrupted Code/u);
    expect(story).toMatch(/-> Trabolta Introduction/u);
    expect(story).toMatch(/when filing_closed:\n[\s\S]*?-> Filing Closed/u);
    expect(story).toMatch(/when truth_question:\n\s+-> Truth Question/u);
    expect(story).toMatch(/fire truth_question\n/u);
    expect(story).toMatch(/fire filing_closed\n/u);
    expect(story).toMatch(/fire first_reinstallation\n/u);
    expect(story).toMatch(/^start: Power On$/mu);
  });

  it("the bottle's moments are the `do pick` draw and its else", () => {
    expect(story).toMatch(/do pick bottle_landed from .* else bottle_empty/u);
  });

  it("the first-moment / results presses the results card reads are admin cues", () => {
    for (const cue of ["first_moment_of_truth", "read_the_results"]) expect(story).toMatch(new RegExp(`INTERACTION ${cue}\\n[^\\n]*\\n\\s+who: admin`, "u"));
  });

  it("the introduction's greeting is the story's own line", () => {
    expect(INTRO_HELLO).toBe("HELLO, PROGRAMS.");
    // The whole line, as the TV says it (its captions follow the voice).
    expect(story).toContain(`Trabolta: ${INTRO_HELLO} ${INTRO_LINE}\n`);
  });

  it("a wall's shorter take ends inside its scene's length (it ends itself, never a blank wait)", () => {
    const corrupted = SCENES.find((s) => s.id === "corrupted_code")!;
    expect(typeof corrupted.ms === "number" && CORRUPTED_WALL_MS < corrupted.ms).toBe(true);
  });

  it("ids are unique and every scene draws on both targets", () => {
    expect(new Set(SCENES.map((s) => s.id)).size).toBe(SCENES.length);
    for (const s of SCENES) {
      expect(s.tv, s.id).toBeDefined();
      expect(s.wall, s.id).toBeDefined();
    }
  });
});

describe("act 1 — the fiction", () => {
  const before = fakeState({ introduced: false });
  const pre = ["power_on", "call_desktop", "bingo", "bingo_time", "corrupted_code"];

  it("the pre-introduction scenes may play before the introduction, the rest that name him may not", () => {
    for (const id of pre) expect(allowed(SCENES.find((s) => s.id === id)!, before), id).toBe(true);
    expect(allowed(SCENES.find((s) => s.id === "trabolta_introduction")!, before)).toBe(false);
  });

  it("no scene that may play before the introduction names him, at any frame", () => {
    for (const s of SCENES) {
      if (s.namesCharacter === true) continue;
      const ms = typeof s.ms === "number" ? s.ms : 60_000;
      for (const target of ["tv", "wall"] as const) {
        const View = target === "tv" ? s.tv! : s.wall!;
        for (const t of [0, 400, 1500, 3000, 6000, 9000, ms - 500, HISTORY_T]) {
          const html = renderToStaticMarkup(createElement(View, props({ t, value: valueOf(s.id), state: before })));
          expect(html.toLowerCase().includes("trabolta"), `${s.id} ${target} @${t}`).toBe(false);
        }
      }
    }
  });
});

const valueOf = (id: string): string => {
  const s = SCENES.find((x) => x.id === id)!;
  const w = s.when[0]!;
  return "slide" in w ? w.slide : w.name;
};

function props(o: Partial<SceneProps> & { t: number }): SceneProps {
  const state = o.state ?? fakeState({ now: 1_000_000 + o.t });
  return { at: 1_000_000, seq: 1, value: "", state, night: state.night, who: "Winamp", target: "tv", sfx: () => false, done: () => {}, reduced: false, ...o };
}

describe("act 1 — every scene renders", () => {
  it("draws every scene on both targets at many frames, reduced motion too, without throwing", () => {
    for (const s of SCENES) {
      const ms = typeof s.ms === "number" ? s.ms : 90_000;
      for (const reduced of [false, true])
        for (const target of ["tv", "wall"] as const) {
          const View = target === "tv" ? s.tv! : s.wall!;
          for (let t = 0; t <= ms; t += Math.max(250, Math.floor(ms / 40))) {
            expect(() => renderToStaticMarkup(createElement(View, props({ t, value: valueOf(s.id), target, reduced })))).not.toThrow();
          }
        }
    }
  });

  it("a held slide keeps moving: two frames a second apart differ, long into the hold", () => {
    for (const s of SCENES) {
      if (s.ms !== "hold") continue;
      for (const target of ["tv", "wall"] as const) {
        const View = target === "tv" ? s.tv! : s.wall!;
        const a = renderToStaticMarkup(createElement(View, props({ t: 600_000, value: valueOf(s.id), target })));
        const b = renderToStaticMarkup(createElement(View, props({ t: 601_000, value: valueOf(s.id), target })));
        expect(a === b, `${s.id} ${target}`).toBe(false);
      }
    }
  });

  it("the same frame draws the same picture (t is everything)", () => {
    for (const s of SCENES) {
      const a = renderToStaticMarkup(createElement(s.tv!, props({ t: 4321, value: valueOf(s.id) })));
      const b = renderToStaticMarkup(createElement(s.tv!, props({ t: 4321, value: valueOf(s.id) })));
      expect(a, s.id).toBe(b);
    }
  });
});

describe("act 1 — the card and the carry", () => {
  it("the bingo card is the asterisk: 17 squares, six ticks a round, then it clears", () => {
    expect(BINGO_CELLS.length).toBe(17);
    expect(BINGO_CELLS.filter(([r, c]) => r === 2 && c === 2).length).toBe(1);
    expect(bingoTicks(1000).size).toBe(0);
    expect(bingoTicks(4200 + 8000 * 3 + 10).size).toBe(4);
    expect(bingoTicks(4200 + 8000 * 6 + 10).size).toBe(1);
    expect(bingoTicks(4200 + 8000 * 3 + 10).has(8)).toBe(false); // never the centre
  });

  it("the corrupted program is carried from its icon to the globe", () => {
    expect(carryAt(0).x).toBeCloseTo(0.24, 3);
    expect(carryAt(20_000).x).toBeCloseTo(0.76, 3);
    expect(carryAt(5000).y).toBeLessThan(0.55);
  });
});

describe("act 1 — the filing window fits its slide", () => {
  const scene = SCENES.find((s) => s.id === "hunt_results")!;
  const draw = (target: "tv" | "wall", at: number, t: number, closed = false) => {
    const moments: ScreenMoment[] = [{ seq: 10, at, kind: "signal", name: "first_moment_of_truth", who: null, kept: false }];
    if (closed) moments.push({ seq: 20, at: at + 60_000, kind: "beat", name: "Filing Closed", who: null, kept: false });
    const state = fakeState({ now: at + t, moments, target: target === "tv" ? "tv" : "terminals" });
    return renderToStaticMarkup(createElement((target === "tv" ? scene.tv : scene.wall)!, props({ t, at, state, target, value: "hunt_results" })));
  };

  it("never counts down past the slide's hold: no ticking clock outlives it, the close is the Filing Closed moment's", () => {
    for (const target of ["tv", "wall"] as const) {
      const hold = filingHold(target);
      expect(hold).toBeLessThan(FILING_MS); // the reason: the slide is gone before two minutes are up
      for (const t of [5000, 30_000, hold - 1000]) {
        const html = draw(target, 2_000_000 + (target === "tv" ? 0 : 1), t);
        expect(html, `${target} @${t}`).not.toContain("kit-countdown");
        expect(html).not.toContain("PENCILS DOWN");
      }
      expect(draw("tv", 3_000_000, 30_000)).toContain("FILING IS OPEN");
    }
    // A director's early ⏱ while the slide is up: PENCILS DOWN under it.
    expect(draw("tv", 4_000_000, 70_000, true)).toContain("PENCILS DOWN");
  });
});

describe("act 1 — bingo's hold", () => {
  it("every ball pops with a sound and its square ticks a beat later; every fourth rings the chord", () => {
    // Walk 90 s of the hold collecting each due cue once (as useSfxCues would).
    const seen = new Map<number, string>();
    for (let t = 0; t < 90_000; t += 100) for (const [at, name] of bingoCues(t)) seen.set(at * 100 + name.length, name);
    const names = [...seen.values()];
    const balls = Math.floor((90_000 - 4200) / 8000) + 1;
    expect(names.filter((n) => n === "popup").length).toBe(balls);
    expect(names.filter((n) => n === "tick").length).toBeGreaterThanOrEqual(balls - 1);
    expect(names.filter((n) => n === "chord").length).toBe(Math.floor(balls / 4));
    expect(names).toContain("whoosh"); // a new round's card
  });

  it("the freshly ticked square stamps in", () => {
    const f = freshTick(4200 + 8000 * 2 + 600);
    expect(f.cell).toBeGreaterThanOrEqual(0);
    expect(f.k).toBeGreaterThan(0);
    expect(f.k).toBeLessThan(1);
    expect(bingoTicks(4200 + 8000 * 2 + 600).has(f.cell)).toBe(true);
    expect(freshTick(4200 + 8000 * 2 + 5000).cell).toBe(-1);
  });
});

describe("act 1 — the bottle's landing under his voice", () => {
  it("every landing accent plays under the voice that names the pick", () => {
    const cues = bottleLandedCues(5);
    expect(cues.length).toBeGreaterThan(10);
    for (const [, , o] of cues) expect(o.over).toBe(true);
  });
});

describe("act 1 — a results card's number is the story's", () => {
  const scene = SCENES.find((s) => s.id === "hunt_results")!;
  it("QUESTION n and its text come from night.results_q; with no count, no number", () => {
    const at = 5_000_000;
    const moments: ScreenMoment[] = [{ seq: 50, at, kind: "signal", name: "read_the_results", who: null, kept: false }];
    const draw = (q: number | null) => {
      const state = fakeState({ now: at + 3000, moments, night: { results_q: q } });
      return renderToStaticMarkup(createElement(scene.tv!, props({ t: 3000, at: at + 1, state, value: "hunt_results" })));
    };
    expect(draw(2)).toContain("QUESTION 2");
    expect(draw(2)).not.toContain("QUESTION 1");
    expect(draw(null)).not.toMatch(/QUESTION \d/u);
  });
});
