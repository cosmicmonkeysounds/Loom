//! Trapped in the Internet — wave 13 (story lane): the show's side of the
//! Play overhaul. One home per broadcast (no `# system-log`), the host
//! parts (`admin: true`), the objectives every phone shows as NOW, the
//! interrupt ladder (`Night.alerts`), effect text, per-person notices (`~`),
//! the cards that ask (`moment: major`), codex categories, the booth card's
//! facts, a delivery for every beat that used to be buried, and the booth
//! noise trims. Every text change is DRAFT in `SIGNOFF-w13.md`.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { ChatStore, composeGuestMessages } from "../server/chat.ts";
import type { ChatMessage } from "../server/chat.ts";
import { cueState, guestView, modView, notePress, objectivesFor, primeView, pressRefused } from "../server/views.ts";
import { cueRows } from "../src/cue-sheet.ts";

export const SRC = scenarioSource("trapped-in-the-internet");
export const SLOW = 120_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};

/** A Sim plus the chat the event server would compose from it. */
export class Night {
  readonly sim: Sim;
  readonly chat = new ChatStore();
  constructor(src = SRC) {
    this.sim = Sim.fromSources(src);
    this.take(this.sim.fireBeat("Power On"));
  }
  /** Compose a batch into the chat; returns the stored messages. */
  take(events: SimEvent[]): ChatMessage[] {
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
  /** A director's press: never refused. */
  press(name: string, subject?: string): ChatMessage[] {
    const ev = this.sim.signal(name, subject);
    notePress(this.sim, ev);
    expect(pressRefused(this.sim, ev), name).toBe(false);
    return this.take(ev);
  }
  scan(scanner: string, id: string): ChatMessage[] {
    return this.take(this.sim.scan(scanner, id));
  }
  /** Register → CAPTCHA → the problem (if asked) → deposit → the door scan. */
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
  /** The cue sheet's NEXT, if any. */
  next(): string | null {
    const rows = cueRows(modView(this.sim, "open", "x").interactions ?? [], cueState(this.sim));
    return rows.find((r) => r.next)?.id ?? null;
  }
}

/** Messages a guest's phone receives (its own or everyone's). */
export const forGuest = (ms: readonly ChatMessage[], id: string) =>
  ms.filter((m) => m.audience === "all" || (Array.isArray(m.audience) && m.audience.includes(id)));

export const PROGRAMS: [string, string][] = [
  ["g1", "Calculator"],
  ["g2", "Microsoft Excel"],
  ["g3", "OpenOffice"],
  ["g4", "MS Paint"],
  ["g5", "Winamp"],
  ["g6", "VLC"],
];

describe("Trapped in the Internet — wave 13: one home per broadcast", () => {
  it("there is no # system-log: an everyone-alert posts once, in the lobby", () => {
    const n = new Night();
    const sim = n.sim;
    expect([...sim.model.channels.keys()].some((k) => /system/i.test(k))).toBe(false);
    for (const [id, name] of PROGRAMS) n.upload(id, name);
    const out = n.press("call_to_the_desktop");
    const alerts = out.filter((m) => m.alert === true);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.channelKind).not.toBe("announcement");
  }, SLOW);
});

describe("Trapped in the Internet — wave 13: the host parts", () => {
  it("admin: true is on Task Manager, Adobe Acrobat and the Recycling Bin only (never Clippy)", () => {
    const m = Sim.fromSources(SRC).model;
    const admins = [...m.characters.values()].filter((c) => c.admin).map((c) => c.id).sort();
    expect(admins).toEqual(["Adobe Acrobat", "Recycling Bin", "Task Manager"]);
    expect(m.characters.get("Clippy")!.admin).toBe(false);
  });
});

describe("Trapped in the Internet — wave 13: codex categories", () => {
  it("every CODEX entry carries a guest-facing category (titi:facts writes the generated ones)", () => {
    const m = Sim.fromSources(SRC).model;
    const allowed = new Set(["People", "Places", "The story", "How it works", "Files", "Trabolta", "Missions", "Facts", "The cold door"]);
    const missing = [...m.codex.values()].filter((c) => c.category === null).map((c) => c.id);
    expect(missing).toEqual([]);
    for (const c of m.codex.values()) {
      expect(allowed.has(c.category!), `${c.id}: ${c.category}`).toBe(true);
      expect(c.category!, c.id).not.toMatch(/instruction|jeeves|kernel|staff/i);
    }
    expect(m.codex.get("Clippy Instructions 1")!.category).toBe("Missions");
    expect(m.codex.get("The Door Code")!.category).toBe("The cold door");
  });
});

describe("Trapped in the Internet — wave 13: the booth card's facts", () => {
  it("a scan card lists Cleared / Marked / Bathroom Mode / Late / In the Internet (false booleans too), never a secret slot", () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.upload("g2", "Winamp", null);
    const g1 = primeView(n.sim, "Norton Anti-Virus").guests.find((g) => g.id === "g1")!;
    const on = (g: typeof g1) => Object.fromEntries((g.flags ?? []).map((f) => [f.label, f.on]));
    expect(on(g1)).toMatchObject({ Cleared: true, Marked: false, "Bathroom Mode": false, Late: false, "In the Internet": false });
    expect(on(g1)["Checked in"]).toBeUndefined(); // text "none": listed only once set
    const g2 = primeView(n.sim, "Norton Anti-Virus").guests.find((g) => g.id === "g2")!;
    expect(on(g2).Cleared).toBe(false); // "Not cleared"
    n.signal("go to the bathroom", "g1");
    const after = primeView(n.sim, "Norton Anti-Virus").guests.find((g) => g.id === "g1")!;
    expect(on(after)["Bathroom Mode"]).toBe(true);
    const secret = new Set(n.sim.model.roles.get("Program")!.secret ?? []);
    for (const g of primeView(n.sim, "Norton Anti-Virus").guests) for (const f of g.flags ?? []) expect(secret.has(f.path.split(".").slice(1).join(".")), f.path).toBe(false);
  });
});
