//! `pin` / `unpin` (Wave 4): a sticky notice above a stream — in a person's
//! own feed, in an authored room, or in a place. The sim records `pinned`
//! / `unpinned` with the key the client dedupes on (the person's id, or ""
//! for a room-wide pin); chat.ts turns them into ordinary stored messages
//! carrying `pin` / `unpin`, so a replay rebuilds them.

import { describe, expect, it } from "vitest";
import { statementToDirective } from "../src/parser/statements.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";
import { composeGuestMessages, visibleTo } from "../server/chat.ts";

const SOURCE = `# Pins
start: Boot

LOCATION Hall
  label: The Hall

LOCATION The Tube
  hidden: true

GROUP Staff

SPACE Rooms
  CHANNEL staff
    kind: faction
    faction: Staff

ROLE Guest
  when someone joins:
    move guest to Hall
  when alarm for guest:
    pin "!Go." for guest
  when escort for guest:
    pin "Escort {guest.name}." in staff for guest
  when done for guest:
    unpin in staff for guest "done"
  when clear for guest:
    unpin for guest
  when bad for guest:
    pin "x" in nowhere for guest
  when badclear for guest:
    unpin in nowhere for guest
  when again for guest:
    pin "Second." for guest

when wall:
  pin "Wall." in The Tube

when all:
  pin "All."

when room_clear:
  unpin in staff

when takeover:
  pin "!!GO TO THE LIVING ROOM"

when dance:
  unpin "Dance."

== Boot
Narrator: Boot.
`;

const pinned = (evs: SimEvent[]) => evs.filter((e): e is Extract<SimEvent, { type: "pinned" }> => e.type === "pinned");
const unpinned = (evs: SimEvent[]) => evs.filter((e): e is Extract<SimEvent, { type: "unpinned" }> => e.type === "unpinned");

function boot(): Sim {
  const sim = Sim.fromSources(SOURCE);
  sim.createPerson("g1", "Ada");
  sim.createPerson("g2", "Bea");
  return sim;
}

describe("pin — statement lowering", () => {
  it("lowers every quoted form and leaves prose alone", () => {
    expect(statementToDirective('pin "x" for guest')).toBe('pin: "x" for guest');
    expect(statementToDirective('pin "x" in staff for guest')).toBe('pin: "x" in staff for guest');
    expect(statementToDirective('pin "x" in The Tube')).toBe('pin: "x" in The Tube');
    expect(statementToDirective('pin "x"')).toBe('pin: "x"');
    expect(statementToDirective("unpin for guest")).toBe("unpin: for guest");
    expect(statementToDirective('unpin in staff for guest "done"')).toBe('unpin: in staff for guest "done"');
    expect(statementToDirective("unpin in staff")).toBe("unpin: in staff");
    expect(statementToDirective("pin the tail on the donkey")).toBeNull();
    expect(statementToDirective("pinned to the wall")).toBeNull();
    expect(statementToDirective("unpin")).toBeNull();
    expect(statementToDirective("unpin the badge")).toBeNull();
  });
});

describe("pin — the sim + chat", () => {
  it("a person's own pin lands in their feed as an alert signal keyed by their id", () => {
    const sim = boot();
    const evs = sim.signal("alarm", "g1");
    expect(pinned(evs)).toEqual([{ type: "pinned", text: "!Go.", channel: null, person: "g1", key: "g1" }]);
    const [m] = composeGuestMessages(sim, evs).filter((d) => d.pin !== undefined);
    expect(m).toMatchObject({ channel: "lobby", kind: "signal", text: "Go.", audience: ["g1"], pin: "g1", alert: true, parentSeq: null });
  });

  it("a pin in an authored room carries the room's audience (none for a staff room) and the person's key", () => {
    const sim = boot();
    const evs = sim.signal("escort", "g1");
    expect(pinned(evs)).toEqual([{ type: "pinned", text: "Escort Ada.", channel: "room:staff", person: "g1", key: "g1" }]);
    const [m] = composeGuestMessages(sim, evs).filter((d) => d.pin !== undefined);
    expect(m).toMatchObject({ channel: "room:staff", channelKind: "faction", kind: "signal", text: "Escort Ada.", audience: [], pin: "g1" });
    expect(m!.alert).toBeUndefined();
  });

  it("a story rule pins room-wide (key \"\") in a place or in everyone's feed", () => {
    const sim = boot();
    const wall = sim.signal("wall");
    expect(pinned(wall)).toEqual([{ type: "pinned", text: "Wall.", channel: "loc:The Tube", person: null, key: "" }]);
    const [w] = composeGuestMessages(sim, wall).filter((d) => d.pin !== undefined);
    expect(w).toMatchObject({ channel: "loc:The Tube", channelKind: "location", pin: "", audience: [] });
    const all = sim.signal("all");
    expect(pinned(all)).toEqual([{ type: "pinned", text: "All.", channel: null, person: null, key: "" }]);
    const [a] = composeGuestMessages(sim, all).filter((d) => d.pin !== undefined);
    expect(a).toMatchObject({ channel: "lobby", pin: "", audience: "all", kind: "signal", text: "All." });
  });

  it("unpin is a system line carrying the key, with the authored text or a default", () => {
    const sim = boot();
    const done = sim.signal("done", "g1");
    expect(unpinned(done)).toEqual([{ type: "unpinned", text: "done", channel: "room:staff", person: "g1", key: "g1" }]);
    const [d] = composeGuestMessages(sim, done).filter((m) => m.unpin !== undefined);
    expect(d).toMatchObject({ channel: "room:staff", kind: "system", text: "done", unpin: "g1", audience: [] });
    const clear = sim.signal("clear", "g1");
    expect(unpinned(clear)).toEqual([{ type: "unpinned", text: null, channel: null, person: "g1", key: "g1" }]);
    const [c] = composeGuestMessages(sim, clear).filter((m) => m.unpin !== undefined);
    expect(c).toMatchObject({ channel: "lobby", kind: "system", text: "📌 Cleared.", unpin: "g1", audience: ["g1"] });
    const room = sim.signal("room_clear");
    expect(unpinned(room)).toEqual([{ type: "unpinned", text: null, channel: "room:staff", person: null, key: "" }]);
  });

  it("an unknown room is a diagnostic and no message; a second pin for the same person keeps both (the client picks the newest)", () => {
    const sim = boot();
    const bad = sim.signal("bad", "g1");
    expect(pinned(bad)).toEqual([]);
    expect(bad.filter((e) => e.type === "diagnostic").map((e) => (e as { message: string }).message)).toEqual(["pin: no room or place named nowhere"]);
    expect(composeGuestMessages(sim, bad).filter((d) => d.pin !== undefined)).toEqual([]);
    const badclear = sim.signal("badclear", "g1");
    expect(unpinned(badclear)).toEqual([]);
    const first = sim.signal("alarm", "g1");
    const second = sim.signal("again", "g1");
    const msgs = composeGuestMessages(sim, [...first, ...second]).filter((d) => d.pin !== undefined);
    expect(msgs.map((m) => [m.text, m.pin])).toEqual([
      ["Go.", "g1"],
      ["Second.", "g1"],
    ]);
  });

  it("a `!!` pin is a takeover + an alert with both marks stripped; a text-only unpin takes it down", () => {
    const sim = boot();
    const up = sim.signal("takeover");
    expect(pinned(up)).toEqual([{ type: "pinned", text: "!!GO TO THE LIVING ROOM", channel: null, person: null, key: "" }]);
    const [t] = composeGuestMessages(sim, up).filter((d) => d.pin !== undefined);
    expect(t).toMatchObject({ channel: "lobby", audience: "all", kind: "signal", text: "GO TO THE LIVING ROOM", pin: "", alert: true, takeover: true });
    // A single `!` stays a plain alert pin.
    const [a] = composeGuestMessages(sim, sim.signal("alarm", "g1")).filter((d) => d.pin !== undefined);
    expect(a!.takeover).toBeUndefined();
    const down = sim.signal("dance");
    expect(unpinned(down)).toEqual([{ type: "unpinned", text: "Dance.", channel: null, person: null, key: "" }]);
    const [d] = composeGuestMessages(sim, down).filter((m) => m.unpin !== undefined);
    expect(d).toMatchObject({ channel: "lobby", audience: "all", kind: "system", text: "Dance.", unpin: "" });
  });

  it("a restricted (marked) guest still receives the lobby takeover and its unpin: delivery is by audience, not by room", () => {
    const sim = boot();
    sim.restrict("g1", ["Hall"]);
    expect(sim.isRestricted("g1")).toBe(true);
    const [t] = composeGuestMessages(sim, sim.signal("takeover")).filter((m) => m.pin !== undefined);
    const [d] = composeGuestMessages(sim, sim.signal("dance")).filter((m) => m.unpin !== undefined);
    // event-runtime's deliverMessage + historyFor filter guests by
    // `visibleTo` alone, so the marked guest's stream carries both.
    expect(visibleTo({ ...t!, seq: 1, hidden: false }, "g1")).toBe(true);
    expect(visibleTo({ ...d!, seq: 2, hidden: false }, "g1")).toBe(true);
  });
});
