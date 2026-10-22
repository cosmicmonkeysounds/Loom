//! Wave 18b (R15): the booth's badges — a guest's `badge:` lines (🚻
//! Bathroom Mode) beside their name wherever the booth shows one: Guests,
//! the card, the pickers, a Wanted poster, the door queue, the confront.
//! The booth view's guest rows carry them (`PrimeGuest.badges`); the rows
//! that only carry a name (a poster, a door entry) look them up here by id.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { badgesOf } from "../guest/wire.ts";
import { NameBadges } from "../ui/primitives.tsx";
import type { NameBadge, PrimeGuest } from "../types.ts";

const NONE: ReadonlyMap<string, NameBadge[]> = new Map();

const BoothBadgesContext = createContext<ReadonlyMap<string, NameBadge[]>>(NONE);

/** Guest id → the badges they wear now (only guests wearing one). */
export function boothBadgeMap(guests: readonly PrimeGuest[] | undefined): Map<string, NameBadge[]> {
  const out = new Map<string, NameBadge[]>();
  for (const g of guests ?? []) {
    const b = badgesOf(g);
    if (b.length > 0) out.set(g.id, b);
  }
  return out;
}

export function BoothBadgesProvider({ guests, children }: { guests: readonly PrimeGuest[] | undefined; children: ReactNode }) {
  const map = useMemo(() => boothBadgeMap(guests), [guests]);
  return <BoothBadgesContext.Provider value={map}>{children}</BoothBadgesContext.Provider>;
}

/** The badges a guest wears, beside their name (nothing when none). */
export function GuestBadges({ id }: { id: string }) {
  const map = useContext(BoothBadgesContext);
  return <NameBadges badges={map.get(id)} />;
}
