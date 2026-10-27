//! (wave 32) The ad burst where the cutscene layer won't draw it: the
//! Server Door's chess and casino terminals (no cutscenes there), and any
//! page whose lazy cutscene chunk is still loading or failed (`slot.tsx`
//! falls back to the slide's card). In the base bundle, CSS only, like the
//! glitch takeover: a few torn bands, three error windows reading the
//! burst's line, the line itself as a banner, gone after `BURST_MS`. It
//! draws over whatever is up and never covers it for long, takes no taps
//! (a chess game or a bet goes on under it), and sits under the overlays.
//! The cutscene layer's `AdBurst` (the popup storm) is the full picture.

import { useEffect, useState } from "react";
import { BURST_MS } from "./slides.ts";
import { sfx } from "./sound/bus.ts";

/** The torn bands (top / height %, tint, jump em): never a full red field. */
const BANDS: ReadonlyArray<{ top: number; h: number; tint: "c" | "m" | "y" | "w"; dx: number }> = [
  { top: 12, h: 6, tint: "m", dx: -4 },
  { top: 41, h: 10, tint: "c", dx: 5 },
  { top: 77, h: 5, tint: "y", dx: -3 },
];
/** The error windows: where each lands (% left / top) and when (ms). */
const WINDOWS: ReadonlyArray<{ x: number; y: number; at: number }> = [
  { x: 6, y: 8, at: 120 },
  { x: 54, y: 16, at: 420 },
  { x: 18, y: 62, at: 720 },
];
/** The banner slams in this far in (ms). */
const BANNER_AT = 250;
/** Its accents (s after the cue), `over` (he may be talking): a crackle, then the slam. */
export const BURST_FLASH_SOUNDS: ReadonlyArray<{ at: number; name: "static" | "glitch"; gain: number }> = [
  { at: 0, name: "static", gain: 0.3 },
  { at: BANNER_AT / 1000, name: "glitch", gain: 0.35 },
];

/** The bursts (`seq:at`) whose accents this page has scheduled (a remount stays silent). */
const sounded = new Set<string>();
/** May this burst schedule its sounds? True once per cue per page. */
export function claimBurstFlashSounds(seq: number, at: number): boolean {
  const key = `${seq}:${at}`;
  if (sounded.has(key)) return false;
  sounded.add(key);
  return true;
}
/** Forget the bursts already sounded (tests). */
export function resetBurstFlashSounds(): void {
  sounded.clear();
}

export function BurstFlash({ seq, at: cueAt, t, text }: { seq: number; at: number; t: number; text: string }) {
  // Drawn from where it stood when this page first saw it (one poll late at most).
  const [t0] = useState(() => Math.max(0, Math.min(BURST_MS, t)));
  const [over, setOver] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setOver(true), Math.max(0, BURST_MS - t0));
    return () => window.clearTimeout(id);
  }, [t0]);
  useEffect(() => {
    if (!claimBurstFlashSounds(seq, cueAt)) return;
    for (const c of BURST_FLASH_SOUNDS) {
      const delay = c.at - t0 / 1000;
      if (delay < -0.15) continue; // past: never late
      sfx(c.name, { over: true, gain: c.gain, delay: Math.max(0, delay) });
    }
  }, [seq, cueAt, t0]);
  if (over || t0 >= BURST_MS) return null;
  const at = (ms: number) => ({ animationDelay: `${ms - t0}ms` });
  return (
    <div className="screen-burst" data-burst-flash={seq} aria-hidden="true" style={at(0)}>
      {BANDS.map((b, i) => (
        <div key={i} className={`sg-band sg-${b.tint}`} style={{ top: `${b.top}%`, height: `${b.h}%`, ["--dx" as string]: `${b.dx}em`, ...at(0) }} />
      ))}
      {WINDOWS.map((w, i) => (
        <div key={i} className="sg-win" style={{ left: `${w.x}%`, top: `${w.y}%`, ...at(w.at) }}>
          <div className="sg-win-bar">
            {/* DRAFT w32 (the cutscene burst's own popup title) */}
            <span>SPECIAL OFFER</span>
            <span className="sg-win-x">×</span>
          </div>
          <div className="sg-win-body">
            <span className="sg-win-icon">✖</span>
            <span>{text}</span>
          </div>
          <div className="sg-win-ok">OK</div>
        </div>
      ))}
      <div className="screen-burst-banner" style={at(BANNER_AT)}>
        <div className="screen-burst-star">★ ★ ★</div>
        <div className="screen-burst-text">{text}</div>
      </div>
    </div>
  );
}
