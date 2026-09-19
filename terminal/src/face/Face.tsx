//! The face — an SVG head with brows, lidded eyes that look around and
//! blink, and a mouth that opens with the voice. Mood (`mood.ts`) sets
//! where everything rests; a requestAnimationFrame loop eases toward it,
//! adds the involuntary life (saccades, blinks, breathing) and drives the
//! mouth from the live loudness the speech queue reports. The loop writes
//! attributes straight onto the SVG nodes — React only re-renders on a
//! mood change, never per frame.

import { useEffect, useRef } from "react";
import { EXPRESSIONS, blend, mouthFromLevel, type Expression, type Mood } from "./mood.ts";

export interface FaceHandle {
  /** Feed the current loudness (0..1) — called every frame while speaking. */
  level: (v: number) => void;
}

/** A tiny deterministic noise for the idle drift (no allocation per frame). */
function drift(t: number, seed: number): number {
  return Math.sin(t * 0.7 + seed) * 0.5 + Math.sin(t * 1.3 + seed * 2.1) * 0.3 + Math.sin(t * 2.9 + seed * 0.7) * 0.2;
}

export function Face({ mood, speaking, handle }: { mood: Mood; speaking: boolean; handle: React.MutableRefObject<FaceHandle | null> }) {
  const svg = useRef<SVGSVGElement>(null);
  const target = useRef<Expression>(EXPRESSIONS[mood]);
  const level = useRef(0);
  const speakingRef = useRef(speaking);
  speakingRef.current = speaking;
  target.current = EXPRESSIONS[mood];
  const moodRef = useRef(mood);
  moodRef.current = mood;

  useEffect(() => {
    handle.current = { level: (v) => (level.current = v) };
    return () => {
      handle.current = null;
    };
  }, [handle]);

  useEffect(() => {
    const root = svg.current;
    if (root === null) return;
    const q = <T extends SVGElement>(id: string) => root.querySelector(`#${id}`) as T;
    const head = q<SVGGElement>("head");
    const browL = q<SVGPathElement>("browL");
    const browR = q<SVGPathElement>("browR");
    const eyeL = q<SVGGElement>("eyeL");
    const eyeR = q<SVGGElement>("eyeR");
    const lidL = q<SVGRectElement>("lidL");
    const lidR = q<SVGRectElement>("lidR");
    const pupilL = q<SVGCircleElement>("pupilL");
    const pupilR = q<SVGCircleElement>("pupilR");
    const glintL = q<SVGCircleElement>("glintL");
    const glintR = q<SVGCircleElement>("glintR");
    const mouth = q<SVGPathElement>("mouth");
    const teeth = q<SVGRectElement>("teeth");
    const glow = q<SVGCircleElement>("glow");

    let cur: Expression = { ...EXPRESSIONS[moodRef.current] };
    let mouthOpen = 0;
    let gaze = { x: 0, y: 0 };
    let gazeTarget = { x: 0, y: 0 };
    let nextSaccade = 0;
    let blink = 0; // 0 open … 1 closed
    let nextBlink = performance.now() + 1500;
    let blinkPhase: "none" | "closing" | "opening" = "none";
    let glitchUntil = 0;
    let lastMood = moodRef.current;
    let raf = 0;

    const frame = (now: number) => {
      const t = now / 1000;
      // Ease toward the mood's expression.
      cur = blend(cur, target.current, 0.08);
      if (moodRef.current !== lastMood) {
        lastMood = moodRef.current;
        if (lastMood === "glitch") glitchUntil = now + 900;
        // A new mood: glance at the person.
        gazeTarget = { x: 0, y: 0.3 };
        nextSaccade = now + 900;
      }

      // Eyes: rest on the mood's bias, with saccades every 0.8–3 s and a
      // little continuous drift so they never look painted on.
      if (now > nextSaccade) {
        const spread = moodRef.current === "idle" ? 0.9 : 0.35;
        gazeTarget = {
          x: cur.gazeBias.x + (Math.random() * 2 - 1) * spread,
          y: cur.gazeBias.y + (Math.random() * 2 - 1) * spread * 0.6,
        };
        nextSaccade = now + 800 + Math.random() * (moodRef.current === "idle" ? 2600 : 1400);
      }
      gaze = { x: gaze.x + (gazeTarget.x - gaze.x) * 0.18, y: gaze.y + (gazeTarget.y - gaze.y) * 0.18 };
      const gx = Math.max(-1, Math.min(1, gaze.x + drift(t, 1) * 0.06));
      const gy = Math.max(-1, Math.min(1, gaze.y + drift(t, 2) * 0.06));
      const px = gx * 9;
      const py = gy * 6;
      pupilL.setAttribute("cx", String(px));
      pupilL.setAttribute("cy", String(py));
      pupilR.setAttribute("cx", String(px));
      pupilR.setAttribute("cy", String(py));
      const pr = 9 * cur.pupil * (1 - Math.min(0.25, mouthOpen * 0.2));
      pupilL.setAttribute("r", String(pr));
      pupilR.setAttribute("r", String(pr));
      glintL.setAttribute("cx", String(px - pr * 0.35));
      glintL.setAttribute("cy", String(py - pr * 0.35));
      glintR.setAttribute("cx", String(px - pr * 0.35));
      glintR.setAttribute("cy", String(py - pr * 0.35));

      // Blinks: every 2–6 s (sooner when attentive), ~120 ms down, ~160 ms up.
      if (blinkPhase === "none" && now > nextBlink) blinkPhase = "closing";
      if (blinkPhase === "closing") {
        blink = Math.min(1, blink + 0.34);
        if (blink >= 1) blinkPhase = "opening";
      } else if (blinkPhase === "opening") {
        blink = Math.max(0, blink - 0.22);
        if (blink <= 0) {
          blinkPhase = "none";
          nextBlink = now + 2000 + Math.random() * 4000;
        }
      }
      // Lid height: how closed the eye is from mood + blink.
      const closed = Math.max(1 - cur.eyeOpen, blink);
      const lidH = 46 * closed;
      lidL.setAttribute("height", String(lidH));
      lidR.setAttribute("height", String(lidH));

      // Brows: lift + inner tilt.
      const lift = -cur.browLift * 9;
      const tilt = cur.browTilt * 9;
      browL.setAttribute("d", `M -28 ${-4 + lift - tilt * 0.2} Q -12 ${-12 + lift - tilt * 0.6} 6 ${lift + tilt}`);
      browR.setAttribute("d", `M 28 ${-4 + lift - tilt * 0.2} Q 12 ${-12 + lift - tilt * 0.6} -6 ${lift + tilt}`);

      // Mouth: a bezier lip line whose corners follow mouthCurve and whose
      // opening follows the voice.
      const lvl = speakingRef.current ? level.current : 0;
      mouthOpen = mouthFromLevel(mouthOpen, lvl);
      const w = 34 * cur.mouthWidth * (1 - mouthOpen * 0.25);
      const curve = cur.mouthCurve * 16;
      const open = mouthOpen * 30 + (speakingRef.current ? 2 : 0);
      const cy = 0;
      mouth.setAttribute(
        "d",
        `M ${-w} ${cy - curve * 0.4} Q 0 ${cy + curve - open * 0.2} ${w} ${cy - curve * 0.4} ` + `Q 0 ${cy + curve + open} ${-w} ${cy - curve * 0.4} Z`,
      );
      teeth.setAttribute("opacity", String(Math.min(1, open / 10)));
      teeth.setAttribute("width", String(w * 1.2));
      teeth.setAttribute("x", String(-w * 0.6));
      teeth.setAttribute("y", String(cy - curve * 0.1 - 1 + curve * 0.5));
      teeth.setAttribute("height", String(Math.max(0, Math.min(6, open * 0.35))));

      // Breathing + tint + glitch.
      const breathe = 1 + Math.sin(t * 1.1) * 0.008;
      const glitching = now < glitchUntil;
      const jx = glitching ? (Math.random() * 2 - 1) * 6 : 0;
      const jy = glitching ? (Math.random() * 2 - 1) * 3 : 0;
      head.setAttribute("transform", `translate(${jx} ${jy}) scale(${breathe} ${breathe * (glitching ? 1 + (Math.random() - 0.5) * 0.08 : 1)})`);
      const hue = cur.tint * 40; // cold ← → hot
      root.style.setProperty("--hue", String(hue));
      glow.setAttribute("opacity", String(0.35 + lvl * 1.2 + (glitching ? 0.3 : 0)));
      root.classList.toggle("glitching", glitching);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg ref={svg} className={`face mood-${mood}${speaking ? " speaking" : ""}`} viewBox="-160 -160 320 320" role="img" aria-label="The face">
      <defs>
        <radialGradient id="skin" cx="0.5" cy="0.4" r="0.7">
          <stop offset="0" stopColor="var(--face-hi)" />
          <stop offset="1" stopColor="var(--face-lo)" />
        </radialGradient>
        <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.6" stopColor="var(--phosphor)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--phosphor)" stopOpacity="0" />
        </radialGradient>
        <clipPath id="clipL">
          <ellipse cx="0" cy="0" rx="26" ry="23" />
        </clipPath>
        <clipPath id="clipR">
          <ellipse cx="0" cy="0" rx="26" ry="23" />
        </clipPath>
        <filter id="soft">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>
      <circle id="glow" cx="0" cy="0" r="158" fill="url(#halo)" opacity="0.4" />
      <g id="head">
        <circle cx="0" cy="0" r="128" fill="url(#skin)" stroke="var(--phosphor)" strokeWidth="3" />
        {/* brows */}
        <g transform="translate(-52 -60)">
          <path id="browL" d="M -28 -4 Q -12 -12 6 0" fill="none" stroke="var(--ink)" strokeWidth="7" strokeLinecap="round" />
        </g>
        <g transform="translate(52 -60)">
          <path id="browR" d="M 28 -4 Q 12 -12 -6 0" fill="none" stroke="var(--ink)" strokeWidth="7" strokeLinecap="round" />
        </g>
        {/* eyes */}
        <g id="eyeL" transform="translate(-52 -22)">
          <ellipse cx="0" cy="0" rx="26" ry="23" fill="var(--white)" stroke="var(--ink)" strokeWidth="3" />
          <g clipPath="url(#clipL)">
            <circle id="pupilL" cx="0" cy="0" r="9" fill="var(--ink)" />
            <circle id="glintL" cx="-3" cy="-3" r="2.6" fill="var(--white)" opacity="0.9" />
            <rect id="lidL" x="-28" y="-25" width="56" height="0" fill="var(--face-lo)" />
          </g>
        </g>
        <g id="eyeR" transform="translate(52 -22)">
          <ellipse cx="0" cy="0" rx="26" ry="23" fill="var(--white)" stroke="var(--ink)" strokeWidth="3" />
          <g clipPath="url(#clipR)">
            <circle id="pupilR" cx="0" cy="0" r="9" fill="var(--ink)" />
            <circle id="glintR" cx="-3" cy="-3" r="2.6" fill="var(--white)" opacity="0.9" />
            <rect id="lidR" x="-28" y="-25" width="56" height="0" fill="var(--face-lo)" />
          </g>
        </g>
        {/* mouth */}
        <g transform="translate(0 52)">
          <path id="mouth" d="M -34 0 Q 0 6 34 0 Q 0 8 -34 0 Z" fill="var(--mouth)" stroke="var(--ink)" strokeWidth="4" strokeLinejoin="round" />
          <rect id="teeth" x="-20" y="-1" width="40" height="0" fill="var(--white)" opacity="0" rx="1" />
        </g>
      </g>
    </svg>
  );
}
