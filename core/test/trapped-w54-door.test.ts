//! Wave 54: the door. An Antivirus or a host confirms an uploaded program;
//! Clippy only greets; staff never wait for a scan; 🚻 carries its printed sign.

import { describe, expect, it } from "vitest";
import { scenarioSource } from "../examples/load.ts";
import { ChatStore, composeGuestMessages, type ChatMessage } from "../server/chat.ts";
import { actionSigns } from "../server/routes/k12.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const HOSTS = ["Task Manager", "Adobe Acrobat", "Recycling Bin"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => (sim.world.get(p) as { value: unknown } | undefined)?.value;

/** A Sim plus the chat the event server would compose from it. */
class Night {
  readonly sim = Sim.fromSources(SRC);
  readonly chat = new ChatStore();
  constructor() {
    this.take(this.sim.fireBeat("Power On"));
  }
  take(events: SimEvent[]): ChatMessage[] {
    return this.chat.append(composeGuestMessages(this.sim, events));
  }
  scan(scanner: string, id: string): ChatMessage[] {
    return this.take(this.sim.scan(scanner, id));
  }
  /** Register → CAPTCHA → the problem → the deposit, and no door scan. */
  upload(id: string, name: string): void {
    this.take(this.sim.createPerson(id, name));
    this.take(this.sim.signal("captcha answered", id, { passed: true }));
    this.take(this.sim.signal("captcha answered", id, { passed: false }));
    if (this.sim.pendingChoiceFor(id)?.length === 5) this.take(this.sim.choose(id, 0));
    this.take(this.sim.choose(id, 0));
  }
}

const uploaded = (): Night => {
  const n = new Night();
  n.upload("g1", "Calculator");
  expect(v(n.sim, "g1.uploaded")).toBe(true);
  expect(v(n.sim, "g1.location")).toBe("The Optical Drive");
  return n;
};

describe("the door", () => {
  it.each(HOSTS)("%s confirms an uploaded program, with no ⭐", (host) => {
    const n = uploaded();
    n.scan(host, "g1");
    expect(v(n.sim, "g1.cleared")).toBe(true);
    expect(v(n.sim, "g1.location")).toBe("The Desktop");
    expect(v(n.sim, `${host}.score`)).toBeUndefined();
  });

  it("an Antivirus confirms too, and earns its ⭐", () => {
    const n = uploaded();
    n.scan("Norton Anti-Virus", "g1");
    expect(v(n.sim, "g1.cleared")).toBe(true);
    expect(v(n.sim, "Norton Anti-Virus.score")).toBe(5);
  });

  it("a host's clearance plays the whole beat once, and no greeting after it", () => {
    const n = uploaded();
    const said = n.scan("Task Manager", "g1").map((m) => m.text);
    expect(said.filter((t) => t.startsWith("Scanned. Calculator is free of viruses"))).toHaveLength(1);
    expect(said.some((t) => t.includes("Status check"))).toBe(false);
  });

  it("a host's scan of a confirmed program still greets it", () => {
    const n = uploaded();
    n.scan("Norton Anti-Virus", "g1");
    expect(n.scan("Task Manager", "g1").map((m) => m.text)).toContain("Calculator. Status check.");
  });

  it("Clippy greets and never clears", () => {
    const n = uploaded();
    n.scan("Clippy", "g1");
    expect(v(n.sim, "g1.cleared")).not.toBe(true);
    expect(v(n.sim, "g1.location")).toBe("The Optical Drive");
  });
});

describe("the bathroom sign", () => {
  it("is the show's one sign, and its press is the button's", () => {
    const n = uploaded();
    n.scan("Norton Anti-Virus", "g1");
    const signs = actionSigns(n.sim.model, "https://a", "E 1", "s3cret");
    expect(signs.map((s) => [s.name, s.label])).toEqual([["go to the bathroom", "🚻 Bathroom Mode"]]);
    expect(signs[0]!.url).toBe("https://a/?code=E%201&act=go%20to%20the%20bathroom");
    n.take(n.sim.signal(signs[0]!.name, "g1"));
    expect(v(n.sim, "g1.afk")).toBe(true);
    expect(v(n.sim, "g1.bath_trips")).toBe(1);
  });
});
