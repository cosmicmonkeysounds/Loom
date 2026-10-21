//! The sides chunk, fetched on first use (wave 18, GUEST-SPEC §9, §13.4):
//! the Sides sheet, the Recruit sheet, the invitation's answer sheet, Found
//! a crew, the doors and the invite card. Nothing of it is in the guest's
//! first load (`test/first-load.test.ts`).

import { createElement } from "react";
import type { WidgetProps } from "../widgets.tsx";
import type { SidesLayerProps } from "./index.tsx";
import { lazyPart, type LazyPart } from "../guest/lazy-part.tsx";
import { sidesLabelOf } from "./model.ts";

const loadSides = () => import("./index.tsx").then((m) => ({ default: m.SidesLayer }));
const LazyFactions = lazyPart<SidesLayerProps>(loadSides, "Factions");
const LazyCrews = lazyPart<SidesLayerProps>(loadSides, "Sides & crews");

/** The sides sheets; a chunk that won't load names the sheet this story
 *  has ("Factions" in faction mode, else "Sides & crews"). */
export const LazySidesLayer: LazyPart<SidesLayerProps> = Object.assign((p: SidesLayerProps) => createElement(sidesLabelOf(p.view) === "Factions" ? LazyFactions : LazyCrews, p), { prefetch: LazyFactions.prefetch });
export const LazyDoors = lazyPart<WidgetProps>(() => import("./doors.tsx").then((m) => ({ default: m.Doors })), "The doors");
export const LazyInvite = lazyPart<WidgetProps>(() => import("./invite.tsx").then((m) => ({ default: m.InviteCard })), "The invitation");
