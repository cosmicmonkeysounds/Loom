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
import { cueState, guestView, isLocked, modView, nightView, notePress, objectivesFor, primeView } from "../server/views.ts";
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
