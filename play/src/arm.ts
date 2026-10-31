// Arm, then fire, for the story's own buttons (W11). An INTERACTION the
// story marks `arm: true` (`InteractionSummary.arm`) — a booth's 🔌 / 💥 /
// ❌ patch-bay fallbacks, a guest button that can't be taken back — never
// fires in one tap: the first tap arms it (it turns black and reads "Tap
// again to fire"), a second one ≥ `ARM_DEAD_MS` and < `ARM_MS` later fires,
// and it disarms itself after `ARM_MS` or when the page is left. The model
// is core's `tapCue`, the one the director's phone and the laptop's
// Director page use; buttons without `arm` fire on the first tap as before.

import { useCallback, useEffect, useState } from "react";
import { ARM_DEAD_MS, ARM_MS, tapCue, type Armed, type Tap } from "../../core/src/cue-sheet.ts";
import type { CueRow } from "../../core/src/cue-sheet.ts";
import type { Action, Interaction } from "./types.ts";

export { ARM_DEAD_MS, ARM_MS };

/** Call `disarm` when the page goes hidden (the screen locks, the director
 *  switches to the radio app) or the window loses focus: an arm never
 *  survives the director looking away (spec §4.3). A hidden page may also
 *  freeze the 4 s timer, which would leave a stale "Tap again to fire".
 *  Returns the unsubscribe. */
export function disarmOnLeave(doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">, win: Pick<Window, "addEventListener" | "removeEventListener">, disarm: () => void): () => void {
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") disarm();
  };
  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("blur", disarm);
  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("blur", disarm);
  };
}

/** The second line an armed button reads (the director phone's words). */
export const ARM_LINE = "Tap again to fire";

/** The cue-sheet row a button stands for: no person to pick, no marks.
 *  `tapCue` reads only the row's `id` and `subject`. */
function buttonRow(id: string): CueRow {
  return { id, subject: false } as Pick<CueRow, "id" | "subject"> as CueRow;
}

/** What a tap on button `id` does, given what is armed (core's `tapCue`). */
export function armTap(armed: Armed | null, id: string, now: number): Exclude<Tap, { kind: "pick" }> {
  const t = tapCue(armed, buttonRow(id), now);
  // A button row never needs a person, so `pick` can't come back.
  return t.kind === "pick" ? { kind: "ignore" } : t;
}

/** One screen's armed button (at most one at a time, like the cue sheet). */
export interface ArmButtons {
  /** The armed button's key, or null. */
  armed: string | null;
  /** Tap button `id`: fire `fire` now (`arm` false), or arm it / fire it on
   *  the second tap (`arm` true). */
  tap: (id: string, arm: boolean | undefined, fire: () => void) => void;
}

export function useArmButtons(): ArmButtons {
  const [armed, setArmed] = useState<Armed | null>(null);
  // Disarms itself if the second tap never comes, and when the page is left.
  useEffect(() => {
    if (armed === null) return;
    const t = setTimeout(() => setArmed(null), ARM_MS);
    const off = disarmOnLeave(document, window, () => setArmed(null));
    return () => {
      clearTimeout(t);
      off();
    };
  }, [armed]);
  const tap = useCallback(
    (id: string, arm: boolean | undefined, fire: () => void) => {
      if (arm !== true) {
        setArmed(null);
        fire();
        return;
      }
      const t = armTap(armed, id, Date.now());
      if (t.kind === "arm") setArmed(t.armed);
      else if (t.kind === "fire") {
        setArmed(null);
        fire();
      }
    },
    [armed],
  );
  return { armed: armed?.id ?? null, tap };
}

/** A story button as an `ActionRow` action: armed-looking while armed, and
 *  tapped through `arm` (so an `arm: true` one needs two taps). */
export function interactionAction(i: Pick<Interaction, "id" | "label" | "arm">, arm: ArmButtons, fire: () => void): Action {
  return { label: i.label, onClick: () => arm.tap(i.id, i.arm, fire), ...(arm.armed === i.id ? { armed: true } : {}) };
}
