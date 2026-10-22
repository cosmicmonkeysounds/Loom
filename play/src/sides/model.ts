//! Sides, recruiting and crews, the pure part (wave 18, GUEST-SPEC §9,
//! DECISIONS F1–F4, CONTRACTS C10): the sides a guest sees (the server's
//! `GuestView.sides`, else the old `factions` names), what each side's card
//! offers them, what a scanned pass offers the recruiter, and the words for
//! a refusal. `test/sides.test.tsx` pins it. Everything here is read off
//! optional fields: an old server shows a Join / Switch-only Sides sheet.
//!
//! Wave 18b, **faction mode** (the story's `founding:` line, contract B3):
//! the declared sides and the factions programs found are one list, one
//! faction at a time, and only your own row carries a count (the server
//! sends none for a rival). `factionModeOf` tells the two apart; a view
//! with no `kind` / `canFound` (an older server, a story with no
//! `founding:`) reads exactly as wave 18 did.

import type { FactionKind, GuestView, PersonCard } from "../types.ts";
import { canFoundOf, extOf, type CrewView, type InviteView, type SideView } from "../guest/wire.ts";

/** A side as the Sides sheet and the doors draw it. */
export interface SideRow {
  id: string;
  name: string;
  leader: string | null;
  /** Head count (null: an old server doesn't say; in faction mode, a rival's). */
  members: number | null;
  needs: number | null;
  mine: boolean;
  /** Faction mode: a declared side or a founded faction (null: not faction mode). */
  kind: FactionKind | null;
  /** Faction mode: a declared side's `ethos:`. */
  ethos: string | null;
  /** Faction mode: who founded it (a side's leader, a founded faction's founder). */
  founder: string | null;
  /** Faction mode, your own row: how many more it needs to win. */
  more: number | null;
}

/** The sides a guest sees: the server's, else the story's names (F1). */
export function sidesOf(view: GuestView | null): SideRow[] {
  if (view === null) return [];
  const ext = extOf(view);
  if (ext.sides !== undefined) {
    return ext.sides.map((s: SideView) => ({
      id: s.id,
      name: s.name,
      leader: s.leader,
      members: s.members ?? null,
      needs: s.needs ?? null,
      mine: s.mine,
      kind: s.kind ?? null,
      ethos: typeof s.ethos === "string" && s.ethos.trim() !== "" ? s.ethos.trim() : null,
      founder: s.founder ?? null,
      more: typeof s.more === "number" ? s.more : null,
    }));
  }
  return (view.factions ?? []).map((f) => ({ id: f, name: f, leader: null, members: null, needs: null, mine: view.faction === f, kind: null, ethos: null, founder: null, more: null }));
}

/** Is the story in faction mode (wave 18b, `founding:`)? The server says so
 *  with `canFound` (always sent then) or a row's `kind`. */
export function factionModeOf(view: Pick<GuestView, "canFound" | "sides"> | null | undefined): boolean {
  if (view === null || view === undefined) return false;
  if (typeof view.canFound === "boolean") return true;
  return (Array.isArray(view.sides) ? view.sides : []).some((s) => s.kind !== undefined);
}

/** The sides sheet's name: "Factions" in faction mode, else wave 18's
 *  "Sides & crews" (Start, Me, the lazy chunk's failure line). */
export function sidesLabelOf(view: Pick<GuestView, "canFound" | "sides"> | null | undefined): "Factions" | "Sides & crews" {
  return factionModeOf(view) ? "Factions" : "Sides & crews";
}

/** Start → Factions (wave 18b): offered when a faction is listed, you have
 *  a crew, or you may found one — in the show founding opens before the
 *  declared sides are revealed, so the list may hold nothing yet. */
export function factionsOffered(view: GuestView | null | undefined): boolean {
  if (view === null || view === undefined) return false;
  const ext = extOf(view);
  return (ext.sides ?? view.factions ?? []).length > 0 || (ext.crew ?? null) !== null || canFoundOf(view);
}

/** Faction mode: the race side you lead, by name — the server's `leads`,
 *  sent whether the side is listed or still hidden (the show's Excel and
 *  OpenOffice from the Truther Download to the clock). You stay with it.
 *  Null when you lead none, or the server doesn't say (read loosely, so an
 *  older wire without the field reads null). */
export function leadsOf(view: object | null | undefined): string | null {
  const v = (view as { leads?: unknown } | null | undefined)?.leads;
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Your faction's name for a profile (Start, Me): your row's, else the
 *  side you lead though it isn't listed yet, else the public faction. */
export function factionNameOf(view: GuestView | null): string | null {
  if (view === null) return null;
  if (!factionModeOf(view)) return view.faction;
  return myRow(view, sidesOf(view))?.name ?? leadsOf(view) ?? view.faction;
}

/** Your own faction's row (faction mode: the side or the founded faction). */
export function myRow(view: Pick<GuestView, "faction"> | null, rows: readonly SideRow[]): SideRow | null {
  return rows.find((r) => r.mine) ?? (view?.faction != null ? rows.find((r) => r.name === view.faction) ?? null : null);
}

/** Your own faction's count line (faction mode): "7 in · 6 more to win",
 *  "13 in · over the line · hold on to them", "7 in" (no `majority:`), ""
 *  (no count). Over the line is not a win: the story may count later (the
 *  show from its last hour), and members can still drift away. */
/** Over the line, never "won": the win is the story's count, not this. */
export const OVER_THE_LINE = "over the line · hold on to them";

export function factionCountLine(s: Pick<SideRow, "members" | "needs" | "more">): string {
  if (s.members === null) return "";
  if (s.needs === null) return `${s.members} in`;
  const more = s.more ?? Math.max(0, s.needs - s.members);
  return more > 0 ? `${s.members} in · ${more} more to win` : `${s.members} in · ${OVER_THE_LINE}`;
}

/** "founded by Ada" / "led by Excel" (faction mode), else "led by X". */
export function whoLine(s: Pick<SideRow, "kind" | "leader" | "founder">): string | null {
  const who = s.founder ?? s.leader;
  if (who === null) return null;
  return s.kind === "founded" ? `founded by ${who}` : `led by ${who}`;
}

/** "4 of 13 needed", "4 in", "" (an old server). */
export function countLine(s: Pick<SideRow, "members" | "needs">): string {
  if (s.members === null) return "";
  return s.needs !== null ? `${s.members} of ${s.needs} needed` : `${s.members} in`;
}

/** What a side's card offers this guest (§9.2). Faction mode adds
 *  `founder`: your own founded faction (Disband), or — on another card —
 *  you founded one and stay with it. */
export type SideAction = "in" | "join" | "switch" | "leader" | "founder" | "restricted";

/** What a card offers in faction mode (wave 18b): one faction at a time;
 *  leaders and founders stay with theirs. */
export function factionAction(side: SideRow, view: Pick<GuestView, "id" | "name" | "faction" | "restricted" | "crew">, rows: readonly SideRow[]): SideAction {
  const mine = myRow(view, rows);
  const crew = view.crew ?? null;
  const founder = crew !== null && crew.founder === view.id;
  // A leader stays with their side, listed or not: a still-hidden side is
  // no row (the server's `leads` says so), and Join would only answer 409.
  const leads = leadsOf(view) !== null || (mine !== null && mine.kind !== "founded" && mine.leader !== null && mine.leader === view.name);
  if (mine !== null && mine.id === side.id) {
    if (leads) return "leader";
    if (side.kind === "founded" && founder) return "founder";
    return view.restricted === true ? "restricted" : "in";
  }
  if (view.restricted === true) return "restricted";
  if (leads) return "leader";
  if (founder) return "founder";
  return mine !== null ? "switch" : "join";
}

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
/** "1 member", "3 members" (N9: the crew read "1 members"). */
export function memberCount(n: number): string {
  return `${n} member${n === 1 ? "" : "s"}`;
}

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
  if (factionModeOf(view)) return factionRecruitOffer(view, target);
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

/** Faction mode's offer (wave 18b): one faction at a time, so one button —
 *  your side's recruit, or your founded faction's invitation — and the
 *  sub line never names the other person's faction (nobody counts a rival). */
function factionRecruitOffer(view: GuestView, target: string): RecruitOffer {
  const p: PersonCard | undefined = (view.people ?? []).find((x) => x.id === target);
  const name = p?.name ?? "this program";
  const rows = sidesOf(view);
  const mine = myRow(view, rows);
  const crew = crewOf(view);
  const inMine = mine !== null && ((mine.kind === "founded" && crew !== null && crew.members.includes(target)) || (mine.kind !== "founded" && p?.faction === mine.name));
  const sub = `◆ ${inMine ? "in your faction" : "program"}${p?.location ? ` · ${p.location}` : ""}`;
  let side: RecruitOffer["side"] = null;
  let crewOffer: RecruitOffer["crew"] = null;
  let note: string | null = null;
  const led = mine === null ? leadsOf(view) : null;
  if (led !== null) {
    note = `That's ${name}'s pass. When ${led} opens, scan it to recruit them.`;
  } else if (mine === null) {
    note = rows.length === 0 && !canFoundOf(view) ? `That's ${name}'s pass. When the factions open, scan it to recruit them.` : `Join or found a faction first, then scan ${name}'s pass to recruit them.`;
  } else if (inMine) {
    note = `${name} is already in ${mine.name}.`;
  } else if (mine.kind === "founded") {
    crewOffer = { label: `🚪 Recruit ${name} to ${mine.name}` };
  } else {
    side = { label: `🚪 Recruit ${name} to ${mine.name}`, side: mine.name };
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

/**
 * What an answered invitation card says (M4). After a reload the server
 * marks the card answered with an empty record, so the live view decides:
 * in the crew / on the side → joined; a remembered no → not now; else the
 * invitation simply closed (answered elsewhere, or made moot).
 */
export function inviteDone(view: GuestView | null, inv: Pick<InviteView, "kind" | "target" | "targetName">, answered: Record<string, unknown>): string {
  const ext = extOf(view);
  const inCrew = inv.kind === "crew" && ext.crew != null && ext.crew.id === inv.target;
  const onSide = inv.kind === "side" && (sidesOf(view).some((s) => s.mine && (s.id === inv.target || s.name === inv.targetName)) || view?.faction === inv.target || view?.faction === inv.targetName);
  if (inCrew || onSide || answered["yes"] === true) return `You joined ${inv.targetName}.`;
  if (answered["yes"] === false) return "You said not now.";
  return "This invitation is closed.";
}

/** Faction mode: what saying yes to an invitation costs — *You'll leave
 *  Y.* when you're in another faction (one at a time), else null. */
export function inviteLeaveLine(view: GuestView | null, inv: Pick<InviteView, "target" | "targetName">): string | null {
  if (!factionModeOf(view)) return null;
  const mine = myRow(view, sidesOf(view));
  if (mine === null || mine.id === inv.target || mine.name === inv.targetName) return null;
  return `You'll leave ${mine.name}.`;
}

/** "Switch to The Way Out?"; in faction mode "… You'll leave Ada's Club." */
export function switchQuestion(name: string, from?: string | null): string {
  return from != null && from !== "" ? `Switch to ${name}? You'll leave ${from}.` : `Switch to ${name}?`;
}

/** Leaving your own faction (faction mode): a founder disbands it. */
export function leaveQuestion(side: Pick<SideRow, "name">, act: SideAction): string {
  return act === "founder" ? `Disband ${side.name}? Its members go back to neither.` : "Back to neither?";
}

/** The call that walks into `side` (faction mode): a founded faction's
 *  walk-in join; a declared side's join, or its switch from another side. */
export function joinFaction(side: SideRow, view: Pick<GuestView, "faction">, rows: readonly SideRow[], calls: Pick<SidesCallsLike, "join" | "defect" | "joinCrew">): Promise<unknown> {
  if (side.kind === "founded") return calls.joinCrew(side.id);
  const mine = myRow(view, rows);
  return mine !== null && mine.kind !== "founded" ? calls.defect(side.name) : calls.join(side.name);
}

/** The call that leaves your own faction: a founded one's leave (a
 *  founder's disbands it), else back to neither. */
export function leaveFaction(side: SideRow, calls: Pick<SidesCallsLike, "leave" | "leaveCrew">): Promise<unknown> {
  return side.kind === "founded" ? calls.leaveCrew() : calls.leave();
}

/** The calls `joinFaction` / `leaveFaction` use (a subset of `SidesCalls`). */
interface SidesCallsLike {
  join(side: string): Promise<unknown>;
  defect(to: string): Promise<unknown>;
  leave(): Promise<unknown>;
  joinCrew(crew: string): Promise<unknown>;
  leaveCrew(): Promise<unknown>;
}

/** The Mission tile for your faction (wave 18b, faction mode): its name
 *  and "7 of 13 · 6 more to win" ("14 in · over the line · hold on to them"); null when you're in none or the server
 *  sends no count. */
export function factionTileOf(view: GuestView | null): { name: string; status: string } | null {
  if (!factionModeOf(view)) return null;
  const mine = myRow(view, sidesOf(view));
  if (mine === null || mine.members === null) return null;
  if (mine.needs === null) return { name: mine.name, status: `${mine.members} in` };
  const more = mine.more ?? Math.max(0, mine.needs - mine.members);
  // Over the line, "14 of 13" would read wrong: say how many are in.
  return { name: mine.name, status: more > 0 ? `${mine.members} of ${mine.needs} · ${more} more to win` : `${mine.members} in · ${OVER_THE_LINE}` };
}
