// Wave 44 (docs/loom-w44-contract.md C1–C3) on the show: the upload's video
// card and ⊞ Start's buttons, 🆘 Help Me on the locked phone (one alert a
// minute, to # hosts), and the credits at G11 / G12 on every screen.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scenarioSource } from "../examples/load.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";
import { ChatStore, composeGuestMessages, type ChatMessage } from "../server/chat.ts";
import { guestView, isLocked, nightView, notePress } from "../server/views.ts";
import { creditsProblems } from "../src/credits.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const SLOW = 120_000;
type Ev<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => (sim.world.get(p) as { value?: unknown } | undefined)?.value;
const widgets = (evs: SimEvent[]) => evs.filter((e) => e.type === "widget") as Ev<"widget">[];

class Night {
  readonly sim = Sim.fromSources(SRC);
  readonly chat = new ChatStore();
  constructor() {
    this.take(this.sim.fireBeat("Power On"));
  }
  take(events: SimEvent[]): ChatMessage[] {
    return this.chat.append(composeGuestMessages(this.sim, events));
  }
  raw(name: string, subject?: string, args?: Record<string, unknown>, actor?: string): SimEvent[] {
    const ev = this.sim.signal(name, subject, args as never, actor);
    notePress(this.sim, ev);
    this.take(ev);
    return ev;
  }
  press(name: string, subject?: string, actor?: string): ChatMessage[] {
    const ev = this.sim.signal(name, subject, undefined, actor);
    notePress(this.sim, ev);
    return this.take(ev);
  }
  advance(seconds: number): void {
    for (let i = 0; i < seconds; i++) this.take(this.sim.tick(1000));
  }
  /** Register, the CAPTCHA, a stock problem, Deposited; returns the upload's events. */
  upload(id: string, name: string): SimEvent[] {
    const out: SimEvent[] = [];
    out.push(...this.sim.createPerson(id, name));
    out.push(...this.sim.signal("captcha answered", id, { passed: true }));
    out.push(...this.sim.signal("captcha answered", id, { passed: false }));
    const p = this.sim.pendingChoiceFor(id);
    if (p && p.length === 5) out.push(...this.sim.choose(id, 0));
    out.push(...this.sim.choose(id, 1)); // I have nothing to leave
    this.take(out);
    this.take(this.sim.scan("Norton Anti-Virus", id));
    return out;
  }
}

describe("wave 44: the video card at the upload (C1)", () => {
  it("is dealt just before the inbox card, never holds the upload up, and keeps the answer secret", () => {
    const n = new Night();
    const up = n.upload("g1", "Calculator");
    const cards = widgets(up).filter((w) => w.widget !== "captcha");
    expect(cards.map((w) => w.widget)).toEqual(["poll", "email", "pass"]);
    const card = cards[0]!;
    expect(card.text).toBe("🎥 May video of you from tonight be used?");
    expect(card.params["options"]).toBe("Yes, use video of me | No, leave me out");
    expect(card.audience).toEqual(["g1"]);
    // Unanswered: uploaded all the same, nothing decided (an opt-out).
    expect(v(n.sim, "g1.uploaded")).toBe(true);
    expect(v(n.sim, "g1.video")).toBe("none");
    expect(n.sim.model.roles.get("Program")!.secret.has("video")).toBe(true);
  });

  it("No, leave me out → out; Start offers the way back; a press of either button sets it", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    const ids = () => guestView(n.sim, "g1").interactions.map((i) => i.id);
    expect(ids()).toContain("video_leave_me_out");
    expect(ids()).not.toContain("video_use_me");
    n.raw("poll answered", "g1", { choice: "No, leave me out", index: 1, card: 1 });
    expect(v(n.sim, "g1.video")).toBe("out");
    expect(ids()).toContain("video_use_me");
    expect(ids()).not.toContain("video_leave_me_out");
    const back = n.press("video_use_me", "g1");
    expect(v(n.sim, "g1.video")).toBe("ok");
    expect(back.some((m) => m.text.includes("video of you may be used"))).toBe(true);
    n.press("video_leave_me_out", "g1");
    expect(v(n.sim, "g1.video")).toBe("out");
    n.raw("poll answered", "g1", { choice: "Yes, use video of me", index: 0, card: 1 });
    expect(v(n.sim, "g1.video")).toBe("ok");
  });

  it("the video answer is never a vote or the bottle", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.raw("poll answered", "g1", { choice: "No, leave me out", index: 1, card: 1 });
    expect(v(n.sim, "Night.help_votes")).toBe(0);
    expect(v(n.sim, "Night.thwart_votes")).toBe(0);
  });

  it("is not offered before the upload, nor on a locked phone", { timeout: SLOW }, () => {
    const n = new Night();
    n.take(n.sim.createPerson("g9", "Notepad"));
    expect(guestView(n.sim, "g9").interactions.map((i) => i.id)).not.toContain("video_leave_me_out");
  });
});

describe("wave 44: 🆘 Help Me (C2)", () => {
  /** A captured (locked) program, the night at Bingo. */
  function captured(): Night {
    const n = new Night();
    n.upload("g1", "Calculator");
    for (const c of ["call_to_the_desktop", "start_the_bingo", "bingo_time"]) n.press(c);
    n.raw("mark_for_reinstallation", "g1", { reason: "flagged by a host" });
    n.raw("confronted", "g1", { hunter: "Norton Anti-Virus" });
    n.press("send to the internet", "g1", "Norton Anti-Virus");
    expect(isLocked(n.sim, "g1")).toBe(true);
    return n;
  }
  const hostAlerts = (ms: readonly ChatMessage[]) => ms.filter((m) => m.channel === "room:hosts" && m.text.includes("HELP ME"));

  it("is on the locked phone beside 🚻, and alerts # hosts once a minute", { timeout: SLOW }, () => {
    const n = captured();
    expect(guestView(n.sim, "g1").interactions.map((i) => i.id).sort()).toEqual(["go to the bathroom", "tent_help_me"]);
    const first = n.press("tent_help_me", "g1");
    const alert = hostAlerts(first);
    expect(alert).toHaveLength(1);
    expect(alert[0]!.alert).toBe(true); // `!`: pinned and pushed on every booth
    expect(alert[0]!.text).toMatch(/Calculator needs a host in the Internet/u);
    expect(alert[0]!.text).not.toMatch(/\btent\b/iu); // a rain night's Internet is the shed
    expect(first.some((m) => m.audience !== "all" && Array.isArray(m.audience) && m.audience.includes("g1") && m.text.includes("Help is on the way"))).toBe(true);
    expect(v(n.sim, "g1.help_asks")).toBe(1);
    // Again inside the minute: reassured, no second alert.
    n.advance(30);
    const again = n.press("tent_help_me", "g1");
    expect(hostAlerts(again)).toEqual([]);
    expect(again.some((m) => m.text.includes("already on the way"))).toBe(true);
    // After it: a new alert.
    n.advance(31);
    expect(hostAlerts(n.press("tent_help_me", "g1"))).toHaveLength(1);
    expect(v(n.sim, "g1.help_asks")).toBe(2);
  });

  it("is not offered to a program who is not being reinstalled; a press then alerts nobody", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    expect(guestView(n.sim, "g1").interactions.map((i) => i.id)).not.toContain("tent_help_me");
    expect(hostAlerts(n.press("tent_help_me", "g1"))).toEqual([]);
    // A marked program at the tent's screen (its begin captures them) may call.
    n.raw("mark_for_reinstallation", "g1", { reason: "flagged by a host" });
    expect(hostAlerts(n.press("tent_help_me", "g1"))).toHaveLength(1);
  });
});

describe("wave 44: the credits at the very end (C3)", () => {
  it("G11 rolls them on every screen and phone; G12 rolls them again, only after", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    const early = n.press("roll_the_credits");
    expect(early.some((m) => m.channel === "room:hosts" && m.text.includes("🎬"))).toBe(true);
    expect(v(n.sim, "Night.credits_roll")).toBe(0);
    expect(nightView(n.sim).credits).toBeUndefined();
    n.press("computer_destroyed");
    n.press("start_the_ceremony");
    n.press("award_staff_mole");
    n.advance(5);
    n.press("resurrection");
    expect(v(n.sim, "Night.resurrected")).toBe(true);
    expect(v(n.sim, "Night.screen")).toBe("credits");
    expect(v(n.sim, "Night.terminals")).toBe("credits");
    expect(v(n.sim, "Night.credits_roll")).toBe(1);
    const first = nightView(n.sim).credits!;
    expect(first.roll).toBe(1);
    expect(first.at).toBe(v(n.sim, "Night.credits_at") * 1000);
    expect(guestView(n.sim, "g1").night?.credits).toEqual(first);
    n.advance(10);
    n.press("roll_the_credits");
    expect(nightView(n.sim).credits).toEqual({ roll: 2, at: first.at + 10_000 });
  });

  it("the show's credits.json has no problems and names no secret", () => {
    const dir = new URL("../examples/trapped-in-the-internet/", import.meta.url);
    const credits = readFileSync(new URL("credits.json", dir), "utf8");
    expect(creditsProblems(credits)).toEqual([]);
    const facts = JSON.parse(readFileSync(new URL("facts.json", dir), "utf8")) as Record<string, unknown>;
    const secrets: string[] = [];
    const walk = (x: unknown, key = ""): void => {
      if (typeof x === "string" && x.length >= 4 && /code|answer|combo|key/iu.test(key)) secrets.push(x);
      else if (Array.isArray(x)) x.forEach((y) => walk(y, key));
      else if (x !== null && typeof x === "object") for (const [k, y] of Object.entries(x)) walk(y, k);
    };
    walk(facts);
    expect(secrets.length).toBeGreaterThan(0);
    for (const s of secrets) expect(credits.includes(s), "a secret in credits.json").toBe(false);
  });
});
