// Wave 45 on the show: Bathroom Mode at the awards ceremony. Each program
// counts its trips, its story seconds in Bathroom Mode and its on / off
// switches; G13 🚻 The Bathroom Report reads the party's total, the most
// and the least time, the most switches and how many never went; and a
// program that never went loses 5 trust at G1 (THE TRUST FORMULA's
// `no_bath`), back on its first trip.

import { describe, expect, it } from "vitest";
import { scenarioSource } from "../examples/load.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";
import { ChatStore, composeGuestMessages, type ChatMessage } from "../server/chat.ts";
import { notePress } from "../server/views.ts";
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
  }
  take(events: SimEvent[]): ChatMessage[] {
    return this.chat.append(composeGuestMessages(this.sim, events));
  }
  press(name: string, subject?: string): ChatMessage[] {
    const ev = this.sim.signal(name, subject);
    notePress(this.sim, ev);
    return this.take(ev);
  }
  advance(seconds: number): void {
    this.take(this.sim.tick(seconds * 1000));
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
  /** Bathroom Mode for `seconds`, then Back. */
  trip(id: string, seconds: number): void {
    this.press("go to the bathroom", id);
    this.advance(seconds);
    this.press("back from the bathroom", id);
  }
  /** A Trabolta-hosted ceremony (the song ending), G1 pressed. */
  ceremony(ending = "song"): ChatMessage[] {
    this.sim.setVar("Night.ending", ending);
    this.sim.setVar("Night.ended", "true");
    this.press("start_the_ceremony"); // wave 58: the first press only asks
    return this.press("start_the_ceremony");
  }
}

const trust = (n: Night, id: string) => v(n.sim, `${id}.trust`) as number;
const desktop = (ms: readonly ChatMessage[]) => ms.filter((m) => m.channel === "loc:The Desktop").map((m) => `${m.from}: ${m.text}`);

describe("wave 45: what Bathroom Mode counts", () => {
  it("trips, seconds and real switches; a repeat press while away banks the time; the timeout ends a trip", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.trip("g1", 300);
    expect(v(n.sim, "g1.bath_trips")).toBe(1);
    expect(v(n.sim, "g1.bath_s")).toBe(300);
    expect(v(n.sim, "g1.bath_presses")).toBe(2);
    expect(v(n.sim, "g1.bath_open")).toBe(0);
    // Back while not away: no switch.
    n.press("back from the bathroom", "g1");
    expect(v(n.sim, "g1.bath_presses")).toBe(2);
    // A repeat 🚻 while away (a stale button): one trip, no time lost.
    n.press("go to the bathroom", "g1");
    n.advance(60);
    n.press("go to the bathroom", "g1");
    n.advance(30);
    n.press("back from the bathroom", "g1");
    expect(v(n.sim, "g1.bath_trips")).toBe(2);
    expect(v(n.sim, "g1.bath_s")).toBe(390);
    expect(v(n.sim, "g1.bath_presses")).toBe(4);
    // The 15-minute timeout closes the trip at its own time.
    n.press("go to the bathroom", "g1");
    n.advance(1000);
    expect(v(n.sim, "g1.afk")).toBe(false);
    expect(v(n.sim, "g1.bath_s")).toBe(1390);
    expect(v(n.sim, "g1.bath_open")).toBe(0);
    expect(v(n.sim, "g1.bath_presses")).toBe(5);
  });
});

describe("wave 45: no bathroom, less trust", () => {
  it("G1 takes 5 from a program that never went, nobody else; a first trip gives it back", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.upload("g2", "Notepad");
    n.trip("g1", 60);
    const before = { g1: trust(n, "g1"), g2: trust(n, "g2") };
    n.ceremony();
    expect(v(n.sim, "Night.ceremony")).toBe(true);
    expect(v(n.sim, "g2.no_bath")).toBe(1);
    expect(trust(n, "g2")).toBe(before.g2 - 5);
    expect(v(n.sim, "g1.no_bath")).toBe(0);
    expect(trust(n, "g1")).toBe(before.g1);
    // The formula keeps it through a recompute (Trabolta's assess power).
    const ms = n.press("go to the bathroom", "g2");
    expect(v(n.sim, "g2.no_bath")).toBe(0);
    expect(trust(n, "g2")).toBe(before.g2);
    expect(ms.some((m) => m.from === "Trabolta" && m.text.includes("Your trust is restored"))).toBe(true);
  });

  it("never before the ceremony", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.advance(3600);
    expect(v(n.sim, "g1.no_bath")).toBe(0);
  });
});

describe("wave 45: G13 🚻 The Bathroom Report", () => {
  function party(): Night {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.upload("g2", "Notepad");
    n.upload("g3", "Minesweeper");
    n.upload("g4", "Paint Shop");
    n.trip("g1", 300);
    n.trip("g1", 70);
    n.trip("g1", 5);
    n.trip("g2", 100);
    n.trip("g4", 100);
    return n;
  }

  it("is appended last in act G as an aside, live only during the ceremony", () => {
    const sim = Sim.fromSources(SRC);
    const admin = [...sim.model.interactions.values()].filter((i) => i.who === "admin");
    // Wave 48: 🔑 G14 is appended after it; wave 50: 🌀, on Anytime, after that; wave 53: ⏭.
    const last = admin[admin.length - 4]!;
    expect(last.id).toBe("bathroom_report");
    expect(last.label.startsWith("G13 · 🚻")).toBe(true);
  });

  it("refuses before G1", { timeout: SLOW }, () => {
    const n = new Night();
    const ms = n.press("bathroom_report");
    expect(ms.some((m) => m.channel === "room:hosts" && m.text.includes("Start the ceremony (G1) first"))).toBe(true);
    expect(v(n.sim, "Night.bath_reported")).toBe(0);
  });

  it("reads the total, most, least (ties named together), the most switches and the never-wents", { timeout: SLOW }, () => {
    const n = party();
    n.ceremony();
    const ms = n.press("bathroom_report");
    expect(v(n.sim, "Night.bath_programs")).toBe(4);
    expect(v(n.sim, "Night.bath_goers")).toBe(3);
    expect(v(n.sim, "Night.bath_never")).toBe(1);
    expect(v(n.sim, "Night.bath_trips")).toBe(5);
    expect(v(n.sim, "Night.bath_total_s")).toBe(575);
    expect(v(n.sim, "Night.bath_total_m")).toBe(10);
    expect(v(n.sim, "Night.bath_most")).toBe("Calculator");
    expect(v(n.sim, "Night.bath_most_m")).toBe(6);
    expect(v(n.sim, "Night.bath_least")).toBe("Notepad and Paint Shop");
    expect(v(n.sim, "Night.bath_least_s")).toBe(100);
    expect(v(n.sim, "Night.bath_least_m")).toBe(2);
    expect(v(n.sim, "Night.bath_toggler")).toBe("Calculator");
    expect(v(n.sim, "Night.bath_toggles")).toBe(6);
    expect(v(n.sim, "Night.screen")).toBe("award_bathroom");
    expect(v(n.sim, "Night.terminals")).toBe("award_bathroom");
    const said = desktop(ms);
    expect(said[0]).toMatch(/^Trabolta: A bonus section\. The Bathroom Report\./u);
    expect(said).toContain("Trabolta: Most time in Disk Cleanup. Minutes: 6. Calculator. I did not ask what you were doing. I logged it.");
    expect(said).toContain("Trabolta: Least time, of those who went. Minutes: 2. Notepad and Paint Shop. Efficient. Suspiciously efficient.");
    expect(said.some((l) => l.includes("never once visited Disk Cleanup tonight: 1."))).toBe(true);
    // The one who never went hears it in their own thread, once.
    const told = n.chat.all().filter((m) => m.from === "Trabolta" && m.text.includes("You did not visit Disk Cleanup once tonight"));
    expect(told).toHaveLength(1);
    expect(told[0]!.audience).toEqual(["g3"]);
    n.press("bathroom_report");
    expect(n.chat.all().filter((m) => m.from === "Trabolta" && m.text.includes("You did not visit Disk Cleanup once tonight"))).toHaveLength(1);
  });

  it("counts an open trip up to now; a press again reads the newest numbers", { timeout: SLOW }, () => {
    const n = party();
    n.ceremony();
    n.press("go to the bathroom", "g3");
    n.advance(200);
    n.press("bathroom_report");
    expect(v(n.sim, "g3.afk")).toBe(true);
    expect(v(n.sim, "Night.bath_goers")).toBe(4);
    expect(v(n.sim, "Night.bath_never")).toBe(0);
    expect(v(n.sim, "Night.bath_total_s")).toBe(775);
    expect(v(n.sim, "Night.bath_least")).toBe("Notepad and Paint Shop");
    n.advance(400);
    const again = desktop(n.press("bathroom_report"));
    expect(v(n.sim, "Night.bath_most")).toBe("Minesweeper");
    expect(v(n.sim, "Night.bath_most_m")).toBe(10);
    expect(again).toContain("Trabolta: Every program here visited Disk Cleanup at least once. Clean processes. I trust that.");
  });

  it("with one goer reads no least; with nobody, the whole party loses trust and hears so", { timeout: SLOW }, () => {
    const one = new Night();
    one.upload("g1", "Calculator");
    one.upload("g2", "Notepad");
    one.trip("g1", 30);
    one.ceremony();
    const said = desktop(one.press("bathroom_report"));
    expect(said.some((l) => l.includes("Least time"))).toBe(false);
    expect(v(one.sim, "Night.bath_most_m")).toBe(1);

    const none = new Night();
    none.upload("g1", "Calculator");
    none.ceremony();
    const quiet = desktop(none.press("bathroom_report"));
    expect(quiet.some((l) => l.includes("Nobody used Bathroom Mode tonight"))).toBe(true);
    expect(v(none.sim, "Night.bath_most")).toBe("none");
  });

  it("Clippy reads it after destroyed; ✍ skips Trabolta's lines but not the slide", { timeout: SLOW }, () => {
    const c = party();
    c.ceremony("destroyed");
    const said = desktop(c.press("bathroom_report"));
    expect(said.length).toBeGreaterThan(3);
    expect(said.every((l) => l.startsWith("Clippy: "))).toBe(true);
    // Switched off: Trabolta tells nobody in a thread.
    expect(c.chat.all().some((m) => m.from === "Trabolta" && m.text.includes("You did not visit Disk Cleanup"))).toBe(false);

    const d = party();
    d.ceremony();
    d.press("own_award_lines");
    expect(desktop(d.press("bathroom_report"))).toEqual([]);
    expect(v(d.sim, "Night.screen")).toBe("award_bathroom");
  });
});

describe("wave 45: the TV's Bathroom Report slide (the screen state)", () => {
  const WHO = { name: "TV", spot: "desktop-tv", view: "tv", character: "" };
  it("carries the report only while award_bathroom is up; the least only with two or more who went", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.upload("g2", "Notepad");
    n.upload("g3", "Minesweeper");
    n.trip("g1", 300);
    n.trip("g2", 100);
    n.ceremony();
    const w = new ScreenWatch({ now: () => 10_000 });
    const poll = () => w.poll(n.sim, WHO, () => false).night;
    expect(poll().bathroom).toBeUndefined();
    n.press("bathroom_report");
    expect(poll().bathroom).toEqual({ goers: 2, never: 1, total_s: 400, most: "Calculator", most_s: 300, least: "Notepad", least_s: 100, toggler: "Calculator and Notepad", toggles: 2 });
    n.press("award_most_trusted", "g1");
    expect(poll().bathroom).toBeUndefined();
    expect(poll().award_winner).toBe("Calculator");

    const one = new Night();
    one.upload("g1", "Calculator");
    one.trip("g1", 30);
    one.ceremony();
    one.press("bathroom_report");
    const w1 = new ScreenWatch({ now: () => 10_000 });
    expect(w1.poll(one.sim, WHO, () => false).night.bathroom).toMatchObject({ goers: 1, most: "Calculator", least: null, least_s: 0 });
  });
});

describe("wave 45: the director's recap", () => {
  it("lists minutes (an open trip up to now) and switches off the story's counters, and who never went", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.upload("g2", "Notepad");
    n.upload("g3", "Minesweeper");
    n.trip("g1", 300);
    n.trip("g1", 70);
    n.press("go to the bathroom", "g2");
    n.advance(130);
    const r = computeRecap(n.sim);
    expect(r.lists.bathroomMinutes.map((x) => [x.name, x.value, x.rank])).toEqual([["Calculator", 6, 1], ["Notepad", 2, 2], ["Minesweeper", 0, 3]]);
    expect(r.lists.bathroomSwitches.map((x) => [x.name, x.value])).toEqual([["Calculator", 4], ["Notepad", 1], ["Minesweeper", 0]]);
    expect(r.lists.bathroom.find((x) => x.id === "g2")?.value).toBe(1);
    expect(r.totals.bathroomMinutes).toBe(8);
    expect(r.bathroomNever).toEqual([{ id: "g3", name: "Minesweeper" }]);
    expect(r.text).toContain("Minutes in Bathroom Mode:\n  1. Calculator — 6\n  2. Notepad — 2");
    expect(r.text).toContain("Never went to the bathroom (−5 trust): Minesweeper");
    expect(r.text).toContain("8 bathroom minutes");
  });
});
