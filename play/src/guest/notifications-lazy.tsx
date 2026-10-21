//! The Notifications window (the moments lane's `moments/notifications.tsx`,
//! GUEST-SPEC §4), fetched on first open (wave 18): its rows, exits and gags
//! are a guest's rare trip, so they stay out of the first load.

import { lazyPart } from "./lazy-part.tsx";

export interface NotificationsWindowProps {
  onClose?: () => void;
  timeOf?: (storyMs: number) => string;
}

export const LazyNotificationsWindow = lazyPart<NotificationsWindowProps>(() => import("../moments/notifications.tsx").then((m) => ({ default: m.NotificationsWindow })), "Notifications");
