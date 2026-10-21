//! The scan box (wave 17, D1): the corner of an awake wall terminal that
//! reads a pass while the idle show plays round it. The camera's video is
//! always drawn here (never `display: none`: a hidden video stops decoding
//! on some tablets), the reticle sweeps over it, the typed fallback opens
//! out of it, and no popup ever lands on it (`IdleShow`'s `reserveRef`).
//! A room terminal whose character is speaking there says LISTEN instead.

import type { ReactNode, RefObject } from "react";
import { SCAN_COPY } from "./scan-copy.ts";

export function ScanBox({
  boxRef,
  scanner,
  listen,
  problem,
  typedOpen,
  onToggleTyped,
  typed,
}: {
  boxRef: RefObject<HTMLElement>;
  /** The live camera (`<Scanner>`), mounted for as long as the box is. */
  scanner: ReactNode;
  /** The character speaking in this room: "LISTEN — … IS SPEAKING". */
  listen: string | null;
  /** Why the camera can't run, if it can't. */
  problem: string | null;
  typedOpen: boolean;
  onToggleTyped: () => void;
  /** The typed fallback (shown while open). */
  typed: ReactNode;
}) {
  return (
    <aside ref={boxRef} className={`scan-box${typedOpen ? " open" : ""}${listen !== null ? " listening" : ""}`} aria-label={SCAN_COPY.title}>
      <div className="scan-box-cam">{scanner}</div>
      <div className="scan-box-words">
        {listen !== null ? (
          <>
            <div className="scan-box-title blink">{SCAN_COPY.listen}</div>
            <div className="scan-box-hint">{listen}</div>
          </>
        ) : (
          <>
            <div className="scan-box-title">{SCAN_COPY.title}</div>
            <div className="scan-box-hint">{SCAN_COPY.hint}</div>
          </>
        )}
        {problem !== null && <div className="scan-box-problem">{problem}</div>}
        <button type="button" className="link scan-box-typed" onClick={onToggleTyped}>
          {SCAN_COPY.typed}
        </button>
        {typedOpen && typed}
      </div>
    </aside>
  );
}
