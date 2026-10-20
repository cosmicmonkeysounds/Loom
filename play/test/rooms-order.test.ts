//! Wave 13 (chrome): the room list's fixed order — pinned, staff, here,
//! the rooms that ask, agent DMs, the lobby, DMs with badges, populated
//! rooms — stable inside each tier (no recency jumping), and the empty
//! rooms folded into "Other rooms (n)".

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FOLD_TIER, foldRooms, roomOrder, roomTier } from "../src/rooms/order.ts";
import { SpaceList, otherRoomsLabel } from "../src/rooms/list.tsx";
import { groupBySpace } from "../src/rooms/spaces.ts";
import type { Channel } from "../src/types.ts";

const person = { id: "x", name: "X", kind: "guest" as const, group: null };
function ch(id: string, extra: Partial<Channel> = {}): Channel {
  const kind = id === "lobby" ? "lobby" : id.startsWith("loc:") ? "location" : id.startsWith("dm:") ? "dm" : "open";
  return { id, kind, title: id.replace(/^\w+:/u, ""), spaceId: "story", messages: [], unread: 0, decision: null, lastTs: 0, ...extra } as Channel;
}
const said = [{ seq: 1 } as Channel["messages"][number]];

const rooms = {
  wallet: ch("wallet", { kind: "wallet", spaceId: "pinned", order: -1 }),
  quests: ch("quests", { kind: "quests", spaceId: "pinned", order: 0 }),
  codex: ch("codex", { kind: "codex", spaceId: "pinned", order: 1, unread: 4 }),
  hosts: ch("hosts", { staff: true }),
  here: ch("loc:The Desktop", { here: true, people: [person] }),
  asks: ch("dm:Clippy", { needsYou: true, messages: said }),
  agent: ch("dm:Trabolta", { agent: true, messages: said }),
  lobby: ch("lobby", { order: 0, messages: said }),
  dmBadge: ch("dm:Norton", { unread: 2, messages: said }),
  populated: ch("loc:The Start Bar", { people: [person] }),
  chat: ch("general", { messages: said }),
  empty: ch("loc:The Cloud"),
  empty2: ch("loc:The RAM"),
};

describe("roomTier", () => {
  it("puts every kind of room in its tier", () => {
    expect(Object.fromEntries(Object.entries(rooms).map(([k, c]) => [k, roomTier(c)]))).toEqual({
      wallet: 0, quests: 0, codex: 0, hosts: 1, here: 2, asks: 3, agent: 4, lobby: 5, dmBadge: 6, populated: 7, chat: 7, empty: 8, empty2: 8,
    });
    expect(roomTier(ch("loc:Hall", { decision: { title: "?", options: [] } }))).toBe(3);
    expect(roomTier(ch("loc:Hall", { unread: 1 }))).toBe(7); // something new: never folded away
    expect(FOLD_TIER).toBe(8);
  });
});

describe("roomOrder", () => {
  it("is the fixed core order, whatever order the rooms come in", () => {
    const want = ["wallet", "quests", "codex", "hosts", "loc:The Desktop", "dm:Clippy", "dm:Trabolta", "lobby", "dm:Norton", "general", "loc:The Start Bar", "loc:The Cloud", "loc:The RAM"];
    const list = Object.values(rooms);
    expect([...list].sort(roomOrder).map((c) => c.id)).toEqual(want);
    expect([...list].reverse().sort(roomOrder).map((c) => c.id)).toEqual(want);
  });

  it("never jumps by recency inside a tier", () => {
    const a = ch("loc:Attic", { people: [person], lastTs: 1 });
    const b = ch("loc:Basement", { people: [person], lastTs: 2 });
    expect([a, b].sort(roomOrder).map((c) => c.id)).toEqual(["loc:Attic", "loc:Basement"]);
    // Basement hears something newer: the order holds.
    expect([{ ...a, lastTs: 1 }, { ...b, lastTs: 99 }].sort(roomOrder).map((c) => c.id)).toEqual(["loc:Attic", "loc:Basement"]);
    // "The" is ignored for the name order.
    expect([ch("loc:The Zoo", { people: [person] }), ch("loc:Attic", { people: [person] })].sort(roomOrder).map((c) => c.id)).toEqual(["loc:Attic", "loc:The Zoo"]);
  });

  it("moves a room only when its tier changes", () => {
    const list = [rooms.lobby, rooms.populated, rooms.empty];
    expect([...list].sort(roomOrder).map((c) => c.id)).toEqual(["lobby", "loc:The Start Bar", "loc:The Cloud"]);
    const walked = [rooms.lobby, rooms.populated, { ...rooms.empty, here: true }];
    expect([...walked].sort(roomOrder).map((c) => c.id)).toEqual(["loc:The Cloud", "lobby", "loc:The Start Bar"]);
  });
});

describe("Other rooms (n)", () => {
  it("folds the empty rooms, keeps the open one, and never folds a lone one", () => {
    const sorted = Object.values(rooms).sort(roomOrder);
    const { shown, folded } = foldRooms(sorted);
    expect(folded.map((c) => c.id)).toEqual(["loc:The Cloud", "loc:The RAM"]);
    expect(shown).toHaveLength(sorted.length - 2);
    // The open room stays out; one quiet room left is not worth a fold.
    expect(foldRooms(sorted, "loc:The RAM").folded).toEqual([]);
    expect(foldRooms([rooms.lobby, rooms.empty]).folded).toEqual([]);
    expect(otherRoomsLabel(9)).toBe("Other rooms (9)");
  });

  it("the guest's list renders the fold closed at the foot", () => {
    const sorted = Object.values(rooms).sort(roomOrder);
    const out = renderToStaticMarkup(createElement(SpaceList, { spaces: groupBySpace(sorted), onOpen: () => {}, fold: true }));
    expect(out).toContain("Other rooms (2)");
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain(">The Cloud<");
    expect(out.indexOf("Other rooms")).toBeGreaterThan(out.indexOf("The Start Bar"));
    // Without `fold` (the booth's list today) every room shows.
    expect(renderToStaticMarkup(createElement(SpaceList, { spaces: groupBySpace(sorted), onOpen: () => {} }))).not.toContain("Other rooms");
  });
});
