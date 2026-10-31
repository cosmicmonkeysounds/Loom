// Presence — who is where. Pure helpers that turn the server snapshots
// (a guest's `people` directory, a performer's `guests`) into the
// "who's here" the sidebar and room headers show, and that put the room
// you're standing in at the top of the list.

import type { Channel, PersonCard, PrimeGuest } from "./types.ts";

export { roomOrder } from "./rooms/order.ts";

/** A person as a room strip shows them. */
export interface Presence {
  id: string;
  name: string;
  kind: "guest" | "character";
  group: string | null;
}

/** Wave 59: is this person on a People list? The server says who is online
 *  (a locked phone keeps a grace, `ONLINE_GRACE_MS`); an older server says
 *  nothing, and everyone stays. */
export function isOnline(p: { online?: boolean }): boolean {
  return p.online !== false;
}

/** Everyone online standing in each location, keyed by location id. The
 *  viewer themselves (`me`, with `myLocation`) is included so a room's count
 *  is honest — you are in the room too. */
export function occupantsByLocation(
  people: ReadonlyArray<PersonCard | PrimeGuest>,
  me: { id: string; name: string; group: string | null; location: string | null } | null,
): Map<string, Presence[]> {
  const out = new Map<string, Presence[]>();
  const put = (loc: string | null, p: Presence) => {
    if (loc === null) return;
    const arr = out.get(loc) ?? [];
    if (!arr.some((x) => x.id === p.id)) arr.push(p);
    out.set(loc, arr);
  };
  if (me !== null) put(me.location, { id: me.id, name: me.name, kind: "guest", group: me.group });
  for (const p of people) {
    const kind: Presence["kind"] = "kind" in p ? p.kind : "guest";
    if (kind !== "guest" || !isOnline(p)) continue; // characters have no standing location
    put(p.location, { id: p.id, name: p.name, kind, group: p.faction });
  }
  return out;
}

/** The location id a `loc:` room id names, else null. */
export function locationOfRoom(id: string): string | null {
  return id.startsWith("loc:") ? id.slice(4) : null;
}

/** "3 here" / "just you" / "" — the sidebar's one-glance occupancy. */
export function occupancyLabel(c: Channel, meId: string | null): string {
  const people = c.people ?? [];
  if (locationOfRoom(c.id) === null) return "";
  if (people.length === 0) return "empty";
  const others = people.filter((p) => p.id !== meId);
  if (others.length === 0) return c.here ? "just you" : "";
  if (c.here) return others.length === 1 ? `you + ${others[0]!.name}` : `you + ${others.length} others`;
  return others.length === 1 ? others[0]!.name : `${others.length} here`;
}
