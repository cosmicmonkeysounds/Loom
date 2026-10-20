//! Wave 13 delivery flags on composed chat messages (CONTRACTS §2.3): the
//! manner + fx on scripted lines, ambient barks, `~` notices, moments, the
//! readout's room, and the codex card's category / aboutKind.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { composeGuestMessages, type DraftMessage } from "../server/chat.ts";

const STORY = `# Delivery
start: Opening

ROLE Guest

LOCATION Hall

CHARACTER Wren

CHARACTER Truther Download
  crawl: fx

CHARACTER Norton
  when scanned by guest:
    reply Clean: {guest.name}.
  when alarm_tripped:
    reply !Server room breach.

CODEX The Kernel Notes
  about: Wren
  category: People
  text: She runs the lamp.

CODEX The Hall Plan
  about: Hall
  text: A plan.

CODEX Loose Lore
  about: the weather
  text: It rains.

CODEX No Subject
  text: Nothing.

QUEST Find The Duck
  from: Wren
  text: Go find it.

GENERATOR Hum
  tier: ambient
  every 10s
  yield bark from a hum

== Opening
  setting: Hall
The lights come on.

== Spoken
  setting: Hall
Wren (glitching, quietly): The lamp.
Wren (quietly): Still here.
Truther Download: I AM THE TRUTH
Narrator (static):
  The screens hiss.

== Asked
Wren (glitch):
  Pick one.
  * Yes.
    You said yes.

== Notices
broadcast "~✅ {guest.name} is accepted." to everyone
broadcast "!~Not a notice." to everyone
broadcast "Plain." to everyone

== Pins
pin "!Look up." for guest
pin "!!TAKEOVER" for guest
pin "Quiet pin." for guest

== Cards
show poll "Truth or dare?" to guest with moment: MAJOR
show image "A picture" to guest with moment: sideways
show captcha "Prove it" to guest

== Steps
start quest Find The Duck for guest
update quest Find The Duck for guest "Getting warmer."

== Self reply
reply !You are marked.
reply Your own readout.
`;

function compose(sim: Sim, events: ReturnType<Sim["fireBeat"]>): DraftMessage[] {
  return composeGuestMessages(sim, events);
}

describe("chat delivery — manner + fx", () => {
  it("carries the manner and marks effect manners and crawl: fx speakers as fx", () => {
    const sim = Sim.fromSources(STORY);
    const msgs = compose(sim, sim.fireBeat("Spoken"));
    const rows = msgs.map((m) => [m.text, m.manner, m.fx]);
    expect(rows).toEqual([
      ["The lamp.", "glitching, quietly", true],
      ["Still here.", "quietly", undefined],
      ["I AM THE TRUTH", undefined, true],
      ["The screens hiss.", "static", true],
    ]);
    expect(msgs[3]).toMatchObject({ kind: "narration", from: "Narrator" });
    expect("fx" in msgs[1]!).toBe(false);
  });

  it("keeps the manner + fx on a line after a choice", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g1", "Ada");
    compose(sim, sim.fireBeat("Asked", "g1"));
    const after = compose(sim, sim.choose("g1", 0));
    expect(after.find((m) => m.text === "You said yes.")).toMatchObject({ manner: "glitch", fx: true, kind: "line" });
  });
});

describe("chat delivery — ambient, notices, moments", () => {
  it("flags a GENERATOR bark as ambient", () => {
    const sim = Sim.fromSources(STORY);
    const msgs = compose(sim, sim.tick(10_000));
    expect(msgs.find((m) => m.text === "a hum")).toMatchObject({ ambient: true, kind: "narration", channel: "lobby" });
  });

  it("a ~ cue is a notice keyed by its glyph; an alert is never a notice and is a major moment", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g1", "Ada");
    const msgs = compose(sim, sim.fireBeat("Notices", "g1"));
    const notice = msgs.find((m) => m.text.includes("is accepted"))!;
    expect(notice).toMatchObject({ text: "✅ Ada is accepted.", notice: "✅" });
    expect(notice.moment).toBeUndefined();
    const alert = msgs.find((m) => m.text.includes("Not a notice"))!;
    expect(alert).toMatchObject({ alert: true, moment: "major" });
    expect(alert.notice).toBeUndefined();
    expect(alert.text.startsWith("~")).toBe(true);
    const plain = msgs.find((m) => m.text === "Plain.")!;
    expect(plain.notice).toBeUndefined();
    expect(plain.moment).toBeUndefined();
  });

  it("a ! pin is a major moment; a takeover and a quiet pin are not moments", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g1", "Ada");
    const msgs = compose(sim, sim.fireBeat("Pins", "g1"));
    expect(msgs.find((m) => m.text === "Look up.")).toMatchObject({ alert: true, moment: "major" });
    const takeover = msgs.find((m) => m.text === "TAKEOVER")!;
    expect(takeover).toMatchObject({ takeover: true, alert: true });
    expect(takeover.moment).toBeUndefined();
    expect(msgs.find((m) => m.text === "Quiet pin.")!.moment).toBeUndefined();
  });

  it("a card's moment param (case-insensitive) makes it a moment; the param stays", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g1", "Ada");
    const msgs = compose(sim, sim.fireBeat("Cards", "g1"));
    const poll = msgs.find((m) => m.widget?.kind === "poll")!;
    expect(poll.moment).toBe("major");
    expect(poll.widget!.params["moment"]).toBe("MAJOR");
    expect(msgs.find((m) => m.widget?.kind === "image")!.moment).toBeUndefined();
    expect(msgs.find((m) => m.widget?.kind === "captcha")!.moment).toBeUndefined();
  });

  it("a quest's start is a minor moment; a later step is not", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g1", "Ada");
    const msgs = compose(sim, sim.fireBeat("Steps", "g1")).filter((m) => m.kind === "quest");
    expect(msgs.map((m) => [m.quest!.action, m.moment])).toEqual([
      ["start", "minor"],
      ["update", undefined],
    ]);
  });
});

describe("chat delivery — readouts", () => {
  it("a booth readout lands in the character's dm: Inbox, addressed @<Character>, about the guest", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g1", "Ada");
    const msgs = compose(sim, sim.scan("Norton", "g1"));
    const readout = msgs.find((m) => m.readout === true)!;
    expect(readout).toMatchObject({
      channel: "dm:Norton",
      channelKind: "dm",
      title: "Norton",
      from: "",
      kind: "narration",
      text: "Clean: Ada.",
      audience: ["@Norton"],
      about: "g1",
      moment: "minor",
    });
    expect(readout.alert).toBeUndefined();
  });

  it("a reply ! to a character is a major alert, the ! stripped", () => {
    const sim = Sim.fromSources(STORY);
    const msgs = compose(sim, sim.signal("alarm_tripped"));
    const readout = msgs.find((m) => m.readout === true)!;
    expect(readout).toMatchObject({ channel: "dm:Norton", text: "Server room breach.", alert: true, moment: "major", audience: ["@Norton"] });
    expect(readout.about).toBeUndefined();
  });

  it("a person's own readout stays in their lobby feed: minor, or major when it is a ! alert", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g1", "Ada");
    const msgs = compose(sim, sim.fireBeat("Self reply", "g1")).filter((m) => m.readout);
    expect(msgs.map((m) => [m.channel, m.text, m.audience, m.alert, m.moment])).toEqual([
      ["lobby", "You are marked.", ["g1"], true, "major"],
      ["lobby", "Your own readout.", ["g1"], undefined, "minor"],
    ]);
  });

  it("a reply with nobody to answer is the lobby's, for everyone, no moment", () => {
    const sim = Sim.fromSources(STORY);
    const [m] = composeGuestMessages(sim, [{ type: "respond", to: "", text: "House notice." }]);
    expect(m).toMatchObject({ channel: "lobby", audience: "all", readout: true });
    expect(m!.moment).toBeUndefined();
  });
});

describe("chat delivery — codex cards", () => {
  it("carries the entry's category and what its about: names", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g1", "Ada");
    const cards = ["The Kernel Notes", "The Hall Plan", "Loose Lore", "No Subject"].map((entry) => {
      const msgs = compose(sim, sim.unlock("g1", entry));
      return msgs.find((m) => m.kind === "codex")!.codex!;
    });
    expect(cards.map((c) => [c.entry, c.category, c.aboutKind])).toEqual([
      ["The Kernel Notes", "People", "character"],
      ["The Hall Plan", undefined, "location"],
      ["Loose Lore", undefined, "topic"],
      ["No Subject", undefined, undefined],
    ]);
    expect("category" in cards[1]!).toBe(false);
    expect("aboutKind" in cards[3]!).toBe(false);
  });
});
