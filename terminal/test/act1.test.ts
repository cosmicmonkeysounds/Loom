import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fakeState } from "../src/cutscene/fake.ts";
import { HISTORY_T } from "../src/cutscene/clock.ts";
import { allowed } from "../src/cutscene/pick.ts";
import { ACT1_TRIGGERS, BINGO_CELLS, CORRUPTED_WALL_MS, DARE_CHOSEN_MS, DARE_ORDER, FILE_NUDGES, FILING_MS, FILING_STEPS, SCENES, VERDICT_COPY, bingoCues, bottleLandedCues, bingoTicks, carryAt, filingHold, freshTick, mingleAt } from "../src/cutscene/scenes/act1.tsx";
import { INTRO_HELLO, INTRO_LINE } from "../src/cutscene/kit/tv1-boot.tsx";
import { VERDICT_SIGNALS } from "../src/cutscene/kit/tv1-time.ts";
import type { SceneProps } from "../src/cutscene/types.ts";
import type { ScreenMoment, ScreenState } from "../src/screen.ts";

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
        else if ("room" in w) throw new Error(`unexpected room trigger ${w.room}`);
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
    // Wave 26 (D1): `== Dare Chosen` is the story lane's, written in parallel
    // (it merges first). Until its `when dare_scene:` rule is in the story
    // this check waits for it; once it is there the check is strict.
    const dareStory = /when dare_scene:/u.test(story);
    for (const b of ACT1_TRIGGERS.beats) if (b !== "Dare Chosen" || dareStory) expect(story.includes(`== ${b}\n`), b).toBe(true);
    if (dareStory) expect(story).toMatch(/when dare_scene:\n\s+-> Dare Chosen/u);
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

  it("the bottle's verdicts are booth presses settled on its pick, with the story's own words", () => {
    for (const v of Object.keys(VERDICT_SIGNALS)) {
      expect(story, v).toMatch(new RegExp(`INTERACTION ${v}\\n[^\\n]*\\n\\s+who: performer`, "u"));
      expect(story, v).toMatch(new RegExp(`when ${v} for program:\\n\\s+if Night\\.bottle_open == true and program\\.name == Night\\.bottle_pick:`, "u"));
    }
    // The lines on screen are the story's broadcasts, word for word.
    expect(story).toContain("{program.name} answered. Trabolta is satisfied. +50 Truthcoin.");
    expect(story).toContain("{program.name} refused to answer. That is a directive problem.");
    expect(story).toContain("{program.name} chose Dare. Programs choose Truth.");
    expect(VERDICT_COPY.answered.line("{program.name}")).toBe("{program.name} answered. Trabolta is satisfied.");
    expect(VERDICT_COPY.refused.line("{program.name}")).toBe("{program.name} refused to answer. That is a directive problem.");
    expect(VERDICT_COPY.dare.line("{program.name}")).toBe("{program.name} chose Dare. Programs choose Truth.");
    expect(story).toContain(`reason: "${VERDICT_COPY.refused.mark}"`);
    expect(story).toContain(`reason: "${VERDICT_COPY.dare.mark}"`);
    // A phone's Dare closes the bottle with no press: what phoneDare reads
    // (its lines, or since wave 26 D1 the shared `dare_taken`).
    expect(story).toMatch(/if index == 1:\n\s+set Night\.bottle_open = false\n\s+(broadcast "~🎩|fire dare_taken)/u);
  });

  it("the first-moment / results presses the results card reads are admin cues", () => {
    for (const cue of ["first_moment_of_truth", "read_the_results"]) expect(story).toMatch(new RegExp(`INTERACTION ${cue}\\n[^\\n]*\\n\\s+who: admin`, "u"));
  });

  it("the introduction's greeting is the story's own line", () => {
    expect(INTRO_HELLO).toBe("Happy Halloween, programs.");
    // The Oct 30 script, word for word.
    expect(INTRO_LINE).toBe("Thank you, Clippy, for hosting this marvelous evening.");
    expect(story).toContain(`Trabolta: ${INTRO_LINE}\n`);
    expect(story).toContain(`Trabolta: ${INTRO_HELLO} My name is Jean Trabolta`);
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
          // D19 (wave 18b): an owner scene may name him only as the owner, "Jean Trabolta".
          const text = s.owner === true ? html.replace(/Jean Trabolta/gu, "") : html;
          expect(text.toLowerCase().includes("trabolta"), `${s.id} ${target} @${t}`).toBe(false);
        }
      }
    }
  });
});

const valueOf = (id: string): string => {
  const s = SCENES.find((x) => x.id === id)!;
  const w = s.when[0]!;
  return "slide" in w ? w.slide : "room" in w ? w.room : w.name;
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

  it("never states the judging rule (wave 26, G1): three in-fiction steps stamp where the rules did", () => {
    const rule = /accept|symptom|sure|guess|confiden|accurate|wrong/iu;
    expect(FILING_STEPS).toHaveLength(3); // the three-stamp timing stays
    for (const s of FILING_STEPS) {
      expect(s.text).not.toMatch(rule);
      expect(s.ok).toBe(true);
    }
    for (const n of FILE_NUDGES) expect(n).not.toMatch(rule);
    // Drawn: the steps are on the TV once stamped, and no rule is.
    const html = draw("tv", 5_000_000, 6000);
    for (const s of FILING_STEPS) expect(html).toContain(s.text.replace(/'/gu, "&#x27;"));
    expect(html).not.toMatch(rule);
  });
});

describe("act 1 — the bingo slide's owner line (wave 18b)", () => {
  it("names the owner who joins later only before the introduction", () => {
    const bingo = SCENES.find((s) => s.id === "bingo")!;
    for (const target of ["tv", "wall"] as const) {
      const at = (introduced: boolean) => {
        const state = fakeState({ now: 1_000_000 + 8000, introduced });
        return renderToStaticMarkup(createElement((target === "tv" ? bingo.tv : bingo.wall)!, props({ t: 8000, state, target, value: "bingo" })));
      };
      expect(at(false), target).toContain("joins by digital conference later tonight");
      expect(at(true), target).not.toContain("later tonight");
    }
  });
});

describe("act 1 — bingo's hold", () => {
  it("every meeting blips softly (no ball draw: nobody calls the Bingo) and its square ticks a beat later; every fourth rings the chord", () => {
    // Walk 90 s of the hold collecting each due cue once (as useSfxCues would).
    const seen = new Map<number, string>();
    for (let t = 0; t < 90_000; t += 100) for (const [at, name] of bingoCues(t)) seen.set(at * 100 + name.length, name);
    const names = [...seen.values()];
    const balls = Math.floor((90_000 - 4200) / 8000) + 1;
    expect(names.filter((n) => n === "blip").length).toBe(balls);
    expect(names).not.toContain("popup");
    expect(names.filter((n) => n === "tick").length).toBeGreaterThanOrEqual(balls - 1);
    expect(names.filter((n) => n === "chord").length).toBe(Math.floor(balls / 4));
    expect(names).toContain("whoosh"); // a new round's card
  });

  it("the hold is a mingle: two programs meet as the square ticks; no cage, no called ball (F3)", () => {
    expect(mingleAt(4200).m).toBe(0);
    expect(mingleAt(4200 + 8000 * 2 + 100)).toEqual({ m: 100, pair: 2 });
    // Approaching the next square: already its pair.
    expect(mingleAt(4200 + 8000 * 2 + 5000).pair).toBe(3);
    // Before the hold, the first pair is on its way in.
    expect(mingleAt(1000).pair).toBe(0);
    const src = readFileSync(fileURLToPath(new URL("../src/cutscene/scenes/act1.tsx", import.meta.url)), "utf8");
    expect(src).not.toMatch(/BingoCage|BALL_WORDS|a1-bingo-out/u);
    expect(src).toContain("FIND A PROGRAM FOR EVERY SQUARE");
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

describe("act 1 — the bottle's verdict", () => {
  const at = 7_000_000;
  const landed: ScreenMoment = { seq: 60, at, kind: "signal", name: "bottle_landed", who: "Winamp", kept: false };
  it("each verdict moment draws its own picture with the pick's name", () => {
    for (const [id, word] of [["truth_answered", "TRUTH ACCEPTED"], ["truth_refused", "REFUSED"], ["dare_chosen", "DARE"]] as const) {
      const scene = SCENES.find((s) => s.id === id)!;
      const html = renderToStaticMarkup(createElement(scene.tv!, props({ t: 5000, who: "Winamp", value: id })));
      expect(html, id).toContain(word);
      expect(html, id).toContain("Winamp");
      expect(html.includes("MARKED FOR REINSTALLATION"), id).toBe(id !== "truth_answered");
      const wall = renderToStaticMarkup(createElement(scene.wall!, props({ t: 5000, who: "Winamp", value: id, target: "wall" })));
      expect(wall, id).toContain("Winamp");
    }
    expect(renderToStaticMarkup(createElement(SCENES.find((s) => s.id === "truth_answered")!.tv!, props({ t: 4000, who: "Winamp" })))).toContain("TRUTHCOIN");
  });

  it("a Dare plays his Dare Chosen beat (wave 26, D1): the dared program from the night, his order to the Antivirus", () => {
    const scene = SCENES.find((s) => s.id === "dare_chosen")!;
    expect(scene.when).toEqual([{ moment: "beat", name: "Dare Chosen" }]);
    expect(scene.ms).toBe(DARE_CHOSEN_MS);
    expect(scene.namesCharacter).toBe(true);
    // The old signal scene is retired: one scene for both Dare paths.
    expect(SCENES.some((s) => s.id === "chose_dare" || s.when.some((w) => "moment" in w && w.name === "chose_dare"))).toBe(false);
    // A beat moment carries no `who`: the name is night.bottle_pick.
    const state = fakeState({ now: at + 6000, night: { bottle_pick: "Winamp" } });
    const html = renderToStaticMarkup(createElement(scene.tv!, props({ t: 6000, who: null, state, value: "Dare Chosen" })));
    expect(html).toContain("🎩 DARE");
    expect(html).toContain("Winamp");
    expect(html).toContain(DARE_ORDER.mark("Winamp"));
    expect(html).toContain(VERDICT_COPY.dare.line("Winamp")); // the story's minor broadcast, unchanged
    const wall = renderToStaticMarkup(createElement(scene.wall!, props({ t: 6000, who: null, state, value: "Dare Chosen", target: "wall" })));
    expect(wall).toContain("Winamp");
  });

  it("a Dare tapped on the phone (no press) shows on the bottle's slide once the bottle closes on its pick", () => {
    const scene = SCENES.find((s) => s.id === "truth_or_dare")!;
    const draw = (night: Partial<ScreenState["night"]>, moments: ScreenMoment[] = [landed]) => {
      const state = fakeState({ now: at + 20_000, moments, night: { bottle_pick: "Winamp", ...night } });
      return renderToStaticMarkup(createElement(scene.tv!, props({ t: 20_000, at, state, value: "truth_or_dare" })));
    };
    expect(draw({ bottle_open: true })).not.toContain("🎩 DARE");
    expect(draw({ bottle_open: false })).toContain("🎩 DARE");
    // Truth chosen, or a booth verdict: not a Dare.
    expect(draw({ bottle_open: false }, [landed, { seq: 61, at: at + 5000, kind: "beat", name: "Truth Question", who: null, kept: false }])).not.toContain("🎩 DARE");
    expect(draw({ bottle_open: false }, [landed, { seq: 62, at: at + 9000, kind: "signal", name: "truth_answered", who: "Winamp", kept: false }])).not.toContain("🎩 DARE");
  });
});
