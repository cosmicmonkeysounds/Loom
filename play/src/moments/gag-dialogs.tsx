//! The Recycle Bin's dialogs (wave 18, the moments lane; GUEST-SPEC §4.2),
//! loaded on the first ✕ or Clear all (`notifications.tsx` lazy-imports this
//! file): the confirm, the in-use error, the multiple-delete confirm, the
//! fake "Deleting…" bar, Access is denied, and the beans. `WinDialog`, so
//! `plain` renders the same words in a plain dialog.

import { WinDialog } from "../ui/window.tsx";
import { DELETE_BAR_MS, GAG_COPY } from "./delete-gags.ts";

/** Which dialog is up. */
export type GagStep =
  | { kind: "confirm"; title: string }
  | { kind: "inUse"; title: string }
  | { kind: "confirmAll"; n: number }
  | { kind: "deleting"; title: string; k: number; n: number; still: boolean }
  | { kind: "denied"; caption: string }
  | { kind: "beans" };

export interface GagProps {
  step: GagStep;
  /** Yes on a confirm. */
  onYes: () => void;
  /** No, OK, Cancel, Escape: close (Cancel stops the bar; what went stays gone). */
  onClose: () => void;
}

export default function GagDialog({ step, onYes, onClose }: GagProps) {
  switch (step.kind) {
    case "confirm":
    case "confirmAll":
      return (
        <WinDialog title={step.kind === "confirm" ? GAG_COPY.confirmTitle : GAG_COPY.clearTitle} onClose={onClose}>
          <div className="moments-gag">
            <p className="moments-gag-text">
              <span className="moments-gag-icon" aria-hidden>
                🗑
              </span>
              {step.kind === "confirm" ? GAG_COPY.confirm(step.title) : GAG_COPY.clear(step.n)}
            </p>
            <div className="moments-gag-buttons">
              <button type="button" className="w95-btn moments-gag-yes" onClick={onYes}>
                {GAG_COPY.yes}
              </button>
              <button type="button" className="w95-btn" onClick={onClose}>
                {GAG_COPY.no}
              </button>
            </div>
          </div>
        </WinDialog>
      );
    case "inUse":
    case "denied":
    case "beans":
      return (
        <WinDialog title={step.kind === "beans" ? GAG_COPY.beansTitle : step.kind === "inUse" ? GAG_COPY.inUseTitle : GAG_COPY.deniedTitle} onClose={onClose}>
          <div className="moments-gag">
            <p className="moments-gag-text">
              <span className="moments-gag-icon" aria-hidden>
                {step.kind === "beans" ? "🫘" : "⛔"}
              </span>
              {step.kind === "inUse" ? GAG_COPY.inUse(step.title) : step.kind === "denied" ? GAG_COPY.denied(step.caption) : GAG_COPY.beans}
            </p>
            <div className="moments-gag-buttons">
              <button type="button" className="w95-btn moments-gag-yes" onClick={onClose}>
                {GAG_COPY.ok}
              </button>
            </div>
          </div>
        </WinDialog>
      );
    case "deleting": {
      // Reduce Motion: the bar fills in one step at the end.
      const shown = step.still ? (step.k >= step.n ? step.n : 0) : step.k;
      const pct = step.n === 0 ? 100 : Math.round((shown / step.n) * 100);
      return (
        <WinDialog title={GAG_COPY.deletingTitle} onClose={onClose}>
          <div className="moments-gag" aria-live="polite">
            <p className="moments-gag-move">
              <span className={`moments-gag-paper${step.still ? " still" : ""}`} aria-hidden>
                📄
              </span>
              <span aria-hidden> ⟶ 🗑 </span>
              <span className="moments-gag-name">&apos;{step.title}&apos;</span>
            </p>
            <div className="moments-gag-bar w95-inset" role="progressbar" aria-valuemin={0} aria-valuemax={step.n} aria-valuenow={shown} data-ms={DELETE_BAR_MS}>
              <span className="moments-gag-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="moments-gag-buttons">
              <span className="moments-gag-count">{GAG_COPY.progress(shown, step.n)}</span>
              <button type="button" className="w95-btn" onClick={onClose}>
                {GAG_COPY.cancel}
              </button>
            </div>
          </div>
        </WinDialog>
      );
    }
  }
}
