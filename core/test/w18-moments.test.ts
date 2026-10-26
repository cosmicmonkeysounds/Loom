//! Wave 18 C1 + C2 + C3 on composed chat: the `big` moment class (`!!` on
//! `reply` / `broadcast`, `show … with moment: big`, `with close:`), the
//! moment exits (`with go: …` resolved to `GoTarget`s, the defaults, never
//! the lobby, a guest's unseen rooms dropped) and a booth readout's guest by
//! name and picture.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { composeGuestMessages, goForViewer, readoutText, splitAlert, type ChatMessage, type DraftMessage } from "../server/chat.ts";
import { parseCloseMs, resolveGoWord, splitMomentArgs } from "../src/go.ts";
import { statementToDirective } from "../src/parser/statements.ts";

const STORY = `# Moments
start: Opening

ROLE Program
  marked: bool = false

GROUP Unlimited Power

LOCATION The Desktop

LOCATION The Internet
  label: The Internet (the tent)

LOCATION Server Room
  hidden: true

CHANNEL hosts
  kind: faction
  faction: Unlimited Power

CHARACTER Clippy

CHARACTER Norton
  when scanned by program:
    reply !!🛡 Corruption found on {program.name}.
  when nudge for program:
    reply "Seen {program.name}." with go: pass

CODEX The Sandy File
  code: SANDY
  text: A file.

QUEST The Cold Door
  from: Clippy
  text: Find the digits.

INTERACTION i have bingo
  label: 🎱 I have BINGO
  who: guest

INTERACTION nudge
  who: performer

== Opening
  setting: The Desktop
Hello.

== Big
  setting: The Desktop
reply !!You won the Bingo Ribbon.
broadcast "!!Encarta won the Bingo Ribbon — cheer!" to everyone with go: The Desktop, close: 6s
broadcast "!Come to the Desktop." to everyone with go: The Desktop, go: i have bingo, go: lobby, go: nowhere
show poll "Pick one" to guest with moment: big, question: "P1"

== Go words
  setting: The Desktop
reply "Sent to the Internet." with go: The Internet, go: pass
reply Prose with go: pass stays prose
pin "!Head to the tent." for guest with go: The Internet
broadcast "Look." to everyone with go: Server Room, go: codex: The Sandy File, go: quest: The Cold Door, go: wallet as "Count your coin"

== Gifts
unlock The Sandy File for guest
start quest The Cold Door for guest
Clippy: Here.
show captcha "Prove it" to guest

== Typo go
Clippy: Again.
show captcha "Again" to guest with go: nowhere
`;

function compose(sim: Sim, events: ReturnType<Sim["fireBeat"]>): DraftMessage[] {
  return composeGuestMessages(sim, events, { avatarOf: (name) => (name === "Ada" ? "k-ada" : null) });
}

function setup(): Sim {
  const sim = Sim.fromSources(STORY);
  sim.createPerson("g1", "Ada");
  sim.createPerson("g2", "Bo");
  return sim;
}

describe("C1: the big moment class", () => {
  it("splitAlert and readoutText learn `!!`, both marks stripped", () => {
    expect(splitAlert("!!Big")).toEqual({ cue: "Big", alert: true, big: true });
    expect(splitAlert('"!!Big."')).toEqual({ cue: '"Big."', alert: true, big: true });
    expect(splitAlert("!One")).toEqual({ cue: "One", alert: true });
    expect(readoutText("!!🛡 Found.")).toEqual({ text: "🛡 Found.", alert: true, big: true });
    expect(readoutText("Plain.")).toEqual({ text: "Plain.", alert: false });
  });

  it("reply !!, broadcast \"!!…\" and show … with moment: big are big; close: rides only a big moment to two or more", () => {
    const sim = setup();
    const msgs = compose(sim, sim.fireBeat("Big", "g1"));
    const won = msgs.find((m) => m.text === "You won the Bingo Ribbon.")!;
    expect(won).toMatchObject({ readout: true, alert: true, moment: "big", audience: ["g1"] });
    expect(won.autoClose).toBeUndefined();
    const cheer = msgs.find((m) => m.text.startsWith("Encarta"))!;
    expect(cheer).toMatchObject({ alert: true, moment: "big", autoClose: 6000, audience: "all" });
    expect(cheer.text).toBe("Encarta won the Bingo Ribbon — cheer!");
    const one = msgs.find((m) => m.text === "Come to the Desktop.")!;
    expect(one.moment).toBe("major");
    const card = msgs.find((m) => m.kind === "widget")!;
    expect(card).toMatchObject({ moment: "big", widget: { kind: "poll", params: { question: "P1", moment: "big" } } });
  });

  it("a booth readout `reply !!…` is big too, and carries its guest (C3)", () => {
    const sim = setup();
    const msgs = compose(sim, sim.scan("Norton", "g1"));
    const r = msgs.find((m) => m.readout === true && m.channel === "dm:Norton")!;
    expect(r).toMatchObject({ moment: "big", about: "g1", aboutName: "Ada", aboutAvatar: "k-ada", text: "🛡 Corruption found on Ada." });
    const bo = compose(sim, sim.scan("Norton", "g2")).find((m) => m.channel === "dm:Norton")!;
    expect(bo).toMatchObject({ about: "g2", aboutName: "Bo" });
    expect(bo.aboutAvatar).toBeUndefined();
  });

  it("a `pin \"!!…\"` keeps meaning the takeover (never big)", () => {
    const sim = Sim.fromSources(`${STORY}\n== Takeover\npin "!!GO TO THE LIVING ROOM"\n`);
    const msgs = composeGuestMessages(sim, sim.fireBeat("Takeover"));
    expect(msgs[0]).toMatchObject({ takeover: true, alert: true });
    expect(msgs[0]!.moment).toBeUndefined();
  });
});

describe("C2: with go:", () => {
  it("parses the tail: go words in order, close in ms, the rest passed on", () => {
    expect(splitMomentArgs('go: The Internet, go: codex: The Sandy File, close: 6s, moment: big, question: "a, b"')).toEqual({
      go: ["The Internet", "codex: The Sandy File"],
      close: 6000,
      // Wave 26 (C1): `ack:` is split off too (null: not written).
      ack: null,
      rest: 'moment: big, question: "a, b"',
    });
    expect(parseCloseMs("1.5s")).toBe(1500);
    expect(parseCloseMs("800ms")).toBe(800);
    expect(parseCloseMs("soon")).toBeNull();
  });

  it("pin / broadcast / reply / show statements accept the tail", () => {
    expect(statementToDirective('pin "x" for program with go: pass')).toBe('pin: "x" for program with go: pass');
    expect(statementToDirective('broadcast "x" to everyone with go: pass')).toBe('broadcast: "x" to everyone with go: pass');
    expect(statementToDirective('show poll "x" to program with go: pass, moment: big')).toBe('show: poll "x" to program with go: pass, moment: big');
  });

  it("resolves the words: places, channels, characters, guest buttons, codex / quests entries, reserved words; never the lobby", () => {
    const sim = setup();
    const r = (w: string) => resolveGoWord(sim.model, w);
    expect(r("The Desktop")).toEqual({ kind: "room", id: "loc:The Desktop", label: "Go to The Desktop" });
    expect(r("the internet (the tent)")).toEqual({ kind: "room", id: "loc:The Internet", label: "Go to The Internet" });
    expect(r("# hosts")).toMatchObject({ kind: "room", id: "room:hosts" });
    expect(r("Clippy")).toEqual({ kind: "dm", id: "dm:Clippy", label: "Open Clippy" });
    expect(r("i have bingo")).toEqual({ kind: "act", id: "i have bingo", label: "🎱 I have BINGO" });
    expect(r("nudge")).toBeNull(); // a performer's button is no guest exit
    expect(r("codex: the sandy file")).toEqual({ kind: "codex", entry: "The Sandy File", label: "Read “The Sandy File”" });
    expect(r("quest: The Cold Door")).toEqual({ kind: "quests", quest: "The Cold Door", label: "See the quest" });
    expect(r("pass")).toEqual({ kind: "pass", label: "Show my pass" });
    expect(r("Codex")).toEqual({ kind: "codex", label: "Open the Codex" });
    expect(r('scan as "Check in"')).toEqual({ kind: "scan", label: "Check in" });
    expect(r("lobby")).toBeNull();
    expect(r("nowhere")).toBeNull();
  });

  it("composed moments carry their exits, unknown words and the lobby dropped", () => {
    const sim = setup();
    const big = compose(sim, sim.fireBeat("Big", "g1"));
    expect(big.find((m) => m.text === "Come to the Desktop.")!.go).toEqual([
      { kind: "room", id: "loc:The Desktop", label: "Go to The Desktop" },
      { kind: "act", id: "i have bingo", label: "🎱 I have BINGO" },
    ]);
    const msgs = compose(sim, sim.fireBeat("Go words", "g1"));
    const sent = msgs.find((m) => m.text === "Sent to the Internet.")!;
    expect(sent.go).toEqual([
      { kind: "room", id: "loc:The Internet", label: "Go to The Internet" },
      { kind: "pass", label: "Show my pass" },
    ]);
    // Unquoted text keeps "with" as prose (lint L1214 says so).
    const prose = msgs.find((m) => m.text.startsWith("Prose"))!;
    expect(prose.text).toBe("Prose with go: pass stays prose");
    expect(prose.go).toBeUndefined();
    const pin = msgs.find((m) => m.pin !== undefined)!;
    expect(pin).toMatchObject({ text: "Head to the tent.", go: [{ kind: "room", id: "loc:The Internet" }] });
    const look = msgs.find((m) => m.text === "Look.")!;
    expect(look.go).toEqual([
      { kind: "room", id: "loc:Server Room", label: "Go to Server Room" },
      { kind: "codex", entry: "The Sandy File", label: "Read “The Sandy File”" },
      { kind: "quests", quest: "The Cold Door", label: "See the quest" },
      { kind: "wallet", label: "Count your coin" },
    ]);
  });

  it("a guest never gets an exit to a room they cannot see (goForViewer)", () => {
    const sim = setup();
    const look = compose(sim, sim.fireBeat("Go words", "g1")).find((m) => m.text === "Look.")!;
    const m = { ...look, seq: 0, hidden: false } as ChatMessage;
    expect(goForViewer(m, sim, "g1").go!.map((t) => t.kind)).toEqual(["codex", "quests", "wallet"]);
    sim.reveal("Server Room");
    expect(goForViewer(m, sim, "g1").go!.map((t) => t.kind)).toEqual(["room", "codex", "quests", "wallet"]);
    const only = { ...m, go: [{ kind: "room" as const, id: "room:hosts", label: "Open #hosts" }] };
    expect("go" in goForViewer(only, sim, "g1")).toBe(false);
  });

  it("the defaults: a card's thread, a codex entry, a quest step's quest, never the lobby", () => {
    const sim = setup();
    const msgs = compose(sim, sim.fireBeat("Gifts", "g1"));
    expect(msgs.find((m) => m.kind === "codex")!.go).toEqual([{ kind: "codex", entry: "The Sandy File", label: "Read “The Sandy File”" }]);
    expect(msgs.find((m) => m.kind === "quest")!.go).toEqual([{ kind: "quests", quest: "The Cold Door", label: "See the quest" }]);
    expect(msgs.find((m) => m.kind === "widget")!.go).toEqual([{ kind: "dm", id: "dm:Clippy", label: "Open Clippy" }]);
    // A readout or broadcast in the lobby gets no default exit.
    for (const m of compose(sim, sim.fireBeat("Big", "g1"))) {
      for (const t of m.go ?? []) expect(t.kind === "room" && t.id === "lobby").toBe(false);
    }
    expect(compose(sim, sim.fireBeat("Big", "g1")).find((m) => m.text === "You won the Bingo Ribbon.")!.go).toBeUndefined();
  });

  it("a go: that resolves to nothing keeps the card's default exit (m6)", () => {
    const sim = setup();
    const card = compose(sim, sim.fireBeat("Typo go", "g1")).find((m) => m.kind === "widget")!;
    expect(card.go).toEqual([{ kind: "dm", id: "dm:Clippy", label: "Open Clippy" }]);
  });

  it("a reply with a quoted text strips the quotes only when a tail follows", () => {
    const sim = setup();
    const msgs = compose(sim, sim.signal("nudge", "g1", null, "Norton"));
    expect(msgs.find((m) => m.channel === "dm:Norton")).toMatchObject({ text: "Seen Ada.", go: [{ kind: "pass" }] });
  });
});
