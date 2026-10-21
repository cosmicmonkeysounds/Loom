//! Hidden rooms, places and people (Loom 4 rooms): `hidden: true` on a
//! LOCATION / CHANNEL / CHARACTER keeps it off a guest's phone until the
//! story `reveal`s it (to everyone, or `for` one participant) — a hidden
//! place also appears once you have stood there. `cutscene: true` on a
//! location puts the app on rails while a guest stands there.

import { describe, expect, it } from "vitest";
import { statementToDirective } from "../src/parser/statements.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { composeGuestMessages } from "../server/chat.ts";
import { guestView, primeView } from "../server/views.ts";

const SOURCE = `# Hidden House
start: Boot

GROUP The Society
  hidden: true

LOCATION Porch
  label: The Porch
  cutscene: true

LOCATION Hall
  label: The Hall

LOCATION Cellar
  label: The Cellar
  hidden: true

LOCATION Attic
  hidden: true

SPACE Rooms
  CHANNEL general
    kind: open
  CHANNEL task manager
    kind: open
    hidden: true
  CHANNEL secrets
    kind: private
    hidden: true

CHARACTER Task Manager
  listed: true

CHARACTER The Ghost
  listed: true
  hidden: true
  mind: external

ROLE Guest
  when someone joins:
    move guest to Porch
  when walk in for guest:
    move guest to Hall
  when the doors open for guest:
    reveal Cellar for guest
    reveal task manager for guest
    reveal The Ghost for guest
  when nothing for guest:
    reveal Nowhere for guest

when the house opens:
  reveal Attic
  reveal task manager
  reveal The Ghost
  reveal The Society

== Boot
The house.
`;

function fresh(): Sim {
  return Sim.fromSources(SOURCE);
}
const rooms = (sim: Sim, id: string) => guestView(sim, id).channels.map((c) => c.id).sort();
const people = (sim: Sim, id: string) => guestView(sim, id).people.map((p) => p.id).sort();

describe("`reveal` as a statement", () => {
  it("accepts a bare name, a lowercase multi-word room, and `for who`", () => {
    expect(statementToDirective("reveal The Society")).toBe("reveal: The Society");
    expect(statementToDirective("reveal task manager")).toBe("reveal: task manager");
    expect(statementToDirective("reveal The Cellar for guest")).toBe("reveal: The Cellar for guest");
    // Prose that merely starts with the word stays prose.
    expect(statementToDirective("reveal nothing to anyone about the cellar tonight")).toBeNull();
  });
});

describe("hidden places", () => {
  it("are listed once you have stood there, and stay listed after you leave", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    expect(rooms(sim, "g1")).toEqual(["loc:Hall", "loc:Porch", "room:general"]);
    sim.arrive("g1", "Cellar");
    expect(rooms(sim, "g1")).toContain("loc:Cellar");
    sim.arrive("g1", "Hall");
    expect(rooms(sim, "g1")).toContain("loc:Cellar");
    expect(sim.hasVisited("g1", "Cellar")).toBe(true);
    expect(sim.hasVisited("g1", "Attic")).toBe(false);
  });

  it("open for one participant with `reveal X for who` — and for nobody else", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    sim.createPerson("g2", "Bob");
    const evs = sim.signal("the doors open", "g1");
    expect(rooms(sim, "g1")).toEqual(["loc:Cellar", "loc:Hall", "loc:Porch", "room:general", "room:task manager"]);
    expect(rooms(sim, "g2")).toEqual(["loc:Hall", "loc:Porch", "room:general"]);
    expect(people(sim, "g1")).toContain("The Ghost");
    expect(people(sim, "g2")).not.toContain("The Ghost");
    expect(evs.filter((e) => e.type === "revealed")).toEqual([
      { type: "revealed", target: "Cellar", kind: "location", person: "g1" },
      { type: "revealed", target: "room:task manager", kind: "channel", person: "g1" },
      { type: "revealed", target: "The Ghost", kind: "character", person: "g1" },
    ]);
    // Rooms announce themselves to the one they opened for (a place and a
    // chat room opening together are one notice); a person does not.
    const notices = composeGuestMessages(sim, evs).filter((m) => m.kind === "system");
    expect(notices.map((m) => [m.text, m.audience])).toEqual([["📂 The Cellar and #task manager are open now.", ["g1"]]]);
    // Idempotent: revealing again records nothing.
    expect(sim.signal("the doors open", "g1").some((e) => e.type === "revealed")).toBe(false);
    // An unknown target is ignored.
    expect(sim.signal("nothing", "g1").some((e) => e.type === "revealed")).toBe(false);
  });

  it("a house opening room by room is one notice, not one per room", () => {
    const sim = Sim.fromSources(`# Rooms
LOCATION Hall
LOCATION Cellar
  label: The Cellar (downstairs)
  hidden: true
LOCATION Attic
  hidden: true
LOCATION Shed
  hidden: true
SPACE Rooms
  CHANNEL secrets
    kind: open
    hidden: true
ROLE Guest
  when cleared for guest:
    reveal Cellar for guest
    reveal Attic for guest
    reveal Shed for guest
    reveal secrets for guest
    reveal Attic for guest
`);
    sim.createPerson("g1", "Ada");
    sim.createPerson("g2", "Bob");
    const notices = composeGuestMessages(sim, sim.signal("cleared", "g1")).filter((m) => m.kind === "system");
    // A run of places and rooms is one line, listed by name (labels lose
    // their parenthetical); a repeat records nothing (W6 B6).
    expect(notices.map((m) => [m.text, m.audience])).toEqual([["📂 The Cellar, Attic, Shed and #secrets are open now.", ["g1"]]]);
    // The next person's run is their own notice.
    const both = [...sim.signal("cleared", "g2")];
    expect(composeGuestMessages(sim, both).filter((m) => m.kind === "system").map((m) => m.audience)).toEqual([["g2"]]);
  });

  it("a room first, then places, is one notice; a line in between starts a new one (W6 B6)", () => {
    const sim = Sim.fromSources(`# Rooms
LOCATION Hall
LOCATION Cellar
  hidden: true
SPACE Rooms
  CHANNEL desk
    kind: open
    hidden: true
  CHANNEL vault
    kind: open
    hidden: true
CHARACTER Clerk
ROLE Guest
  when cleared for guest:
    reveal desk for guest
    reveal Cellar for guest
    Clerk: Welcome in.
    reveal vault for guest
`);
    sim.createPerson("g1", "Ada");
    const notices = composeGuestMessages(sim, sim.signal("cleared", "g1")).filter((m) => m.kind === "system");
    expect(notices.map((m) => m.text)).toEqual(["📂 #desk and Cellar are open now.", "📂 #vault is open now."]);
  });

  it("open for everyone with a bare `reveal X`, including a late arrival", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    const evs = sim.signal("the house opens");
    expect(rooms(sim, "g1")).toEqual(["loc:Attic", "loc:Hall", "loc:Porch", "room:general", "room:task manager"]);
    expect(people(sim, "g1")).toContain("The Ghost");
    sim.createPerson("g2", "Bob");
    expect(rooms(sim, "g2")).toContain("loc:Attic");
    expect(people(sim, "g2")).toContain("The Ghost");
    // A faction keeps its own reveal path (unmasked for the party).
    expect(evs.some((e) => e.type === "factionRevealed" && e.faction === "The Society")).toBe(true);
    expect(sim.factionRevealed("The Society")).toBe(true);
    // The place + room are one notice, the faction its own.
    const notices = composeGuestMessages(sim, evs).filter((m) => m.kind === "system");
    expect(notices.map((m) => m.audience)).toEqual(["all", "all"]);
    expect(notices[0]!.text).toBe("📂 Attic and #task manager are open now.");
    // `reveal task manager` opened the room, not CHARACTER Task Manager.
    expect(evs.filter((e) => e.type === "revealed").map((e) => (e as { target: string }).target)).toEqual(["Attic", "room:task manager", "The Ghost"]);
  });

  it("a hidden membership-gated room still needs membership once revealed", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    sim.reveal("room:secrets");
    expect(rooms(sim, "g1")).not.toContain("room:secrets");
    sim.inviteToChannel("g1", "g1", "room:secrets");
    expect(rooms(sim, "g1")).toContain("room:secrets");
  });

  it("never hide anything from a performer or an operator", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    const booth = primeView(sim, "Task Manager").channels.map((c) => c.id);
    expect(booth).toContain("loc:Cellar");
    expect(booth).toContain("loc:Attic");
    expect(booth).toContain("room:task manager");
    expect(sim.allChannelsFor("g1").map((c) => c.id)).toContain("loc:Attic");
  });

  it("`Sim.reveal` is the mod's twin: any target, optionally for one person", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    sim.createPerson("g2", "Bob");
    expect(sim.reveal("Attic", "g1").some((e) => e.type === "revealed")).toBe(true);
    expect(rooms(sim, "g1")).toContain("loc:Attic");
    expect(rooms(sim, "g2")).not.toContain("loc:Attic");
    expect(sim.reveal("Attic", "nobody").some((e) => e.type === "revealed")).toBe(false); // unknown person
    expect(sim.isRevealedTo("Attic", "g1")).toBe(true);
    expect(sim.isRevealedTo("Attic", "g2")).toBe(false);
  });
});

describe("cutscene locations", () => {
  it("put the app on rails while a guest stands there", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    expect(sim.cutsceneFor("g1")).toBe(true);
    expect(guestView(sim, "g1").cutscene).toBe(true);
    sim.signal("walk in", "g1");
    expect(guestView(sim, "g1")).toMatchObject({ location: "Hall", cutscene: false });
    // Not placed anywhere: not a cutscene.
    const bare = Sim.fromSources(`# Bare\nstart: Go\nLOCATION Somewhere\n  cutscene: true\n== Go\nHi.\n`);
    bare.createPerson("g1", "Ada");
    expect(bare.cutsceneFor("g1")).toBe(false);
  });
});

describe("`reveal … quietly` (wave 18b)", () => {
  const QUIET = `# Quiet House
GROUP The Society
  hidden: true

LOCATION Hall
LOCATION Cellar
  label: The Cellar
  hidden: true
LOCATION Attic
  hidden: true

SPACE Rooms
  CHANNEL secrets
    kind: open
    hidden: true

ROLE Guest
  when cleared for guest:
    reveal Cellar for guest quietly
  when cleared loudly for guest:
    reveal Cellar for guest

when the house opens:
  reveal Attic quietly
  reveal secrets quietly
  reveal The Society quietly

== Boot
The house.
`;

  it("parses as a statement, with or without `for who`", () => {
    expect(statementToDirective("reveal The Start Bar quietly")).toBe("reveal: The Start Bar quietly");
    expect(statementToDirective("reveal The Start Bar for program quietly")).toBe("reveal: The Start Bar for program quietly");
    expect(statementToDirective("reveal The Big Start Bar quietly")).toBe("reveal: The Big Start Bar quietly");
  });

  it("opens the room for its person, records `quiet`, and posts no notice", () => {
    const sim = Sim.fromSources(QUIET);
    sim.createPerson("g1", "Ada");
    sim.createPerson("g2", "Bob");
    const evs = sim.signal("cleared", "g1");
    expect(evs.filter((e) => e.type === "revealed")).toEqual([{ type: "revealed", target: "Cellar", kind: "location", person: "g1", quiet: true }]);
    expect(guestView(sim, "g1").channels.map((c) => c.id)).toContain("loc:Cellar");
    expect(guestView(sim, "g2").channels.map((c) => c.id)).not.toContain("loc:Cellar");
    expect(composeGuestMessages(sim, evs).filter((m) => m.kind === "system")).toEqual([]);
  });

  it("opens rooms and exposes a faction for everyone with no notice at all", () => {
    const sim = Sim.fromSources(QUIET);
    sim.createPerson("g1", "Ada");
    const evs = sim.signal("the house opens");
    expect(evs.filter((e) => e.type === "revealed" || e.type === "factionRevealed").map((e) => (e as { quiet?: true }).quiet)).toEqual([true, true, true]);
    expect(guestView(sim, "g1").channels.map((c) => c.id)).toEqual(expect.arrayContaining(["loc:Attic", "room:secrets"]));
    expect(sim.factionRevealed("The Society")).toBe(true);
    expect(composeGuestMessages(sim, evs).filter((m) => m.kind === "system")).toEqual([]);
  });

  it("a plain reveal still announces itself", () => {
    const sim = Sim.fromSources(QUIET);
    sim.createPerson("g1", "Ada");
    const evs = sim.signal("cleared loudly", "g1");
    expect(evs.find((e) => e.type === "revealed")).not.toHaveProperty("quiet");
    expect(composeGuestMessages(sim, evs).filter((m) => m.kind === "system").map((m) => m.text)).toEqual(["📂 The Cellar is open now."]);
  });
});
