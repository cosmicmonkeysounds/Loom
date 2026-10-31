// Wave 55 (docs/loom-w55-contract.md): a beat's `aloud:` line marks what a
// live person reads out loud, over a tiny story and the real show.

import { describe, expect, it } from "vitest";
import { scenarioSource } from "../examples/load.ts";
import { aloudReaders, aloudSpeakers, boothOwnRow, capHistory, ChatStore, composeGuestMessages, guestOwnRow, type ChatMessage } from "../server/chat.ts";
import { forGuest } from "../server/event-runtime.ts";
import { aloudPush } from "../server/push.ts";
import { notePress } from "../server/views.ts";
import { Workspace } from "../src/lsp/workspace.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";

const SHOW = scenarioSource("trapped-in-the-internet");
const SLOW = 120_000;

const TINY = `
TITLE: Tiny

CHARACTER Clippy

CHARACTER Trabolta

== Speech
  setting: The Desktop
  aloud: Clippy
Narrator: The lights dim.
Clippy (dejectedly): Read me.
Trabolta: A cue for her.

== Plain
  setting: The Desktop
Clippy: Nobody reads me.

== Bobber
  setting: The Desktop
  aloud: {Night.bobber}
Narrator: This is the truth.
Clippy: Still a cue.
`;

describe("wave 55: `aloud:` over a tiny story", () => {
  const compose = (sim: Sim, beat: string) => composeGuestMessages(sim, sim.fireBeat(beat));

  it("marks a part's own lines, and leaves the rest of the beat as cues", () => {
    const sim = Sim.fromSources(TINY);
    const msgs = compose(sim, "Speech");
    expect(msgs.map((m) => [m.from, m.aloud])).toEqual([
      ["Narrator", { readers: ["@Clippy"] }],
      ["Clippy", { readers: ["@Clippy"], reader: "@Clippy" }],
      ["Trabolta", { readers: ["@Clippy"] }],
    ]);
    expect(msgs[1]!.manner).toBe("dejectedly");
    expect(msgs[1]!.beat).toBe("Speech");
    expect(aloudSpeakers(msgs)).toEqual(["@Clippy"]);
  });

  it("never marks a beat that says nothing", () => {
    const sim = Sim.fromSources(TINY);
    expect(compose(sim, "Plain").every((m) => m.aloud === undefined)).toBe(true);
  });

  it("gives a program reader the narration, and nobody the beat until the story names one", () => {
    const sim = Sim.fromSources(TINY);
    sim.createPerson("g-1", "Microsoft Excel");
    expect(compose(sim, "Bobber").every((m) => m.aloud === undefined)).toBe(true);
    sim.setVar("Night.bobber", "Microsoft Excel");
    const msgs = compose(sim, "Bobber").filter((m) => m.beat === "Bobber");
    expect(msgs.map((m) => [m.from, m.aloud])).toEqual([
      ["Narrator", { readers: ["g-1"], reader: "g-1" }],
      ["Clippy", { readers: ["g-1"] }],
    ]);
  });

  it("keeps a reader's lines through the history cap, for that reader alone", () => {
    const row = (seq: number, aloud?: ChatMessage["aloud"]): ChatMessage =>
      ({ seq, channel: "loc:The Desktop", channelKind: "location", title: "The Desktop", from: "Clippy", kind: "line", text: "x", ts: 0, audience: "all", parentSeq: null, hidden: false, ...(aloud !== undefined ? { aloud } : {}) }) as ChatMessage;
    const msgs = [row(1, { readers: ["@Clippy", "g-1"], reader: "@Clippy" }), row(2), row(3), row(4)];
    expect(capHistory(msgs, 1, boothOwnRow("Clippy")).map((m) => m.seq)).toEqual([1, 4]);
    expect(capHistory(msgs, 1, guestOwnRow("g-1")).map((m) => m.seq)).toEqual([1, 4]);
    expect(capHistory(msgs, 1, boothOwnRow("Norton")).map((m) => m.seq)).toEqual([4]);
    expect(capHistory(msgs, 1, guestOwnRow("g-2")).map((m) => m.seq)).toEqual([4]);
  });

  it("strips the mark from every guest but the reader", () => {
    const m = { seq: 1, from: "Narrator", aloud: { readers: ["g-1"], reader: "g-1" } } as unknown as ChatMessage;
    expect(forGuest(m, null, "g-1").aloud).toEqual({ readers: ["g-1"], reader: "g-1" });
    expect(forGuest(m, null, "g-2").aloud).toBeUndefined();
    expect(forGuest({ ...m, via: "Director" }, null, "g-1")).not.toHaveProperty("via");
  });

  it("pushes a short, spoiler-free title", () => {
    expect(aloudPush("Truth Txt")).toEqual({ kind: "alert", title: "📜 Read this out loud", body: "Truth Txt", tag: "aloud", url: "/" });
  });

  it("lints an `aloud:` that reaches nobody", () => {
    const w = new Workspace();
    w.open("file:///a.loom", TINY.replace("aloud: Clippy", "aloud: Clipy, Trabolta"));
    const codes = (w.diagnosticsFor("file:///a.loom")?.diagnostics ?? []).filter((d) => d.code === "L1227");
    expect(codes.length).toBeGreaterThanOrEqual(1);
    expect(codes[0]!.message).toContain("Clipy");
  });
});

class Night {
  readonly sim = Sim.fromSources(SHOW);
  readonly chat = new ChatStore();
  constructor() {
    this.take(this.sim.fireBeat("Power On"));
  }
  take(events: SimEvent[]): ChatMessage[] {
    return this.chat.append(composeGuestMessages(this.sim, events));
  }
  press(name: string, subject?: string, args?: Record<string, string>): ChatMessage[] {
    const ev = this.sim.signal(name, subject, args);
    notePress(this.sim, ev);
    return this.take(ev);
  }
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
  /** The house after `ending`, its host set as `start_the_ceremony` does. */
  ended(ending: string): this {
    this.sim.setVar("Night.ending", ending);
    this.sim.setVar("Night.ended", "true");
    this.sim.setVar("Night.ceremony_host", ending === "destroyed" || ending === "rave" ? "Clippy" : "Trabolta");
    return this;
  }
}

const said = (msgs: readonly ChatMessage[], reader: string) => msgs.filter((m) => m.aloud?.reader === reader);

describe("wave 55: the show's read-aloud beats", () => {
  it("every mark names someone real, so no line goes missing on the night", { timeout: SLOW }, () => {
    const sim = Sim.fromSources(SHOW);
    const marked = [...sim.model.beats.values()].filter((b) => b.contract.has("aloud"));
    expect(marked.map((b) => b.name).sort()).toEqual(
      [
        "Ad Hijack", "Bathroom Report", "Bingo Prize", "Bingo Time", "Bobbing For Truth", "Clippy On Trabolta", "Computer Bingo", "Corrupted Code",
        "Filing Closed", "Final Reveal", "First Moment Of Truth", "Five Minute Warning", "Following The Reinstallation", "Full Of Beans", "Hunt Two Go",
        "Language Report", "No Bingos", "Present Award", "Purgatory", "Second Hunt", "Shy Winner", "The Ceremony", "The Full Truth Read", "The Goals Report",
        "The Night In Review", "The Report On Everyone", "The Rest Of The Report",
        "Truth Pong", "Truth Txt", "What We Did", "Winning Line",
      ].sort(),
    );
    for (const b of marked.filter((m) => m.name !== "Truth Txt")) expect(aloudReaders(sim, b.name).length, b.name).toBeGreaterThan(0);
  });

  it("gives Clippy the whole opening, every line hers, the hosts none (wave 58)", { timeout: SLOW }, () => {
    const n = new Night();
    const msgs = n.take(n.sim.fireBeat("Computer Bingo"));
    expect(said(msgs, "@Clippy").length).toBeGreaterThan(8);
    for (const host of ["@Task Manager", "@Adobe Acrobat", "@Recycling Bin"]) expect(said(msgs, host), host).toEqual([]);
    expect(msgs.every((m) => m.aloud === undefined || m.aloud.readers.join() === "@Clippy")).toBe(true);
    // Each branch is its own section, read by her alone, and in the room.
    for (const beat of ["Winning Line", "Bingo Prize", "Shy Winner", "Following The Reinstallation", "Clippy On Trabolta", "First Moment Of Truth", "Filing Closed"]) {
      const hers = said(n.take(n.sim.fireBeat(beat)), "@Clippy");
      expect(hers.length, beat).toBeGreaterThan(0);
      expect(hers.every((m) => m.audience === "all" && m.channel === "loc:The Desktop"), beat).toBe(true);
    }
  });

  it("his speech is the TV's: no teleprompter on it (wave 58)", { timeout: SLOW }, () => {
    const n = new Night();
    for (const beat of ["Trabolta Introduction", "Trabolta Greeting", "Hunt One Go", "Truth Scavenger Hunt One"]) expect(n.sim.model.beats.get(beat)?.contract.has("aloud"), beat).toBe(false);
  });

  it("reads the whole of Purgatory to Clippy, shared beats and all", { timeout: SLOW }, () => {
    const n = new Night().ended("destroyed");
    n.upload("g-1", "Microsoft Excel");
    const msgs = n.take(n.sim.fireBeat("Purgatory"));
    const hers = said(msgs, "@Clippy");
    expect(new Set(hers.map((m) => m.beat))).toEqual(new Set(["Purgatory", "What We Did", "The Goals Report"]));
    expect(hers[0]!.text).toMatch(/^This summary was auto-generated/u);
    expect(hers.at(-1)!.text).toBe("It looks like you're trying to leave. I can't help you with that anymore.");
    expect(hers.every((m) => m.audience === "all" && m.channel === "loc:The Desktop")).toBe(true);
    expect(msgs.find((m) => m.from === "Narrator")?.aloud).toEqual({ readers: ["@Clippy"] });
  });

  it("gives Clippy the ceremony when she hosts, an award at a time, in the room", { timeout: SLOW }, () => {
    const n = new Night().ended("destroyed");
    n.upload("g-1", "Microsoft Excel");
    const open = (n.press("start_the_ceremony"), n.press("start_the_ceremony"));
    expect(said(open, "@Clippy").some((m) => m.beat === "The Ceremony")).toBe(true);
    const award = n.press("award_most_trusted", "g-1", { value: "12" });
    const hers = said(award, "@Clippy");
    expect(hers.map((m) => m.beat)).toEqual(["Present Award"]);
    expect(hers[0]!.text).toContain("The report lists Microsoft Excel");
    expect(hers[0]!.audience).toBe("all");
  });

  it("leaves Clippy nothing to read when Trabolta hosts: his lines are only cues", { timeout: SLOW }, () => {
    const n = new Night().ended("song");
    n.upload("g-1", "Microsoft Excel");
    const msgs = [...(n.press("start_the_ceremony"), n.press("start_the_ceremony")), ...n.press("award_most_trusted", "g-1", { value: "12" })];
    expect(said(msgs, "@Clippy")).toEqual([]);
    expect(msgs.some((m) => m.from === "Trabolta" && m.aloud?.readers[0] === "@Clippy")).toBe(true);
  });

  // OpenOffice is a featured program: a guest, and a CHARACTER too.
  it("hands truth.txt to the program who brought up the bag", { timeout: SLOW }, () => {
    const n = new Night();
    n.upload("g-1", "Microsoft Excel");
    n.upload("g-2", "OpenOffice");
    n.sim.setVar("Night.bobber", "OpenOffice");
    const msgs = n.take(n.sim.fireBeat("Truth Txt"));
    const lines = said(msgs, "g-2");
    expect(lines[0]!.text).toBe("📄 truth.txt — Notepad");
    expect(lines.at(-1)!.text).toBe("End of file.");
    expect(lines.some((m) => m.text.includes("her name is Sandy"))).toBe(true);
    expect(said(msgs, "g-1")).toEqual([]);
  });

  it("leaves the quick reactions out, so a mid-game phone is never blocked", { timeout: SLOW }, () => {
    const n = new Night();
    for (const beat of ["Hunt One Go", "Summons Closed", "Trust Chart", "Praise The Top"]) {
      expect(n.sim.model.beats.get(beat)?.contract.has("aloud"), beat).toBe(false);
    }
  });
});
