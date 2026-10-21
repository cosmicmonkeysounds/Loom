//! A host booth's cue press (D9, D10): any host may fire from its NEXT bar
//! or Cues tab. The press carries `presses` (the count its arm was bound
//! to), so when two hosts tap the same cue the server takes the first and
//! answers the second 409 `moved` — the desk then drops the arm with
//! "Cues moved — tap again". The director phone's `fireCue` does the rest
//! (a timeout, "not sure it fired" on no answer, a re-poll either way).

import { cueValueArgs } from "../../../core/src/cue-sheet.ts";
import { REPOLL_WAIT_MS, fireCue, type DeskFire, type FirePost } from "../director.tsx";
import type { HostCalls } from "./api.ts";

/** The desk's fire over the host calls. `fresh(ms)` re-polls the host view
 *  and resolves once that poll is in (or after `ms`), so the desk unlocks
 *  on fresh marks. */
export function hostFire(calls: Pick<HostCalls, "cue">, fresh: (ms: number) => Promise<void>, timeoutMs?: number): DeskFire {
  return async (id, subject, value, presses) => {
    const post: FirePost = async (body, signal) => {
      const r = await calls.cue(body.name, body.subject ?? null, body.args ?? null, body.presses, signal);
      // The press's lines ride along: LAST's did: reads them (BN-F14).
      return { refused: r["refused"] === true, moved: r["moved"] === true, said: r["said"], staff: r["staff"] };
    };
    const args = value !== undefined ? cueValueArgs(value) : null;
    const body = { name: id, label: "", ...(subject !== null ? { subject } : {}), ...(args !== null ? { args } : {}), ...(presses !== undefined ? { presses } : {}) };
    let wait: Promise<void> = Promise.resolve();
    const out = await fireCue(post, body, () => {
      wait = fresh(REPOLL_WAIT_MS);
    }, timeoutMs);
    await wait;
    return out;
  };
}
