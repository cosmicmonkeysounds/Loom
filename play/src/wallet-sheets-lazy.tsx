//! The wallet's sheets, fetched on first open (the guest's first load
//! never carries them; `wallet-sheets.tsx`).

import type { ComponentProps } from "react";
import type { FreezeSheet as Freeze, OfferSheet as Offer, PeopleAmountSheet as PeopleAmount, StimulusSheet as Stimulus } from "./wallet-sheets.tsx";
import { lazyPart } from "./guest/lazy-part.tsx";

const load = () => import("./wallet-sheets.tsx");
export const LazyPeopleAmountSheet = lazyPart<ComponentProps<typeof PeopleAmount>>(() => load().then((m) => ({ default: m.PeopleAmountSheet })), "The wallet");
export const LazyOfferSheet = lazyPart<ComponentProps<typeof Offer>>(() => load().then((m) => ({ default: m.OfferSheet })), "The wallet");
export const LazyStimulusSheet = lazyPart<ComponentProps<typeof Stimulus>>(() => load().then((m) => ({ default: m.StimulusSheet })), "The wallet");
export const LazyFreezeSheet = lazyPart<ComponentProps<typeof Freeze>>(() => load().then((m) => ({ default: m.FreezeSheet })), "The wallet");
