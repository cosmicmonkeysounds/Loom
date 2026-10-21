//! The guest lane's two card kinds (wave 18, GUEST-SPEC §9.1, §9.4,
//! CONTRACTS A8): `sides` — the doors, the full-bleed big at the side
//! reveal — and `invite` — an invitation to a side or a crew. Registered
//! once, from `guest/app.tsx`, through the moments lane's `registerWidget`
//! when `widgets.tsx` exports it, else straight into `WIDGETS` (the same
//! effect, until that lane is merged). Both render from the lazy sides
//! chunk.

import * as W from "../widgets.tsx";
import type { WidgetDef } from "../widgets.tsx";
import { LazyDoors, LazyInvite } from "./lazy.tsx";

/** A `WidgetDef` with the wave 18 flags the big rung reads. */
export type GuestWidgetDef = WidgetDef & { inline?: boolean; fullBleed?: boolean };

export const SIDES_WIDGET: GuestWidgetDef = { label: "🚪 choose a side", answerable: true, inline: true, fullBleed: true, render: (p) => <LazyDoors {...p} /> };
export const INVITE_WIDGET: GuestWidgetDef = { label: "🚪 an invitation", answerable: true, inline: true, render: (p) => <LazyInvite {...p} /> };

type Register = (kind: string, def: GuestWidgetDef) => void;

/** Register a kind through the moments lane's `registerWidget`, else by hand. */
export function registerGuestWidget(kind: string, def: GuestWidgetDef): void {
  const reg = (W as unknown as { registerWidget?: Register }).registerWidget;
  if (typeof reg === "function") reg(kind, def);
  else W.WIDGETS[kind] = def;
}

let done = false;
/** Register `sides` and `invite` (idempotent). */
export function registerSidesWidgets(): void {
  if (done) return;
  done = true;
  registerGuestWidget("sides", SIDES_WIDGET);
  registerGuestWidget("invite", INVITE_WIDGET);
}
