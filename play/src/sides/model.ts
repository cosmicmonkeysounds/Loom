//! Sides, recruiting and crews, the pure part (wave 18, GUEST-SPEC §9,
//! DECISIONS F1–F4, CONTRACTS C10): the sides a guest sees (the server's
//! `GuestView.sides`, else the old `factions` names), what each side's card
//! offers them, what a scanned pass offers the recruiter, and the words for
//! a refusal. `test/sides.test.tsx` pins it. Everything here is read off
//! optional fields: an old server shows a Join / Switch-only Sides sheet.

import type { GuestView, PersonCard } from "../types.ts";
import { extOf, type CrewView, type InviteView, type SideView } from "../guest/wire.ts";

/** A side as the Sides sheet and the doors draw it. */
export interface SideRow {
  id: string;
  name: string;
  leader: string | null;
  /** Head count (null: an old server doesn't say). */
  members: number | null;
  needs: number | null;
  mine: boolean;
}

/** The sides a guest sees: the server's, else the story's names (F1). */
export function sidesOf(view: GuestView | null): SideRow[] {
  if (view === null) return [];
  const ext = extOf(view);
  if (ext.sides !== undefined) {
    return ext.sides.map((s: SideView) => ({ id: s.id, name: s.name, leader: s.leader, members: s.members, needs: s.needs ?? null, mine: s.mine }));
  }
  return (view.factions ?? []).map((f) => ({ id: f, name: f, leader: null, members: null, needs: null, mine: view.faction === f }));
}

/** "4 of 13 needed", "4 in", "" (an old server). */
export function countLine(s: Pick<SideRow, "members" | "needs">): string {
  if (s.members === null) return "";
  return s.needs !== null ? `${s.members} of ${s.needs} needed` : `${s.members} in`;
}

/** What a side's card offers this guest (§9.2). */
export type SideAction = "in" | "join" | "switch" | "leader" | "restricted";

export function sideAction(side: SideRow, view: Pick<GuestView, "name" | "faction" | "restricted">, rows: readonly SideRow[]): SideAction {
  const mine = side.mine || view.faction === side.name;
  if (mine) {
    if (side.leader !== null && side.leader === view.name) return "leader";
    return view.restricted === true ? "restricted" : "in";
  }
  if (view.restricted === true) return "restricted";
  // A leader of another side stays with it (vetoable, §9.2).
  const onSide = rows.find((r) => r.mine || r.name === view.faction);
  if (onSide !== undefined && onSide.leader === view.name) return "leader";
  return onSide !== undefined ? "switch" : "join";
}

export { hasSidesOrCrew } from "../guest/wire.ts";

/** The guest's crew, if any. */
export function crewOf(view: GuestView | null): CrewView | null {
  return extOf(view).crew ?? null;
}

/** The crew's room id (C10). */
export function crewRoom(crew: Pick<CrewView, "id">): string {
  return `crew:${crew.id}`;
}

/** What scanning another guest's pass offers (§9.3). */
export interface RecruitOffer {
  id: string;
  name: string;
  /** "◆ unaligned · The CPU" */
  sub: string;
  /** `🚪 Recruit {name} to {Side}` when you can. */
  side: { label: string; side: string } | null;
  /** `◇ Invite {name} to {Crew}` when you can. */
  crew: { label: string } | null;
  /** Why there's nothing to offer. */
  note: string | null;
}

export function recruitOffer(view: GuestView, target: string): RecruitOffer {
  const p: PersonCard | undefined = (view.people ?? []).find((x) => x.id === target);
  const name = p?.name ?? "this program";
  const sub = `◆ ${p?.faction ?? "unaligned"}${p?.location ? ` · ${p.location}` : ""}`;
  const sides = sidesOf(view);
  const crew = crewOf(view);
  const mySide = view.faction;
  const side = sides.length > 0 && mySide !== null && p?.faction !== mySide ? { label: `🚪 Recruit ${name} to ${mySide}`, side: mySide } : null;
  const crewOffer = crew !== null && !crew.members.includes(target) ? { label: `◇ Invite ${name} to ${crew.name}` } : null;
  let note: string | null = null;
  if (side === null && crewOffer === null) {
    if (sides.length === 0) note = `That's ${name}'s pass. When the sides open, scan it to recruit them.`;
    else if (mySide === null) note = `Join a side first, then scan ${name}'s pass to recruit them.`;
    else note = `${name} is already in ${mySide}.`;
  } else if (side === null && sides.length > 0 && mySide === null) {
    note = `Join a side first, then scan ${name}'s pass to recruit them.`;
  }
  return { id: target, name, sub, side, crew: crewOffer, note };
}

/** A recruit's refusal in words (§9.3): 409 "already" names the side. */
export function recruitRefusal(e: unknown, name: string, side: string | null): string {
  const status = (e as { status?: unknown }).status;
  const message = String((e as { message?: unknown }).message ?? "");
  if (status === 409 && /already/iu.test(message) && side !== null) return `${name} is already in ${side}.`;
  return message !== "" ? message : "That didn't go through — try again.";
}

/** A crew name refusal in words (§9.5): the server's, else the fallback. */
export function crewRefusal(e: unknown): string {
  const message = String((e as { message?: unknown }).message ?? "").trim();
  return message !== "" ? message : "That name is taken. Try another.";
}

/** A crew name the form may send: 2–24 characters after trimming. */
export function crewNameOk(name: string): boolean {
  const n = name.trim();
  return n.length >= 2 && n.length <= 24;
}

/** The invitation a card (`show invite … with invite: <id>`) is about. */
export function inviteOf(view: GuestView | null, params: Record<string, string>, text: string): InviteView & { line: string } {
  const id = params["invite"] ?? "";
  const known = (extOf(view).invites ?? []).find((i) => i.id === id);
  const fromName = known?.fromName ?? params["fromName"] ?? params["from"] ?? "Someone";
  const targetName = known?.targetName ?? params["targetName"] ?? params["target"] ?? "their side";
  const kind = known?.kind ?? (params["kind"] === "crew" ? "crew" : "side");
  return { id, from: known?.from ?? params["from"] ?? "", fromName, kind, target: known?.target ?? params["target"] ?? "", targetName, line: text.trim() !== "" ? text.trim() : `${fromName} wants you in ${targetName}` };
}

/** "Switch to The Way Out?" */
export function switchQuestion(name: string): string {
  return `Switch to ${name}?`;
}
