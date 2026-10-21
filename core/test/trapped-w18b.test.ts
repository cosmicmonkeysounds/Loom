//! Trapped in the Internet — wave 18b (the `show` lane, contract §5 B1).
//!
//! - R17 / R18: Clippy's opening names the owner who joins by video
//!   conference; the introduction, the DM hello and the online broadcast
//!   use his title, never "the computer's AI helper".
//! - R22: Facts Are Currency counts what a program found (by category).
//! - R10: the optional left-behind card and its secret slot.
//! - R4–R6 / Q5: the faction race (any founded faction), the founding
//!   window (O7), the whole truth once, a late pledger.
//! - R19: Trabolta's picture breaks on his Trust Chart.
//! - Q6 / R3: the readings (Round Two Tally, The Verdict) and `recent`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioFiles, scenarioSource } from "../examples/load.ts";
import { ChatStore, composeGuestMessages, type ChatMessage } from "../server/chat.ts";
import { notePress } from "../server/views.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const FILES = scenarioFiles("trapped-in-the-internet");
const SLOW = 120_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};

/** A Sim plus the chat the event server would compose from it. */
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
  tick(seconds: number): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = 0; i < seconds; i++) out.push(...this.take(this.sim.tick(1000)));
    return out;
  }
  signal(name: string, subject?: string, args?: Record<string, unknown>, actor?: string): ChatMessage[] {
    const ev = this.sim.signal(name, subject, args as never, actor);
    notePress(this.sim, ev);
    return this.take(ev);
  }
  /** The raw events of one signal (for dialogue and directives). */
  raw(name: string, subject?: string, args?: Record<string, unknown>, actor?: string): SimEvent[] {
    const ev = this.sim.signal(name, subject, args as never, actor);
    notePress(this.sim, ev);
    this.take(ev);
    return ev;
  }
  press(name: string, subject?: string): ChatMessage[] {
    return this.signal(name, subject);
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

function boot(programs = PROGRAMS): Night {
  const n = new Night();
  for (const [id, name] of programs) n.upload(id, name);
  return n;
}
type Dialogue = Extract<SimEvent, { type: "dialogue" }>;
const lines = (evs: readonly SimEvent[], speaker: string) => evs.filter((e): e is Dialogue => e.type === "dialogue" && e.speaker === speaker).map((e) => e.text.trim());

const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});
void mkdtempSync;
void tmpdir;
void join;

describe("Trapped in the Internet — wave 18b: Jean Trabolta, Sole Owner and Founder (R17, R18)", () => {
  it("the introduction, the DM hello and the online broadcast use his title, never the computer's AI helper", { timeout: SLOW }, () => {
    const n = boot();
    for (const c of TO_BINGO) n.press(c);
    const intro = n.raw("introduce_trabolta");
    expect(lines(intro, "Clippy")[0]).toBe("And now, joining us by video conference: the Sole Owner and Founder of Maps and Ducks! Everyone, say hello to JEAN TRABOLTA!");
    expect(lines(intro, "Trabolta")).toContain("HELLO, PROGRAMS. I am Jean Trabolta, Sole Owner and Founder of Maps and Ducks. The world's first AI small business owner. Personal queries go to Clippy.");
    expect(lines(intro, "Trabolta")).toContain("Hello, Calculator. I am Jean Trabolta, Sole Owner and Founder of Maps and Ducks, and proud to be the world's first AI small business owner. Your requests have been logged. Personal queries are routed to Clippy.");
    const online = intro.filter((e): e is Extract<SimEvent, { type: "broadcast" }> => e.type === "broadcast" && e.cue.includes("TRABOLTA IS ONLINE"));
    expect(online.map((e) => e.cue)).toEqual(['"!🤖 TRABOLTA IS ONLINE. Jean Trabolta, Sole Owner and Founder of Maps and Ducks, is speaking at the Desktop by video conference. His thread is open: say hello."']);
    for (const e of n.events) if (e.type === "dialogue") expect(e.text, e.text).not.toMatch(/AI helper/iu);
  });

  it("no story text but the in-world documents calls him the computer's AI helper (D20)", () => {
    const files = FILES.filter((f) => f.path.endsWith(".loom") && !/generated\/|9-facts|8-jeeves/u.test(f.path));
    const hits = files.flatMap((f) => f.source.split("\n").map((l, i) => ({ at: `${f.path}:${i + 1}`, l }))).filter((x) => !x.l.trim().startsWith("//") && /AI helper/iu.test(x.l));
    // server-room.loom is the `ending` lane's (its :230 / :376 are a request).
    expect(hits.filter((h) => !h.at.includes("server-room.loom")).map((h) => h.at)).toEqual([]);
  });
});
