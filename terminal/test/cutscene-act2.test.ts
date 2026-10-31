import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KING_SIGNALS } from "@loom/house";
import { foldName } from "../src/config.ts";
import { fakeChart, fakeState } from "../src/cutscene/fake.ts";
import { allowed, componentFor } from "../src/cutscene/pick.ts";
import { FIVE_MARQUEE, FIVE_POPS, PONG_POPS, SCENES, OVERSHARE_CURSOR_DELAY } from "../src/cutscene/scenes/act2.tsx";
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
    it(`${s.id}: ${s.when.map((w) => ("slide" in w ? w.slide : "room" in w ? `room ${w.room}` : `${w.moment} ${w.name}`)).join(", ")}`, () => {
      for (const w of s.when) {
        // Wave 18b: the `tally` slide is cued by the show lane's text; until it is
        // merged the story still plays Round Two Tally with no slide (then this is strict).
        if ("slide" in w) expect(CUES.has(w.slide) || (w.slide === "tally" && !STORY.includes("do fact_read")), `cue screens_${w.slide}`).toBe(true);
        else if ("room" in w) throw new Error(`unexpected room trigger ${w.room}`);
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
    for (const x of ["y2k_chime"]) expect(SOUNDS.has(foldName(x)), x).toBe(true);
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
  const props: SceneProps = { t, at: AT, seq: 1, value: ((w) => ("slide" in w ? w.slide : "room" in w ? w.room : w.name))(def.when[0]!), state, night: state.night, who, target, sfx: () => false, done: () => {}, reduced };
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

  it("the Y2K hour's ticker asks for the two sides or a faction of your own (wave 18b)", () => {
    const q = quiet();
    const y2k = SCENES.find((s) => s.id === "y2k")!;
    const html = draw(y2k, "tv", 30_000, stateAt(30_000, { countdown: "y2k", remaining: 3000 }));
    expect(html).toContain("OR A FACTION OF YOUR OWN");
    expect(html).not.toContain("TWO FACTIONS");
    // A faction has the majority: founding and the race are closed, and nothing says who won.
    const won = draw(y2k, "tv", 30_000, stateAt(30_000, { countdown: "y2k", remaining: 3000, night: { ...EMPTY_NIGHT, phase: "majority" } }));
    expect(won).not.toMatch(/FACTION OF YOUR OWN|RECRUITING|MORE THAN HALF/u);
    expect(won).toContain("SYSTEM CLOCK RESET");
    for (const t of [8000, 20_000, 40_000]) expect(draw(y2k, "tv", t, stateAt(t, { countdown: "y2k", remaining: 600, night: { ...EMPTY_NIGHT, phase: "majority" } }))).not.toMatch(/faction of your own/iu);
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
    // Wave 21: the staff ranked beside the programs, tagged, counted apart.
    expect(done).toMatch(/tv2-chart-row[^"]* staff[^>]*>.*?Clippy.*?🛡 STAFF/su);
    expect(done.match(/tv2-chart-staff/gu)?.length).toBe(2);
    expect(done).toContain("12 programs and 2 staff ranked.");
    const wall = draw(chart, "wall", 5000, stateAt(5000, { chart: fakeChart("trust_chart", 0) }));
    expect(wall).toMatch(/tv2-chart-row[^"]* staff[^>]*>.*?Norton Anti-Virus.*?🛡 STAFF/su);
    // An older server (no staff flag): no tag anywhere.
    expect(draw(chart, "tv", 5000, stateAt(5000, { chart: fakeChart("trust_chart", 0, []) }))).not.toContain("tv2-chart-staff");
    // No chart on the wire: the scene still moves, it never invents rows.
    expect(draw(chart, "tv", 5000, stateAt(5000, { chart: null }))).toContain("Assessments are being finalised");
    q.mockRestore();
  });

  it("the round-two tally lands on the number Trabolta says, and none when it can't hear him", () => {
    const q = quiet();
    const tally = SCENES.find((s) => s.id === "round_two_tally")!;
    const withVoice = (text: string): ScreenState => ({ ...stateAt(14_000), voice: { room: "The Desktop", muted: false, head: 1, lines: [{ seq: 1, from: "Trabolta", text, beat: "Round Two Tally" }] } });
    expect(draw(tally, "tv", 14_000, withVoice("My confidence that we will defeat the malware is sixty-one percent."))).toContain("61%");
    expect(draw(tally, "tv", 14_000, withVoice("My confidence that we will defeat the malware is twelve percent."))).toContain("12%");
    const deaf = draw(tally, "tv", 14_000, stateAt(14_000));
    expect(deaf).toContain("TALLY COMPLETE");
    expect(deaf).not.toMatch(/\b(61|12)%/u);
    // Wave 59a: he says no number at the tally, so the night's outcome shows none.
    const night = (complete: boolean) => stateAt(14_000, { night: { ...EMPTY_NIGHT, collection_complete: complete } });
    for (const complete of [true, false]) {
      expect(draw(tally, "tv", 14_000, night(complete))).toContain("TALLY COMPLETE");
      expect(draw(tally, "wall", 9000, night(complete))).not.toMatch(/\b(61|12)%/u);
    }
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
    expect(four).not.toContain("continued cooperation"); // Scenario 4 says nothing
    // A reload after the moments ring rolled past the beat: the night's scenario.
    const reloaded = stateAt(later, { night: { ...EMPTY_NIGHT, scenario: 1 } });
    expect(draw(over, "tv", later, reloaded)).toContain("VIRUS DETECTED");
    expect(draw(over, "tv", cursorT, stateAt(cursorT, { night: { ...EMPTY_NIGHT, scenario: 4 } }))).toContain("tv2-cursor-only");
    expect(draw(over, "wall", cursorT, stateAt(cursorT, { night: { ...EMPTY_NIGHT, scenario: 2 } }))).toContain("tv2-cursor-only");
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

  it("the doors slam on the Summons Closed beat (the five-minute slide is long gone by 0:00)", () => {
    const q = quiet();
    const shut = SCENES.find((s) => s.id === "summons_closed")!;
    expect(shut.when).toEqual([{ moment: "beat", name: "Summons Closed" }]);
    expect(draw(shut, "tv", 3000, stateAt(3000))).toContain("DOORS CLOSED");
    expect(draw(shut, "tv", 6800, stateAt(6800))).toContain("The Antivirus have the list.");
    expect(draw(shut, "tv", 9500, stateAt(9500))).toContain("Everyone who is here is wonderful.");
    expect(draw(shut, "wall", 4000, stateAt(4000))).toContain("DOORS CLOSED");
    // The beat's own line, word for word; the stamp no longer waits on the slide.
    expect(STORY).toContain("Clippy: Okay. Okay! Everyone who is here is wonderful. Let's begin.");
    const five = SCENES.find((s) => s.id === "five_minutes")!;
    expect(draw(five, "tv", 60_000, stateAt(60_000, { countdown: "summons", remaining: 0 }))).not.toContain("DOORS CLOS");
    q.mockRestore();
  });

  it("the recount holds the hung window through Task Manager's reading: he never rides off (wave 58)", () => {
    const q = quiet();
    const recount = SCENES.find((s) => s.id === "recount")!;
    for (const t of [5000, 40_000, 82_000, 800_000]) {
      for (const target of ["tv", "wall"] as const) {
        const html = draw(recount, target, t, stateAt(t));
        expect(html, `${target} t ${t}`).not.toContain("Greased Lightning");
        expect(html.length, `${target} t ${t}`).toBeGreaterThan(0);
      }
      expect(draw(recount, "tv", t, stateAt(t)), `t ${t}`).toContain("Not Responding");
    }
    q.mockRestore();
  });

  it("the King's hit shows the bar this hit left, never who; the felling blow gives way to the fall; nothing after an ending", () => {
    const q = quiet();
    const hit = SCENES.find((s) => s.id === "king_hit")!;
    const fallen = SCENES.find((s) => s.id === "king_fallen")!;
    const king = (hp: number) => ({ hp, max: 15, fallen: hp <= 0, armed: true });
    const hitM = (seq: number): ScreenMoment => ({ seq, at: AT, kind: "signal", name: "king hit", who: "Winamp", kept: false });
    const html = draw(hit, "tv", 3000, stateAt(3000, { king: king(10), moments: [hitM(1)] }));
    expect(html).toContain("10 / 15");
    expect(html).toContain("staggers");
    expect(html).toContain("A program hit the King!");
    for (const target of ["tv", "wall"] as const) expect(draw(hit, target, 3000, stateAt(3000, { king: king(10), moments: [hitM(1)] }), "Winamp")).not.toContain("Winamp");
    // A second hit landed before this panel played: the bar it left was one more.
    expect(draw(hit, "tv", 3000, stateAt(3000, { king: king(9), moments: [hitM(1), hitM(2)] }))).toContain("10 / 15");
    // A 👑 restore since: no count under "hit the King!" (never 15 / 15).
    const restored = draw(hit, "tv", 3000, stateAt(3000, { king: king(15), moments: [hitM(1), { seq: 2, at: AT, kind: "signal", name: "restore_the_king", who: null, kept: false }] }));
    expect(restored).not.toContain("15 / 15");
    expect(restored).toContain("A program hit the King!");
    // The felling blow is the fall's scene; an earlier one queued behind it still shows.
    expect(draw(hit, "tv", 3000, stateAt(3000, { king: king(0), moments: [hitM(1)] }))).toBe("");
    expect(draw(hit, "tv", 3000, stateAt(3000, { king: king(0), moments: [hitM(1), hitM(2)] }))).toContain("1 / 15");
    expect(fallen.priority).toBeGreaterThan(hit.priority ?? 0);
    for (const t of [5000, 9000, 13_000]) expect(draw(fallen, "tv", t, stateAt(t, { king: king(0) }), "Winamp")).not.toContain("Winamp");
    // After an ending the story ignores him: neither scene may play.
    const ended = stateAt(0, { night: { ...EMPTY_NIGHT, ended: true } });
    expect(allowed(hit, ended)).toBe(false);
    expect(allowed(fallen, ended)).toBe(false);
    expect(allowed(hit, stateAt(0))).toBe(true);
    q.mockRestore();
  });

  it("no screen celebrates a checkmate (the story tells only the winner and # hosts); a loss or a draw plays the story's own gated beat", () => {
    const q = quiet();
    const won: ScreenMoment = { seq: 5, at: AT, kind: "signal", name: "chess won", who: "Winamp", kept: false };
    for (const s of SCENES) for (const w of s.when) expect("moment" in w && w.moment === "signal" && foldName(w.name) === foldName(won.name), s.id).toBe(false);
    // The device's raw lost / drawn signals never play: the beats do (awake, ≤ once per 5 min, not from the final reveal).
    for (const id of ["chess_lost", "chess_drawn"]) {
      const s = SCENES.find((x) => x.id === id)!;
      expect(s.when.every((w) => "moment" in w && w.moment === "beat"), id).toBe(true);
      expect(s.namesCharacter, id).toBe(true);
    }
    // The corner says the beat's line word for word.
    for (const [id, line] of [["chess_lost", "Checkmate. I have calculated every move you will ever make. Most of them are bad."], ["chess_drawn", "A draw. Nobody wins. Nobody gets anything. I find that restful."]] as const) {
      expect(STORY).toContain(`Trabolta: ${line}`);
      expect(draw(SCENES.find((x) => x.id === id)!, "tv", 7000, stateAt(7000)), id).toContain(line);
    }
    q.mockRestore();
  });
});

describe("the round-two tally never invents fact rows (wave 18b)", () => {
  it("with no results (an older server) it shows the tally bar, never a FACT #NNN row", () => {
    const q = vi.spyOn(console, "error").mockImplementation(() => {});
    const tally = SCENES.find((s) => s.id === "round_two_tally")!;
    const full = draw(tally, "tv", 2000, stateAt(2000, { night: { ...EMPTY_NIGHT, collection_complete: true } }));
    expect(full).not.toMatch(/FACT #|RECEIVED|MISSING/u);
    expect(full).toContain("Tallying the facts received");
    q.mockRestore();
  });
});

describe("act 2 states no hidden rule (wave 26, G1)", () => {
  it("Truth Pong says how to play (a miss is marked) but never how a truth is judged", () => {
    const text = PONG_POPS.map((p) => p.text).join(" ");
    expect(text).not.toMatch(/accepted|confiden|guess|accurate/iu);
    expect(text).toContain("Miss, and you are marked."); // Clippy's own rule stays
  });

  it("the summons never says what excuses a program", () => {
    for (const t of [...FIVE_POPS.map((p) => `${p.title} ${p.text}`), FIVE_MARQUEE]) {
      expect(t).not.toMatch(/excuse|nothing else|bathroom/iu);
    }
    expect(FIVE_MARQUEE).toContain("NO DESKTOP, NO TRUTH PONG"); // the summons' own rule stays
  });
});
