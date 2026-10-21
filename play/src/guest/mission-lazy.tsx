//! Mission's window, a part of its own (wave 18): the guest's home after
//! sign-in, not the join screen — fetched as the page loads (`prefetch`), so
//! the join screen paints first and the home is there by the time the
//! stream is.

import type { ComponentProps } from "react";
import type { MissionHome } from "./mission.tsx";
import { lazyPart } from "./lazy-part.tsx";

export const LazyMission = lazyPart<ComponentProps<typeof MissionHome>>(() => import("./mission.tsx").then((m) => ({ default: m.MissionHome })), "Your mission", <div className="screen mission" />);
