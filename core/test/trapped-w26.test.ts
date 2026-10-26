//! Trapped in the Internet — wave 26 (story lane).
//!
//! - R1 / C1 / C2: the `lock:` header, the capture and CORRUPTION DETECTED
//!   moments with only the pass and Bathroom Mode (`ack: none`), the Find
//!   Gerald card, no menu on a locked phone.
//! - C9: the trust formula at every recompute site, the three game moments
//!   (escape, heart, pickup) and their hooks; the escape and heart lines are
//!   game-only.
//! - T2 / C3: the glitch at the ad hijack.
//! - D1: one Dare path, the Dare Chosen scene, the loud order, the dared
//!   phone's big moment.
//! - B1–B5: a guest's BINGO, the exact undo, 🤐 names nobody, one round.
//! - G1: no hints in the show text.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { ChatStore, composeGuestMessages, momentLines, type ChatMessage } from "../server/chat.ts";
import { cueState, guestCardView, guestView, isLocked, modView, nightView, notePress, objectivesFor, primeView } from "../server/views.ts";
import { cueRows } from "../src/cue-sheet.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const DIR = new URL("../examples/trapped-in-the-internet/", import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, DIR), "utf8");
const SLOW = 120_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};

class Night {
  readonly sim = Sim.fromSources(SRC);
  readonly chat = new ChatStore();
  readonly events: SimEvent[] = [];
  constructor() {
    this.take(this.sim.fireBeat("Power On"));
  }
  take(events: SimEvent[]): ChatMessage[] {
    this.events.push(...events);
    return this.chat.append(composeGuestMessages(this.sim, events));
  }
  signal(name: string, subject?: string, args?: Record<string, unknown>, actor?: string): ChatMessage[] {
    const ev = this.sim.signal(name, subject, args as never, actor);
    notePress(this.sim, ev);
    return this.take(ev);
  }
  /** The raw SimEvents of one signal (for `momentLines`). */
  raw(name: string, subject?: string, args?: Record<string, unknown>, actor?: string): SimEvent[] {
    const ev = this.sim.signal(name, subject, args as never, actor);
    notePress(this.sim, ev);
    this.take(ev);
    return ev;
  }
  press(name: string, subject?: string, actor?: string): ChatMessage[] {
    return this.signal(name, subject, undefined, actor);
  }
  advance(seconds: number): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = 0; i < seconds; i++) out.push(...this.take(this.sim.tick(1000)));
    return out;
  }
  scan(scanner: string, id: string): ChatMessage[] {
    return this.take(this.sim.scan(scanner, id));
  }
  upload(id: string, name: string, scanner: string | null = "Norton Anti-Virus"): ChatMessage[] {
    const out: ChatMessage[] = [];
    out.push(...this.take(this.sim.createPerson(id, name)));
    out.push(...this.signal("captcha answered", id, { passed: true }));
    out.push(...this.signal("captcha answered", id, { passed: false }));
    const p = this.sim.pendingChoiceFor(id);
    if (p && p.length === 4) out.push(...this.take(this.sim.choose(id, 0)));
    out.push(...this.take(this.sim.choose(id, 0)));
    if (scanner !== null) out.push(...this.scan(scanner, id));
    return out;
  }
}

const PROGRAMS: [string, string][] = [
  ["g1", "Calculator"],
  ["g2", "Microsoft Excel"],
  ["g3", "OpenOffice"],
  ["g4", "MS Paint"],
  ["g5", "Winamp"],
  ["g6", "VLC"],
];
const TO_BINGO = ["call_to_the_desktop", "start_the_bingo", "bingo_time"];
const TO_TRUTH_1 = [...TO_BINGO, "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth"];
const TO_RESULTS = [...TO_TRUTH_1, "close_the_filing", "read_the_results", "read_the_results", "read_the_results"];

function boot(): Night {
  const n = new Night();
  for (const [id, name] of PROGRAMS) n.upload(id, name);
  return n;
}
const to = (ms: readonly ChatMessage[], id: string) => ms.filter((m) => m.audience === "all" || (Array.isArray(m.audience) && m.audience.includes(id)));
const readouts = (ms: readonly ChatMessage[], who: string) => ms.filter((m) => m.channel === `dm:${who}` && m.readout === true);
const text = (ms: readonly ChatMessage[]) => ms.map((m) => m.text).join("\n");

/** Mark a program and confront + capture it (an Antivirus' scan, then 🛡). */
function capture(n: Night, id: string): { confront: ChatMessage[]; capture: ChatMessage[] } {
  if (v(n.sim, `${id}.marked`) !== true) n.signal("mark_for_reinstallation", id, { reason: "flagged by a host" });
  const confront = n.signal("confronted", id, { hunter: "Norton Anti-Virus" });
  const cap = n.signal("send to the internet", id, undefined, "Norton Anti-Virus");
  return { confront, capture: cap };
}

describe("Trapped in the Internet — wave 26: the locked phone (R1, C1, C2)", () => {
  it("the story declares `lock:` beside `reinstall:`", () => {
    const m = Sim.fromSources(SRC).model;
    expect(m.lock).toBe("program.corrupted == true and Night.banish != true and Night.ended != true");
    expect(read("main.loom")).toMatch(/^reinstall: [^\n]+\nlock: program\.corrupted == true and Night\.banish != true and Night\.ended != true$/mu);
  }, SLOW);

  it("the capture and CORRUPTION DETECTED moments offer only the pass and Bathroom Mode, with no OK", () => {
    const n = boot();
    for (const c of TO_BINGO) n.press(c);
    const { confront, capture: cap } = capture(n, "g5");
    const detected = to(confront, "g5").find((m) => m.text.includes("CORRUPTION DETECTED"));
    const sent = to(cap, "g5").find((m) => m.text.includes("Sent to the Internet"));
    for (const m of [detected, sent]) {
      expect(m, "the moment reached the phone").toBeDefined();
      expect(m!.noAck).toBe(true);
      expect(m!.text).not.toMatch(/with go:|ack:/u);
      expect(m!.go?.map((g) => g.kind)).toEqual(["pass", "act"]);
      expect(m!.go?.[0]?.label).toBe("🎟 Show my pass");
    }
    // Nothing points at the Internet's room any more.
    expect(sent!.go!.some((g) => g.kind === "room")).toBe(false);
  }, SLOW);

  it("a captured program is locked (only Bathroom Mode on the phone); release unlocks; a banished night never locks", () => {
    const n = boot();
    for (const c of TO_BINGO) n.press(c);
    expect(isLocked(n.sim, "g5")).toBe(false);
    capture(n, "g5");
    expect(isLocked(n.sim, "g5")).toBe(true);
    const gv = guestView(n.sim, "g5");
    expect(gv.locked).toBe(true);
    expect(gv.interactions.map((i) => i.id).sort()).toEqual(["go to the bathroom"]);
    // The Find Gerald card: the pass and the bathroom pair, no way to the Internet's room.
    const now = objectivesFor(n.sim, { guest: "g5" })[0]!;
    expect(now.title).toMatch(/Find Gerald/u);
    expect(n.sim.model.objectives.get("Find Gerald")?.go ?? null).toBeNull();
    expect(now.buttons).toEqual(["pass", "go to the bathroom"]);
    n.press("go to the bathroom", "g5");
    expect(guestView(n.sim, "g5").interactions.map((i) => i.id)).toEqual(["back from the bathroom"]);
    n.press("back from the bathroom", "g5");
    n.press("mark as reinstalled", "g5", "Norton Anti-Virus");
    expect(isLocked(n.sim, "g5")).toBe(false);
    // A banished night (everyone in the Internet) is no reinstallation.
    n.take(n.sim.setVar("Night.banish", "true"));
    n.take(n.sim.setVar("g4.corrupted", "true"));
    expect(isLocked(n.sim, "g4")).toBe(false);
  }, SLOW);

  it("the 💾 button never shows inside the Internet, and the bottle never lands on a corrupted program", () => {
    const n = boot();
    for (const c of TO_BINGO) n.press(c);
    n.take(n.sim.setVar("g2.carries_virus", "true"));
    capture(n, "g2");
    n.take(n.sim.setVar("g2.corrupted", "true"));
    // Locked anyway; the button's own `while:` says so too.
    const m = n.sim.model;
    const plant = m.interactions.get("plant_the_virus")!;
    expect(plant.while).toMatch(/program\.corrupted != true/u);
    expect(read("main.loom")).toMatch(/do pick bottle_landed from \{\[p for p in Persons where [^\]]*p\.corrupted != true/u);
  }, SLOW);

  it("The Tablet Video's corrupted branch has no menu, and no screen claims to see everyone", () => {
    const src = read("beats/internet.loom");
    const tablet = src.slice(src.indexOf("== The Tablet Video"), src.indexOf("== Zipped"));
    const corrupted = tablet.slice(tablet.indexOf("if program.corrupted:"), tablet.indexOf("else if Night.ended"));
    expect(corrupted).not.toMatch(/^\s*\* /mu);
    expect(src).not.toMatch(/Every screen in the house can see you/u);
  });
});

describe("Trapped in the Internet — wave 26: the game's moments and the trust formula (R4, R6, R7, C9)", () => {
  it("every `trust = ` recompute in the story uses the new formula (six sites)", () => {
    const files = ["main.loom", "cast/trabolta.loom", "cast/kit.loom", "cast/hosts.loom", "cast/antivirus.loom", "objectives.loom"];
    const sites: string[] = [];
    for (const f of files) for (const m of read(f).matchAll(/^\s*set (\w+)\.trust = (.+)$/gmu)) sites.push(`${f}: ${m[0]!.trim()}`);
    expect(sites).toHaveLength(6);
    for (const line of sites) {
      const x = /set (\w+)\.trust = (.+)$/u.exec(line)!;
      const w = x[1]!;
      expect(x[2], line).toBe(`${w}.truths_accepted * 10 - ${w}.internet_visits * 5 - ${w}.escapes * 5 + ${w}.assessment`);
    }
    expect(read("main.loom")).toContain("//   trust = truths_accepted * 10 - internet_visits * 5 - escapes * 5 + assessment");
  });

  it("the three moments are admin, Anytime, out of sequence", () => {
    const m = Sim.fromSources(SRC).model;
    for (const id of ["simulation escape attempt", "simulation heart reached", "simulation pickup taken"]) {
      const i = m.interactions.get(id)!;
      expect(i, id).toBeDefined();
      expect(i.who).toBe("admin");
      expect(i.act).toBe("Anytime");
      expect(i.sequence).toBe(false);
    }
  }, SLOW);

  it("an escape before his reveal: −5 trust, his lines come back for the game only, no phone or booth sees him", () => {
    const n = boot();
    n.press("call_to_the_desktop");
    n.signal("mark_for_reinstallation", "g5", { reason: "a test" });
    const before = v(n.sim, "g5.trust");
    const ev = n.raw("simulation escape attempt", "g5");
    expect(v(n.sim, "g5.escapes")).toBe(1);
    expect(v(n.sim, "g5.trust")).toBe(before - 5);
    const lines = momentLines(ev, "g5");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.every((l) => l.from === "Trabolta")).toBe(true);
    expect(lines[0]!.text).toBe("There is no outside, Winamp. There is only my computer.");
    // Game-only: no Trabolta line in any chat message, no thread on the phone.
    expect(n.chat.all().some((m) => m.channel === "dm:Trabolta" || (m.from === "Trabolta" && m.audience !== "all"))).toBe(false);
    const hosts = composeGuestMessages(n.sim, ev).filter((m) => m.text.includes("tried to walk out of the simulation"));
    expect(hosts.map((m) => m.channel)).toEqual(["room:hosts"]);
    // Again: −5 more.
    n.raw("simulation escape attempt", "g5");
    expect(v(n.sim, "g5.trust")).toBe(before - 10);
  }, SLOW);

  it("the heart: nothing before he wakes (retryable), the monologue once after, then silence", () => {
    const n = boot();
    for (const c of TO_BINGO) n.press(c);
    let ev = n.raw("simulation heart reached", "g1", { prop: "trabolta-heart" });
    expect(momentLines(ev, "g1")).toEqual([]);
    expect(v(n.sim, "g1.sim_heart")).toBe(false);
    n.press("introduce_trabolta");
    ev = n.raw("simulation heart reached", "g1", { prop: "trabolta-heart" });
    const lines = momentLines(ev, "g1");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.every((l) => l.from === "Trabolta")).toBe(true);
    expect(v(n.sim, "g1.sim_heart")).toBe(true);
    // Never a door, a code, a cable, a layer or Sandy.
    expect(lines.map((l) => l.text).join(" ")).not.toMatch(/door|code|combination|patch|cable|layer|stand down|Sandy/iu);
    expect(momentLines(n.raw("simulation heart reached", "g1", { prop: "trabolta-heart" }), "g1")).toEqual([]);
    expect(n.chat.all().some((m) => m.channel === "dm:Trabolta" && m.text.includes("copy of my heart"))).toBe(false);
  }, SLOW);

  it("the virus disk: the tent QR's entry for anyone, the paranoid Excel's antivirus, once", () => {
    const n = boot();
    for (const c of TO_BINGO) n.press(c);
    const ev = n.raw("simulation pickup taken", "g5", { item: "virus", prop: "virus-disk" });
    expect(n.sim.holdsCodex("g5", "ILOVEYOU")).toBe(true);
    expect(v(n.sim, "g5.carries_virus")).toBe(true);
    // The Truther Download line comes back to the game and reaches the phone too.
    expect(momentLines(ev, "g5").map((l) => l.from)).toContain("Truther Download");
    expect(to(composeGuestMessages(n.sim, ev), "g5").some((m) => m.text.startsWith("Something came back from the Internet with you."))).toBe(true);
    // A second disk does nothing.
    expect(momentLines(n.raw("simulation pickup taken", "g5", { item: "virus", prop: "virus-disk" }), "g5")).toEqual([]);
    // Excel on the paranoid path gets the "antivirus".
    n.take(n.sim.setVar("g2.excel_choice", "\"paranoid\""));
    n.raw("simulation pickup taken", "g2", { item: "virus", prop: "virus-disk" });
    expect(n.sim.holdsCodex("g2", "Free Antivirus Trial")).toBe(true);
    expect(n.sim.holdsCodex("g2", "ILOVEYOU")).toBe(false);
    // Not a virus: nothing.
    n.raw("simulation pickup taken", "g1", { item: "something else", prop: "x" });
    expect(v(n.sim, "g1.carries_virus")).toBe(false);
  }, SLOW);
});

describe("Trapped in the Internet — wave 26: the first glitch at the ad hijack (T2, C3)", () => {
  it("the 📺 rule cues screens_glitch and stamps the glitch before the ad; the doors seed it; every phone's night carries it", () => {
    const src = read("main.loom");
    const rule = src.slice(src.indexOf("when second_hunt_preview:"), src.indexOf("when start_the_second_hunt:"));
    expect(rule.indexOf("cue screens_glitch")).toBeGreaterThan(0);
    expect(rule.indexOf("cue screens_glitch")).toBeLessThan(rule.indexOf("cue screens_ad_hijack"));
    expect(rule).toContain("set Night.glitch_at = Time.elapsed");
    expect(rule).toContain('set Night.glitch_text = "000. 000. 000."');
    const n = boot();
    expect(v(n.sim, "Night.glitch_at")).toBe(0);
    expect(v(n.sim, "Night.glitch_text")).toBe("none");
    expect(nightView(n.sim).glitch).toBeUndefined();
    for (const c of TO_RESULTS) n.press(c);
    n.advance(3);
    const at = v(n.sim, "Time.elapsed") as number;
    const ev = n.sim.signal("second_hunt_preview");
    n.take(ev);
    expect(JSON.stringify(ev)).toContain("screens_glitch");
    expect(v(n.sim, "Night.glitch_at")).toBe(at);
    expect(nightView(n.sim).glitch).toEqual({ at: at * 1000, text: "000. 000. 000." });
    expect(guestView(n.sim, "g1").night?.glitch).toEqual({ at: at * 1000, text: "000. 000. 000." });
    expect(primeView(n.sim, "Clippy").night?.glitch).toEqual({ at: at * 1000, text: "000. 000. 000." });
  }, SLOW);
});

describe("Trapped in the Internet — wave 26: a Dare makes Trabolta make a scene (D1)", () => {
  const beatsOf = (ev: readonly SimEvent[]) => ev.filter((e) => e.type === "beatEntered").map((e) => (e as { beat: string }).beat);
  const dare = (n: Night, how: "phone" | "booth", id = "g2"): SimEvent[] => {
    for (const c of TO_RESULTS) n.press(c);
    n.press("spin_the_bottle");
    n.signal("bottle_landed", id);
    return how === "phone" ? n.raw("poll answered", id, { index: 1, card: 1 }) : n.raw("chose_dare", id, undefined, "Clippy");
  };

  for (const how of ["phone", "booth"] as const) {
    it(`the ${how} Dare: the house line, the mark, the dared phone's big moment, the Antivirus' loud order, Dare Chosen once`, () => {
      const n = boot();
      const score = v(n.sim, "Clippy.score");
      const ev = dare(n, how);
      const ms = composeGuestMessages(n.sim, ev);
      expect(beatsOf(ev).filter((b) => b === "Dare Chosen")).toHaveLength(1);
      // The house line and the mark reason are unchanged (terminal/test/act1.test.ts pins them).
      expect(ms.some((m) => m.text === "🎩 Microsoft Excel chose Dare. Programs choose Truth.")).toBe(true);
      expect(v(n.sim, "g2.marked_for")).toBe("chose Dare");
      // The dared phone: only the pass, no OK; never the soft heads-up.
      const big = to(ms, "g2").find((m) => m.text.startsWith("🎩 Trabolta is not amused"))!;
      expect(big).toMatchObject({ moment: "big", noAck: true });
      expect(big.go?.map((g) => g.kind)).toEqual(["pass"]);
      expect(to(ms, "g2").some((m) => m.text.startsWith("🚨 You are marked for reinstallation"))).toBe(false);
      // Every Antivirus booth: the loud Dare order, a big readout.
      for (const av of ["Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software"]) {
        const r = readouts(ms, av).find((m) => m.text.startsWith("🚨 TRABOLTA'S ORDER: take Microsoft Excel to the Internet NOW."));
        expect(r, av).toMatchObject({ moment: "big" });
      }
      // The scene: public Trabolta lines at the Desktop naming the program, ending with the order.
      const said = ev.filter((e) => e.type === "dialogue" && (e as { speaker: string }).speaker === "Trabolta" && (e as { beat?: string }).beat === "Dare Chosen").map((e) => (e as { text: string }).text);
      expect(said.length).toBeGreaterThanOrEqual(2);
      expect(said.at(-1)).toBe("Antivirus! Take Microsoft Excel to the Internet. Now.");
      // The credit stays on the 🎩 fallback only.
      if (how === "phone") expect(v(n.sim, "Clippy.score")).toBe(score);
    }, SLOW);
  }

  it("the old chose_dare signal scene is retired in the story: both paths fire the one beat", () => {
    const src = read("main.loom");
    // Each path tells the house just before `dare_taken` (terminal/test/act1.test.ts pins the phone path).
    expect(src.match(/broadcast "~🎩 \{program\.name\} chose Dare\. Programs choose Truth\." to everyone\n\s+fire dare_taken for program/gu)).toHaveLength(2);
    expect(src.match(/fire dare_taken for program/gu)).toHaveLength(2);
    expect(read("beats/hunt.loom")).toMatch(/== Dare Chosen\n  setting: The Desktop\n  cast: Trabolta\n/u);
  });
});

describe("Trapped in the Internet — wave 26: a guest's BINGO and one round (B1–B5)", () => {
  const sheet = (sim: Sim) => {
    const rows = cueRows(modView(sim, "open", "x").interactions ?? [], cueState(sim));
    return { last: rows.find((r) => r.last)?.id ?? null, next: rows.find((r) => r.next)?.id ?? null };
  };
  const hostLines = (ms: readonly ChatMessage[]) => ms.filter((m) => m.channel === "room:hosts").map((m) => m.text);
  const bingoEnds = (n: Night, id = "g1") => guestView(n.sim, id).countdowns?.find((c) => c.label === "Bingo ends")?.endsAt;
  const live = (n: Night, booth: string, id: string, host = false) => guestCardView(n.sim, n.chat.all(), booth, id, host)?.live ?? [];
  const startBingo = (n: Night) => {
    n.press("call_to_the_desktop");
    n.press("start_the_bingo");
  };

  it("🎱 BINGO! is on the Play Computer Bingo card; a call goes straight to the results, by story, with the exact time left", () => {
    const n = boot();
    startBingo(n);
    const now = guestView(n.sim, "g5").objectives![0]!;
    expect(now.id).toBe("Play Computer Bingo");
    expect(now.buttons).toContain("call_bingo");
    expect(n.sim.model.interactions.get("call_bingo")).toMatchObject({ who: "guest", arm: true, label: "🎱 BINGO!" });
    n.advance(900);
    const out = n.press("call_bingo", "g5");
    expect(v(n.sim, "Night.phase")).toBe("bingo_results");
    expect(v(n.sim, "Night.step")).toBe(3);
    expect(v(n.sim, "Night.bingo_on")).toBe(false);
    expect(v(n.sim, "Night.bingo_caller")).toBe("Winamp");
    expect(v(n.sim, "Night.bingo_left")).toBe(300);
    expect(cueState(n.sim)).toMatchObject({ last: "bingo_time", lastBy: "story" });
    expect(to(out, "g5").some((m) => m.text.startsWith("🎱 You called BINGO!") && m.moment === "big")).toBe(true);
    expect(out.some((m) => m.audience === "all" && m.text.startsWith("⏰ BINGO! Winamp called it."))).toBe(true);
    // Clippy's NOW: check the caller's line, on their card.
    const clippy = primeView(n.sim, "Clippy").objectives![0]!;
    expect(clippy.id).toBe("Check The Bingo");
    expect(clippy.target).toMatchObject({ id: "g5", name: "Winamp" });
    expect(clippy.buttons).toEqual(["bingo_winner", "not_a_bingo"]);
    expect(primeView(n.sim, "Task Manager", undefined, { host: true }).objectives![0]!.id).toBe("A Program Called Bingo");
    // The quests settle at the end of the round, not now.
    expect(n.sim.questStatus("g1", "The Bingo Card")).toBe("active");
  }, SLOW);

  it("two guests press 🎱 back to back: the first wins, the second does nothing; a 🎱 after a 🎯 changes nothing", () => {
    const n = boot();
    startBingo(n);
    n.press("call_bingo", "g5");
    const second = n.press("call_bingo", "g1");
    expect(v(n.sim, "Night.bingo_caller")).toBe("Winamp");
    expect(hostLines(second).some((t) => t.includes("Nothing happens"))).toBe(true);
    expect(to(second, "g1").some((m) => m.text.startsWith("🎱 You called BINGO!"))).toBe(false);
    expect(guestView(n.sim, "g1").interactions.map((i) => i.id)).not.toContain("call_bingo");
    // A 🎯 closes the round; a late 🎱 does nothing.
    n.signal("bingo_winner", "g5", undefined, "Clippy");
    n.signal("named_at_bingo", "g4", undefined, "Clippy");
    const late = n.press("call_bingo", "g6");
    expect(v(n.sim, "Night.bingo_caller")).toBe("Winamp");
    expect(v(n.sim, "Night.phase")).toBe("bingo_results");
    expect(hostLines(late).some((t) => t.includes("Nothing happens"))).toBe(true);
  }, SLOW);

  it("↩ Not a Bingo with time left: the night is back at the call, the countdown resumes at exactly what was left, another guest may call", () => {
    const n = boot();
    startBingo(n);
    n.advance(900);
    n.press("call_bingo", "g5");
    expect(bingoEnds(n)).toBeUndefined();
    n.advance(60);
    // Not on a non-caller's card; on the caller's for Clippy and a host.
    expect(live(n, "Clippy", "g1")).not.toContain("not_a_bingo");
    expect(live(n, "Clippy", "g5")).toContain("not_a_bingo");
    expect(live(n, "Task Manager", "g5", true)).toContain("not_a_bingo");
    const at = v(n.sim, "Time.elapsed") as number;
    const out = n.press("not_a_bingo", "g5", "Task Manager");
    expect(v(n.sim, "Night.phase")).toBe("bingo");
    expect(v(n.sim, "Night.step")).toBe(2);
    expect(v(n.sim, "Night.bingo_on")).toBe(true);
    expect(v(n.sim, "Night.bingo_end")).toBe(at + 300);
    expect(v(n.sim, "Night.screen")).toBe("bingo");
    expect(v(n.sim, "Night.bingo_called")).toBe(false);
    expect(v(n.sim, "Night.bingo_caller")).toBe("none");
    expect(bingoEnds(n)).toBe(at + 300);
    expect(out.some((m) => m.audience === "all" && m.text.startsWith("↩ Not a Bingo yet. Back to your cards."))).toBe(true);
    expect(hostLines(out)).toContain("↩ Task Manager pressed Not a Bingo for Winamp. Bingo is back on: the clock picks up where it stopped.");
    expect(guestView(n.sim, "g1").objectives![0]!.id).toBe("Play Computer Bingo");
    expect(sheet(n.sim)).toMatchObject({ next: "bingo_time" });
    // The time-up rule fires at the restored deadline, not before.
    expect(n.advance(299).some((m) => m.text.includes("Bingo time is up"))).toBe(false);
    expect(n.advance(2).some((m) => m.text.includes("Bingo time is up"))).toBe(true);
    // Another guest may call now.
    n.press("call_bingo", "g1");
    expect(v(n.sim, "Night.bingo_caller")).toBe("Calculator");
    expect(v(n.sim, "Night.bingo_left")).toBe(0);
  }, SLOW);

  it("a call after time-up, undone: no clock, time-up never fires twice; the host's ⏰ briefs the cast exactly once", () => {
    const n = boot();
    startBingo(n);
    n.advance(1201);
    n.press("call_bingo", "g5");
    expect(v(n.sim, "Night.bingo_left")).toBe(0);
    const first = n.events.length;
    n.press("not_a_bingo", "g5", "Clippy");
    expect(v(n.sim, "Night.phase")).toBe("bingo");
    expect(v(n.sim, "Night.bingo_on")).toBe(false);
    expect(bingoEnds(n)).toBeUndefined();
    expect(n.advance(1300).some((m) => m.text.includes("Bingo time is up"))).toBe(false);
    // The hosts' ⏰: the results again; the briefs and the Bingo Time beat only once all night.
    const again = n.press("bingo_time");
    expect(v(n.sim, "Night.phase")).toBe("bingo_results");
    const all = n.events.slice(0);
    const beats = all.filter((e) => e.type === "beatEntered" && (e as { beat: string }).beat === "Bingo Time");
    expect(beats).toHaveLength(1);
    const game = n.chat.all().filter((m) => m.channel === "dm:Clippy" && m.text.startsWith("🎱 YOUR GAME IS ON · The Bingo results"));
    expect(game).toHaveLength(1);
    const norton = n.chat.all().filter((m) => m.channel === "dm:Norton Anti-Virus" && m.text.startsWith("🛡 You are the selected Antivirus."));
    expect(norton).toHaveLength(1);
    expect(again.some((m) => m.text.startsWith("⏰ BINGO TIME."))).toBe(true);
    expect(first).toBeGreaterThan(0);
  }, SLOW);

  it("↩ is offered only before any 🎱 / 🎯 / 🤐", () => {
    const n = boot();
    startBingo(n);
    n.press("call_bingo", "g5");
    n.signal("bingo_winner", "g5", undefined, "Clippy");
    expect(v(n.sim, "Night.bingo_checked")).toBe(true);
    expect(live(n, "Clippy", "g5")).not.toContain("not_a_bingo");
    const refused = n.press("not_a_bingo", "g5", "Clippy");
    expect(v(n.sim, "Night.phase")).toBe("bingo_results");
    expect(hostLines(refused).some((t) => t.includes("Nothing happens"))).toBe(true);
    expect(primeView(n.sim, "Clippy").objectives![0]!.id).toBe("Celebrate The Winners");
  }, SLOW);

  it("🤐 the winner names nobody: nobody marked, the round over, ⭐ +5 for Clippy, After The Bingo", () => {
    const n = boot();
    for (const c of TO_BINGO) n.press(c);
    expect(live(n, "Clippy", "g1")).not.toContain("named_nobody");
    n.signal("bingo_winner", "g1", undefined, "Clippy");
    n.signal("award_the_ribbon", "g1", undefined, "Clippy");
    expect(live(n, "Clippy", "g1")).toContain("named_nobody");
    const score = v(n.sim, "Clippy.score") as number;
    const out = n.signal("named_nobody", "g1", undefined, "Clippy");
    expect(v(n.sim, "Night.bingo_none")).toBe(true);
    expect(v(n.sim, "Night.bingo_done")).toBe(true);
    expect([...n.sim.persons.keys()].filter((g) => v(n.sim, `${g}.marked`) === true)).toEqual([]);
    expect(v(n.sim, "Clippy.score")).toBe(score + 5);
    expect(hostLines(out)).toContain("🤐 Calculator names nobody at the centre square. Nobody is marked.");
    expect(primeView(n.sim, "Clippy").objectives![0]!.id).toBe("After The Bingo");
    expect(n.sim.questStatus("g1", "The Bingo Card")).toBe("done");
    expect(n.sim.questStatus("Norton Anti-Virus", "The Selected Antivirus")).toBe("done");
    // Once over, nothing more: no 🎱, no 🎯.
    expect(live(n, "Clippy", "g2")).not.toContain("bingo_winner");
    expect(live(n, "Clippy", "g2")).not.toContain("named_at_bingo");
  }, SLOW);

  it("one round: the first 🎯 closes it (a second is refused); a Bingo-phase capture and 🤖 close it too", () => {
    const n = boot();
    for (const c of TO_BINGO) n.press(c);
    n.signal("bingo_winner", "g1", undefined, "Clippy");
    n.signal("named_at_bingo", "g4", undefined, "Clippy");
    expect(v(n.sim, "Night.bingo_done")).toBe(true);
    expect(n.sim.questStatus("g2", "The Bingo Card")).toBe("done");
    expect(n.sim.questStatus("Clippy", "Run The Bingo")).toBe("done");
    expect(primeView(n.sim, "Clippy").objectives![0]!.id).toBe("After The Bingo");
    const again = n.signal("named_at_bingo", "g3", undefined, "Clippy");
    expect(v(n.sim, "Night.bingo_named")).toBe(1);
    expect(v(n.sim, "g3.marked")).toBe(false);
    expect(hostLines(again).some((t) => t.includes("Nothing happens"))).toBe(true);
    for (const g of ["g2", "g3", "g5"]) {
      expect(live(n, "Clippy", g)).not.toContain("bingo_winner");
      expect(live(n, "Clippy", g)).not.toContain("named_at_bingo");
    }
    // A capture during the results closes a round nobody closed.
    const c = boot();
    for (const x of TO_BINGO) c.press(x);
    c.signal("mark_for_reinstallation", "g6", { reason: "a test" });
    c.signal("send to the internet", "g6", undefined, "Norton Anti-Virus");
    expect(v(c.sim, "Night.bingo_done")).toBe(true);
    // 🤖 with the round still open: belt and braces.
    const t = boot();
    for (const x of TO_BINGO) t.press(x);
    t.press("introduce_trabolta");
    expect(v(t.sim, "Night.bingo_done")).toBe(true);
    expect(t.sim.questStatus("g1", "The Bingo Card")).toBe("done");
    expect(sheet(t.sim).last).toBe("introduce_trabolta");
  }, SLOW);
});

describe("Trapped in the Internet — wave 26: no hints in the show text (G1)", () => {
  const beat = (file: string, name: string) => {
    const src = read(file);
    const a = src.indexOf(`== ${name}\n`);
    const b = src.indexOf("\n== ", a + 3);
    return src.slice(a, b < 0 ? undefined : b);
  };

  it("Clippy never says the judging rule: the First Moment of Truth and Truth Pong", () => {
    const fmt = beat("beats/hunt.loom", "First Moment Of Truth");
    expect(fmt).toContain("Clippy: Every answer you filed with Trabolta will be judged. Trabolta knows best!");
    expect(fmt).not.toMatch(/one hundred percent sure|symptom of corruption|accepted/iu);
    expect(fmt).toContain("Clippy: You have two minutes. File anything you found with Trabolta NOW.");
    const pong = beat("beats/pong.loom", "Truth Pong");
    expect(pong).not.toMatch(/Confident is accepted|A guess is the Internet/u);
    // The miss is the author's own rule, and stays.
    expect(pong).toContain("you will need to be reinstalled in the Internet");
    // After-the-fact verdicts stay.
    expect(beat("beats/hunt.loom", "Question Results")).toContain("A guess is a symptom of corruption. Antivirus, you know what to do.");
  });

  it("no guest objective, button or founder's quest states a hidden rule up front", () => {
    const m = Sim.fromSources(SRC).model;
    let checked = 0;
    for (const o of m.objectives.values()) {
      if (!o.audience.roles.includes("Program")) continue;
      checked++;
      const all = [o.brief, ...o.checklist.map((c) => c.label)].join("\n");
      expect(all, o.id).not.toMatch(/100%|symptom of corruption|four digit notes|door code|excuses you|a summons excuses|they wait outside|Fail the security|Late without Bathroom Mode|did not agree to be ruled/iu);
    }
    expect(checked).toBeGreaterThan(20);
    expect(m.interactions.get("go to the bathroom")!.description).not.toMatch(/excuse/iu);
    expect(m.quests.get("A Faction Of Your Own")!.text).not.toMatch(/door code/iu);
  }, SLOW);

  it("Clippy keeps the rule privately; Trabolta's brief no longer states it", () => {
    const ci3 = read("codex/7-clippy.loom");
    expect(ci3).toContain("- Never say the rules out loud");
    expect(read("cast-packs/performers/clippy.md")).toContain("**Never say the rules out loud**");
    expect(read("cast-packs/performers/clippy.md")).not.toMatch(/The rules, out loud/u);
    const mind = read("trabolta.mind.md");
    expect(mind).not.toMatch(/confident answers were accepted/u);
    expect(read("trabolta.persona.md")).toContain("judging belongs to Clippy and the Moments of Truth; never explain it.");
  });
});
