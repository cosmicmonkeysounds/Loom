//! `restrict` / `unrestrict` (Wave 4): the story shrinks a participant's
//! app to the places it names (+ their private threads), read-only, with
//! every button off — the generic sibling of `capture` / `release`. The
//! statement lowers like any keyword verb, the sim records `restricted` /
//! `unrestricted` and fires the matching hooks on the edge, and every view
//! (guest / booth / roster) reads the flag.

import { describe, expect, it } from "vitest";
import { statementToDirective } from "../src/parser/statements.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";
import { guestView, modView, primeView } from "../server/views.ts";

const SOURCE = `# Restricted
start: Boot

LOCATION Hall
  label: The Hall

LOCATION The Tube
  hidden: true

LOCATION Jail
  prison: true
  sealed: true

GROUP Staff

SPACE Rooms
  CHANNEL general
    kind: open
  CHANNEL staff
    kind: faction
    faction: Staff

ROLE Guest
  when someone joins:
    move guest to Hall
  when restricted for guest:
    reply Restricted.
  when unrestricted for guest:
    reply Free.

CHARACTER The Clerk
  listed: true

INTERACTION knock
  label: Knock
  who: guest

== Boot
Narrator: Boot.

== Lock
restrict guest to The Tube, Jail

== Unlock
unrestrict guest

== Nowhere
restrict guest to Nowhere

== Bare
restrict guest
`;

const replies = (evs: SimEvent[]) => evs.filter((e): e is Extract<SimEvent, { type: "respond" }> => e.type === "respond").map((e) => e.text);
const ofType = <T extends SimEvent["type"]>(evs: SimEvent[], t: T) => evs.filter((e): e is Extract<SimEvent, { type: T }> => e.type === t);

function boot(): Sim {
  const sim = Sim.fromSources(SOURCE);
  sim.createPerson("g1", "Ada");
  sim.createPerson("g2", "Bea");
  return sim;
}

describe("restrict — statement lowering", () => {
  it("lowers the verb pair and leaves prose alone", () => {
    expect(statementToDirective("restrict guest to The Tube, Jail")).toBe("restrict: guest to The Tube, Jail");
    expect(statementToDirective("restrict guest")).toBe("restrict: guest");
    expect(statementToDirective("unrestrict guest")).toBe("unrestrict: guest");
    expect(statementToDirective("restrict the flow of time")).toBeNull();
    expect(statementToDirective("restricted access only")).toBeNull();
    expect(statementToDirective("unrestricted joy")).toBeNull();
  });
});

describe("restrict — the sim", () => {
  it("flags the person, keeps the named places, fires the hook once on the edge", () => {
    const sim = boot();
    expect(sim.isRestricted("g1")).toBe(false);
    const evs = sim.fireBeat("Lock", "g1");
    expect(sim.isRestricted("g1")).toBe(true);
    expect(sim.world.get("g1.restricted").kind).toBe("bool");
    expect(sim.restrictedPlaces("g1")).toEqual(["The Tube", "Jail"]);
    expect(ofType(evs, "restricted")).toEqual([{ type: "restricted", person: "g1", places: ["The Tube", "Jail"] }]);
    expect(replies(evs)).toEqual(["Restricted."]);
    // A repeat refreshes the places and records again, but no second hook.
    const again = sim.fireBeat("Bare", "g1");
    expect(ofType(again, "restricted")).toEqual([{ type: "restricted", person: "g1", places: [] }]);
    expect(replies(again)).toEqual([]);
    expect(sim.restrictedPlaces("g1")).toEqual([]);
    // Nobody else is touched.
    expect(sim.isRestricted("g2")).toBe(false);
  });

  it("shrinks the viewer's rooms to the named places + where they stand, read-only", () => {
    const sim = boot();
    sim.fireBeat("Lock", "g1");
    const ids = sim.visibleChannelsFor("g1").map((c) => [c.id, c.canPost] as const);
    // The hidden Tube is listed (the story named it); the Hall is where they stand.
    expect(ids.map(([id]) => id).sort()).toEqual(["loc:Hall", "loc:Jail", "loc:The Tube"]);
    expect(ids.every(([, canPost]) => canPost === false)).toBe(true);
    expect(sim.canPost("g1", "dm:The Clerk")).toBe(true);
    expect(sim.canPost("g1", "pm:g1:g2")).toBe(true);
    expect(sim.canPost("g1", "room:general")).toBe(false);
    expect(sim.canPost("g1", "loc:Hall")).toBe(false);
    expect(sim.canPost("g1", "lobby")).toBe(false);
    // The other guest is untouched.
    expect(sim.visibleChannelsFor("g2").map((c) => c.id)).toContain("room:general");
    expect(sim.canPost("g2", "loc:Hall")).toBe(true);
  });

  it("reads the same in every view: no buttons for the guest, a flag for the booth and the roster", () => {
    const sim = boot();
    expect(guestView(sim, "g1").restricted).toBe(false);
    expect(guestView(sim, "g1").interactions.map((i) => i.id)).toEqual(["knock"]);
    expect(primeView(sim, "The Clerk").guests.find((g) => g.id === "g1")!.restricted).toBe(false);
    expect(modView(sim, "open", "x").roster.find((r) => r.id === "g1")!.restricted).toBe(false);
    sim.fireBeat("Lock", "g1");
    const g = guestView(sim, "g1");
    expect(g.restricted).toBe(true);
    expect(g.interactions).toEqual([]);
    expect(g.channels.map((c) => c.id).sort()).toEqual(["loc:Hall", "loc:Jail", "loc:The Tube"]);
    expect(primeView(sim, "The Clerk").guests.find((g) => g.id === "g1")!.restricted).toBe(true);
    expect(modView(sim, "open", "x").roster.find((r) => r.id === "g1")!.restricted).toBe(true);
    expect(guestView(sim, "g2").interactions.map((i) => i.id)).toEqual(["knock"]);
  });

  it("unrestrict lifts it, fires the hook, and gives the rooms back", () => {
    const sim = boot();
    sim.fireBeat("Lock", "g1");
    const evs = sim.fireBeat("Unlock", "g1");
    expect(sim.isRestricted("g1")).toBe(false);
    expect(ofType(evs, "unrestricted")).toEqual([{ type: "unrestricted", person: "g1" }]);
    expect(replies(evs)).toEqual(["Free."]);
    expect(sim.visibleChannelsFor("g1").map((c) => c.id)).toContain("room:general");
    expect(sim.canPost("g1", "loc:Hall")).toBe(true);
    expect(guestView(sim, "g1").interactions.map((i) => i.id)).toEqual(["knock"]);
    // Lifting an unrestricted person is a no-op.
    const noop = sim.fireBeat("Unlock", "g1");
    expect(ofType(noop, "unrestricted")).toEqual([]);
    expect(replies(noop)).toEqual([]);
  });

  it("the operator mutators and `setVar` route through the same path", () => {
    const sim = boot();
    const on = sim.setVar("g1.restricted", "true");
    expect(sim.isRestricted("g1")).toBe(true);
    expect(ofType(on, "restricted")).toHaveLength(1);
    expect(replies(on)).toEqual(["Restricted."]);
    const off = sim.setVar("g1.restricted", "false");
    expect(sim.isRestricted("g1")).toBe(false);
    expect(replies(off)).toEqual(["Free."]);
    const direct = sim.restrict("g2", ["Jail"]);
    expect(ofType(direct, "restricted")).toEqual([{ type: "restricted", person: "g2", places: ["Jail"] }]);
    expect(sim.restrictedPlaces("g2")).toEqual(["Jail"]);
    expect(sim.unrestrict("g2").some((e) => e.type === "unrestricted")).toBe(true);
    // An unknown person: nothing.
    expect(sim.restrict("nobody")).toEqual([]);
    expect(sim.isRestricted("nobody")).toBe(false);
  });

  it("a place that is not a LOCATION is a diagnostic, not a room", () => {
    const sim = boot();
    const evs = sim.fireBeat("Nowhere", "g1");
    expect(ofType(evs, "diagnostic").map((d) => d.message)).toEqual(["restrict: no LOCATION named Nowhere"]);
    expect(sim.isRestricted("g1")).toBe(true);
    expect(sim.restrictedPlaces("g1")).toEqual([]);
    expect(sim.visibleChannelsFor("g1").map((c) => c.id)).toEqual(["loc:Hall"]);
  });
});
