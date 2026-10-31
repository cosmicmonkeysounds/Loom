// Wave 48 / 48b on the show: the Password Manager's filter. The server
// fires `swear_flagged` for each guest line the filter catches,
// `swear_censored` for her ✂ and `swear_filter` for her strength slider
// (all covered in w48-filter-server.test.ts); here the story's side: the
// counts, her ⭐, the program's suspicion and notice (no mark since 48b),
// her booth's replies, and G14 🔑 The Language Report at the ceremony
// (lines and the TV's block).

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
  /** The Password Manager's ✂ (`fresh`: the words nobody censored before),
   *  as the server journals it: what it paid, the top words. */
  censor(id: string, seq: number, words: string[], fresh: string[], pay: Partial<Record<"unsaid" | "points" | "stars" | "distinct", number>> & { mult?: number; top?: string } = {}): ChatMessage[] {
    const points = pay.points ?? words.length;
    const mult = pay.mult ?? 3;
    const args = { message: seq, words: words.length, list: words.join(", "), fresh: fresh.join(", "), unsaid: pay.unsaid ?? 0, points, mult, stars: pay.stars ?? Math.floor(points * mult), top: pay.top ?? fresh.join(", "), distinct: pay.distinct ?? fresh.length, heat: 1, heat_at: 0 };
    return this.take(this.sim.signal("swear_censored", id, args, PM));
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

describe("wave 48: the filter's counts, the censor's ⭐ and the program's suspicion", () => {
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

  it("✂ counts and pays her, raises their suspicion, sends them a notice and never marks them (48b)", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    const doubt = v(n.sim, "g1.doubt") as number;
    const score = v(n.sim, `${PM}.score`) as number;
    const a = n.flag("g1", ["hello", "password"]);
    const ms = n.censor("g1", a, ["hello", "password"], ["hello", "password"], { points: 2, mult: 3, stars: 6 });
    expect(v(n.sim, "g1.lang_censored")).toBe(2);
    expect(v(n.sim, "Night.lang_censored")).toBe(2);
    expect(v(n.sim, "Night.lang_top")).toBe("hello, password");
    expect(v(n.sim, "Night.lang_distinct")).toBe(2);
    expect(v(n.sim, "Night.lang_stars")).toBe(6);
    expect(v(n.sim, `${PM}.score`)).toBe(score + 6);
    expect(v(n.sim, "g1.doubt")).toBe(doubt + 5);
    expect(v(n.sim, "g1.marked")).not.toBe(true);
    expect(booth(ms)).toContain(`✂ Censored Calculator: hello, password. 2 × 3 = ⭐ +6. Their suspicion: ${doubt + 5}/100.`);
    expect(ms.some((m) => Array.isArray(m.audience) && m.audience.includes("g1") && m.text.includes("Automated notice: a message you sent was censored for language (hello, password). This incident has been logged."))).toBe(true);
    expect(ms.some((m) => m.text.includes("marked for reinstallation"))).toBe(false);
    // At ×¼ a hello pays nothing; suspicion stops at 100.
    n.sim.setVar("g1.doubt", "98");
    const b = n.flag("g1", ["hello"]);
    const again = n.censor("g1", b, ["hello"], [], { points: 1, mult: 0.25, stars: 0, top: "hello, password", distinct: 2 });
    expect(booth(again)).toContain("✂ Censored Calculator: hello. 1 × 0.25 = ⭐ +0. Their suspicion: 100/100.");
    expect(v(n.sim, "g1.doubt")).toBe(100);
    expect(v(n.sim, "Night.lang_stars")).toBe(6);
  });

  it("counts a slur without naming it", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    const s = n.flag("g1", ["[slur]"]);
    const ms = n.censor("g1", s, ["[slur]"], [], { unsaid: 1, points: 12, stars: 36, top: "", distinct: 0 });
    expect(v(n.sim, "Night.lang_unsaid")).toBe(1);
    expect(v(n.sim, "Night.lang_top")).toBe("none");
    expect(booth(ms)).toContain(`✂ Censored Calculator: [slur]. 12 × 3 = ⭐ +36. Their suspicion: ${v(n.sim, "g1.doubt")}/100.`);
  });

  it("after the ending it counts and notices, but pays nothing", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.ceremony();
    const score = v(n.sim, `${PM}.score`) as number;
    const s = n.flag("g1", ["crap"]);
    const ms = n.censor("g1", s, ["crap"], ["crap"], { points: 3, stars: 9 });
    expect(v(n.sim, "g1.marked")).not.toBe(true);
    expect(v(n.sim, "Night.lang_censored")).toBe(1);
    expect(v(n.sim, `${PM}.score`)).toBe(score);
    expect(booth(ms)).toContain("✂ Censored Calculator: crap. The night is over: no ⭐. It counts for the Language Report.");
  });

  it("keeps where she left the strength", { timeout: SLOW }, () => {
    const n = new Night();
    expect(v(n.sim, "Night.lang_level")).toBe(100);
    n.take(n.sim.signal("swear_filter", PM, { level: 25, was: 100 }, PM));
    expect(v(n.sim, "Night.lang_level")).toBe(25);
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
    n.censor("g1", a, ["hello", "password"], ["hello", "password"], { points: 2, mult: 3, stars: 6 });
    return n;
  };

  it("is appended last in act G as an aside, after G13", () => {
    const sim = Sim.fromSources(SRC);
    const admin = [...sim.model.interactions.values()].filter((i) => i.who === "admin");
    // Wave 50: 🌀 is appended after it, on Anytime; wave 53: ⏭ after that; wave 58: 🔒 🔓.
    expect(admin.map((i) => i.id).slice(-6)).toEqual(["bathroom_report", "language_report", "dream_toggle", "wave_staff_through", "trabolta_music_lock", "trabolta_music_unlock"]);
    expect(admin[admin.length - 5]!.label.startsWith("G14 · 🔑")).toBe(true);
  });

  it("refuses before G1", { timeout: SLOW }, () => {
    const n = new Night();
    const ms = n.press("language_report");
    expect(ms.some((m) => m.channel === "room:hosts" && m.text.includes("Start the ceremony (G1) first"))).toBe(true);
    expect(v(n.sim, "Night.lang_reported")).toBe(0);
  });

  it("reads who cursed the most (ties together), n of m censored, the top words and the strength", { timeout: SLOW }, () => {
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
    expect(said).toContain("Trabolta: The words censored most: hello, password. All 2 different words are on the screen. I would not look at them for long.");
    expect(said).toContain("Trabolta: My filter ran at full strength all night. At full strength, even her own name is a swear.");
    expect(said.some((l) => l.includes("will not say"))).toBe(false);
  });

  it("never reads a slur: it counts them", { timeout: SLOW }, () => {
    const n = party();
    const s = n.flag("g2", ["[slur]"]);
    n.censor("g2", s, ["[slur]"], [], { unsaid: 1, points: 12, top: "hello, password", distinct: 2 });
    n.take(n.sim.signal("swear_filter", PM, { level: 25, was: 100 }, PM));
    n.ceremony();
    const said = desktop(n.press("language_report"));
    expect(said).toContain("Trabolta: Words I will not say: 1. Some words should stay in the filter.");
    expect(said.some((l) => l.includes("[slur]"))).toBe(false);
    expect(said.some((l) => l.includes("full strength"))).toBe(false);
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
    c.take(c.sim.signal("swear_filter", PM, { level: 40, was: 100 }, PM));
    c.ceremony("destroyed");
    const said = desktop(c.press("language_report"));
    expect(said.length).toBeGreaterThan(3);
    expect(said.every((l) => l.startsWith("Clippy: "))).toBe(true);
    expect(said).toContain("Clippy: Different words censored: 2. The most censored: hello, password. The rest are on the screen. Please do not read the screen out loud.");
    expect(said).toContain("Clippy: The Password Manager earned 6 stars censoring you. She was having a great time.");
    expect(said).toContain("Clippy: She left the filter at 40 percent. She found the dial!");

    const d = party();
    d.ceremony();
    d.press("own_award_lines");
    expect(desktop(d.press("language_report"))).toEqual([]);
    expect(v(d.sim, "Night.screen")).toBe("award_language");
  });
});

describe("wave 48: the TV's Language Report slide (the screen state)", () => {
  const WHO = { name: "TV", spot: "desktop-tv", view: "tv", character: "" };
  const book = { words: [{ word: "hello", n: 3 }, { word: "password", n: 1 }], unsaid: 2, level: 40, stars: 18 };
  const extras = { language: () => book };

  it("carries the report only while award_language is up, words from the server's book", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.upload("g2", "Notepad");
    const a = n.flag("g1", ["hello", "password"]);
    n.flag("g2", ["check"]);
    n.censor("g1", a, ["hello", "password"], ["hello", "password"]);
    n.ceremony();
    const w = new ScreenWatch({ now: () => 10_000 });
    const poll = () => w.poll(n.sim, WHO, () => false, [], null, null, extras).night;
    expect(poll().language).toBeUndefined();
    n.press("language_report");
    expect(poll().language).toEqual({ flagged: 3, censored: 2, curser: "Calculator", curses: 2, words: ["hello", "password"], counts: [3, 1], more: 0, unsaid: 2, level: 40, stars: 18 });
    n.press("award_most_trusted", "g1");
    expect(poll().language).toBeUndefined();
  });

  it("lists at most 400 words and counts the rest; nobody reads null; no book reads empty", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.sim.setVar("g1.cleared", "false");
    const s = n.flag("g1", ["hell"]);
    n.censor("g1", s, ["hell"], ["hell"]);
    n.ceremony();
    n.press("language_report");
    const many = { words: Array.from({ length: 405 }, (_, i) => ({ word: `hell${i}`, n: 1 })), unsaid: 0, level: 100, stars: 0 };
    const w = new ScreenWatch({ now: () => 10_000 });
    const lang = w.poll(n.sim, WHO, () => false, [], null, null, { language: () => many }).night.language!;
    expect(lang.words).toHaveLength(400);
    expect(lang.counts).toHaveLength(400);
    expect(lang.more).toBe(5);
    expect(lang.curser).toBeNull();
    const bare = w.poll(n.sim, WHO, () => false).night.language!;
    expect(bare).toMatchObject({ words: [], counts: [], more: 0, unsaid: 0, level: 100, stars: 0 });
  });
});
