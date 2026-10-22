//! The "scan done" dialog's chunk (wave 18b, R1), fetched on the first scan
//! rather than in the guest's first load: the 📷 sheet prefetches it when it
//! opens, and the scan's answer waits on it alongside the request.

import type { ComponentProps } from "react";
import { retryImport } from "./lazy-chunk.tsx";
import { lazyPart } from "./guest/lazy-part.tsx";
import type { ScanDoneDialog } from "./scan-done.tsx";

/** The chunk's pure readers (`redeemOutcome`, `checkinOutcome`, `scanErrorNote`). */
export const loadScanDone = retryImport(() => import("./scan-done.tsx"));

export const LazyScanDone = lazyPart<ComponentProps<typeof ScanDoneDialog>>(() => import("./scan-done.tsx").then((m) => ({ default: m.ScanDoneDialog })), "The scan result");

/** A call's answer or its refusal, as a value (so it waits beside the chunk). */
export function settled<T>(p: Promise<T>): Promise<{ r: T } | { e: unknown }> {
  return p.then(
    (r) => ({ r }),
    (e: unknown) => ({ e }),
  );
}
