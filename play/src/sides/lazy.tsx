//! The sides chunk, fetched on first use (wave 18, GUEST-SPEC §9, §13.4):
//! the Sides sheet, the Recruit sheet, the invitation's answer sheet, Found
//! a crew, the doors and the invite card. Nothing of it is in the guest's
//! first load (`test/first-load.test.ts`).

import type { WidgetProps } from "../widgets.tsx";
import type { SidesLayerProps } from "./index.tsx";
import { lazyPart } from "../guest/lazy-part.tsx";

export const LazySidesLayer = lazyPart<SidesLayerProps>(() => import("./index.tsx").then((m) => ({ default: m.SidesLayer })), "Factions");
export const LazyDoors = lazyPart<WidgetProps>(() => import("./doors.tsx").then((m) => ({ default: m.Doors })), "The doors");
export const LazyInvite = lazyPart<WidgetProps>(() => import("./invite.tsx").then((m) => ({ default: m.InviteCard })), "The invitation");
