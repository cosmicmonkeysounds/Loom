//! Wave 58: a codex QR read by the phone's own camera app, on a phone signed
//! in as a booth. `app-role.ts` opens the booth, so `?unlock=` lands here: once
//! the booth is up, redeem it once, strip it from the address (a reload must
//! not try again) and say what came of it, on the Codex when an entry landed.
//! The guest's twin is the effect in `session/guest.ts`. It lives in the booth
//! app, so a part on rails keeps the link until its upload's stage has gone.

import { useEffect, useRef } from "react";
import { unlockFromSearch, withoutUnlock } from "../codex.ts";
import type { RedeemAnswer } from "../scan-done.tsx";
import { redeemHeld, redeemNote, scanError } from "./model.ts";

export interface UnlockLinkOptions {
  /** This page is the app's own, not a pane embedded in Run. */
  ownsPage: boolean;
  /** Signed in, with a first view: the redeem can be answered and the note read. */
  ready: boolean;
  redeem: (code: string) => Promise<RedeemAnswer>;
  /** A quiet line on the booth. */
  say: (text: string) => void;
  openCodex: () => void;
  /** The view a refusal is worded against (`scanError`). */
  view: () => Parameters<typeof scanError>[1];
}

export function useUnlockLink({ ownsPage, ready, redeem, say, openCodex, view }: UnlockLinkOptions): void {
  const read = useRef(false);
  useEffect(() => {
    if (read.current || !ready) return;
    read.current = true;
    const code = ownsPage ? unlockFromSearch(window.location.search) : null;
    if (code === null) return;
    try {
      window.history.replaceState(null, "", `${window.location.pathname}${withoutUnlock(window.location.search)}`);
    } catch {
      /* fine */
    }
    void redeem(code).then(
      (r) => {
        say(redeemNote(r));
        if (redeemHeld(r)) openCodex();
      },
      (e: unknown) => say(scanError(e, view())),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}
