//! The void's jump scare (wave 26, R4): his face, huge and angry, over a
//! Win9x "FATAL EXCEPTION 0E" panel, with the screech (`Sfx.scare`). One hard
//! flash at the start and nothing faster than 3 Hz after it (the face shakes
//! at 2.5 Hz; no strobe). Under `prefers-reduced-motion` it neither zooms nor
//! shakes. Shown for `SCARE_MS`, then the teleport (`engine.ts` `escape`).
//! No name text: the face is the one the TV shows, nothing says whose it is.

import { useRef } from "react";
import { Face, type FaceHandle } from "@loom/terminal/face/Face.tsx";
import { SCARE_TITLE } from "./moments.ts";

// DRAFT w26 (R4): the panel's glitch art (no name, no words a guest could act on).
export const SCARE_GARBAGE = "0028:C0DE0E36 VXD VMM(01) + 00010E36";

export function Scare() {
  const handle = useRef<FaceHandle | null>(null);
  return (
    <div className="scare" role="alert" aria-label={SCARE_TITLE}>
      <div className="scare-flash" aria-hidden="true" />
      <div className="scare-face" aria-hidden="true">
        <Face mood="angry" speaking={false} handle={handle} />
      </div>
      <div className="scare-panel">
        <b>{SCARE_TITLE}</b>
        <span>{SCARE_GARBAGE}</span>
      </div>
    </div>
  );
}
