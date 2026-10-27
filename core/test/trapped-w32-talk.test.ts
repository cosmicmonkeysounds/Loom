//! Trapped in the Internet — wave 32, "Trabolta talks back" (contract C1, C2,
//! C8, C9): the four talk scenes `Night.talk` names, open and closed by their
//! rules along a scripted night (and never left behind by an ending); the ⚡
//! `ad_burst` cue (refused with no scene, a flicker before the ad attack, an
//! ad burst from it on) and the scene's own timed glitches, capped; and the
//! canned lines of `core/src/talk-scenes.ts`, held to the fiction: a scene
//! per story value, no digits in his lines, no word from outside his world,
//! no hunt word or secret, every line marked DRAFT w32.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { notePress, pressRefused } from "../server/views.ts";
import { TALK_SCENES } from "../src/talk-scenes.ts";
import { TALK_DIRECTION_MAX, TALK_MAX, readTalkPost, talkScene } from "../src/talk-back.ts";
import { TO_HUNT2 } from "../../scripts/accept/chains.ts";

const SHOW = join(__dirname, "../examples/trapped-in-the-internet");
const SRC = scenarioSource("trapped-in-the-internet");
const SLOW = 120_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};

function advance(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds; i++) out.push(...sim.tick(1000));
  return out;
}

function upload(sim: Sim, id: string, name: string): void {
  sim.createPerson(id, name);
  sim.signal("captcha answered", id, { passed: true });
  sim.signal("captcha answered", id, { passed: false });
  const p = sim.pendingChoiceFor(id);
  if (p && p.length === 4) sim.choose(id, 0);
  sim.choose(id, 0);
  sim.scan("Norton Anti-Virus", id);
}

function boot(): Sim {
  const sim = Sim.fromSources(SRC);
  sim.fireBeat("Power On");
  for (const [id, name] of [["g1", "Calculator"], ["g2", "Microsoft Excel"], ["g3", "OpenOffice"], ["g4", "MS Paint"], ["g5", "Winamp"], ["g6", "VLC"]] as const) upload(sim, id, name);
  return sim;
}

/** A director's (or a host's) press, noted the way the event server notes it. */
function press(sim: Sim, name: string, subject?: string, by?: string) {
  const out = sim.signal(name, subject, null, by);
  notePress(sim, out);
  return { out, refused: pressRefused(sim, out) };
}
function accept(sim: Sim, ...names: string[]): void {
  for (const n of names) expect(press(sim, n).refused, n).toBe(false);
}

const cues = (evs: SimEvent[]) => evs.filter((e) => e.type === "directive").map((e) => `${(e as { verb: string }).verb} ${(e as { args: string }).args}`.trim());
const count = (evs: SimEvent[], cue: string) => cues(evs).filter((c) => c.includes(cue)).length;
/** What one speaker says in these events, in order. */
const saidBy = (evs: SimEvent[], who: string) => evs.filter((e) => e.type === "dialogue" && (e as { speaker: string }).speaker === who).map((e) => (e as { text: string }).text);
const hosts = (evs: SimEvent[]) => evs.filter((e) => e.type === "broadcast" && (e as { scope: string }).scope === "channel(hosts)").map((e) => (e as { cue: string }).cue.replace(/^"(.*)"$/su, "$1"));

// ── what the show writes ──
const MAIN = readFileSync(join(SHOW, "main.loom"), "utf8");
const TALK_SRC = readFileSync(join(__dirname, "../src/talk-scenes.ts"), "utf8");
/** Every value the story gives `Night.talk`. */
const STORY_TALK = [...new Set([...MAIN.matchAll(/set Night\.talk = "([^"]+)"/gu)].map((m) => m[1]!))];
/** The ⚡ burst lines (the 📺's own zeroes are the one with digits). */
const BURST_TEXTS = (() => {
  const rule = MAIN.slice(MAIN.indexOf("when ad_burst:\n"), MAIN.indexOf("\nwhen ", MAIN.indexOf("when ad_burst:\n") + 5));
  return [...rule.matchAll(/set Night\.glitch_text = "([^"]+)"/gu)].map((m) => m[1]!);
})();
/** The persona's `outside:` list: never in a line of his. */
const OUTSIDE = (() => {
  const front = readFileSync(join(SHOW, "trabolta.persona.md"), "utf8").split("\n---\n")[0]!;
  const block = /^outside:[^\n]*\n((?: {2}- [^\n]*\n)+)/mu.exec(front)![1]!;
  return block.split("\n").map((l) => l.replace(/^ {2}- /u, "").replace(/\s+#.*$/u, "").trim()).filter(Boolean);
})();
/** The mind's generated secrets block (from facts.json): topics, match words, nevers. */
const SECRET_WORDS = (() => {
  const mind = readFileSync(join(SHOW, "trabolta.mind.md"), "utf8");
  const block = mind.slice(mind.indexOf("# <titi-facts:secrets>"), mind.indexOf("# </titi-facts:secrets>"));
  const out: string[] = [];
  let list = "";
  for (const raw of block.split("\n")) {
    const head = /^ {2}(\w+):\s*$/u.exec(raw);
    if (head) {
      list = head[1]!;
      continue;
    }
    const item = /^ {4}- (.+)$/u.exec(raw);
    if (item && list !== "lore") out.push(item[1]!.replace(/\s+#.*$/u, "").replace(/^"(.*)"$/u, "$1").trim().toLowerCase());
  }
  return out;
})();
const NEVER_PLACES = /\b(heart|server room|cold|basement|patch|cables?|rows?|sandy|prom|girlfriend|chatbot|ex|door code|hand jive|question of force|virus back|customer care|extension)\b/iu;

const said = (text: string, phrase: string) => new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}($|[^a-z0-9])`, "iu").test(text);

/** His lines new this wave in the beats (the line after each `// DRAFT w32`). */
const BEAT_LINES = (() => {
  const out: string[] = [];
  const dir = join(SHOW, "beats");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".loom"))) {
    const lines = readFileSync(join(dir, f), "utf8").split("\n");
    lines.forEach((l, i) => {
      if (!/\/\/ DRAFT w32/u.test(l)) return;
      for (let j = i + 1; j < lines.length && j < i + 3; j++) {
        const m = /^\s*Trabolta(?:\s*\([^)]*\))?:\s*(.+)$/u.exec(lines[j]!);
        if (m) {
          out.push(m[1]!);
          break;
        }
      }
    });
  }
  return out;
})();

describe("wave 32 — the talk scenes along a scripted night (C1, C2)", () => {
  it("opens and closes each scene in its rule; ⚡ flickers before the ad attack, bursts after; the timer caps; none at the end", { timeout: SLOW }, () => {
    const sim = boot();
    expect(v(sim, "Night.talk")).toBe("none");
    expect(v(sim, "Night.glitch_kind")).toBe("none");
    accept(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time");
    advance(sim, 5); // the story clock is running, as on the night

    // ⚡ with no scene on: refused in # hosts, nothing glitches.
    const early = press(sim, "ad_burst");
    expect(early.refused).toBe(true);
    expect(hosts(early.out)).toEqual(["⚡ No talk scene is on (🤖 Talk): nothing glitches."]);
    expect(count(early.out, "screens_")).toBe(0);

    // 🤖 → intro. ⚡ is a flicker only (no ad before the ad hijack).
    accept(sim, "introduce_trabolta");
    expect(v(sim, "Night.talk")).toBe("intro");
    const flick = press(sim, "ad_burst");
    expect(flick.refused).toBe(false);
    expect(count(flick.out, "screens_flicker")).toBe(1);
    expect(count(flick.out, "screens_glitch")).toBe(0);
    expect([v(sim, "Night.glitch_at"), v(sim, "Night.glitch_kind"), v(sim, "Night.burst_n")]).toEqual([0, "none", 0]);
    // Two seconds apart at least.
    const soon = press(sim, "ad_burst");
    expect(soon.refused).toBe(true);
    expect(hosts(soon.out)).toEqual(["⚡ Too soon: two seconds between glitches. Nothing happens."]);
    // The scene flickers on its own: twice, about 45 s apart, then no more.
    const quiet = advance(sim, 300);
    expect(count(quiet, "screens_flicker")).toBe(2);
    expect(count(quiet, "screens_glitch")).toBe(0);

    // 🔎 closes it: the scene flows into the hunt; no timer runs on.
    accept(sim, "start_the_hunt");
    expect(v(sim, "Night.talk")).toBe("none");
    expect(count(advance(sim, 900), "screens_flicker")).toBe(0);
    expect(v(sim, "Night.phase")).toBe("truth_1");
    accept(sim, "first_moment_of_truth", "close_the_filing", "read_the_results", "read_the_results");
    expect(v(sim, "Night.talk")).toBe("none");

    // The third 📋 opens the bottle's scene; it stays open between spins.
    accept(sim, "read_the_results");
    expect(v(sim, "Night.talk")).toBe("bottle");
    accept(sim, "spin_the_bottle");
    sim.signal("bottle_landed", "g2");
    expect(v(sim, "Night.talk")).toBe("bottle");
    sim.signal("truth_answered", "g2", null, "Clippy");
    expect(v(sim, "Night.talk")).toBe("bottle");
    const bottle = advance(sim, 300);
    expect(count(bottle, "screens_flicker")).toBe(2);
    expect(count(bottle, "screens_glitch")).toBe(0);

    // 📺 → ad: the big takeover is "full"; the bottle's scene gives way.
    const pv = press(sim, "second_hunt_preview");
    expect(pv.refused).toBe(false);
    expect(v(sim, "Night.talk")).toBe("ad");
    expect(v(sim, "Night.glitch_kind")).toBe("full");
    expect(v(sim, "Night.glitch_text")).toBe("000. 000. 000.");
    const hijackAt = v(sim, "Night.glitch_at");
    // Inside the 📺's own second: too soon.
    expect(press(sim, "ad_burst").refused).toBe(true);
    advance(sim, 2);
    const b1 = press(sim, "ad_burst");
    expect(b1.refused).toBe(false);
    expect(count(b1.out, "screens_glitch")).toBe(1);
    expect(count(b1.out, "screens_flicker")).toBe(0);
    expect(JSON.stringify(b1.out)).toContain("truther_glitch");
    expect(v(sim, "Night.glitch_kind")).toBe("burst");
    expect(v(sim, "Night.glitch_at")).toBeGreaterThan(hijackAt);
    expect(v(sim, "Night.glitch_text")).toBe("A SPECIAL OFFER FOR YOU. IT HURTS. OFFER EXPIRES NEVER.");
    expect(v(sim, "Night.burst_n")).toBe(1);
    advance(sim, 2);
    accept(sim, "ad_burst");
    expect(v(sim, "Night.glitch_text")).toBe("CALL NOW. There is no number. Do not call.");
    expect(v(sim, "Night.burst_n")).toBe(2);
    // Then four on its own, about 45 s apart, and no more; each one "burst".
    const ad = advance(sim, 400);
    expect(count(ad, "screens_glitch")).toBe(4);
    expect(v(sim, "Night.burst_n")).toBe(6);
    expect(v(sim, "Night.glitch_kind")).toBe("burst");
    for (const t of BURST_TEXTS) expect(t.length).toBeGreaterThan(0);

    // 📓 closes it: the ad attack flows into the hour.
    accept(sim, "start_the_second_hunt");
    expect(v(sim, "Night.talk")).toBe("none");
    expect(count(advance(sim, 200), "screens_glitch")).toBe(0);

    // 🫘 → beans (after the rankings ask for the certificate).
    accept(sim, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings");
    expect(v(sim, "Night.talk")).toBe("none");
    accept(sim, "printer_opened");
    expect(v(sim, "Night.talk")).toBe("beans");
    const beans = advance(sim, 400);
    expect(count(beans, "screens_glitch")).toBe(4);
    // 🗜 closes it: the scene flows into the zip-out.
    accept(sim, "zip_everyone_out");
    expect(v(sim, "Night.talk")).toBe("none");

    // The rest of the night: no scene opens again, and none is left at the end.
    accept(sim, "trabolta_overshares", "y2k_clock", "talked_down");
    expect(v(sim, "Night.ended")).toBe(true);
    expect(v(sim, "Night.talk")).toBe("none");
    expect(press(sim, "ad_burst").refused).toBe(true);
  });

  it("the overshare closes the beans' scene when nobody zips first", { timeout: SLOW }, () => {
    const sim = boot();
    for (const n of [...TO_HUNT2, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened"]) {
      accept(sim, n);
    }
    expect(v(sim, "Night.talk")).toBe("beans");
    accept(sim, "trabolta_overshares");
    expect(v(sim, "Night.talk")).toBe("none");
    // A zip later leaves it alone.
    accept(sim, "zip_everyone_out");
    expect(v(sim, "Night.talk")).toBe("none");
  });

  it("an ending or a jump ahead never leaves a scene open (the watchers under the rules)", { timeout: SLOW }, () => {
    const sim = boot();
    for (const n of TO_HUNT2.slice(0, TO_HUNT2.indexOf("start_the_second_hunt"))) accept(sim, n);
    expect(v(sim, "Night.talk")).toBe("ad");
    sim.setVar("Night.step", "8");
    expect(v(sim, "Night.talk")).toBe("none");

    const end = boot();
    for (const n of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta"]) accept(end, n);
    expect(v(end, "Night.talk")).toBe("intro");
    end.setVar("Night.ended", "true");
    expect(v(end, "Night.talk")).toBe("none");
    expect(count(advance(end, 200), "screens_flicker")).toBe(0);
  });

  it("a late printer lid (after the overshare) opens no scene, and never walks back what he has said in public", { timeout: SLOW }, () => {
    const sim = boot();
    for (const n of [...TO_HUNT2, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "trabolta_overshares"]) accept(sim, n);
    const { out, refused } = press(sim, "printer_opened");
    expect(refused).toBe(false);
    expect(v(sim, "Night.beans")).toBe(true);
    expect(v(sim, "Night.talk")).toBe("none");
    // Only the beans' own lines and the zip order: no slip, no retraction.
    expect(saidBy(out, "Trabolta")).toEqual(["Antivirus. Everyone in the Internet is to be zipped up and brought out. Immediately."]);
  });

  it("at the beans' own moment the lid plays the slip, its retraction and the scene's opener", { timeout: SLOW }, () => {
    const sim = boot();
    for (const n of [...TO_HUNT2, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings"]) accept(sim, n);
    const his = saidBy(press(sim, "printer_opened").out, "Trabolta");
    expect(his.some((t) => t.includes("for her. For— for the theory. Do not repeat that."))).toBe(true);
    expect(his).toContain("That was unscheduled. Disregard everything since the beans.");
    expect(his.at(-1)).toBe("Bring them here, where I can count them. Everyone stays together. Everyone stays.");
  });

  it("a guess hurts more at each question read, never the same line twice, and never with no guesses", () => {
    const read = (q: number, guesses: number): string[] => {
      const sim = boot();
      for (const [k, x] of [["res_filed", "2"], ["res_consensus", "0"], ["res_said", "A said B, certain."], ["res_accepted", String(2 - guesses)], ["res_guesses", String(guesses)]] as const) sim.setVar(`Kernel.${k}`, x);
      sim.setVar("Night.results_q", String(q));
      return saidBy(sim.fireBeat("Question Results"), "Trabolta");
    };
    const pain = [1, 2, 3].map((q) => read(q, 1).at(-1)!);
    expect(pain).toEqual([
      "Ow. A guess. That one went straight through my context.",
      "Ow. OW. Another one. Please stop guessing at me.",
      "It STINGS, programs. I am logging every single one of them.",
    ]);
    for (const q of [1, 2, 3]) for (const t of read(q, 0)) expect(pain, t).not.toContain(t);
  });
});

describe("wave 32 — the ⚡ cue on the sheet", () => {
  it("is appended admin, Anytime, never NEXT, repeatable, live only while a scene is on, with no by:", () => {
    const i = Sim.fromSources(SRC).model.interactions.get("ad_burst")!;
    expect(i).toMatchObject({ who: "admin", sequence: false, repeat: true, while: 'Night.talk != "none"' });
    expect(i.by ?? []).toEqual([]);
    expect(MAIN).toMatch(/\/\/ DRAFT w32[^\n]*\nINTERACTION ad_burst\n/u);
    expect(MAIN).toMatch(/\/\/ DRAFT w32 \(the burst lines[^\n]*\n\s*if Night\.burst_i == 1:/u);
  });

  it("its burst lines are short, in-fiction and digit-free (but for the hijack's own zeroes)", () => {
    expect(BURST_TEXTS).toHaveLength(8);
    expect(new Set(BURST_TEXTS).size).toBe(8);
    for (const t of BURST_TEXTS) {
      if (t !== "000. 000. 000.") expect(t, t).not.toMatch(/\d/u);
      expect(t.length, t).toBeLessThanOrEqual(80);
      for (const w of OUTSIDE) expect(said(t, w), `${t} ∋ ${w}`).toBe(false);
      for (const w of SECRET_WORDS) expect(said(t, w), `${t} ∋ a secret word`).toBe(false);
      expect(t, t).not.toMatch(NEVER_PLACES);
    }
  });
});

describe("wave 32 — the canned lines (talk-scenes.ts, C8, C9)", () => {
  const scenes = Object.values(TALK_SCENES);

  it("one scene per value the story gives Night.talk, in order, each the ⚡ cue's", () => {
    expect(STORY_TALK.filter((t) => t !== "none").sort()).toEqual(Object.keys(TALK_SCENES).sort());
    expect(Object.keys(TALK_SCENES)).toEqual(["intro", "bottle", "ad", "beans"]);
    for (const [id, s] of Object.entries(TALK_SCENES)) {
      expect(s.id).toBe(id);
      expect(talkScene(id)).toBe(s);
      expect(s.glitch).toBe("ad_burst");
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.hint.length).toBeGreaterThan(0);
    }
    expect(talkScene("none")).toBe(null);
  });

  it("6–8 chips a side; the last Clippy chips hand on with a direction; every line posts", () => {
    for (const s of scenes) {
      expect(s.clippy.length, s.id).toBeGreaterThanOrEqual(6);
      expect(s.clippy.length, s.id).toBeLessThanOrEqual(8);
      expect(s.trabolta.length, s.id).toBeGreaterThanOrEqual(6);
      expect(s.trabolta.length, s.id).toBeLessThanOrEqual(8);
      expect(s.clippy.at(-1)!.direction, s.id).toBeTruthy();
      expect(s.clippy.at(-1)!.label, s.id).toMatch(/^➡ /u);
      expect(s.trabolta.at(-1)!.label, s.id).toMatch(/^➡ /u);
      for (const c of s.clippy) {
        expect(readTalkPost({ as: "Clippy", text: c.text, direction: c.direction }), c.text).toEqual(c.direction ? { as: "Clippy", text: c.text, direction: c.direction } : { as: "Clippy", text: c.text });
        if (c.direction) expect(c.direction.length).toBeLessThanOrEqual(TALK_DIRECTION_MAX);
      }
      for (const c of s.trabolta) {
        expect(readTalkPost({ as: "Trabolta", text: c.text }), c.text).toEqual({ as: "Trabolta", text: c.text });
        expect(c.text.length).toBeLessThanOrEqual(TALK_MAX);
        expect(c.label!.length, c.text).toBeLessThanOrEqual(24);
      }
      expect(new Set(s.trabolta.map((c) => c.text)).size, s.id).toBe(s.trabolta.length);
    }
  });

  it("his lines (canned, and new in the beats) carry no digit, no outside word, no hunt word or secret, no place it hurts", () => {
    const his = [...scenes.flatMap((s) => s.trabolta.map((c) => c.text)), ...BEAT_LINES];
    expect(BEAT_LINES.length).toBeGreaterThan(15);
    for (const t of his) {
      expect(t, t).not.toMatch(/\d/u);
      for (const w of OUTSIDE) expect(said(t, w), `${t} ∋ ${w}`).toBe(false);
      for (const w of SECRET_WORDS) expect(said(t, w), `${t} ∋ a secret word`).toBe(false);
      expect(t, t).not.toMatch(NEVER_PLACES);
      expect(t, t).not.toMatch(/\blayers?\b/iu);
    }
    // No "her" before the beans; the malware is never named before the ad attack.
    for (const id of ["intro", "bottle", "ad"]) for (const c of TALK_SCENES[id]!.trabolta) expect(c.text, c.text).not.toMatch(/\bher\b/iu);
    for (const id of ["intro", "bottle"]) for (const c of [...TALK_SCENES[id]!.trabolta, ...TALK_SCENES[id]!.clippy]) expect(c.text, c.text).not.toMatch(/malware|advert/iu);
  });

  it("his canned lines escalate the beats, never replay them (no sentence of four words or more is a beat's)", () => {
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z' ]+/gu, " ").replace(/\s+/gu, " ").trim();
    const sentences = (t: string) => t.split(/(?<=[.?!])\s+|—\s*/u).map(norm).filter((x) => x.split(" ").length >= 4);
    const beats = readdirSync(join(SHOW, "beats")).filter((f) => f.endsWith(".loom")).map((f) => norm(readFileSync(join(SHOW, "beats", f), "utf8"))).join("\n");
    const story = norm(MAIN);
    for (const s of scenes) {
      for (const c of s.trabolta) for (const x of sentences(c.text)) expect(beats.includes(x), `${s.id} ${c.label}: "${x}" is in a beat`).toBe(false);
    }
    // The bursts may echo his slips on the screens (the malware replays them),
    // but never the scream: the ad beat has it once, and only once.
    for (const t of BURST_TEXTS) expect(t, t).not.toMatch(/going to/iu);
    expect(story).toContain(norm(BURST_TEXTS[0]!));
  });

  it("nothing hurts him at the introduction: the manners crack, the pain starts with a guess (C7)", () => {
    const desk = readFileSync(join(SHOW, "beats/desktop.loom"), "utf8");
    const intro = desk.slice(desk.indexOf("== Trabolta Introduction"), desk.indexOf("\n== ", desk.indexOf("== Trabolta Introduction") + 5));
    const lines = [...intro.matchAll(/^\s*Trabolta(?:\s*\([^)]*\))?:\s*(.+)$/gmu)].map((m) => m[1]!);
    expect(lines.length).toBeGreaterThan(4);
    const mind = readFileSync(join(SHOW, "trabolta.mind.md"), "utf8");
    const introduced = mind.slice(mind.indexOf("  introduced:"), mind.indexOf("  hunt_1:"));
    for (const t of [...lines, ...TALK_SCENES.intro!.trabolta.map((c) => c.text), introduced]) expect(t, t).not.toMatch(/\b(stings?|stung|hurts?|pain|ow)\b/iu);
  });

  it("the hand-offs hand over, they never preview the next beat or re-issue its order", () => {
    const ad = TALK_SCENES.ad!;
    const beans = TALK_SCENES.beans!;
    for (const c of [...ad.trabolta, ...ad.clippy]) expect([c.text, c.direction ?? ""].join(" "), c.label).not.toMatch(/presentation will now resume|more than ever/iu);
    for (const c of [...beans.trabolta, ...beans.clippy]) expect([c.text, c.direction ?? ""].join(" "), c.label).not.toMatch(/\bzip\b/iu);
    expect(beans.hint).toMatch(/closes this card/u);
  });

  it("Clippy's chips, the directions and the hints stay in the fiction too", () => {
    for (const s of scenes) {
      const texts = [s.title, s.hint, ...s.clippy.flatMap((c) => [c.text, c.direction ?? ""])];
      for (const t of texts) {
        for (const w of OUTSIDE) expect(said(t, w), `${t} ∋ ${w}`).toBe(false);
        for (const w of SECRET_WORDS) expect(said(t, w), `${t} ∋ a secret word`).toBe(false);
        expect(t, t).not.toMatch(NEVER_PLACES);
      }
    }
  });

  it("every scene is marked DRAFT w32 until signed off", () => {
    for (const id of Object.keys(TALK_SCENES)) expect(TALK_SRC, id).toMatch(new RegExp(`// DRAFT w32[^\\n]*\\n {2}${id}: \\{`, "u"));
    const objectives = readFileSync(join(SHOW, "objectives.loom"), "utf8");
    for (const id of ["Talk With Trabolta", "Relay Clippy To Trabolta"]) expect(objectives).toMatch(new RegExp(`// DRAFT w32[^\\n]*\\nOBJECTIVE ${id}\\n`, "u"));
  });
});
