//! The Notifications window, fetched on first open (wave 18): its rows,
//! exits and gags are a guest's rare trip, so they stay out of the first load.

import type { NotificationsWindowProps } from "./notifications.tsx";
import { lazyPart } from "./lazy-part.tsx";

export const LazyNotificationsWindow = lazyPart<NotificationsWindowProps>(() => import("./notifications.tsx").then((m) => ({ default: m.NotificationsWindow })), "Notifications");
