//! The Me sheet, fetched on first open (wave 18): a guest opens it rarely.

import type { ComponentProps } from "react";
import type { MeSheet as Me } from "./me.tsx";
import { lazyPart } from "./lazy-part.tsx";

export const LazyMeSheet = lazyPart<ComponentProps<typeof Me>>(() => import("./me.tsx").then((m) => ({ default: m.MeSheet })), "Me");
