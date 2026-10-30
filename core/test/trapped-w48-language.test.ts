// Wave 48 on the show: the Password Manager's filter. The server fires
// `swear_flagged` for each guest line with a swear stem and
// `swear_censored` for her ✂ (both covered in w48-filter-server.test.ts);
// here the story's side: the counts, the mark, her booth's replies, and G14
// 🔑 The Language Report at the ceremony (lines and the TV's block).

import { describe, expect, it } from "vitest";
import { scenarioSource } from "../examples/load.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";
import { ChatStore, composeGuestMessages, type ChatMessage } from "../server/chat.ts";
import { notePress } from "../server/views.ts";
import { ScreenWatch } from "../server/routes/screen.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const SLOW = 120_000;
const PM = "Password Manager";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => (sim.world.get(p) as { value?: unknown } | undefined)?.value;

class Night {
  readonly sim = Sim.fromSources(SRC);
  readonly chat = new ChatStore();
  private seq = 1000;
  constructor() {
    this.take(this.sim.fireBeat("Power On"));
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
  /** What the server journals for a flagged line. */
  flag(id: string, words: string[]): number {
    const seq = this.seq++;
    this.take(this.sim.signal("swear_flagged", id, { message: seq, words: words.length, list: words.join(", ") }));
    return seq;
  }
  /** The Password Manager's ✂ (`fresh`: the words nobody censored before). */
  censor(id: string, seq: number, words: string[], fresh: string[]): ChatMessage[] {
    return this.take(this.sim.signal("swear_censored", id, { message: seq, words: words.length, list: words.join(", "), fresh: fresh.join(", ") }, PM));
  }
  /** A Trabolta-hosted ceremony (the song ending), G1 pressed. */
  ceremony(ending = "song"): ChatMessage[] {
    this.sim.setVar("Night.ending", ending);
    this.sim.setVar("Night.ended", "true");
    return this.press("start_the_ceremony");
  }
}

const desktop = (ms: readonly ChatMessage[]) => ms.filter((m) => m.channel === "loc:The Desktop").map((m) => `${m.from}: ${m.text}`);
const booth = (ms: readonly ChatMessage[]) => ms.filter((m) => m.readout === true && Array.isArray(m.audience) && m.audience.includes(`@${PM}`)).map((m) => m.text);

describe("wave 48: the filter's counts and the censor's mark", () => {
  it("names the Password Manager the censor", () => {
    expect(Sim.fromSources(SRC).model.censor).toBe(PM);
  });

  it("counts the caught words per program and for the night, silently", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    const before = n.chat.length;
    n.flag("g1", ["hello", "password"]);
    n.flag("g1", ["check"]);
    expect(v(n.sim, "g1.lang_flagged")).toBe(3);
    expect(v(n.sim, "Night.lang_flagged")).toBe(3);
    expect(n.chat.length).toBe(before);
  });

  it("✂ counts, keeps each censored word once, marks a loose program and tells her booth", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    const a = n.flag("g1", ["hello", "password"]);
    const ms = n.censor("g1", a, ["hello", "password"], ["hello", "password"]);
    expect(v(n.sim, "g1.lang_censored")).toBe(2);
    expect(v(n.sim, "Night.lang_censored")).toBe(2);
    expect(v(n.sim, "Night.lang_words")).toBe("hello, password");
    expect(v(n.sim, "g1.marked")).toBe(true);
    expect(v(n.sim, "g1.marked_for")).toBe("censored: hello, password");
    expect(booth(ms)).toContain("✂ Censored Calculator: hello, password. Marked for reinstallation.");
    // The program hears the mark, with why.
    expect(ms.some((m) => Array.isArray(m.audience) && m.audience.includes("g1") && m.text.includes("You are marked for reinstallation (censored: hello, password)"))).toBe(true);
    // Again on a marked program: counted, no second mark, no # hosts noise.
    const b = n.flag("g1", ["hello", "butt"]);
    const again = n.censor("g1", b, ["hello", "butt"], ["butt"]);
    expect(v(n.sim, "Night.lang_words")).toBe("hello, password, butt");
    expect(v(n.sim, "Night.lang_censored")).toBe(4);
    expect(booth(again)).toContain("✂ Censored Calculator: hello, butt. They were already marked for reinstallation.");
    expect(again.some((m) => m.channel === "room:hosts")).toBe(false);
    // A line with nothing fresh adds no word.
    const c = n.flag("g1", ["hello"]);
    n.censor("g1", c, ["hello"], []);
    expect(v(n.sim, "Night.lang_words")).toBe("hello, password, butt");
  });

  it("after the ending it only counts", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.ceremony();
    const s = n.flag("g1", ["crap"]);
    const ms = n.censor("g1", s, ["crap"], ["crap"]);
    expect(v(n.sim, "g1.marked")).not.toBe(true);
    expect(v(n.sim, "Night.lang_censored")).toBe(1);
    expect(booth(ms)).toContain("✂ Censored Calculator: crap. The night is over, so no mark; it counts for the Language Report.");
  });
});

describe("wave 48: G14 🔑 The Language Report", () => {
  const party = () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.upload("g2", "Notepad");
    n.upload("g3", "Minesweeper");
    const a = n.flag("g1", ["hello", "password"]);
    n.flag("g2", ["check", "button"]);
    n.flag("g3", ["hello"]);
    n.censor("g1", a, ["hello", "password"], ["hello", "password"]);
    return n;
  };

  it("is appended last in act G as an aside, after G13", () => {
    const sim = Sim.fromSources(SRC);
    const admin = [...sim.model.interactions.values()].filter((i) => i.who === "admin");
    expect(admin.map((i) => i.id).slice(-2)).toEqual(["bathroom_report", "language_report"]);
    expect(admin[admin.length - 1]!.label.startsWith("G14 · 🔑")).toBe(true);
  });

  it("refuses before G1", { timeout: SLOW }, () => {
    const n = new Night();
    const ms = n.press("language_report");
    expect(ms.some((m) => m.channel === "room:hosts" && m.text.includes("Start the ceremony (G1) first"))).toBe(true);
    expect(v(n.sim, "Night.lang_reported")).toBe(0);
  });

  it("reads who cursed the most (ties together), n of m censored and every censored word", { timeout: SLOW }, () => {
    const n = party();
    n.ceremony();
    const said = desktop(n.press("language_report"));
    expect(v(n.sim, "Night.lang_curser")).toBe("Calculator and Notepad");
    expect(v(n.sim, "Night.lang_curses")).toBe(2);
    expect(v(n.sim, "Night.screen")).toBe("award_language");
    expect(v(n.sim, "Night.terminals")).toBe("award_language");
    expect(said[0]).toMatch(/^Trabolta: A bonus section\. The Language Report\./u);
    expect(said).toContain("Trabolta: My filter caught this many words: 5. The Password Manager censored 2 of them.");
    expect(said).toContain("Trabolta: The program that cursed the most tonight. Words caught: 2. Calculator and Notepad. I heard every one.");
    expect(said).toContain("Trabolta: The words that were censored. I will say them once, so you know what was taken from you: hello, password.");
  });

  it("with nothing caught says so; with nothing censored says that", { timeout: SLOW }, () => {
    const none = new Night();
    none.upload("g1", "Calculator");
    none.ceremony();
    const quiet = desktop(none.press("language_report"));
    expect(quiet.some((l) => l.includes("My filter caught nothing"))).toBe(true);
    expect(quiet.some((l) => l.includes("cursed the most"))).toBe(false);

    const kept = new Night();
    kept.upload("g1", "Calculator");
    kept.flag("g1", ["hello"]);
    kept.ceremony();
    const said = desktop(kept.press("language_report"));
    expect(said).toContain("Trabolta: The Password Manager censored nothing. Every word stood. I noticed.");
  });

  it("Clippy reads it after destroyed; ✍ skips Trabolta's lines but not the slide", { timeout: SLOW }, () => {
    const c = party();
    c.ceremony("destroyed");
    const said = desktop(c.press("language_report"));
    expect(said.length).toBeGreaterThan(3);
    expect(said.every((l) => l.startsWith("Clippy: "))).toBe(true);
    expect(said).toContain("Clippy: The censored words, for the record: hello, password.");

    const d = party();
    d.ceremony();
    d.press("own_award_lines");
    expect(desktop(d.press("language_report"))).toEqual([]);
    expect(v(d.sim, "Night.screen")).toBe("award_language");
  });
});

describe("wave 48: the TV's Language Report slide (the screen state)", () => {
  const WHO = { name: "TV", spot: "desktop-tv", view: "tv", character: "" };
  it("carries the report only while award_language is up", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.upload("g2", "Notepad");
    const a = n.flag("g1", ["hello", "password"]);
    n.flag("g2", ["check"]);
    n.censor("g1", a, ["hello", "password"], ["hello", "password"]);
    n.ceremony();
    const w = new ScreenWatch({ now: () => 10_000 });
    const poll = () => w.poll(n.sim, WHO, () => false).night;
    expect(poll().language).toBeUndefined();
    n.press("language_report");
    expect(poll().language).toEqual({ flagged: 3, censored: 2, curser: "Calculator", curses: 2, words: ["hello", "password"], more: 0 });
    n.press("award_most_trusted", "g1");
    expect(poll().language).toBeUndefined();
  });

  it("lists at most 60 words and counts the rest; nobody reads null", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.sim.setVar("g1.cleared", "false");
    const words = Array.from({ length: 65 }, (_, i) => `hell${i}`);
    const s = n.flag("g1", words);
    n.censor("g1", s, words, words);
    n.ceremony();
    n.press("language_report");
    const w = new ScreenWatch({ now: () => 10_000 });
    const lang = w.poll(n.sim, WHO, () => false).night.language!;
    expect(lang.words).toHaveLength(60);
    expect(lang.more).toBe(5);
    expect(lang.curser).toBeNull();
  });
});
