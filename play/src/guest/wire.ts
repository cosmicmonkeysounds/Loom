//! The wave 18 wire fields the guest app reads (CONTRACTS C1, C2, C10, C11,
//! A7). The shapes are the server's own (`../types.ts`, mirrored from core);
//! every reader still goes through these helpers so an older server (none of
//! these fields) reads as "nothing new", never as a crash.

import type { ChatMessage, GoTarget, GuestMission, GuestView, ObjectiveView, PersonCard } from "../types.ts";

export type { CrewView, GoTarget, InviteView, SideView } from "../types.ts";

/** C11: the NOW objective's place (`GuestView.mission`). */
export type MissionPlace = GuestMission;

/** The wave 18 fields a `GuestView` may carry. */
export type GuestViewW18 = Pick<GuestView, "mission" | "archived" | "sides" | "crew" | "invites">;

/** The wave 18 fields of a view, whatever the server sent (absent = undefined). */
export function extOf(view: GuestView | null | undefined): GuestViewW18 {
  if (view === null || view === undefined) return {};
  return {
    ...(view.mission !== undefined ? { mission: view.mission } : {}),
    ...(Array.isArray(view.archived) ? { archived: view.archived } : {}),
    ...(Array.isArray(view.sides) ? { sides: view.sides } : {}),
    ...(view.crew !== undefined ? { crew: view.crew } : {}),
    ...(Array.isArray(view.invites) ? { invites: view.invites } : {}),
  };
}

/** C2: a message's `go` targets ([] when none). */
export function goOf(m: Pick<ChatMessage, "go"> | null | undefined): GoTarget[] {
  const go = m?.go;
  return Array.isArray(go) ? go : [];
}

/** C1: `ChatMessage.autoClose` (ms), when set. */
export function autoCloseOf(m: Pick<ChatMessage, "autoClose">): number | null {
  const n = m.autoClose;
  return typeof n === "number" && n > 0 ? n : null;
}

/** A7: `ObjectiveView.evergreen`, when the server sends it (undefined = it doesn't say). */
export function evergreenFlag(o: ObjectiveView): boolean | undefined {
  return o.evergreen === true ? true : undefined;
}

/** C10: every group a person card names (display names, crew included), or
 *  just their side for an old server. */
export function groupsOf(p: Pick<PersonCard, "faction" | "groups">): string[] {
  if (Array.isArray(p.groups)) return p.groups.filter((g): g is string => typeof g === "string");
  return p.faction !== null ? [p.faction] : [];
}

/** Does the guest have anything to see in Sides & crews (Start, Me): a side
 *  open (the server's `sides`, else the story's `factions`) or a crew. */
export function hasSidesOrCrew(view: GuestView | null | undefined): boolean {
  if (view === null || view === undefined) return false;
  const ext = extOf(view);
  return (ext.sides ?? view.factions ?? []).length > 0 || (ext.crew ?? null) !== null;
}
