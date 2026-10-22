//! The few sides readers the guest's first load needs (wave 18b): is this
//! faction mode, is Start → Factions offered, what the sheet is called and
//! your faction's name. Split out of `model.ts` so the entry chunk doesn't
//! carry the whole sides model (the 145 kB first-load gate); `model.ts`
//! re-exports every one of them.

import type { FactionKind, GuestView } from "../types.ts";
import { canFoundOf, extOf, type SideView } from "../guest/wire.ts";

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

