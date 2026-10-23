//! The door overlay (wave 20, CONTRACT-w20 §1.4 item 6): while the
//! server-room door stands open and the heart wants it shut (`heart_stage` is
//! `door`, `scan` or `talk`), a full-width *CLOSE THE DOOR* banner with an
//! amber pulse, and one `exclamation` each time it comes up. It never ends a
//! line; it takes no taps (the choices under it are greyed instead).

import "./heart.css";
import { useEffect, useRef } from "react";
import { sfx } from "../sound/bus.ts";
import { doorOverlayOn } from "./heart.ts";

export function DoorOverlay({ doorOpen, stage }: { doorOpen: boolean | null; stage: string | null }) {
  const on = doorOverlayOn(doorOpen, stage);
  const was = useRef(false);
  useEffect(() => {
    if (on && !was.current) sfx("exclamation");
    was.current = on;
  }, [on]);
  if (!on) return null;
  return (
    <div className="door-overlay" role="alert" aria-live="assertive">
      <div className="door-overlay-band">
        <span className="door-overlay-icon" aria-hidden="true">
          ⚠
        </span>
        CLOSE THE DOOR
      </div>
    </div>
  );
}
