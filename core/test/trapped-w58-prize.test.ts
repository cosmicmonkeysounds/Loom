// Wave 58 on the show: G9a 🏅, the special prize SCRIPT promises "the program
// who gets the most questions correct". The story counts each program's own
// questions at the press, once a question, off what stands on the record and
// never off `truths_accepted`, which counts confident lies. A key still owed
// counts for nobody. The answers filed here are made up: a verdict is the
// judge's event arg, so no test spells a key.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scenarioDir, scenarioSource } from "../examples/load.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";
import { cueActs, cueRows } from "../src/cue-sheet.ts";
import { FACTS_FILE, parseFactsText } from "../src/facts.ts";
import { ChatStore, composeGuestMessages, type ChatMessage } from "../server/chat.ts";
import { modView, notePress } from "../server/views.ts";
import { ScreenWatch } from "../server/routes/screen.ts";
import { computeRecap } from "../server/recap.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const SLOW = 120_000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => (sim.world.get(p) as { value?: unknown } | undefined)?.value;

class Night {
  readonly sim = Sim.fromSources(SRC);
  readonly chat = new ChatStore();
  constructor() {
    this.take(this.sim.fireBeat("Power On"));
    // Every key in, unless a test says otherwise: the show's own flags are
    // held to facts.json below, and H1–H3 are the ones still owed tonight.
    for (const q of ["h1", "h2", "h3"]) this.sim.setVar(`Night.owed_${q}`, "false");
  }
  take(events: SimEvent[]): ChatMessage[] {
    return this.chat.append(composeGuestMessages(this.sim, events));
  }
  press(name: string, subject?: string): ChatMessage[] {
    const ev = this.sim.signal(name, subject);
    notePress(this.sim, ev);
    return this.take(ev);
  }
  /** Register, the CAPTCHA, a stock problem, Deposited, scanned in. */
  upload(id: string, name: string): void {
    const out: SimEvent[] = [];
    out.push(...this.sim.createPerson(id, name));
    out.push(...this.sim.signal("captcha answered", id, { passed: true }));
    out.push(...this.sim.signal("captcha answered", id, { passed: false }));
    const p = this.sim.pendingChoiceFor(id);
    if (p && p.length === 5) out.push(...this.sim.choose(id, 0));
    out.push(...this.sim.choose(id, 1));
    this.take(out);
    this.take(this.sim.scan("Norton Anti-Virus", id));
  }
  /** Rounds open, every question can be filed. */
  open(round = 3): void {
    this.sim.setVar("Night.round", String(round));
  }
  /** A 📝 filing, as the server's judge hands it to the story. */
  file(id: string, question: string, verdict: string, confidence = 100): void {
    this.take(this.sim.signal("fact answered", id, { question, answer: "a filed answer", confidence, verdict, ...(verdict === "accurate" ? { key_answer: "the key" } : {}) }));
  }
  /** A host's ✅ or 😤 on a spoken answer to question `q` of `round`. */
  spoken(id: string, press: "judge_accurate" | "judge_confident", round: number, q: number): void {
    this.sim.setVar("Night.round", String(round));
    this.sim.setVar("Night.judging", "true");
    this.sim.setVar("Night.judge_now", String(q));
    this.sim.setVar(`${id}.may_answer`, "true");
    this.press(press, id);
    this.sim.setVar("Night.judging", "false");
  }
  /** A Trabolta-hosted ceremony (the song ending), G1 pressed. */
  ceremony(ending = "song"): void {
    this.sim.setVar("Night.ending", ending);
    this.sim.setVar("Night.ended", "true");
    this.press("start_the_ceremony"); // the first press only asks
    this.press("start_the_ceremony");
  }
}

const desktop = (ms: readonly ChatMessage[]) => ms.filter((m) => m.channel === "loc:The Desktop").map((m) => `${m.from}: ${m.text}`);
const pops = (ms: readonly ChatMessage[], id: string) => ms.filter((m) => m.text.includes("You won Most Questions Correct") && (m.channel === `dm:${id}` || m.audience === id || (Array.isArray(m.audience) && m.audience.includes(id))));
const party = (): Night => {
  const n = new Night();
  n.upload("g1", "Calculator");
  n.upload("g2", "Notepad");
  n.upload("g3", "Minesweeper");
  n.open();
  return n;
};

describe("wave 58: G9a 🏅 on the cue sheet", () => {
  const sheet = () => {
    const sim = Sim.fromSources(SRC);
    const v0 = modView(sim, "open", "x");
    return cueRows(v0.interactions ?? [], v0.cues!);
  };

  it("sits after G9 and before G10 in act G, on the running order, with no subject", () => {
    const rows = sheet();
    const i = rows.findIndex((r) => r.id === "award_most_correct");
    expect(rows[i - 1]!.id).toBe("award_quest_completionist");
    expect(rows[i + 1]!.id).toBe("award_the_painting");
    expect(rows[i]!.code).toBe("G9a");
    expect(rows[i]!.title.startsWith("🏅")).toBe(true);
    expect(rows[i]!.sequence).not.toBe(false);
    expect(rows[i]!.subject ?? false).toBe(false);
    expect(cueActs(rows).find((a) => a.code === "G")!.spine.map((r) => r.id)).toContain("award_most_correct");
  });

  it("refuses before G1, and says so in # hosts", { timeout: SLOW }, () => {
    const n = party();
    const ms = n.press("award_most_correct");
    expect(ms.some((m) => m.text.includes("Start the ceremony (G1) first"))).toBe(true);
    expect(v(n.sim, "Night.award")).toBe("none");
  });
});

describe("wave 58: what counts as a question correct", () => {
  it("a filing that matched the key counts; a confident lie, a guess and an accepted-count never do", { timeout: SLOW }, () => {
    const n = party();
    // Five questions, all in the record, all accepted the same: the most
    // `truths_accepted` of the night, and not one of them true.
    for (const q of ["H4", "H5", "H6", "F1", "F2"]) n.file("g1", q, "lie");
    n.file("g2", "H4", "accurate");
    n.file("g2", "H5", "accurate", 30); // a right answer is right however sure
    n.file("g3", "H4", "uncertain", 40);
    n.ceremony();
    n.press("award_most_correct");
    expect(v(n.sim, "g1.questions_right")).toBe(0);
    expect(v(n.sim, "g2.questions_right")).toBe(2);
    expect(v(n.sim, "g3.questions_right")).toBe(0);
    expect(v(n.sim, "Night.award_winner")).toBe("Notepad");
    expect(v(n.sim, "Night.award_value")).toBe(2);
  });

  it("a spoken answer a host ✅ accepted counts; 😤 doesn't; ✅ taking a 😤 back does", { timeout: SLOW }, () => {
    const n = party();
    n.spoken("g1", "judge_accurate", 1, 1);
    n.spoken("g2", "judge_confident", 1, 1);
    n.spoken("g3", "judge_confident", 1, 2);
    n.spoken("g3", "judge_accurate", 1, 2); // a mis-tap put right
    expect(v(n.sim, "g1.truths_accepted")).toBe(1);
    expect(v(n.sim, "g2.truths_accepted")).toBe(1); // the same to anyone watching
    n.ceremony();
    n.press("award_most_correct");
    expect(v(n.sim, "g1.questions_right")).toBe(1);
    expect(v(n.sim, "g2.questions_right")).toBe(0);
    expect(v(n.sim, "g3.questions_right")).toBe(1);
  });

  it("one question counts once, however many roads it took", { timeout: SLOW }, () => {
    const n = party();
    n.file("g1", "H4", "accurate");
    n.spoken("g1", "judge_accurate", 2, 1);
    expect(v(n.sim, "g1.truths_accepted")).toBeGreaterThanOrEqual(1);
    n.ceremony();
    n.press("award_most_correct");
    expect(v(n.sim, "g1.questions_right")).toBe(1);
  });

  it("a filing still pending counts by its proposal (The Verdict's rule); `marked` (no cup) never does", { timeout: SLOW }, () => {
    const n = party();
    n.sim.setVar("Night.judge_mode", "review");
    n.file("g1", "F1", "accurate");
    n.file("g2", "F1", "lie");
    n.sim.setVar("Night.judge_mode", "auto");
    n.file("g3", "H4", "accurate");
    expect(v(n.sim, "g1.fact_v7")).toBe("pending");
    expect(v(n.sim, "g2.fact_v7")).toBe("pending");
    // The tally settles round 2: no cup, not counted, and Trabolta says so.
    n.take(n.sim.signal("settle_q4", "g3"));
    expect(v(n.sim, "g3.fact_v4")).toBe("marked");
    n.ceremony();
    n.press("award_most_correct");
    expect(v(n.sim, "g1.questions_right")).toBe(1);
    expect(v(n.sim, "g2.questions_right")).toBe(0);
    expect(v(n.sim, "g3.questions_right")).toBe(0);
  });

  it("a director's rehearsal persona and a program who left never win", { timeout: SLOW }, () => {
    const n = party();
    n.file("g1", "H4", "accurate");
    n.file("g1", "H5", "accurate");
    n.file("g2", "H4", "accurate");
    n.file("g2", "H5", "accurate");
    n.file("g3", "H4", "accurate");
    n.sim.setVar("g1.persona", "true");
    n.sim.setVar("g2.gone", "true");
    n.ceremony();
    n.press("award_most_correct");
    expect(v(n.sim, "Night.award_winner")).toBe("Minesweeper");
    expect(v(n.sim, "Night.award_value")).toBe(1);
  });
});

describe("wave 58: a key still owed", () => {
  const facts = parseFactsText(readFileSync(join(scenarioDir("trapped-in-the-internet"), FACTS_FILE), "utf8")).facts!;

  it("the show's own flags are facts.json's, and clear themselves when a key arrives", { timeout: SLOW }, () => {
    const sim = Sim.fromSources(SRC);
    sim.fireBeat("Power On");
    expect(facts.questions).toHaveLength(8);
    for (const q of facts.questions) expect(v(sim, `Night.owed_${q.id.toLowerCase()}`), q.id).toBe(q.placeholder === true);
  });

  it("counts for nobody, not even on a host's ✅, and the rest still decide it", { timeout: SLOW }, () => {
    const n = party();
    n.sim.setVar("Night.owed_h1", "true");
    n.sim.setVar("Night.owed_h2", "true");
    n.sim.setVar("Night.owed_h3", "true");
    // The server passes a filing on an owed key with no verdict: not recorded.
    n.file("g1", "H1", "");
    expect(v(n.sim, "g1.fact_h1")).toBe(false);
    n.spoken("g1", "judge_accurate", 1, 1);
    n.spoken("g1", "judge_accurate", 1, 2);
    n.spoken("g1", "judge_accurate", 1, 3);
    n.open();
    n.file("g2", "H4", "accurate");
    n.ceremony();
    n.press("award_most_correct");
    expect(v(n.sim, "g1.questions_right")).toBe(0);
    expect(v(n.sim, "Night.award_winner")).toBe("Notepad");
    const recap = computeRecap(n.sim);
    expect(recap.lists.questionsRight.find((r) => r.id === "g1")!.value).toBe(0);
    expect(recap.lists.questionsRight.find((r) => r.id === "g2")!.value).toBe(1);
  });

  it("with every owed key unanswered and nobody right, the night still walks on", { timeout: SLOW }, () => {
    const n = party();
    n.ceremony();
    const ms = n.press("award_most_correct");
    expect(v(n.sim, "Night.award_winner")).toBe("Nobody");
    expect(v(n.sim, "Night.award_value")).toBe("none");
    expect(v(n.sim, "Night.screen")).toBe("award_most_correct");
    expect(desktop(ms).join("\n")).toContain("Nobody");
    expect(desktop(ms).join("\n")).not.toContain("{");
    for (const a of ["award_staff_trusted", "award_staff_points", "award_staff_mole"]) n.press(a);
    expect(v(n.sim, "Night.ceremony_done")).toBe(true);
    n.press("resurrection");
    expect(v(n.sim, "Night.resurrected")).toBe(true);
  });
});

describe("wave 58: the award itself", () => {
  it("one winner: the slide, the fanfare, Trabolta's line, their phone alone", { timeout: SLOW }, () => {
    const n = party();
    n.file("g2", "H4", "accurate");
    n.ceremony();
    const before = v(n.sim, "Night.awards_given");
    const ms = n.press("award_most_correct");
    expect(v(n.sim, "Night.award")).toBe("most_correct");
    expect(v(n.sim, "Night.screen")).toBe("award_most_correct");
    expect(v(n.sim, "Night.terminals")).toBe("award_most_correct");
    expect(v(n.sim, "Night.awards_given")).toBe(before + 1);
    const said = desktop(ms).join("\n");
    expect(said).toContain("Trabolta: The special prize of my Truth Scavenger Hunt");
    expect(said).toContain("Notepad");
    expect(pops(ms, "g2")).toHaveLength(1);
    expect(pops(ms, "g1")).toHaveLength(0);
    expect(pops(ms, "g3")).toHaveLength(0);
  });

  it("a tie names everyone in it, they share it, and every phone in it pops", { timeout: SLOW }, () => {
    const n = party();
    n.file("g1", "H4", "accurate");
    n.file("g3", "H4", "accurate");
    n.file("g2", "H4", "uncertain", 50);
    n.ceremony();
    const ms = n.press("award_most_correct");
    expect(v(n.sim, "Night.prize_tied")).toBe(2);
    expect(v(n.sim, "Night.award_winner")).toBe("Calculator and Minesweeper");
    expect(desktop(ms).join("\n")).toContain("A tie. Calculator and Minesweeper. Come up together and share it.");
    expect(pops(ms, "g1")).toHaveLength(1);
    expect(pops(ms, "g3")).toHaveLength(1);
    expect(pops(ms, "g2")).toHaveLength(0);
  });

  it("Clippy reads it after a Trabolta-gone ending; ✍ skips Trabolta's line but not the slide", { timeout: SLOW }, () => {
    const c = party();
    c.file("g1", "H4", "accurate");
    c.sim.setVar("Night.truth_told", "true");
    c.ceremony("destroyed");
    expect(v(c.sim, "Night.ceremony_host")).toBe("Clippy");
    const said = desktop(c.press("award_most_correct")).join("\n");
    expect(said).toContain("Clippy: Award. Most Questions Correct, the special prize of the Truth Scavenger Hunt. The report lists Calculator.");
    expect(said).not.toContain("Trabolta:");

    const t = party();
    t.file("g1", "H4", "accurate");
    t.press("own_award_lines");
    t.ceremony();
    const quiet = t.press("award_most_correct");
    expect(desktop(quiet).filter((l) => l.startsWith("Trabolta:"))).toEqual([]);
    expect(v(t.sim, "Night.screen")).toBe("award_most_correct");
  });

  it("a second press reads the newest numbers", { timeout: SLOW }, () => {
    const n = party();
    n.file("g1", "H4", "accurate");
    n.ceremony();
    n.press("award_most_correct");
    expect(v(n.sim, "Night.award_value")).toBe(1);
    n.sim.setVar("g2.fact_v4", "accurate");
    n.sim.setVar("g2.fact_v5", "accurate");
    n.press("award_most_correct");
    expect(v(n.sim, "Night.award_winner")).toBe("Notepad");
    expect(v(n.sim, "Night.award_value")).toBe(2);
  });
});

describe("wave 58: Trabolta's worker never reads the count", () => {
  it("the count is secret, and nothing is written before the press", { timeout: SLOW }, () => {
    const n = party();
    n.file("g1", "H4", "accurate");
    expect(v(n.sim, "g1.questions_right")).toBe(0);
    n.ceremony();
    expect(v(n.sim, "g1.questions_right")).toBe(0);
    const role = n.sim.model.roles.get(n.sim.persons.get("g1")!.role)!;
    expect(role.secret.has("questions_right")).toBe(true);
  });
});

describe("wave 58: Run's list", () => {
  it("reads live, before the press, and agrees with the story's count", { timeout: SLOW }, () => {
    const n = party();
    n.file("g1", "H4", "accurate");
    n.file("g1", "H5", "lie");
    n.spoken("g1", "judge_accurate", 2, 1); // the same question: still one
    n.spoken("g2", "judge_accurate", 1, 2);
    n.spoken("g3", "judge_confident", 1, 3);
    const live = computeRecap(n.sim).lists.questionsRight;
    expect(live.map((r) => [r.name, r.value, r.rank])).toEqual([
      ["Calculator", 1, 1],
      ["Notepad", 1, 1],
      ["Minesweeper", 0, 3],
    ]);
    expect(computeRecap(n.sim).text).toContain("Questions correct (G9a, the special prize):");
    n.ceremony();
    n.press("award_most_correct");
    for (const r of live) expect(v(n.sim, `${r.id}.questions_right`), r.name).toBe(r.value);
  });
});

describe("wave 58: the TV's slide (the screen state)", () => {
  it("carries a long tie whole, past a moment's clip", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Netscape Navigator");
    n.upload("g2", "Microsoft Excel");
    n.upload("g3", "Encarta 95 Deluxe Edition");
    n.open();
    for (const id of ["g1", "g2", "g3"]) n.file(id, "H4", "accurate");
    n.ceremony();
    n.press("award_most_correct");
    const night = new ScreenWatch({ now: () => 10_000 }).poll(n.sim, { name: "TV", spot: "desktop-tv", view: "tv", character: "" }, () => false).night;
    expect(night.award_winner).toBe("Netscape Navigator, Microsoft Excel and Encarta 95 Deluxe Edition");
    expect(night.award_value).toBe(1);
  });
});
