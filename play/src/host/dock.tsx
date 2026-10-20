//! The host dock (wave 13; the host lane builds it): the NEXT bar and the
//! pull-up drawer above a host booth's taskbar. Mounted by plumbing in the
//! booth; Stage A renders nothing.

import type { PrimeSession } from "../session/prime.ts";

export function HostDock(_p: {
  session: PrimeSession;
  wide: boolean;
  /** Open a guest's card in the booth (booth passes its opener; a no-op in Stage A). */
  openCard: (guestId: string) => void;
}) {
  return null;
}
