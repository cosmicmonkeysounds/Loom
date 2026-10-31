//! The audio ad's pop-up on a wall (wave 59a): the idle show's Windows 95 window,
//! its name, 🔊 and an ×, in the corner the scan box leaves free. It closes with
//! the track. A page that may not play sound yet stays up with a ▶ to tap. The
//! words we add carry `DRAFT w59a`.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { adTableUp, adsHere, wallAd } from "./ad-spot.ts";
import type { TerminalConfig } from "./config.ts";
import { serverNow } from "./cutscene/clock.ts";
import { momentUp } from "./cutscene/moment-bus.ts";
import type { ScreenState } from "./screen.ts";

/** A beat: the poll says what is on the air, this keeps the start on the instant (ms). */
const AD_BEAT_MS = 250;

export function AdSpot({ config, state, busy }: { config: TerminalConfig; state: ScreenState | null; busy: boolean }) {
  const here = adsHere(config);
  const latest = useRef({ state, busy, here });
  latest.current = { state, busy, here };
  useEffect(() => {
    const beat = () => {
      const l = latest.current;
      wallAd.step(l.here ? (l.state?.ad ?? null) : null, l.busy || momentUp() || adTableUp(), serverNow(l.state));
    };
    beat();
    const id = window.setInterval(beat, AD_BEAT_MS);
    return () => window.clearInterval(id);
  }, []);
  const shown = useSyncExternalStore(wallAd.subscribe, wallAd.current, wallAd.current);
  if (shown === null) return null;
  return (
    <div className="ad-spot" role="status" data-ad={shown.n}>
      <div className="ad-window">
        <div className="ad-titlebar">
          <span>{shown.name}</span>
          <button type="button" className="ad-x" aria-label="Close" onClick={() => wallAd.close()}>
            ×
          </button>
        </div>
        <div className="ad-body">
          {shown.refused ? (
            <button type="button" className="ad-button" onClick={() => wallAd.retry(serverNow(latest.current.state))}>
              {/* DRAFT w59a */}▶ Play
            </button>
          ) : (
            <span className="ad-spot-sound" aria-hidden="true">
              🔊
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
