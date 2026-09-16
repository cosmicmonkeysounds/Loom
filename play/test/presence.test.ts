import { describe, expect, it } from "vitest";

import { locationOfRoom, occupancyLabel, occupantsByLocation, roomOrder } from "../src/presence.ts";
import type { Channel, PersonCard, PrimeGuest } from "../src/types.ts";

function card(id: string, location: string | null, kind: PersonCard["kind"] = "guest"): PersonCard {
  return { id, name: id.toUpperCase(), kind, faction: null, known: [], location };
}
function ch(id: string, extra: Partial<Channel> = {}): Channel {
  return { id, kind: id.startsWith("loc:") ? "location" : "open", title: id, spaceId: "story", messages: [], unread: 0, decision: null, lastTs: 0, ...extra };
}

describe("occupantsByLocation", () => {
  it("groups guests by where they stand, counts the viewer, skips characters + the unplaced", () => {
    const people = [card("a", "Hall"), card("b", "Hall"), card("c", "Yard"), card("d", null), card("Clippy", "Hall", "character")];
    const occ = occupantsByLocation(people, { id: "me", name: "Me", group: "Reds", location: "Hall" });
    expect(occ.get("Hall")!.map((p) => p.id)).toEqual(["me", "a", "b"]);
    expect(occ.get("Yard")!.map((p) => p.id)).toEqual(["c"]);
    expect(occ.has("null")).toBe(false);
    expect(occ.get("Hall")![0]).toMatchObject({ group: "Reds", kind: "guest" });
  });

  it("accepts the performer's guest list too", () => {
    const guests: PrimeGuest[] = [{ id: "a", name: "A", faction: "Reds", captured: false, location: "Hall" }];
    expect(occupantsByLocation(guests, null).get("Hall")).toEqual([{ id: "a", name: "A", kind: "guest", group: "Reds" }]);
  });
});

describe("roomOrder", () => {
  it("puts where you stand first, then decisions, unread, populated, recent", () => {
    const here = ch("loc:Hall", { here: true, lastTs: 1 });
    const decision = ch("dm:Host", { decision: { title: "?", options: [] }, lastTs: 2 });
    const unread = ch("loc:Yard", { unread: 3, lastTs: 3 });
    const populated = ch("loc:Cellar", { people: [{ id: "x", name: "X", kind: "guest", group: null }], lastTs: 4 });
    const recent = ch("lobby", { lastTs: 99 });
    const quiet = ch("loc:Attic", { lastTs: 5 });
    const sorted = [quiet, recent, populated, unread, decision, here].sort(roomOrder).map((c) => c.id);
    expect(sorted).toEqual(["loc:Hall", "dm:Host", "loc:Yard", "loc:Cellar", "lobby", "loc:Attic"]);
  });
});

describe("occupancyLabel", () => {
  const me = "me";
  const p = (id: string) => ({ id, name: id, kind: "guest" as const, group: null });
  it("reads like a glance at the door", () => {
    expect(occupancyLabel(ch("lobby"), me)).toBe("");
    expect(occupancyLabel(ch("loc:Hall", { people: [] }), me)).toBe("empty");
    expect(occupancyLabel(ch("loc:Hall", { here: true, people: [p("me")] }), me)).toBe("just you");
    expect(occupancyLabel(ch("loc:Hall", { here: true, people: [p("me"), p("ana")] }), me)).toBe("you + ana");
    expect(occupancyLabel(ch("loc:Hall", { here: true, people: [p("me"), p("ana"), p("bo")] }), me)).toBe("you + 2 others");
    expect(occupancyLabel(ch("loc:Hall", { people: [p("ana")] }), me)).toBe("ana");
    expect(occupancyLabel(ch("loc:Hall", { people: [p("ana"), p("bo")] }), me)).toBe("2 here");
  });
  it("names a location room's location", () => {
    expect(locationOfRoom("loc:The Hall")).toBe("The Hall");
    expect(locationOfRoom("dm:Host")).toBeNull();
  });
});
