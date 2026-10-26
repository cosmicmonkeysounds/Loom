//! The guest's 📷 Scan sheet, a part of its own (wave 26): out of the
//! guest's first load, fetched a little after the first paint so the
//! taskbar's Scan opens it at once.

import type { ComponentProps } from "react";
import type { ScanSheet } from "./guest-scan-sheet.tsx";
import { lazyPart } from "./guest/lazy-part.tsx";

export const LazyScanSheet = lazyPart<ComponentProps<typeof ScanSheet>>(() => import("./guest-scan-sheet.tsx").then((m) => ({ default: m.ScanSheet })), "The scanner");
