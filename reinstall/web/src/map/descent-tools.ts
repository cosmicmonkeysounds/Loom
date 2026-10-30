//! The map page's touch with the descent (wave 49): the event's words (for the
//! inspector's Talks select and the check) and the 👣 Test. One hook, so the
//! page itself only passes them on.

import { useCallback, useEffect, useState } from "react";
import { FOOTSTEP_TEST_MS, type DescentScript } from "@loom/house";
import { fetchDescent } from "../api.ts";
import { testFootsteps, testRefusal } from "./audio-api.ts";

export interface MapDescent {
  /** The event's `descent.json`, null when it has none (or an old server). */
  script: DescentScript | null;
  stepsTest: (speaker: string) => void;
}

/** What a 👣 Test says on the page. DRAFT w49 (UI copy). */
export function stepsSentText(speaker: string): string {
  return `👣 Steps on ${speaker} for ${Math.round(FOOTSTEP_TEST_MS / 1000)} s.`;
}

export function useMapDescent(base: string, token: string, unlock: () => Promise<boolean>, notice: (text: string) => void): MapDescent {
  const [script, setScript] = useState<DescentScript | null>(null);
  useEffect(() => {
    let live = true;
    void fetchDescent(base, token).then((s) => {
      if (live) setScript(s);
    });
    return () => {
      live = false;
    };
  }, [base, token]);
  const stepsTest = useCallback(
    (speaker: string) => {
      void (async () => {
        if (!(await unlock())) return;
        const r = await testFootsteps(base, token, speaker);
        notice(r.ok ? stepsSentText(speaker) : testRefusal(r, { speaker }));
      })();
    },
    [base, token, unlock, notice],
  );
  return { script, stepsTest };
}
