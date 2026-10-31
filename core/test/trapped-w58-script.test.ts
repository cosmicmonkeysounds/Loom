// Wave 58: the opening is the Oct 30 script, word for word, compared by program.
//
// The script is read from the delivered file, which stays as it was delivered:
// every word of ours round it is a logged fix below, and nothing else may differ.
// The show's beats, in the order the night plays them, must equal the script's
// spoken paragraphs in order. Its stage directions must all be in Clippy's
// Instructions, and never in a beat: a line in a beat reaches every phone.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";

const ROOT = join(import.meta.dirname, "../..");
const SHOW = join(ROOT, "core/examples/trapped-in-the-internet");
const SCRIPT = join(ROOT, "Trapped In The Internet story/oct30/TRAPPED IN THE INTERNET - SCRIPT.md");

/** The logged fixes: `[line of the script, what it says, what the story says]`. */
const FIXES: ReadonlyArray<readonly [number, string, string]> = [
  [3, "to the desktop!", "to the Desktop!"], // the proper noun, as SCRIPT:39 and :47 write it
  [49, "fellow programs And we", "fellow programs. And we"], // a dropped full stop
  [89, "[program name]", "{Night.framed_name}"], // the 🃏 press names them
  [111, "exactly is how he feeling", "exactly how he is feeling"], // a typo
  [111, "but he is will be very", "but he will be very"], // a typo
  [135, "earn 5 cents", "earn five cents"], // spelled for the voice
  [155, "to the desktop, programs", "to the Desktop, programs"], // the proper noun again
];

/** The beats the opening plays, in the order the night reaches them. */
const BEATS = ["Computer Bingo", "Bingo Time", "Winning Line", "Bingo Prize", "Shy Winner", "No Bingos", "Corrupted Code", "Following The Reinstallation", "Clippy On Trabolta", "Trabolta Introduction", "Trabolta Greeting", "Hunt One Questions", "Hunt One Go", "First Moment Of Truth", "Filing Closed"];

const read = (p: string) => readFileSync(join(SHOW, p), "utf8");
const FILES = ["beats/desktop.loom", "beats/hunt.loom", "generated/questions.loom"].map(read).join("\n");

/** Typographic quotes as the story writes them. */
const plain = (t: string) => t.replace(/[’‘]/gu, "'").replace(/[“”]/gu, '"');
/** A beat's lines, whole (`Speaker: words`), and its body. */
function body(name: string): string {
  const at = FILES.indexOf(`== ${name}\n`);
  expect(at, name).toBeGreaterThanOrEqual(0);
  const next = FILES.indexOf("\n== ", at + 3);
  return FILES.slice(at, next < 0 ? undefined : next);
}
const spokenIn = (name: string) => body(name).split("\n").filter((l) => /^[A-Z][A-Za-z ]*(?: \([^)]*\))?: /u.test(l) && !/^\s*(setting|cast|aloud):/u.test(l));

/** One line of the script: markdown out, escapes out, quotes plain. */
const unmark = (l: string) => plain(l.replace(/\\([!\-_*[\]])/gu, "$1").replace(/\*\*/gu, "").trim());

interface ScriptLine {
  n: number;
  text: string;
}
function parseScript(): { said: ScriptLine[]; directions: ScriptLine[]; questions: ScriptLine[] } {
  const raw = readFileSync(SCRIPT, "utf8").split("\n");
  const said: ScriptLine[] = [];
  const directions: ScriptLine[] = [];
  const questions: ScriptLine[] = [];
  raw.forEach((line, i) => {
    const n = i + 1;
    const t = line.trim();
    if (t === "" || /^(\*\*\*|\\\*\\\*\\\*|\*\*\\\*\\\*\\\*\*\*)$/u.test(t)) return;
    const direction = /^\*\\\[(.*)\\\]\*$/u.exec(t);
    if (direction) return void directions.push({ n, text: unmark(direction[1]!).replace(/:$/u, "") });
    if (/^\*\*[^*]*\*\*$/u.test(t) && /[A-Z]{4}|:\*\*$/u.test(t)) return; // a heading, or a branch's name
    const q = /^(\d)\.\s+(.*)$/u.exec(t);
    if (q) return void questions.push({ n, text: unmark(q[2]!).replace(/\*/gu, "") });
    let text = unmark(t);
    for (const [at, from, to] of FIXES) {
      if (at !== n) continue;
      expect(text, `SCRIPT:${at}'s fix is stale`).toContain(from);
      text = text.replace(from, to);
    }
    said.push({ n, text });
  });
  return { said, directions, questions };
}

const has = existsSync(SCRIPT);

describe.skipIf(!has)("wave 58: the opening against the delivered script", () => {
  const { said, directions, questions } = has ? parseScript() : { said: [], directions: [], questions: [] };
  const story = BEATS.filter((b) => b !== "Hunt One Questions").flatMap(spokenIn).map((l) => l.replace(/^(Clippy|Trabolta): /u, ""));

  it("every spoken line of the script is in the story, word for word, in the night's order, and nothing else is", () => {
    expect(said.length).toBeGreaterThan(50);
    expect(story).toEqual(said.map((l) => l.text));
  });

  it("the story's speakers are the script's: Clippy until 🤖, Trabolta to his sign-off, Clippy again", () => {
    const who = (b: string) => [...new Set(spokenIn(b).map((l) => l.slice(0, l.indexOf(":"))))];
    for (const b of BEATS) expect(who(b), b).toEqual([["Trabolta Introduction", "Trabolta Greeting", "Hunt One Questions", "Hunt One Go"].includes(b) ? "Trabolta" : "Clippy"]);
  });

  it("the three questions go through the generated reader, in the script's words, its asterisks dropped", () => {
    const facts = JSON.parse(read("facts.json")) as { questions: Array<{ id: string; text: string; spoken?: string }> };
    const q = (id: string) => facts.questions.find((x) => x.id === id)!;
    expect(questions.map((x) => x.text)).toEqual(["H1", "H2", "H3"].map((id) => plain(q(id).text)));
    expect(spokenIn("Hunt One Questions")).toEqual(["one", "two", "three"].map((w, i) => `Trabolta: Question ${w}. ${q(`H${i + 1}`).spoken ?? q(`H${i + 1}`).text}`));
  });

  it("every stage direction is in Clippy's Instructions, and none is in a beat", () => {
    const flat = (t: string) => t.replace(/\s+/gu, " ");
    const ci = flat(read("codex/7-clippy.loom"));
    expect(directions).toHaveLength(13);
    for (const d of directions) expect(ci, `SCRIPT:${d.n}`).toContain(d.text);
    const beats = flat(BEATS.map(body).join("\n"));
    for (const d of directions) expect(beats, `SCRIPT:${d.n}`).not.toContain(d.text);
  });
});

describe("wave 58: nothing but the performers' lines in the opening", () => {
  it("no Narrator line in any of its beats: a Narrator line reaches every phone, directions and all", () => {
    for (const b of BEATS) {
      expect(body(b), b).not.toMatch(/^Narrator/mu);
      for (const l of body(b).split("\n").slice(1)) {
        if (l === "" || l.startsWith("//") || /^ {2}(setting|cast|aloud):/u.test(l) || /^(cue |set |if |\s*-> )/u.test(l)) continue;
        expect(l, b).toMatch(/^(Clippy|Trabolta): /u);
      }
    }
  });
});

const SRC = scenarioSource("trapped-in-the-internet");
const PROGRAMS: [string, string][] = [
  ["g1", "Calculator"],
  ["g2", "Microsoft Excel"],
  ["g3", "OpenOffice"],
  ["g4", "MS Paint"],
  ["g5", "Winamp"],
  ["g6", "VLC"],
];
const TO_BINGO = ["call_to_the_desktop", "start_the_bingo", "bingo_time"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => (sim.world.get(p) as { value: unknown } | undefined)?.value;
const fire = (sim: Sim, name: string, subject?: string, actor?: string) => sim.signal(name, subject, undefined, actor);
function boot(): Sim {
  const sim = Sim.fromSources(SRC);
  sim.fireBeat("Power On");
  for (const [id, name] of PROGRAMS) {
    sim.createPerson(id, name);
    sim.signal("captcha answered", id, { passed: true } as never);
    sim.signal("captcha answered", id, { passed: false } as never);
    if (sim.pendingChoiceFor(id)?.length === 5) sim.choose(id, 0);
    sim.choose(id, 0);
    sim.scan("Norton Anti-Virus", id);
  }
  return sim;
}

const beatsOf = (evs: SimEvent[]) => evs.filter((e) => e.type === "beatEntered").map((e) => (e as { beat: string }).beat);
const said = (evs: SimEvent[], who: string) => evs.flatMap((e) => (e.type === "dialogue" && e.speaker === who ? [e.text] : []));

describe("wave 58: the buttons bring up the script's branches", () => {
  const cue = (sim: Sim, name: string) => [...sim.model.interactions.values()].find((i) => i.id === name)!;

  it("🎱 brings up the winning line, once per winner; a stale press brings up nothing", () => {
    const sim = boot();
    for (const c of TO_BINGO) fire(sim, c);
    expect(beatsOf(fire(sim, "bingo_winner", "g1", "Clippy"))).toContain("Winning Line");
    expect(beatsOf(fire(sim, "bingo_winner", "g1", "Clippy"))).not.toContain("Winning Line");
    expect(beatsOf(fire(sim, "bingo_winner", "g2", "Clippy"))).toContain("Winning Line");
  });

  it("a guest's own 🎱 BINGO! brings her words straight up, before any 🎱 of hers, so ↩ still works", () => {
    const sim = boot();
    for (const c of TO_BINGO.slice(0, 2)) fire(sim, c);
    const called = fire(sim, "call_bingo", "g1");
    expect(beatsOf(called)).toEqual(expect.arrayContaining(["Bingo Time", "Winning Line"]));
    expect(said(called, "Clippy").at(-1)).toBe("Wonderful! Thank you for being so thorough.");
    // ↩, then a second program's call: her words again, once, and no second Bingo Time.
    fire(sim, "not_a_bingo", "g1", "Clippy");
    const again = fire(sim, "call_bingo", "g2");
    expect(beatsOf(again)).toContain("Winning Line");
    expect(beatsOf(again)).not.toContain("Bingo Time");
    // Her 🎱 on the caller only confirms it; on anyone else it brings up the words.
    expect(beatsOf(fire(sim, "bingo_winner", "g2", "Clippy"))).not.toContain("Winning Line");
    expect(v(sim, "g2.bingo")).toBe(true);
    expect(beatsOf(fire(sim, "bingo_winner", "g3", "Clippy"))).toContain("Winning Line");
  });

  it("🎀 is the Bingo Floppy Disk on a winner, and a plain ribbon on anyone else", () => {
    const sim = boot();
    for (const c of TO_BINGO) fire(sim, c);
    fire(sim, "bingo_winner", "g1", "Clippy");
    expect(beatsOf(fire(sim, "award_the_ribbon", "g1", "Clippy"))).toContain("Bingo Prize");
    expect(beatsOf(fire(sim, "award_the_ribbon", "g2", "Clippy"))).not.toContain("Bingo Prize");
  });

  it("🤐 plays Clippy's line and leaves it to Norton: any program, his 🛡, Corrupted Code", () => {
    const sim = boot();
    for (const c of TO_BINGO) fire(sim, c);
    fire(sim, "bingo_winner", "g1", "Clippy");
    const out = fire(sim, "named_nobody", "g1", "Clippy");
    expect(beatsOf(out)).toContain("Shy Winner");
    expect(said(out, "Clippy")).toContain("Oh! There's no need to be shy. We're just checking that all the information is correct.");
    expect(v(sim, "Night.bingo_done")).toBe(true);
    const sent = fire(sim, "send to the internet", "g5", "Norton Anti-Virus");
    expect(sim.isCaptured("g5")).toBe(true);
    expect(beatsOf(sent)).toContain("Corrupted Code");
    expect(sim.questStatus("Norton Anti-Virus", "The Selected Antivirus")).toBe("done");
  });

  it("🃏 reads the framed program's name, once; 🎱 on them goes on through the winning line", () => {
    const sim = boot();
    for (const c of TO_BINGO) fire(sim, c);
    const out = fire(sim, "frame_for_bingo", "g4", "Task Manager");
    expect(beatsOf(out)).toContain("No Bingos");
    expect(said(out, "Clippy").at(-1)).toBe("Would MS Paint come forward, please? Let's give them a hand!");
    expect(beatsOf(fire(sim, "frame_for_bingo", "g5", "Task Manager"))).not.toContain("No Bingos");
    expect(beatsOf(fire(sim, "bingo_winner", "g4", "Clippy"))).toContain("Winning Line");
  });

  it("📺 is the mirror, only after the first reinstallation, once, before he is online; off the sequence", () => {
    const sim = boot();
    expect(cue(sim, "follow_the_reinstallation").sequence).toBe(false);
    for (const c of TO_BINGO) fire(sim, c);
    expect(beatsOf(fire(sim, "follow_the_reinstallation"))).toEqual([]);
    expect(v(sim, "Night.screen")).not.toBe("mirror");
    const sent = fire(sim, "send to the internet", "g4", "Norton Anti-Virus");
    expect(sent.some((e) => e.type === "directive" && JSON.stringify(e).includes("tv_mirror"))).toBe(false); // a capture alone doesn't
    const out = fire(sim, "follow_the_reinstallation");
    expect(beatsOf(out)).toEqual(["Following The Reinstallation"]);
    expect(v(sim, "Night.screen")).toBe("mirror");
    expect(beatsOf(fire(sim, "follow_the_reinstallation"))).toEqual([]);
    fire(sim, "introduce_trabolta");
    expect(beatsOf(fire(sim, "follow_the_reinstallation"))).toEqual([]);
  });

  it("🎤 is Clippy alone, once, before 🤖: it needs no reinstallation, and closes the Bingo round as 🤖 does", () => {
    const sim = boot();
    expect(beatsOf(fire(sim, "clippy_on_trabolta"))).toEqual([]);
    for (const c of TO_BINGO) fire(sim, c);
    const out = fire(sim, "clippy_on_trabolta");
    expect(beatsOf(out)).toEqual(["Clippy On Trabolta"]);
    expect(said(out, "Trabolta")).toEqual([]);
    expect(v(sim, "Night.bingo_done")).toBe(true);
    expect(v(sim, "Trabolta.awake")).toBe(false);
    expect(beatsOf(fire(sim, "clippy_on_trabolta"))).toEqual([]);
    fire(sim, "introduce_trabolta");
    expect(beatsOf(fire(sim, "clippy_on_trabolta"))).toEqual([]);
  });

  it("the sequence is ⏰, 🎤, 🤖, 🔎, and a story that skips 🎤 still brings him online", () => {
    const sim = boot();
    const order = [...sim.model.interactions.values()].filter((i) => i.who === "admin" && i.sequence !== false).map((i) => i.id);
    expect(order.slice(order.indexOf("bingo_time"), order.indexOf("start_the_hunt") + 1)).toEqual(["bingo_time", "clippy_on_trabolta", "introduce_trabolta", "start_the_hunt"]);
    for (const c of TO_BINGO) fire(sim, c);
    expect(beatsOf(fire(sim, "introduce_trabolta"))).toContain("Trabolta Introduction");
  });

  it("the ⏱ line lands when the two minutes do, by hand or by the clock", () => {
    const sim = boot();
    for (const c of [...TO_BINGO, "introduce_trabolta", "start_the_hunt", "hunt_time_up"]) fire(sim, c);
    const fm = fire(sim, "first_moment_of_truth");
    expect(said(fm, "Clippy").some((t) => /tallying/u.test(t))).toBe(false);
    expect(v(sim, "Night.filing_open")).toBe(true);
    const shut = fire(sim, "close_the_filing");
    expect(beatsOf(shut)).toContain("Filing Closed");
    expect(said(shut, "Clippy").at(-1)).toBe("Trabolta, are you there? Tell us how our programs are doing!");
  });
});

describe("wave 58: the story's words round the script", () => {
  const story = ["main.loom", "objectives.loom", "quests.loom", "cast/hosts.loom", "cast/antivirus.loom", "codex/1-world.loom", "codex/7-clippy.loom", "beats/desktop.loom", "beats/hunt.loom"];
  const lines = story.flatMap((f) => read(f).split("\n").map((l, i) => ({ at: `${f}:${i + 1}`, l }))).filter((x) => !x.l.trim().startsWith("//"));
  const hits = (re: RegExp) => lines.filter((x) => re.test(x.l)).map((x) => x.at);

  it("digital conference, never video; no Bingo Ribbon; no box to check; no one line through the centre", () => {
    expect(hits(/video (conference|call)/iu)).toEqual([]);
    expect(hits(/Bingo Ribbon/u)).toEqual([]);
    expect(hits(/check the box|checkbox/iu)).toEqual([]);
    expect(hits(/one (full|complete) line through the centre/iu)).toEqual([]);
  });

  it("the 🤐 wording no longer forbids what the script asks for", () => {
    expect(hits(/nobody is (marked|reinstalled)/iu).filter((x) => !x.startsWith("main.loom"))).toEqual([]);
    expect(read("main.loom")).not.toContain("Nobody was named. Patrol the Tube.");
  });

  it("publicly a man: no AI line of his or about him in the opening's phones and hello", () => {
    expect(read("main.loom")).not.toMatch(/proud to be the world's first AI/u);
    expect(read("codex/4-trabolta.loom")).not.toMatch(/first AI small business owner/u);
    expect(read("codex/7-clippy.loom")).not.toMatch(/ALWAYS been a computer program|first AI small/u);
  });

  it("keeps the wave 32 cracks out of his speech", () => {
    const his = ["Trabolta Introduction", "Trabolta Greeting", "Hunt One Go"].flatMap(spokenIn).join("\n");
    expect(his).not.toMatch(/—|\(glitching\)|EXTREMELY|NECESSARY|Disregard/u);
    expect(read("main.loom")).toMatch(/set Night\.talk = "intro"\n {4}-> Trabolta Introduction/u);
  });

  it("a load of the show is unchanged by the chain: every divert lands", () => {
    const sim = Sim.fromSources(SRC);
    for (const b of BEATS) expect(sim.model.beats.has(b), b).toBe(true);
  });
});
