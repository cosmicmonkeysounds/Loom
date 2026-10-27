//! The glitch takeover (wave 26, T2; CONTRACTS C3): the story's first glitch
//! (`NightView.glitch`) takes the whole phone for a moment — tear and RGB
//! bands, a cascade of fake system error windows carrying the story's text
//! (`glitch.text`, the hijack's "000. 000. 000."), a roll bar, a jitter on
//! the overlay only (never a filter on the app), then a tear-out to the
//! app, which never unmounted (a half-typed line survives).
//!
//! `full` (a guest, a player booth): ~6 s, swallows every tap, with a noise
//! burst and a buzz where the phone allows (skipped while the page is hidden
//! or sound is off). `light` (a host booth): 2.5 s, look only, with
//! pointer-events off so a cue is never blocked, and no sound. The provider
//! decides when (`takeoverDue`) and for how long, and holds the moments queue
//! meanwhile; this chunk only draws and sounds it. Flashes stay ≤ 3 Hz with
//! no full-field red; reduced motion shows a still frame. CSS in
//! `css/moments.css` (`.moments-takeover*`), so the embed's shadow roots
//! get it too.

import { useEffect, useState, type SyntheticEvent } from "react";
import { ensureAudio, vibrate } from "../alerts.ts";

// w26 (T2): the takeover's error windows' caption.
export const TAKEOVER_CAPTION = "System Error";
/** The windows' text when the story gave none. */
export const TAKEOVER_TEXT = "000. 000. 000.";
/** How many error windows cascade (full); the light one shows two. */
export const TAKEOVER_WINDOWS = 7;
/** The buzz: long, short, long (Android only; iOS never vibrates). */
export const TAKEOVER_BUZZ: readonly number[] = [400, 120, 400, 120, 900];

/** Where the n-th error window sits (percent of the screen), a stepped
 *  cascade that stays on screen (a window is at most 72 % wide). */
export function cascadeAt(n: number): { top: number; left: number } {
  return { top: 8 + ((n * 11) % 64), left: 2 + ((n * 7) % 24) };
}

/** A noise burst and a falling square tone on the shared context (silent until the page was tapped once). */
export function playGlitch(): void {
  const ctx = ensureAudio();
  if (ctx === null) return;
  try {
    const t0 = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.7);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.08, t0);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    noise.connect(ng).connect(ctx.destination);
    noise.start(t0);
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(660, t0 + 0.1);
    osc.frequency.exponentialRampToValueAtTime(70, t0 + 1.4);
    og.gain.setValueAtTime(0.0001, t0 + 0.1);
    og.gain.exponentialRampToValueAtTime(0.1, t0 + 0.12);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
    osc.connect(og).connect(ctx.destination);
    osc.start(t0 + 0.1);
    osc.stop(t0 + 1.5);
  } catch {
    /* no audio — fine */
  }
}

/** Swallow a tap or a key aimed at the app underneath. */
function swallow(e: SyntheticEvent): void {
  e.preventDefault();
  e.stopPropagation();
}

export function GlitchTakeover({ text, light = false, sound = true }: { text: string | null; light?: boolean; sound?: boolean }) {
  const [still, setStill] = useState(false);
  useEffect(() => {
    setStill(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
    if (light) return;
    const shown = typeof document === "undefined" || document.visibilityState !== "hidden";
    // Sound and buzz both wait on the sound setting, like the moments' ring.
    if (!shown || !sound) return;
    vibrate(TAKEOVER_BUZZ);
    playGlitch();
  }, [light, sound]);
  const words = text !== null && text.trim() !== "" ? text : TAKEOVER_TEXT;
  const count = light ? 2 : TAKEOVER_WINDOWS;
  return (
    <div
      className={`moments-takeover${light ? " light" : ""}${still ? " still" : ""}`}
      role={light ? undefined : "alert"}
      aria-live="assertive"
      {...(light ? {} : { onPointerDown: swallow, onClick: swallow, onTouchStart: swallow, onKeyDown: swallow })}
    >
      <div className="moments-takeover-bands" aria-hidden />
      <div className="moments-takeover-roll" aria-hidden />
      {Array.from({ length: count }, (_, n) => {
        const at = cascadeAt(n);
        return (
          <div key={n} className="moments-takeover-win w95-window" style={{ top: `${at.top}%`, left: `${at.left}%`, animationDelay: `${n * 0.35}s` }} aria-hidden={n > 0}>
            <div className="w95-titlebar moments-takeover-cap">
              <span className="w95-title">⚠ {TAKEOVER_CAPTION}</span>
            </div>
            <p className="moments-takeover-text">{words}</p>
          </div>
        );
      })}
    </div>
  );
}
