// The audio ad's pop-up on a phone (wave 59a, docs/loom-w59-ads-contract.md C5):
// the Windows 95 window, its name, 🔊 and an ×. It closes with the track. If the
// phone refused the sound it stays, with a ▶ to tap. Inside the moments provider,
// so it yields to whatever already holds the moments.

import { useEffect, useSyncExternalStore } from "react";
import { useMomentsEngineContext } from "./moments/provider.tsx";
import { adCardsOpen, onAdCards, type AdSpots } from "./ad-spots.ts";
import { WinWindow } from "./ui/window.tsx";
import { usePlayHost } from "./host.ts";

// DRAFT w59a
export const AD_PLAY_LABEL = "▶ Play";

export function AdSlot({ spots, busy, tell }: { spots: AdSpots | undefined; busy: boolean; tell: ((seq: number) => void) | undefined }) {
  const host = usePlayHost();
  const engine = useMomentsEngineContext();
  const card = useSyncExternalStore(onAdCards, adCardsOpen, adCardsOpen);
  const blocked = busy || card || engine?.held === true || engine?.takeover != null;
  const armable = !host.embedded && spots !== undefined && tell !== undefined;
  useEffect(() => (armable ? spots.arm(tell) : undefined), [armable, spots, tell]);
  useEffect(() => spots?.setBusy(blocked), [spots, blocked]);
  const none = () => null;
  const shown = useSyncExternalStore(spots?.subscribe ?? (() => () => {}), spots?.shown ?? none, none);
  if (shown === null || spots === undefined) return null;
  return (
    <div className="ad-spot" role="status" data-ad={shown.n}>
      <WinWindow title={shown.name} onClose={() => spots.end()}>
        <div className="ad-spot-body">
          {shown.refused ? (
            <button type="button" className="w95-btn ad-spot-play" onClick={() => spots.retry()}>
              {AD_PLAY_LABEL}
            </button>
          ) : (
            <span aria-hidden>🔊</span>
          )}
        </div>
      </WinWindow>
    </div>
  );
}
