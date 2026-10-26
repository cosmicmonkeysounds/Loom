//! The locked phone's screen (wave 26, R1), a part of its own: never in the
//! guest's first load. Fetched a little after the first paint (`prefetch`),
//! so a capture finds it already there.

import type { ComponentProps } from "react";
import type { LockScreen } from "./lock.tsx";
import { lazyPart } from "./lazy-part.tsx";

export const LazyLockScreen = lazyPart<ComponentProps<typeof LockScreen>>(() => import("./lock.tsx").then((m) => ({ default: m.LockScreen })), "This screen", <main className="lock-screen" />);
