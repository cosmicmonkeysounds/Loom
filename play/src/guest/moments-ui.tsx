//! The moments lane's Notifications window and bell, when they are here
//! (wave 18, GUEST-SPEC §4, §13.1: `moments/notifications.tsx`
//! `NotificationsWindow`, `moments/provider.tsx` `BellButton`). They hold
//! the engine's own seen / acknowledged marks, so they win; until that lane
//! is merged the guest lane's own (`notifications.tsx`, `frame.tsx`
//! `BellButton`) stand in. Detected once, at load: a non-eager glob finds a
//! loader only when the file exists, and the provider's namespace has a
//! `BellButton` only once that lane exports one.

import type { ComponentType } from "react";
import * as Provider from "../moments/provider.tsx";
import { lazyPart, type LazyPart } from "./lazy-part.tsx";

/** The moments lane's window's props (§13.1). */
export interface TheirWindowProps {
  onClose?: () => void;
  timeOf?: (storyMs: number) => string;
}

const loaders = import.meta.glob<{ NotificationsWindow?: ComponentType<TheirWindowProps> }>("../moments/notifications.tsx");
const load = Object.values(loaders)[0];

/** Their window (lazy), or null when the moments lane's file isn't here. */
export const TheirNotificationsWindow: LazyPart<TheirWindowProps> | null =
  load === undefined
    ? null
    : lazyPart<TheirWindowProps>(
        () => load().then((m) => ({ default: (m.NotificationsWindow ?? (() => null)) as ComponentType<TheirWindowProps> })),
        "Notifications",
      );

/** Their bell, or null. */
export const TheirBell = ((Provider as unknown as { BellButton?: ComponentType<{ onOpen?: () => void; className?: string }> }).BellButton ?? null);
