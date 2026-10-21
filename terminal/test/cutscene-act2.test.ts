import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KING_SIGNALS } from "@loom/house";
import { foldName } from "../src/config.ts";
import { fakeChart, fakeState } from "../src/cutscene/fake.ts";
import { componentFor } from "../src/cutscene/pick.ts";
import { SCENES, OVERSHARE_CURSOR_DELAY } from "../src/cutscene/scenes/act2.tsx";
import type { SceneDef, SceneProps, SceneTarget } from "../src/cutscene/types.ts";
import { EMPTY_NIGHT, type ScreenMoment, type ScreenState } from "../src/screen.ts";

// --- the story, read the way the tests elsewhere read it (grep, not the compiler) --------

const SHOW = fileURLToPath(new URL("../../core/examples/trapped-in-the-internet/", import.meta.url));
function loomFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? loomFiles(p) : p.endsWith(".loom") ? [p] : [];
  });
}
const STORY = loomFiles(SHOW)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const BEATS = new Set([...STORY.matchAll(/^==\s+(.+?)\s*$/gmu)].map((x) => foldName(x[1]!)));
const CUES = new Set([...STORY.matchAll(/\bcue\s+(?:screens|tv|terminals)_([a-z0-9_]+)/gu)].map((x) => x[1]!));
const SOUNDS = new Set([...STORY.matchAll(/\bsound\s+([a-z0-9_]+)/gu)].map((x) => foldName(x[1]!)));
const WHENS = new Set([...STORY.matchAll(/^when\s+([a-z0-9_]+)/gmu)].map((x) => foldName(x[1]!)));

describe("act 2's triggers are the story's own names", () => {
  it("found the story", () => {
    expect(BEATS.size).toBeGreaterThan(50);
    expect(CUES.has("y2k")).toBe(true);
  });

  for (const s of SCENES) {
    it(`${s.id}: ${s.when.map((w) => ("slide" in w ? w.slide : `${w.moment} ${w.name}`)).join(", ")}`, () => {
      for (const w of s.when) {
        if ("slide" in w) expect(CUES.has(w.slide), `cue screens_${w.slide}`).toBe(true);
        else if (w.moment === "beat") expect(BEATS.has(foldName(w.name)), `== ${w.name}`).toBe(true);
        else if (w.moment === "sfx") expect(SOUNDS.has(foldName(w.name)), `sound ${w.name}`).toBe(true);
        else if (w.moment === "signal") {
          // A device signal (the King's board) the story also hears by name.
          expect(Object.values(KING_SIGNALS).map(foldName)).toContain(foldName(w.name));
          expect(WHENS.has(foldName(w.name)), `when ${w.name}`).toBe(true);
        } else throw new Error(`unexpected trigger ${w.moment}`);
      }
    });
  }

  it("the names the scenes read off the moments are the story's too", () => {
    for (const b of ["Overshare One", "Overshare Two", "Overshare Three", "Overshare Four", "Round Two Tally"]) expect(BEATS.has(foldName(b)), b).toBe(true);
    for (const x of ["y2k_chime", "motorcycle"]) expect(SOUNDS.has(foldName(x)), x).toBe(true);
  });

  it("every scene has a length, a TV take and a wall or TV fallback, and ids are unique", () => {
    expect(new Set(SCENES.map((s) => s.id)).size).toBe(SCENES.length);
    for (const s of SCENES) {
      expect(s.tv, s.id).toBeDefined();
      expect(s.ms === "hold" || (typeof s.ms === "number" && s.ms > 0), s.id).toBe(true);
    }
    // The persistent slides loop their hold for as long as the story keeps them up.
    for (const id of ["y2k", "trust_chart"]) expect(SCENES.find((s) => s.id === id)?.ms).toBe("hold");
  });
});

// --- every scene draws at every phase, on both targets ------------------------------------

const NOW = 946_684_800_000 - 15 * 60_000;
const AT = NOW - 1;

function draw(def: SceneDef, target: SceneTarget, t: number, state: ScreenState, who: string | null = "Winamp", reduced = false): string {
  const View = componentFor(def, target);
  if (View === null) return "";
  const props: SceneProps = { t, at: AT, seq: 1, value: "slide" in def.when[0]! ? def.when[0].slide : def.when[0]!.name, state, night: state.night, who, target, sfx: () => false, done: () => {}, reduced };
  return renderToStaticMarkup(createElement(View, props));
}

const stateAt = (t: number, o: Parameters<typeof fakeState>[0] = {}) => fakeState({ now: AT + t, ...o });

describe("act 2's scenes draw", () => {
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("at every phase, on the TV and the wall, reduced or not", () => {
    const q = quiet();
    for (const s of SCENES) {
      const len = typeof s.ms === "number" ? s.ms : 120_000;
      for (const target of ["tv", "wall"] as const) {
        for (const t of [0, 250, 900, 2000, 4000, 8000, 11_000, 15_000, 22_000, 30_000, len - 200, 600_000]) {
          for (const reduced of [false, true]) {
            const html = draw(s, target, t, stateAt(t, { countdown: "y2k", remaining: 1500 }), "Winamp", reduced);
            expect(typeof html, `${s.id} ${target} ${t}`).toBe("string");
          }
        }
      }
    }
    q.mockRestore();
  });

  it("never names the character unless the scene says it does", () => {
    const q = quiet();
    for (const s of SCENES) {
      if (s.namesCharacter === true) continue;
      for (const target of ["tv", "wall"] as const)
        for (const t of [0, 1000, 3000, 6000, 12_000, 25_000, 60_000]) expect(/trabolta/iu.test(draw(s, target, t, stateAt(t))), `${s.id} ${target} ${t}`).toBe(false);
    }
    q.mockRestore();
  });

  it("the Trust Chart keeps the card's reveal and its call-outs", () => {
    const q = quiet();
    const chart = SCENES.find((s) => s.id === "trust_chart")!;
    // Revealing: the bottom row up first, the top hidden, no call-outs yet.
    const revealAt = AT;
    const mid = draw(chart, "tv", 3200, stateAt(3200, { chart: fakeChart("trust_chart", revealAt) }));
    expect(mid).toContain("Assessments are being finalised");
    expect(mid).not.toContain("MOST TRUSTED");
    expect(mid).toMatch(/tv2-chart-row hidden[^"]*"[^>]*>.*?Winamp/su);
    // Done (history: every row at once): the call-outs name the story's picks.
    const done = draw(chart, "tv", 5000, stateAt(5000, { chart: fakeChart("trust_chart", 0) }));
    expect(done).toContain("MOST TRUSTED: Winamp");
    expect(done).toContain("LEAST TRUSTED: Notepad");
    expect(done).not.toContain("tv2-chart-row hidden");
    // No chart on the wire: the scene still moves, it never invents rows.
    expect(draw(chart, "tv", 5000, stateAt(5000, { chart: null }))).toContain("Assessments are being finalised");
    q.mockRestore();
  });

  it("the round-two tally lands on the number Trabolta says, and none when it can't hear him", () => {
    const q = quiet();
    const tally = SCENES.find((s) => s.id === "round_two_tally")!;
    const withVoice = (text: string): ScreenState => ({ ...stateAt(14_000), voice: { room: "The Desktop", muted: false, head: 1, lines: [{ seq: 1, from: "Trabolta", text, beat: "Round Two Tally" }] } });
    expect(draw(tally, "tv", 14_000, withVoice("…is sixty-one percent."))).toContain("61%");
    expect(draw(tally, "tv", 14_000, withVoice("…is twelve percent."))).toContain("12%");
    const deaf = draw(tally, "tv", 14_000, stateAt(14_000));
    expect(deaf).toContain("TALLY COMPLETE");
    expect(deaf).not.toMatch(/\b(61|12)%/u);
    // No voice lines (the poll after, a reload): the night's outcome, on the TV and the walls.
    const night = (complete: boolean) => stateAt(14_000, { night: { ...EMPTY_NIGHT, collection_complete: complete } });
    expect(draw(tally, "tv", 14_000, night(true))).toContain("61%");
    expect(draw(tally, "tv", 14_000, night(false))).toContain("12%");
    expect(draw(tally, "wall", 9000, night(true))).toContain("61%");
    expect(draw(tally, "wall", 9000, night(false))).toContain("12%");
    expect(draw(tally, "wall", 3000, night(true))).not.toMatch(/\b(61|12)%/u);
    q.mockRestore();
  });

  it("the overshare goes to one cursor, then shows the scenario's own windows", () => {
    const q = quiet();
    const over = SCENES.find((s) => s.id === "overshare")!;
    const beat = (name: string): ScreenMoment[] => [{ seq: 9, at: AT, kind: "beat", name, who: null, kept: false }];
    const cursorT = OVERSHARE_CURSOR_DELAY + 1000;
    expect(draw(over, "tv", cursorT, stateAt(cursorT, { moments: beat("Overshare One") }))).toContain("tv2-cursor-only");
    const later = OVERSHARE_CURSOR_DELAY + 12_000;
    const one = draw(over, "tv", later, stateAt(later, { moments: beat("Overshare One") }));
    expect(one).toContain("VIRUS DETECTED");
    expect(one).toContain("LiveJournal");
    const four = draw(over, "tv", later, stateAt(later, { moments: beat("Overshare Four") }));
    expect(four).not.toContain("VIRUS DETECTED");
    expect(four).toContain("continued cooperation");
    // Sandy is named only on the night the story names her.
    expect(draw(over, "tv", OVERSHARE_CURSOR_DELAY + 4500, stateAt(OVERSHARE_CURSOR_DELAY + 4500, { moments: beat("Overshare Two") }))).not.toContain("Sandy");
    q.mockRestore();
  });

  it("the Y2K clock shows the live time and pops each chime", () => {
    const q = quiet();
    const y2k = SCENES.find((s) => s.id === "y2k")!;
    const html = draw(y2k, "tv", 5000, stateAt(5000, { countdown: "y2k", remaining: 30 * 60 + 15 }));
    expect(html).toContain("11:29:45 PM");
    const chime: ScreenMoment[] = [{ seq: 4, at: AT + 60_000, kind: "sfx", name: "y2k_chime", who: null, kept: false }];
    expect(draw(y2k, "tv", 61_000, stateAt(61_000, { countdown: "y2k", remaining: 890, moments: chime }))).toContain("11:45 PM");
    expect(draw(y2k, "wall", 61_000, stateAt(61_000, { countdown: "y2k", remaining: 890, moments: chime }))).toContain("11:45 PM");
    q.mockRestore();
  });

  it("the King's hit shows his bar as it stands and who hit him; at 0 it gives way to the fall", () => {
    const q = quiet();
    const hit = SCENES.find((s) => s.id === "king_hit")!;
    const html = draw(hit, "tv", 3000, stateAt(3000, { king: { hp: 10, max: 15, fallen: false, armed: true } }));
    expect(html).toContain("10 / 15");
    expect(html).toContain("staggers");
    expect(html).toContain("Winamp hit the King!");
    expect(draw(hit, "tv", 3000, stateAt(3000, { king: { hp: 0, max: 15, fallen: true, armed: true } }))).toBe("");
    expect(SCENES.find((s) => s.id === "king_fallen")!.priority).toBeGreaterThan(hit.priority ?? 0);
    q.mockRestore();
  });

  it("a checkmate never says who won (the door code is theirs alone)", () => {
    const q = quiet();
    const won = SCENES.find((s) => s.id === "chess_won")!;
    for (const t of [500, 3000, 8000]) expect(draw(won, "tv", t, stateAt(t), "Winamp")).not.toContain("Winamp");
    q.mockRestore();
  });
});
