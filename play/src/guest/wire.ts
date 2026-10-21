//! The wave 18 wire fields the guest app reads (CONTRACTS C1, C2, C10, C11,
//! A7), declared here as optional until the core lane's `types.ts` carries
//! them. Every reader goes through `extOf` / `goOf` / `evergreenFlag`, so an
//! old server (none of these fields) and the new one both work: each field
//! is feature-detected, never assumed.

import type { ChatMessage, GuestView, ObjectiveView, PersonCard } from "../types.ts";

/** C2: a moment's button target, resolved per viewer by the server. */
export type GoTarget =
  | { kind: "room"; id: string; label: string }
  | { kind: "dm"; id: string; label: string }
  | { kind: "pass" | "scan" | "chats" | "mission" | "notifications" | "sides" | "wallet" | "me"; label: string }
  | { kind: "codex"; entry?: string; label: string }
  | { kind: "quests"; quest?: string; label: string }
  | { kind: "act"; id: string; label: string };

/** C10: a side as the guest sees it (only joinable, revealed sides). */
export interface SideView {
  id: string;
  name: string;
  leader: string | null;
  members: number;
  /** The majority threshold, when the story declares one (`majority:`). */
  needs?: number;
  mine: boolean;
}

/** C10: the guest's crew. */
export interface CrewView {
  id: string;
  name: string;
  founder: string;
  members: string[];
}

/** C10: an invitation waiting on the guest. */
export interface InviteView {
  id: string;
  from: string;
  fromName: string;
  kind: "crew" | "side";
  target: string;
  targetName: string;
}

/** C11: the NOW objective's place. */
export interface MissionPlace {
  objective: string | null;
  place: { id: string; name: string } | null;
}

/** The wave 18 fields a `GuestView` may carry. */
export interface GuestViewW18 {
  mission?: MissionPlace;
  archived?: string[];
  sides?: SideView[];
  crew?: CrewView | null;
  invites?: InviteView[];
}

/** The wave 18 fields of a view, whatever the server sent (absent = undefined). */
export function extOf(view: GuestView | null | undefined): GuestViewW18 {
  if (view === null || view === undefined) return {};
  const v = view as GuestView & GuestViewW18;
  return {
    ...(v.mission !== undefined ? { mission: v.mission } : {}),
    ...(Array.isArray(v.archived) ? { archived: v.archived } : {}),
    ...(Array.isArray(v.sides) ? { sides: v.sides } : {}),
    ...(v.crew !== undefined ? { crew: v.crew } : {}),
    ...(Array.isArray(v.invites) ? { invites: v.invites } : {}),
  };
}

/** C2: a message's `go` targets ([] when none). */
export function goOf(m: Pick<ChatMessage, "seq"> | null | undefined): GoTarget[] {
  const go = (m as { go?: unknown } | null | undefined)?.go;
  return Array.isArray(go) ? (go as GoTarget[]) : [];
}

/** C1: `ChatMessage.autoClose` (ms), when set. */
export function autoCloseOf(m: Pick<ChatMessage, "seq">): number | null {
  const n = (m as { autoClose?: unknown }).autoClose;
  return typeof n === "number" && n > 0 ? n : null;
}

/** A7: `ObjectiveView.evergreen`, when the server sends it (undefined = it doesn't say). */
export function evergreenFlag(o: ObjectiveView): boolean | undefined {
  const e = (o as { evergreen?: unknown }).evergreen;
  return e === true ? true : undefined;
}

/** C10: every group a person card names (display names, crew included), or
 *  just their side for an old server. */
export function groupsOf(p: Pick<PersonCard, "faction"> & { groups?: unknown }): string[] {
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
