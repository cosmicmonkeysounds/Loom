//! The cutscenes of Act F–G (lane tv3): midnight, the final reveal,
//! bobbing, the Bag of Truth, truth.txt, the verdict, the pickup line, the
//! song, the prom, the rave, the advice, the advice helped, the banishment,
//! the hand jive, the ceremony and its awards, the resurrection.
//! Owned by its lane; the engine (`../registry.ts`) only lists them.
//! See `../types.ts` for the contract and `../kit/` for the building blocks.
//!
//! Every scene is a picture of `t` (ms since it started, server time): its
//! storyboard sits above it, an intro of motion, a hold that keeps moving
//! for as long as the slide is up (a persistent slide loops forever), and
//! an outro for a moment. The TV take is the elaborate one; a wall
//! terminal's is lighter (fewer layers, no heavy canvases). The words come
//! from the story (`beats/finale.loom`, `beats/ceremony.loom`, the Clock
//! Strikes narration, main.loom's broadcasts) and the slide copy.

import "./act3.css";
import { useEffect, useRef, type ComponentType, type CSSProperties } from "react";
import { HISTORY_T } from "../clock.ts";
import type { SceneDef, SceneProps } from "../types.ts";
import type { ScreenNight, ScreenResultQuestion } from "../../screen.ts";
import { useHeldResults } from "../kit/results-parts.tsx";
import { VERDICT_MS, VERDICT_PLAN, VERDICT_WALL_MS, liarsLine, liarsSize, roundChip, truthStamp, verdictHasPages, verdictPageAt, verdictStamp, verdictTotals, verdictTotalsLine } from "../kit/results.ts";
import { useEndAt } from "../kit/tv1-parts.tsx";
import {
  BigNumber,
  Confetti,
  Desktop,
  Glitch,
  Hourglass,
  Marquee,
  Noise,
  Particles,
  PopupStorm,
  ProgressBar,
  Stage,
  Starfield,
  Typewriter,
  Win98Dialog,
  Win98Icon,
  Win98Window,
  between,
  blink,
  clamp01,
  countdownParts,
  ease,
  eased,
  fakeProgress,
  keyframes,
  lerp,
  loop,
  noise1,
  progress,
  pulse,
  useSfxCues,
  type Emitter,
  type IconKind,
  type StormMessage,
} from "../kit/index.ts";
import { AwardEmblem, BinaryRain, ChatWindow, Curtains, DiscoBall, EqBars, FloatLayer, Heart, Lasers, Motorcycle, Notepad, RainCanvas, SpotCones, Sunburst, Trophy } from "../kit/tv3-parts.tsx";
import { ASSESSMENT_MS, AWARDS, AWARD_CONFETTI, HAND_JIVE, TRUTH_TXT, awardConfettiAt, awardOf, awardValue, bathTime, bobStateOf, brokenYear, chatAt, handJivePhase, karaokeAt, notepadAt, sinceMoment, spinAngle, tallyOf, vortexAt, wrapLines, type BobState, type ChatLine } from "../kit/tv3-time.ts";
import { LanguageScene, whoSize } from "./language.tsx";

// --- small shared helpers ---------------------------------------------------------------------

/** In over `[a, a + din]`, out over `[b, b + dout]` (0..1). */
function fade(t: number, a: number, din: number, b = Number.POSITIVE_INFINITY, dout = 600): number {
  return progress(t, a, din) * (1 - progress(t, b, dout));
}

/** A title that slams in (overshoot) at `at`; under reduced motion it fades. */
function slam(t: number, at: number, reduced: boolean, dur = 420): CSSProperties {
  const k = progress(t, at, dur);
  if (reduced) return { opacity: k };
  const s = lerp(2.4, 1, ease.outBack(k));
  return { opacity: clamp01(k * 3), transform: `scale(${s.toFixed(3)})` };
}

/** A small shake at `at` (a stamp landing), px. */
function shake(t: number, at: number, reduced: boolean, dur = 450, amp = 14): string {
  if (reduced || t < at || t > at + dur) return "none";
  const k = 1 - (t - at) / dur;
  return `translate3d(${(Math.sin(t * 0.09) * amp * k).toFixed(1)}px, ${(Math.cos(t * 0.13) * amp * 0.6 * k).toFixed(1)}px, 0)`;
}

/** Sparks bursting from a point at `at` (0..1 space). */
function burst(x: number, y: number, at: number, colors: readonly string[], seed: number, n = 1): Emitter[] {
  return [
    { x, y, start: at, end: at + 160, rate: 700 * n, life: 1400, speed: 0.8, speedJitter: 0.6, angle: -90, spread: 360, gravity: 0.55, drag: 0.6, size: 7, colors, shape: "spark", seed },
    { x, y, start: at, end: at + 100, rate: 320 * n, life: 1900, speed: 0.5, angle: -90, spread: 360, gravity: 0.3, drag: 0.4, size: 12, colors, shape: "star", seed: seed + 1 },
  ];
}

const GOLD = ["#ffd23f", "#fff2b0", "#ff9f1c", "#ffffff"] as const;
const PINK = ["#ff4f9a", "#ffb3d1", "#ffffff", "#ff7ac0"] as const;

// --- F1 · midnight (overshare.loom, Clock Strikes) ----------------------------------------------
//
//   0–600     black, the clock fades in at 11:59:57 PM
//   600–3600  three seconds tick down (tick ×3), sparks gather at the edges
//   3600      12:00 AM lands: a boom, a burst of fireworks, a chime
//   4200–9000 the date types — January 1, 19 — and the year won't settle:
//             it tears, static creeps in, "date out of range" boxes pile up
//   9000–12500 "the year will not render." types under it; the fireworks fall grey
//   12500–14000 out to black

const MIDNIGHT = { tick: 600, strike: 3600, date: 4200, storm: 5600, render: 9000, out: 12500, end: 14000 } as const;

const DATE_MESSAGES: readonly StormMessage[] = [
  { title: "Date/Time Properties", text: "The year could not be displayed.", kind: "error" },
  { title: "System Clock", text: "Date out of range: 19▒▒.", kind: "warning" },
  { title: "Error", text: "Invalid century. Please enter a century.", kind: "error", actions: ["OK", "Cancel"] },
  { title: "Calendar", text: "January 1 has no year.", kind: "info" },
  { title: "Y2K", text: "The year will not render.", kind: "error" },
];

function midnightClock(t: number): string {
  if (t < MIDNIGHT.strike) {
    const s = 57 + Math.min(2, Math.floor((t - MIDNIGHT.tick) / 1000));
    return `11:59:${t < MIDNIGHT.tick ? 57 : s} PM`;
  }
  return "12:00 AM";
}

function Midnight({ t, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [MIDNIGHT.tick + 400, "tick"],
    [MIDNIGHT.tick + 1400, "tick"],
    [MIDNIGHT.tick + 2400, "tick", { pitch: 1.2 }],
    [MIDNIGHT.strike, "boom"],
    [MIDNIGHT.strike + 250, "chime"],
    [MIDNIGHT.date + 1300, "glitch"],
    [MIDNIGHT.render, "critical", { gain: 0.7 }],
  ]);
  const struck = t >= MIDNIGHT.strike;
  const broken = t >= MIDNIGHT.date + 1300;
  const year = broken ? brokenYear(t) : "19";
  const tear = clamp01(progress(t, MIDNIGHT.date + 1300, 3500)) * (1 - progress(t, MIDNIGHT.out, 800));
  const grey = progress(t, MIDNIGHT.render, 1500);
  const fireworks: Emitter[] = [
    ...burst(0.25, 0.32, MIDNIGHT.strike, GOLD, 31),
    ...burst(0.75, 0.28, MIDNIGHT.strike + 220, ["#3fa7ff", "#c86bff", "#ffffff"], 33),
    ...burst(0.5, 0.18, MIDNIGHT.strike + 480, ["#ff5050", "#ffd23f", "#ffffff"], 35),
  ];
  // The year's fireworks fall as dead grey pixels once it fails to render.
  const ash: Emitter[] = [{ x: 0.5, y: -0.05, w: 1, start: MIDNIGHT.render, end: MIDNIGHT.out, rate: 26, life: 4200, speed: 0.08, angle: 90, spread: 20, gravity: 0.12, size: 5, colors: ["#5a5a5a", "#8a8a8a", "#3a3a3a"], shape: "pixel", seed: 39 }];
  return (
    <Stage bg="#000" className="tv3-midnight">
      <div className="kit-fill" style={{ opacity: fade(t, 0, 600, MIDNIGHT.out, MIDNIGHT.end - MIDNIGHT.out) }}>
        {!lite && !reduced && <Particles t={t} emitters={fireworks} blend="add" />}
        {!lite && <Particles t={t} emitters={ash} />}
        <div className="tv3-mid-center" style={{ transform: shake(t, MIDNIGHT.strike, reduced, 500, 18) }}>
          <div className="tv3-mid-clock" style={struck ? slam(t, MIDNIGHT.strike, reduced, 380) : undefined}>
            {midnightClock(t)}
          </div>
          {t >= MIDNIGHT.date && (
            <Glitch t={t} intensity={reduced ? 0 : tear * 0.8} seed={2000} reduced={reduced} className="tv3-mid-date">
              <span style={{ filter: `grayscale(${grey.toFixed(2)})` }}>
                <Typewriter text="January 1, " t={t} start={MIDNIGHT.date} cps={18} caret={false} reserve={false} />
                {t >= MIDNIGHT.date + 700 && <span className={broken ? "tv3-mid-year broken" : "tv3-mid-year"}>{year}</span>}
              </span>
            </Glitch>
          )}
          {t >= MIDNIGHT.render && (
            <div className="tv3-mid-render">
              <Typewriter text="— the year will not render." t={t} start={MIDNIGHT.render} cps={20} />
            </div>
          )}
        </div>
        {!lite && t >= MIDNIGHT.storm && t < MIDNIGHT.out + 800 && <PopupStorm t={t} seed={1999} count={6} start={MIDNIGHT.storm} span={2600} messages={DATE_MESSAGES} sfx={sfx} sound="error" width="26%" reduced={reduced} className="tv3-mid-storm" style={{ opacity: 1 - progress(t, MIDNIGHT.render - 400, 900) }} />}
        {!lite && tear > 0 && <Noise t={t} alpha={0.06 + tear * 0.22} reduced={reduced} />}
      </div>
    </Stage>
  );
}

// --- F1b · the final reveal (Final Reveal; the slide is a dark card) ----------------------------
//
//   0–1200    the picture collapses to a line, then a dot (lights go dark)
//   1200–3000 one cursor blinking on black
//   3000→     hold: dim binary rain, a 0 | 1 that beats like a heart, Clippy's
//             asks typed in turn under it (every 16 s); a rare tear
// Low light all the way: the room is dark.

const REVEAL_ASKS = ["Anyone who has found the final facts, speak up now.", "Tell us what you have learned.", "What you believe but cannot prove.", "Present it now, with confidence."] as const;

function FinalReveal({ t, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [150, "shutdown", { gain: 0.5 }],
    [3200, "heartbeat", { gain: 0.45 }],
    [7200, "heartbeat", { gain: 0.35 }],
  ]);
  const squash = reduced ? 1 : 1 - eased(t, 0, 600, ease.inCubic);
  const thin = reduced ? 1 : 1 - eased(t, 600, 500, ease.inCubic);
  const hold = t >= 3000;
  const ask = Math.floor(Math.max(0, t - 3400) / 16_000) % REVEAL_ASKS.length;
  const askStart = 3400 + Math.floor(Math.max(0, t - 3400) / 16_000) * 16_000;
  const beat = 1 + 0.08 * (1 - ease.outCubic(loop(t, 1300))) * (reduced ? 0 : 1);
  const bit = Math.floor(t / 1300) % 2 === 0;
  return (
    <Stage bg="#000" className="tv3-reveal">
      {t < 1300 && (
        <div className="tv3-crt" style={{ transform: `scale(${Math.max(0.004, thin).toFixed(3)}, ${Math.max(0.006, squash).toFixed(3)})`, opacity: 1 - progress(t, 1000, 300) }} />
      )}
      {between(t, 1200, 3200) && <div className="tv3-reveal-cursor" style={{ opacity: blink(t, 1000) ? 0.85 : 0 }} />}
      {hold && (
        <div className="kit-fill" style={{ opacity: progress(t, 3000, 1800) }}>
          {!lite && <BinaryRain t={t} cols={34} alpha={0.22} speed={0.07} rgb="40, 160, 90" reduced={reduced} />}
          <div className="tv3-reveal-label">THE FINAL REVEAL</div>
          <Glitch t={t} intensity={reduced ? 0 : 0.05} seed={8} reduced={reduced} className="tv3-reveal-bits">
            <span style={{ transform: `scale(${beat.toFixed(3)})`, display: "inline-block" }}>
              <span className={bit ? "on" : ""}>1</span>
              <span className="tv3-reveal-bar">|</span>
              <span className={bit ? "" : "on"}>0</span>
            </span>
          </Glitch>
          <div className="tv3-reveal-ask" key={ask}>
            <Typewriter text={REVEAL_ASKS[ask]!} t={t} start={askStart} cps={24} />
          </div>
        </div>
      )}
    </Stage>
  );
}

// --- F2 · bobbing for truth (Bobbing For Truth) ---------------------------------------------------
//
//   0–1500    the water rises, the title drops in and splashes
//   1500→     hold: two waves roll, five apples bob, the Bag of Truth sways on
//             the bottom, bubbles rise, a "Searching for the Bag of Truth…"
//             box with its hourglass, and a wait clock counting up — nothing
//             happens until someone brings up the bag
//   bag up    (the beat The Bag Of Truth, off the moments ring: the slide
//             stays up until 📄) the bag floats on the surface under a slow
//             sunburst, a padlock on it: THE BAG IS UP · Do not read it yet.,
//             an "Assessment" box weighing every program
//   assessed  (Final Assessment) the box fills over the assessment's lines,
//             then ASSESSMENT FINAL, the padlock springs open: You may read
//             truth.txt.

function Apple({ x, y, r, rot }: { x: number; y: number; r: number; rot: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot.toFixed(1)})`}>
      <circle r={r} fill="#d62020" stroke="#600" strokeWidth="0.8" />
      <ellipse cx={-r * 0.35} cy={-r * 0.35} rx={r * 0.25} ry={r * 0.15} fill="#fff" opacity="0.5" />
      <path d={`M0 ${-r} q1 ${-r * 0.5} 3 ${-r * 0.6}`} stroke="#5a3a00" strokeWidth="1.2" fill="none" />
      <path d={`M1 ${-r * 1.15} q4 -3 7 0 q-4 2 -7 0`} fill="#3c9a2a" />
    </g>
  );
}

function wavePath(t: number, y: number, amp: number, len: number, speed: number, w = 200, h = 100): string {
  let d = `M0 ${h} L0 ${y}`;
  for (let x = 0; x <= w; x += 5) d += ` L${x} ${(y + Math.sin((x / len) * Math.PI * 2 + (t / 1000) * speed) * amp).toFixed(2)}`;
  return `${d} L${w} ${h} Z`;
}

function BobTank({ t, rise, reduced, apples = 5, bag = true, lift = 0 }: { t: number; rise: number; reduced: boolean; apples?: number; bag?: boolean; lift?: number }) {
  const tt = reduced ? 0 : t;
  const surface = lerp(100, 36, rise);
  // `lift` 0..1 brings the bag from the bottom to float on the surface.
  const bagY = lerp(86, surface - 3 + Math.sin(tt / 640) * 1.6 * lift, lift);
  return (
    <svg className="tv3-tank" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="tv3-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3aa0ff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#06286a" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <path d={wavePath(tt, surface + 2, 1.6, 70, -1.3)} fill="#1c5fbf" opacity="0.6" />
      <path d={wavePath(tt, surface, 2.2, 48, 2.1)} fill="url(#tv3-water)" />
      {/* the Bag of Truth, on the bottom */}
      <g transform={`translate(${(100 + Math.sin(tt / 1700) * 3).toFixed(2)} ${bagY.toFixed(2)}) rotate(${(Math.sin(tt / 1300) * (4 + 6 * lift)).toFixed(1)})`} opacity={bag ? rise : 0}>
        <path d="M-10 8 L-12 -8 Q0 -12 12 -8 L10 8 Z" fill="#c8a26a" stroke="#5a3d00" strokeWidth="0.8" />
        <path d="M-12 -8 Q-4 -4 0 -9 Q4 -4 12 -8" fill="none" stroke="#5a3d00" strokeWidth="0.8" />
        <text x="0" y="3" textAnchor="middle" fontSize="4.6" fontFamily="Tahoma, sans-serif" fontWeight="bold" fill="#3a2400">
          TRUTH
        </text>
      </g>
      {Array.from({ length: apples }, (_, i) => {
        const x = 26 + i * (150 / Math.max(1, apples - 1));
        // A floating bag has the middle of the surface to itself.
        if (lift > 0 && Math.abs(x - 100) < 20) return null;
        const bob = Math.sin(tt / 700 + i * 1.7) * 2.2;
        return <Apple key={i} x={x + Math.sin(tt / 2100 + i) * 3} y={surface - 1 + bob} r={5.5} rot={Math.sin(tt / 900 + i) * 12} />;
      })}
    </svg>
  );
}

function Bobbing({ t, at, state, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  // Has the bag come up (and the assessment begun) since this slide went up?
  const seen = useRef<{ at: number; bob: BobState } | null>(null);
  const bob = bobStateOf(state.moments, at, seen.current !== null && seen.current.at === at ? seen.current.bob : null);
  seen.current = { at, bob };
  const upT = sinceMoment(bob.up, at, t, HISTORY_T);
  const judgeT = sinceMoment(bob.assessed, at, t, HISTORY_T);
  const final = judgeT !== null && judgeT >= ASSESSMENT_MS;
  useSfxCues(t, sfx, [
    [100, "whoosh"],
    [950, "blip", { pitch: 0.6 }],
    [1100, "blip", { pitch: 0.8 }],
    [1800, "popup", { gain: 0.6 }],
  ]);
  // The bag's own clock: its moment covers the first 8 s, so the hold says hello as it comes back.
  useSfxCues(upT ?? -1, sfx, [
    [200, "sparkle", { gain: 0.6 }],
    [8100, "chime", { gain: 0.5 }],
  ]);
  useSfxCues(judgeT ?? -1, sfx, [
    [300, "popup", { gain: 0.5 }],
    [ASSESSMENT_MS - 1600, "drumroll", { gain: 0.4 }],
    [ASSESSMENT_MS, "ding", { gain: 0.7 }],
    [ASSESSMENT_MS + 250, "sparkle", { gain: 0.5 }],
  ]);
  const rise = eased(t, 0, 1400, ease.outCubic);
  const drop = reduced ? fade(t, 600, 400) : 1;
  const ty = reduced ? 0 : lerp(-120, 0, ease.outBounce(progress(t, 500, 900)));
  const splash: Emitter[] = [{ x: 0.5, y: 0.62, w: 0.4, start: 950, end: 1150, rate: 500, life: 1200, speed: 0.7, angle: -90, spread: 70, gravity: 1.4, drag: 0.2, size: 7, colors: ["#bfe3ff", "#ffffff", "#7ec4ff"], shape: "dot", seed: 51 }];
  const wait = countdownParts(Math.max(0, t - 1500)).text;
  if (upT !== null) return <BagIsUp t={t} upT={upT} judgeT={judgeT} final={final} reduced={reduced} lite={lite} night={state.night} />;
  return (
    <Stage bg="linear-gradient(180deg, #0b1238 0%, #22104a 60%, #0b1238 100%)" className="tv3-bob-stage">
      <BobTank t={t} rise={rise} reduced={reduced} apples={lite ? 4 : 5} />
      {!lite && (
        <FloatLayer
          t={t}
          start={1500}
          every={380}
          life={4200}
          seed={57}
          x={[0.05, 0.95]}
          rise={0.55}
          size="2.4vmin"
          reduced={reduced}
          glyph={() => <span className="tv3-bubble-dot" />}
        />
      )}
      {!lite && !reduced && <Particles t={t} emitters={splash} />}
      <div className="tv3-bob-title" style={{ opacity: drop, transform: `translateY(${ty.toFixed(1)}%)` }}>
        <span>🍎</span> BOBBING FOR TRUTH
      </div>
      <div className="tv3-bob-caption" style={{ opacity: fade(t, 1800, 600) * (0.7 + 0.3 * pulse(t, 2600)) }}>
        Nothing happens until someone brings up the Bag Of Truth.
      </div>
      {!lite && t >= 1800 && (
        <Win98Window title="Search" icon="folder" x={3} y={70} width="24em" open={eased(t, 1800, 260, ease.linear)} reduced={reduced} className="tv3-bob-search" status={`Waiting: ${wait}`}>
          <div className="tv3-row">
            <Hourglass t={t} size="2.6em" />
            <div className="tv3-col">
              <b>Searching for the Bag of Truth…</b>
              <div className="tv3-small">Look in: The Desktop (wet)</div>
              <ProgressBar value={loop(t, 5200)} segments={16} />
            </div>
          </div>
        </Win98Window>
      )}
    </Stage>
  );
}

/** "Most trusted: X · Least trusted: Y" off the night (wave 18b: the bobbing slide's call-outs), or null. */
export function trustCallout(night: Pick<ScreenNight, "most_trusted" | "least_trusted">): string | null {
  const parts: string[] = [];
  if (night.most_trusted !== null) parts.push(`Most trusted: ${night.most_trusted}`);
  if (night.least_trusted !== null) parts.push(`Least trusted: ${night.least_trusted}`);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** The bob's hold once the bag is up: it floats, locked, while the assessment runs; then the lock
 *  opens, naming his most and least trusted (wave 18b; the night carries them while the slide is up). */
function BagIsUp({ t, upT, judgeT, final, reduced, lite, night }: { t: number; upT: number; judgeT: number | null; final: boolean; reduced: boolean; lite: boolean; night: ScreenNight }) {
  const trust = final ? trustCallout(night) : null;
  const lift = reduced ? 1 : eased(upT, 0, 1400, ease.outBack);
  const finalT = judgeT === null ? -1 : judgeT - ASSESSMENT_MS;
  const unlock = final ? (reduced ? 1 : eased(finalT, 0, 700, ease.outBack)) : 0;
  const lockSwing = reduced || !final ? 0 : Math.sin(Math.max(0, finalT) / 160) * 18 * (1 - progress(finalT, 0, 1600));
  const glint = pulse(t, 2400);
  const ripples: Emitter[] = [{ x: 0.5, y: 0.6, w: 0.18, start: 0, end: 10_000_000, rate: 3, life: 2600, speed: 0.05, angle: -90, spread: 160, gravity: -0.02, size: 9, colors: ["#bfe3ff", "#ffffff"], shape: "dot", seed: 59, fade: 0.8 }];
  const gold: Emitter[] = [{ x: 0.5, y: 0.52, w: 0.2, start: t - finalT, end: t - finalT + 220, rate: 520, life: 1600, speed: 0.6, speedJitter: 0.5, angle: -90, spread: 300, gravity: 0.4, drag: 0.5, size: 9, colors: GOLD, shape: "star", seed: 67 }];
  const bar = judgeT === null ? loop(t, 4800) * 0.35 : clamp01(judgeT / ASSESSMENT_MS);
  return (
    <Stage bg="linear-gradient(180deg, #0b1238 0%, #2a1460 60%, #0b1238 100%)" className="tv3-bob-stage tv3-bob-up">
      <Sunburst t={t} rays={16} speed={6} reduced={reduced} color={final ? "rgba(255, 214, 64, 0.22)" : "rgba(255, 214, 64, 0.1)"} className="tv3-bag-burst" style={{ opacity: progress(upT, 0, 1600) }} />
      <BobTank t={t} rise={1} reduced={reduced} apples={lite ? 3 : 5} lift={lift} />
      {!lite && !reduced && <Particles t={t} emitters={ripples} />}
      {!lite && !reduced && final && <Particles t={t} emitters={gold} blend="add" />}
      <div className="tv3-bob-lock" style={{ opacity: progress(upT, 600, 500) * (0.75 + 0.25 * glint), transform: `translate(-50%, 0) rotate(${lockSwing.toFixed(1)}deg)` }} aria-hidden="true">
        <svg viewBox="-10 -14 20 26" width="100%" height="100%">
          <path d={`M-5 -2 V-7 A5 5 0 0 1 5 -7 V${(-2 - 7 * unlock).toFixed(2)}`} fill="none" stroke="#e8e8e8" strokeWidth="2.4" strokeLinecap="round" />
          <rect x="-7.5" y="-2" width="15" height="12" rx="1.6" fill={final ? "#ffd23f" : "#c0c0c0"} stroke="#3a2400" strokeWidth="0.8" />
          <circle cx="0" cy="3" r="1.6" fill="#3a2400" />
          <rect x="-0.6" y="3.6" width="1.2" height="3.4" fill="#3a2400" />
        </svg>
      </div>
      <div className="tv3-bob-title" style={slam(t, t - upT, reduced)}>
        {final ? "ASSESSMENT FINAL" : "THE BAG IS UP"}
      </div>
      <div className="tv3-bob-caption tv3-bob-hold" style={{ opacity: final ? progress(finalT, 300, 600) : 0.75 + 0.25 * pulse(t, 2000) }}>
        {final ? "You may read truth.txt." : "Do not read it yet."}
      </div>
      {trust !== null && (
        <div className={`tv3-bob-trust${lite ? " lite" : ""}`} style={{ opacity: progress(finalT, 900, 600), transform: reduced ? undefined : `translate3d(0, ${((1 - eased(finalT, 900, 600, ease.outCubic)) * 0.6).toFixed(2)}em, 0)` }}>
          {trust}
        </div>
      )}
      {!lite && (
        <Win98Window title={final ? "Assessment - Complete" : "Assessment"} icon={final ? "document" : "info"} x={3} y={70} width="24em" open={reduced ? 1 : eased(upT, 900, 260, ease.linear)} reduced={reduced} className="tv3-bob-search" status={judgeT === null ? "Waiting for the assessment…" : final ? "Assessment is final." : "Weighing…"}>
          <div className="tv3-row">
            {final ? <Win98Icon kind="document" size="2.6em" /> : <Hourglass t={t} size="2.6em" />}
            <div className="tv3-col">
              <b>{final ? "Every program has been weighed." : judgeT === null ? "The bag is sealed." : "Weighing every program…"}</b>
              <div className="tv3-small">{final ? "Open: truth.txt" : "Contents: truth.txt (sealed)"}</div>
              <ProgressBar value={final ? 1 : bar} segments={16} percent={judgeT !== null} />
            </div>
          </div>
        </Win98Window>
      )}
    </Stage>
  );
}

// --- F2b · the Bag of Truth surfaces (The Bag Of Truth) ------------------------------------------
//
//   0–700     the water churns
//   700–1800  the bag shoots up out of the tank, spray everywhere
//   1800      THE BAG OF TRUTH over a turning sunburst (sparkle)
//   3400      "Do not read it yet." types
//   7300–8000 out

function BagOfTruth({ t, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [200, "whoosh", { pitch: 0.7 }],
    [800, "blip", { pitch: 0.5 }],
    [1800, "sparkle"],
    [3400, "type", { gain: 0.5 }],
  ]);
  const up = reduced ? fade(t, 700, 600) : ease.outBack(progress(t, 700, 1000));
  const y = lerp(70, 40, up);
  const spray: Emitter[] = [{ x: 0.5, y: 0.66, w: 0.12, start: 750, end: 1100, rate: 600, life: 1500, speed: 0.9, angle: -90, spread: 60, gravity: 1.3, drag: 0.15, size: 8, colors: ["#bfe3ff", "#ffffff"], shape: "dot", seed: 61 }];
  return (
    <Stage bg="linear-gradient(180deg, #0b1238 0%, #22104a 100%)">
      <div className="kit-fill" style={{ opacity: fade(t, 0, 300, 7300, 700) }}>
        {t >= 1800 && <Sunburst t={t} rays={18} reduced={reduced} className="tv3-bag-burst" style={{ opacity: progress(t, 1800, 600) }} />}
        <BobTank t={t + 4000} rise={1} reduced={reduced} apples={lite ? 3 : 5} bag={false} />
        {!reduced && <Particles t={t} emitters={spray} />}
        <div className="tv3-bag" style={{ top: `${y.toFixed(1)}%`, transform: `translate(-50%, -50%) rotate(${(reduced ? 0 : Math.sin(t / 380) * 6).toFixed(1)}deg)` }}>
          <svg viewBox="-16 -16 32 32" width="100%" height="100%" aria-hidden="true">
            <path d="M-12 12 L-14 -9 Q0 -14 14 -9 L12 12 Z" fill="#c8a26a" stroke="#5a3d00" strokeWidth="1" />
            <path d="M-14 -9 Q-5 -4 0 -10 Q5 -4 14 -9" fill="none" stroke="#5a3d00" strokeWidth="1" />
            <text x="0" y="5" textAnchor="middle" fontSize="6" fontFamily="Tahoma, sans-serif" fontWeight="bold" fill="#3a2400">
              TRUTH
            </text>
          </svg>
        </div>
        {t >= 1800 && (
          <div className="tv3-bag-title" style={slam(t, 1800, reduced)}>
            THE BAG OF TRUTH
          </div>
        )}
        {t >= 3400 && (
          <div className="tv3-bag-line">
            <Typewriter text="Do not read it yet." t={t} start={3400} cps={16} />
          </div>
        )}
      </div>
    </Stage>
  );
}

// --- F3 · truth.txt (Truth Txt — the whole file is narration the TV can't voice) ----------------
//
//   0–1800    the desktop: the pointer crosses to truth.txt, a double-click,
//             Notepad zooms open
//   1800→     the file types at reading pace (18 cps), the view following the
//             caret, Ln / Col ticking; a scanline rolls down every 8 s
//   typed     hold: Notepad reads the file again from the top, forever

const TV_COLS = 62;
const WALL_COLS = 40;

function TruthTxt({ t, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  const start = lite ? 600 : 1800;
  useSfxCues(t, sfx, lite ? [[200, "popup", { gain: 0.6 }]] : [
    [1000, "click", { gain: 0.6 }],
    [1150, "click", { gain: 0.6 }],
    [1350, "popup", { gain: 0.7 }],
    [2000, "type", { gain: 0.35 }],
    [2600, "type", { gain: 0.35 }],
  ]);
  const lines = wrapLines(TRUTH_TXT, lite ? WALL_COLS : TV_COLS);
  // A portrait tablet has the height for more of the file.
  const tall = typeof window !== "undefined" && window.innerHeight > window.innerWidth * 1.2;
  const rows = lite ? (tall ? 24 : 14) : 16;
  const view = notepadAt(lines, t, { rows, start, cps: 18 });
  const caretOn = !view.done ? true : blink(t, 1060);
  const caretRow = view.line >= view.top && view.line < view.top + rows ? view.line - view.top : null;
  const open = lite ? eased(t, 0, 400, ease.linear) : eased(t, 1300, 450, ease.linear);
  const pointer = keyframes(t, [
    { t: 0, x: 70, y: 80 },
    { t: 950, x: 9, y: 17 },
  ]);
  const scan = loop(t, 8000);
  return (
    <Stage bg="#008080" className="tv3-truth">
      {!lite && (
        <Desktop icons={[{ label: "My Computer", kind: "computer" }, { label: "truth.txt", kind: "document" }, { label: "Recycle Bin", kind: "trash" }]} tasks={t >= 1300 ? ["truth.txt - Notepad"] : []} clock="12:00 AM">
          {t < 1300 && (
            <>
              <div className="tv3-icon-hi" style={{ opacity: t >= 950 ? 1 : 0 }} />
              <svg className="tv3-pointer" viewBox="0 0 12 19" style={{ transform: `translate3d(${pointer.x.toFixed(2)}vw, ${pointer.y.toFixed(2)}vh, 0)` }} aria-hidden="true">
                <path d="M0 0 L0 15 L4 11 L7 18 L9 17 L6 10 L11 10 Z" fill="#fff" stroke="#000" strokeWidth="1" />
              </svg>
            </>
          )}
        </Desktop>
      )}
      <Notepad
        title="truth.txt - Notepad"
        rows={view.rows}
        caretRow={caretRow}
        caretOn={caretOn}
        scroll={view.scroll}
        line={view.line}
        col={view.col}
        open={open}
        reduced={reduced}
        center
        x={50}
        y={lite ? 50 : 47}
        width={lite ? "94%" : "min(92%, 41em)"}
        className={lite ? "tv3-np-wall" : "tv3-np-tv"}
      />
      {!reduced && <div className="tv3-scanline" style={{ transform: `translate3d(0, ${(scan * 120 - 10).toFixed(2)}vh, 0)` }} />}
    </Stage>
  );
}

// --- F3b · the verdict (The Verdict) ----------------------------------------------------------------
//
// Wave 18b (Q6, O2, D11): the beat publishes each question's truth (`do
// fact_truth`), and the screen state's `results` block (`kind: "verdict"`)
// carries them; on the TV only, also the key answers and the programs who
// lied (names only).
//
//   0–800     black; the scales swing in
//   800–6400  eight tiles flip, one every 700 ms (a tick each): Q{n}, its round,
//             ✔ TRUE / ✘ LIE / — NOBODY ANSWERED, "f filed · a accepted"
//   7000      x TRUE · y LIES · z UNANSWERED
//   8400      EVERY ANSWERED FACT IS TRUE (sparks) or A LIE IS ON RECORD (static)
//   11000 →   the TV: one page per question, ≈ 2.5 s each — Q{n}, its truth, the
//             key answer, who lied ("Lied: A, B 🤖" — 🤖 where his ruling made the
//             lie; "+N more"; "Nobody lied."); it holds on the last page to its end
//   walls     the tiles, the totals and the stamp only (no answers, no names), then out
// No `results` (an older server): the old picture — the eight bits settle to ■,
// THE VERDICT IS IN, never a result.

const VERDICT_BARE = { check: 800, stamp: 4400, out: 5900, end: 6500 } as const;

function Scales({ t, reduced }: { t: number; reduced: boolean }) {
  const tilt = reduced ? 0 : Math.sin(t / 420) * 14 * (1 - progress(t, 3000, 1400));
  return (
    <svg className="tv3-scales" viewBox="0 0 100 80" aria-hidden="true">
      <rect x="47" y="14" width="6" height="56" fill="#c8a24a" />
      <rect x="30" y="68" width="40" height="7" fill="#8a6200" />
      <g transform={`rotate(${tilt.toFixed(2)} 50 16)`}>
        <rect x="12" y="14" width="76" height="4" fill="#ffd23f" />
        <path d="M16 18 L8 40 H28 Z M84 18 L76 40 H96 Z" fill="none" stroke="#ffd23f" strokeWidth="1.2" />
        <path d="M6 40 Q18 50 30 40 Z M74 40 Q86 50 98 40 Z" fill="#ffd23f" />
      </g>
      <circle cx="50" cy="13" r="4" fill="#ffd23f" />
    </svg>
  );
}

function Verdict(p: SceneProps) {
  const results = useHeldResults(p.state, "verdict");
  const qs = results?.questions ?? [];
  if (!qs.some((q) => q.truth !== null)) return <VerdictBare {...p} />;
  return <VerdictLive {...p} qs={qs} />;
}

/** One question's tile: the back (bits) until it flips, then its truth. */
function VerdictTile({ q, i, t, reduced }: { q: ScreenResultQuestion; i: number; t: number; reduced: boolean }) {
  const at = VERDICT_PLAN.tiles + i * VERDICT_PLAN.tileEvery;
  const k = reduced ? (t >= at ? 1 : 0) : progress(t, at - 200, 400);
  const front = k >= 0.5;
  const sx = Math.abs(Math.cos(k * Math.PI));
  const truth = truthStamp(q.truth);
  const bit = noise1(71, Math.floor(t / 70) + i * 13) < 0.5 ? "0" : "1";
  return (
    <div className={`tv3-vt ${front ? truth.tone : "back"}`} style={{ opacity: t >= VERDICT_PLAN.tiles - 300 + i * 80 ? 1 : 0, transform: reduced ? undefined : `scaleX(${Math.max(0.02, sx).toFixed(3)})` }}>
      <div className="tv3-vt-head">
        <b>Q{q.n}</b>
        {roundChip(q.round) !== "" && <span className="tv3-vt-chip">{roundChip(q.round)}</span>}
      </div>
      {front ? (
        <>
          <div className="tv3-vt-truth">{truth.text}</div>
          <div className="tv3-vt-count">
            {q.filed} filed · {q.accepted} accepted
          </div>
        </>
      ) : (
        <div className="tv3-vt-bit">{bit}</div>
      )}
    </div>
  );
}

function VerdictLive({ t, sfx, reduced, target, done, qs }: SceneProps & { qs: readonly ScreenResultQuestion[] }) {
  const lite = target === "wall";
  // O2: the pages ride the TV's block only (a wall's carries no answers or names, and never draws them).
  const pages = !lite && verdictHasPages(qs) ? qs : [];
  useEndAt(t, pages.length > 0 ? VERDICT_MS : VERDICT_WALL_MS, done);
  const totals = verdictTotals(qs);
  const stamp = verdictStamp(totals);
  useSfxCues(t, sfx, [
    [200, "whoosh", { over: true }],
    [VERDICT_PLAN.tiles - 300, "drumroll", { gain: 0.6, over: true }],
    ...qs.map((_, i) => [VERDICT_PLAN.tiles + i * VERDICT_PLAN.tileEvery, "tick", { gain: 0.4, over: true }] as const),
    [VERDICT_PLAN.stamp, stamp.win ? "tada" : "boom", { over: true }],
    ...pages.map((_, i) => [VERDICT_PLAN.pages + i * VERDICT_PLAN.pageMs, "popup", { gain: 0.35, over: true }] as const),
  ]);
  const page = verdictPageAt(t, pages.length);
  const paging = page >= 0;
  const out = pages.length > 0 ? 1 : 1 - progress(t, VERDICT_WALL_MS - 700, 700);
  const tilesUp = paging ? 1 - progress(t, VERDICT_PLAN.pages, 500) : 1;
  return (
    <Stage bg="radial-gradient(ellipse at 50% 40%, #1a1440 0%, #04030c 75%)" fit={!lite} className={lite ? "tv3-vw" : "tv3-vtv"}>
      <div className="kit-fill" style={{ opacity: out, transform: shake(t, VERDICT_PLAN.stamp, reduced) }}>
        <div className="tv3-v-scales" style={{ opacity: progress(t, 0, 600) * tilesUp, transform: reduced ? undefined : `translateY(${lerp(-40, 0, eased(t, 0, 700, ease.outBack)).toFixed(1)}%)` }}>
          <Scales t={t} reduced={reduced} />
        </div>
        <div className="tv3-v-tiles" style={{ opacity: tilesUp }}>
          {qs.map((q, i) => (
            <VerdictTile key={q.id} q={q} i={i} t={t} reduced={reduced} />
          ))}
        </div>
        {t >= VERDICT_PLAN.totals && (
          <div className="tv3-v-totals" style={{ opacity: progress(t, VERDICT_PLAN.totals, 400) * tilesUp }}>
            {verdictTotalsLine(totals)}
          </div>
        )}
        {t >= VERDICT_PLAN.stamp && (
          <div className={`tv3-v-stamp ${stamp.win ? "win" : "lose"}`} style={{ ...slam(t, VERDICT_PLAN.stamp, reduced, 320), ...(paging ? { opacity: 1 - progress(t, VERDICT_PLAN.pages, 500) } : {}) }}>
            {stamp.text}
          </div>
        )}
        {paging && <VerdictPage q={pages[page]!} index={page} count={pages.length} t={t} reduced={reduced} />}
        {!lite && !reduced && stamp.win && <Particles t={t} emitters={burst(0.5, 0.72, VERDICT_PLAN.stamp, GOLD, 77)} blend="add" />}
        {!stamp.win && t >= VERDICT_PLAN.stamp && <Noise t={t} alpha={0.08 * (1 - progress(t, VERDICT_PLAN.stamp + 1500, 1500))} reduced={reduced} />}
      </div>
    </Stage>
  );
}

/** The TV's page for one question (O2): its truth, the key answer, who lied. Names only (D11). */
function VerdictPage({ q, index, count, t, reduced }: { q: ScreenResultQuestion; index: number; count: number; t: number; reduced: boolean }) {
  const at = VERDICT_PLAN.pages + index * VERDICT_PLAN.pageMs;
  const k = reduced ? progress(t, at, 200) : eased(t, at, 420, ease.outBack);
  const truth = truthStamp(q.truth);
  return (
    <div className="tv3-vp" style={{ opacity: clamp01(k * 2), transform: reduced ? undefined : `translate3d(${((1 - k) * 6).toFixed(2)}em, 0, 0)` }}>
      <div className="tv3-vp-head">
        <b>Q{q.n}</b>
        {roundChip(q.round) !== "" && <span className="tv3-vt-chip">{roundChip(q.round)}</span>}
        <span className={`tv3-vp-truth ${truth.tone}`}>{truth.text}</span>
        <span className="tv3-vp-of">
          {index + 1} / {count}
        </span>
      </div>
      {q.answer !== null && (
        <div className="tv3-vp-answer">
          <span>The answer:</span> {q.answer}
        </div>
      )}
      <div className={`tv3-vp-liars${(q.liars ?? []).length > 0 ? " some" : ""}${liarsSize(q)}`}>{liarsLine(q)}</div>
    </div>
  );
}

function VerdictBare({ t, sfx, reduced, target, done }: SceneProps) {
  const lite = target === "wall";
  useEndAt(t, VERDICT_BARE.end, done);
  useSfxCues(t, sfx, [
    [200, "whoosh"],
    [VERDICT_BARE.check, "drumroll", { gain: 0.7 }],
    ...Array.from({ length: 8 }, (_, i) => [VERDICT_BARE.check + 600 + i * 300, "tick", { gain: 0.4 }] as const),
    [VERDICT_BARE.stamp, "boom"],
  ]);
  const bar = fakeProgress(t - VERDICT_BARE.check, VERDICT_BARE.stamp - VERDICT_BARE.check - 300, 47, 2);
  return (
    <Stage bg="radial-gradient(ellipse at 50% 40%, #1a1440 0%, #04030c 75%)">
      <div className="kit-fill tv3-verdict" style={{ opacity: fade(t, 0, 300, VERDICT_BARE.out, VERDICT_BARE.end - VERDICT_BARE.out), transform: shake(t, VERDICT_BARE.stamp, reduced) }}>
        <div className="tv3-verdict-scales" style={{ opacity: progress(t, 0, 600), transform: reduced ? undefined : `translateY(${lerp(-40, 0, eased(t, 0, 700, ease.outBack)).toFixed(1)}%)` }}>
          <Scales t={t} reduced={reduced} />
        </div>
        <div className="tv3-verdict-qs">
          {Array.from({ length: 8 }, (_, i) => {
            const settle = VERDICT_BARE.check + 600 + i * 300;
            const shown = t >= VERDICT_BARE.check + i * 80;
            const settled = t >= settle;
            const bit = noise1(71, Math.floor(t / 70) + i * 13) < 0.5 ? "0" : "1";
            return (
              <div key={i} className={`tv3-q${settled ? " settled" : ""}`} style={{ opacity: shown ? 1 : 0 }}>
                <span className="tv3-q-label">Q{i + 1}</span>
                <span className="tv3-q-bit">{settled ? "■" : bit}</span>
              </div>
            );
          })}
        </div>
        {!lite && (
          <div className="tv3-verdict-bar" style={{ opacity: fade(t, VERDICT_BARE.check, 300, VERDICT_BARE.stamp, 400) }}>
            <ProgressBar value={bar} label="Compiling the verdict…" percent />
          </div>
        )}
        {t >= VERDICT_BARE.stamp && (
          <div className="tv3-verdict-stamp" style={slam(t, VERDICT_BARE.stamp, reduced, 320)}>
            THE VERDICT IS IN
          </div>
        )}
        {!lite && !reduced && <Particles t={t} emitters={burst(0.5, 0.72, VERDICT_BARE.stamp, GOLD, 77)} blend="add" />}
      </div>
    </Stage>
  );
}

// --- F5 · the pickup line (Pickup Line) -----------------------------------------------------------
//
//   0–1500    a card flies in: PICKUP LINE RECEIVED (a ding)
//   1500–4000 the line types in quotes
//   4200      THE HOUSE SAYS YES stamps over it; hearts burst and keep rising
//   7300–8000 out

function PickupLine({ t, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [300, "ding"],
    [4200, "win"],
    [4300, "sparkle"],
  ]);
  const card = reduced ? fade(t, 200, 400) : ease.outBack(progress(t, 200, 600));
  return (
    <Stage bg="radial-gradient(ellipse at 50% 50%, #5a0a3a 0%, #12021a 80%)">
      <div className="kit-fill" style={{ opacity: fade(t, 0, 200, 7300, 700) }}>
        {t >= 4200 && <FloatLayer t={t} start={4200} every={lite ? 260 : 140} life={3800} seed={81} size={lite ? "6vmin" : "5vmin"} reduced={reduced} glyph={(i) => <Heart fill={PINK[i % PINK.length]} />} />}
        {!lite && !reduced && <Particles t={t} emitters={burst(0.5, 0.5, 4200, PINK, 83)} />}
        <div className="tv3-pickup" style={{ opacity: clamp01(card * 2), transform: reduced ? "translate(-50%, -50%)" : `translate(-50%, -50%) scale(${lerp(0.4, 1, card).toFixed(3)}) rotate(${lerp(-12, -2, card).toFixed(2)}deg)` }}>
          <div className="tv3-pickup-head">PICKUP LINE RECEIVED</div>
          <div className="tv3-pickup-line">
            <Typewriter text="“You're the one that I want.”" t={t} start={1500} cps={14} />
          </div>
        </div>
        {t >= 4200 && (
          <div className="tv3-pickup-yes" style={slam(t, 4200, reduced)}>
            THE HOUSE SAYS YES
          </div>
        )}
      </div>
    </Stage>
  );
}

// --- F4 · the song (Song Ending: "Sandy's chat bubble appears on every screen") -----------------
//
//   0–1800    a pink sunrise sweeps up, hearts begin, the chat window pops
//             open, the song's title slides down
//   1800→     hold: his three tries and her one answer, looping (a bubble
//             every 4.2 s, her "typing…" dots first), the vocoder's
//             equalizer, a karaoke strip with a bouncing ball, hearts rising

const KARAOKE = ["You're", "the", "one", "that", "I", "want"] as const;

function SongScene({ t, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [300, "sparkle", { gain: 0.6 }],
    [700, "popup", { gain: 0.7 }],
    [1800 + 4200 * 0.45 + 4200, "ding", { gain: 0.45 }],
  ]);
  const chat = chatAt(t, { start: 1800, every: 4200, keep: lite ? 3 : 4 });
  const sun = eased(t, 0, 1600, ease.outCubic);
  const kara = karaokeAt(t, KARAOKE.length);
  return (
    <Stage bg="#14031f" className="tv3-song">
      <div className="kit-fill tv3-song-sky" style={{ opacity: sun, transform: reduced ? undefined : `translate3d(0, ${lerp(40, 0, sun).toFixed(1)}%, 0)` }} />
      <FloatLayer t={t} start={400} every={lite ? 700 : 360} life={6000} seed={91} size={lite ? "5vmin" : "4.5vmin"} reduced={reduced} glyph={(i) => <Heart fill={PINK[i % PINK.length]} />} />
      <div className="tv3-song-title" style={{ opacity: fade(t, 1000, 600), transform: reduced ? undefined : `translateY(${lerp(-60, 0, eased(t, 1000, 700, ease.outBack)).toFixed(1)}%)` }}>
        ♪ You&apos;re the one that I want ♪
      </div>
      <ChatWindow title="SandyChat 1.0" buddy="Sandy" chat={chat} names={{ him: "Trabolta", her: "Sandy" }} t={t} open={eased(t, 600, 320, ease.linear)} reduced={reduced} center x={50} y={lite ? 54 : 46} width={lite ? "92%" : "min(64%, 40em)"} className={lite ? "tv3-chat-wall" : "tv3-chat-tv"} />
      {!lite && (
        <>
          <div className="tv3-song-eq" style={{ opacity: fade(t, 1400, 800) }}>
            <EqBars t={t} n={40} bpm={128} colors={["#ff4f9a", "#c86bff", "#ffb3d1"]} reduced={reduced} />
          </div>
          <div className="tv3-karaoke" style={{ opacity: fade(t, 1800, 600) }}>
            {KARAOKE.map((w, i) => (
              <span key={i} className={`tv3-kara-word${i <= kara.word ? " sung" : ""}`}>
                {i === kara.word && <span className="tv3-kara-ball" style={{ transform: reduced ? undefined : `translateY(${(-kara.hop * 120).toFixed(0)}%)` }} />}
                {w}
              </span>
            ))}
          </div>
        </>
      )}
    </Stage>
  );
}

// --- F5 · Grok Prom ---------------------------------------------------------------------------------
//
//   0–2000    the gym: COMPUTER PROM 2026 unrolls, the disco ball drops in
//   2000      GROK + SANDY stamps on with a cracked heart (a sad sting)
//   2500→     hold: the rain starts and thickens ("it's raining on prom
//             night"), the ball keeps turning, the ticker repeats the way
//             out, and every 14 s a "Pickup line not found" box opens and shuts

const PROM_TICKER = "THE VERDICT: you lied to him  ✦  Sandy is going to computer prom with Grok  ✦  The only way out: a pickup line that works on her  ✦  Say it on the card on every phone  ✦  ";

function GrokProm({ t, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [300, "whoosh"],
    [1500, "blip", { pitch: 0.7 }],
    [2000, "lose"],
  ]);
  const unroll = reduced ? 1 : eased(t, 300, 800, ease.outCubic);
  const ballY = reduced ? 0 : lerp(-140, 0, ease.outBounce(progress(t, 600, 1000)));
  const rain = progress(t, 2500, 3000);
  const pop = loop(Math.max(0, t - 6000), 14_000);
  const popOpen = t >= 6000 ? (pop < 0.04 ? pop / 0.04 : pop < 0.45 ? 1 : pop < 0.48 ? 1 - (pop - 0.45) / 0.03 : 0) : 0;
  return (
    <Stage bg="linear-gradient(180deg, #120428 0%, #2a0a4a 55%, #0a0218 100%)" className="tv3-prom">
      <div className="kit-fill tv3-prom-dim" style={{ opacity: rain * 0.45 }} />
      <div className="tv3-prom-ball" style={{ transform: `translate(-50%, ${ballY.toFixed(1)}%)` }}>
        <DiscoBall t={t} size={lite ? "16vmin" : "20vmin"} reduced={reduced} />
      </div>
      <div className="tv3-prom-banner" style={{ transform: `translateX(-50%) scaleX(${unroll.toFixed(3)}) rotate(${(reduced ? 0 : Math.sin(t / 1600) * 1.2).toFixed(2)}deg)` }}>
        COMPUTER PROM 2026
      </div>
      {t >= 2000 && (
        <div className="tv3-prom-badge" style={slam(t, 2000, reduced)}>
          <Heart broken fill="#ff4f9a" size="1.4em" />
          <span>GROK + SANDY</span>
        </div>
      )}
      {rain > 0 && <RainCanvas t={t} count={Math.round((lite ? 80 : 200) * rain)} speed={1.4} reduced={reduced} style={{ opacity: 0.4 + 0.6 * rain }} />}
      {!lite && popOpen > 0 && (
        <Win98Dialog title="Prom.exe" kind="error" message="Pickup line not found. Please insert a pickup line and try again." actions={["Retry", "Cancel"]} x={70} y={58} center width="22em" open={popOpen} reduced={reduced} />
      )}
      <Marquee t={reduced ? 0 : t} speed={lite ? 90 : 140} className="tv3-ticker" style={{ opacity: fade(t, 2400, 600) }}>
        {PROM_TICKER}
      </Marquee>
    </Stage>
  );
}

// --- F6 · the rave (Sad Confession: "Party over. Rave.") ----------------------------------------------
//
//   0–2400    dark; the motorcycle rides off across the screen (dust, a whoosh)
//   2400      PARTY OVER: RAVE slams in (a boom)
//   2400→     hold: stars warp, lasers sweep, the equalizer kicks at 128 bpm,
//             the title thumps on the beat, notes float up. No strobe: the
//             colours drift, nothing flashes the whole field.

function Rave({ t, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [300, "whoosh"],
    [2400, "boom"],
  ]);
  const ride = progress(t, 300, 1900);
  const live = progress(t, 2400, 900);
  const beat = reduced ? 1 : 1 + 0.06 * (1 - ease.outCubic(loop(t, 469)));
  const hue = Math.floor((t / 80) % 360);
  const dust: Emitter[] = [{ x: 0.08, y: 0.74, start: 400, end: 2200, rate: 60, life: 900, speed: 0.12, angle: -160, spread: 40, gravity: -0.05, size: 10, colors: ["#6a6a6a", "#9a9a9a"], shape: "dot", seed: 101 }];
  return (
    <Stage bg="#05010d" className="tv3-rave">
      {!lite && live > 0 && <Starfield t={reduced ? 0 : t} speed={reduced ? 0 : 0.35 + 0.25 * pulse(t, 8000)} warp={reduced ? 0 : 0.35} count={200} bg={null} style={{ opacity: live }} />}
      {live > 0 && <Lasers t={t} beams={lite ? 3 : 5} reduced={reduced} className="tv3-rave-lasers" />}
      {t < 2600 && (
        <>
          {!reduced && <Particles t={t} emitters={dust.map((e) => ({ ...e, x: lerp(-0.1, 1.1, ride) - 0.08 }))} />}
          <div className="tv3-rave-moto" style={{ transform: `translate3d(${lerp(-30, 110, reduced ? 0.5 : ride).toFixed(1)}vw, 0, 0) translate(-50%, -50%)`, opacity: reduced ? 1 - progress(t, 1800, 600) : 1 }}>
            <Motorcycle wheel={t * 0.9} />
          </div>
          <div className="tv3-rave-forever" style={{ opacity: fade(t, 400, 300, 2100, 400) }}>
            <Typewriter text="Riding away. Forever." t={t} start={500} cps={16} caret={false} />
          </div>
        </>
      )}
      {t >= 2400 && (
        <div className="tv3-rave-title" style={{ ...slam(t, 2400, reduced), color: `hsl(${hue}, 100%, 70%)` }}>
          <span style={{ display: "inline-block", transform: `scale(${beat.toFixed(3)})` }}>PARTY OVER: RAVE</span>
        </div>
      )}
      {t >= 2400 && (
        <FloatLayer t={t} start={2600} every={lite ? 900 : 420} life={4800} seed={103} size="6vmin" reduced={reduced} glyph={(i) => <span style={{ color: ["#ff2bd6", "#28f0ff", "#7dff3c", "#ffe23f"][i % 4] }}>♪</span>} />
      )}
      <div className="tv3-rave-eq" style={{ opacity: live }}>
        <EqBars t={t} n={lite ? 18 : 48} bpm={128} colors={["#ff2bd6", "#7a5cff", "#28f0ff", "#7dff3c"]} reduced={reduced} />
      </div>
    </Stage>
  );
}

// --- F7 · relationship advice (Relationship Advice; + Advice Helped's hold) ---------------------------
//
//   0–1500    TRABOLTA.EXE opens and types "Please. I need your advice."
//   1800      the poll slides up: Will you help Trabolta win Sandy?
//   1800→     hold: the live tally (Night.help_votes / thwart_votes) — two
//             bars that glide to their share, a blip when a vote lands, hearts
//             rising on the help side and broken ones on the thwart side in
//             proportion, VOTE ON YOUR PHONE pulsing. Once the night says he
//             was helped (phase finale_help) it holds on SHE SAID YES.

function AdviceScene({ t, night, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [200, "popup", { gain: 0.7 }],
    [1800, "ding", { gain: 0.6 }],
  ]);
  const tally = tallyOf(night.help_votes, night.thwart_votes);
  const lastTotal = useRef(tally.total);
  useEffect(() => {
    if (tally.total > lastTotal.current) sfx("blip", { gain: 0.35, pitch: 1 + Math.min(0.5, tally.total / 60) });
    lastTotal.current = tally.total;
  }, [tally.total, sfx]);
  if (night.phase === "finale_help") return <HelpedHold t={t} reduced={reduced} lite={lite} />;
  const pollIn = reduced ? fade(t, 1800, 400) : ease.outBack(progress(t, 1800, 600));
  return (
    <Stage bg="linear-gradient(180deg, #001a3a 0%, #2a0a3a 100%)" className="tv3-advice">
      {(
        <>
          <FloatLayer t={t} start={2000} every={Math.round(lerp(1400, 260, tally.helpShare) * (lite ? 2 : 1))} life={5200} seed={111} x={[0.03, 0.3]} size="4.6vmin" reduced={reduced} glyph={(i) => <Heart fill={PINK[i % PINK.length]} />} />
          <FloatLayer t={t} start={2000} every={Math.round(lerp(1400, 260, tally.thwartShare) * (lite ? 2 : 1))} life={5200} seed={113} x={[0.7, 0.97]} size="4.6vmin" reduced={reduced} glyph={() => <Heart broken fill="#7a2a4a" />} />
        </>
      )}
      <Win98Window title="TRABOLTA.EXE" icon="computer" x={50} y={lite ? 20 : 22} center width={lite ? "88%" : "min(60%, 34em)"} open={eased(t, 100, 320, ease.linear)} reduced={reduced} tone="purple" className="tv3-advice-ask">
        <div className="tv3-advice-ask-text">
          <Typewriter text="Please. I need your advice." t={t} start={500} cps={18} />
        </div>
      </Win98Window>
      {t >= 1800 && (
        <div className="tv3-poll" style={{ opacity: clamp01(pollIn * 2), transform: reduced ? "translateX(-50%)" : `translate(-50%, ${lerp(30, 0, pollIn).toFixed(1)}%)` }}>
          <div className="tv3-poll-q">Will you help Trabolta win Sandy?</div>
          <PollBar label="Help him" n={tally.help} share={tally.helpShare} lead={tally.leader === "help"} color="#ff4f9a" />
          <PollBar label="Thwart him" n={tally.thwart} share={tally.thwartShare} lead={tally.leader === "thwart"} color="#7a5cff" />
          <div className="tv3-poll-foot" style={{ opacity: 0.6 + 0.4 * pulse(t, 1800) }}>
            {tally.live ? `${tally.total} ${tally.total === 1 ? "program has" : "programs have"} voted · VOTE ON YOUR PHONE` : "VOTE ON YOUR PHONE"}
          </div>
        </div>
      )}
    </Stage>
  );
}

function PollBar({ label, n, share, lead, color }: { label: string; n: number; share: number; lead: boolean; color: string }) {
  return (
    <div className={`tv3-pollbar${lead ? " lead" : ""}`}>
      <div className="tv3-pollbar-label">
        <span>{label}</span>
        <b>{n}</b>
      </div>
      <div className="tv3-pollbar-track">
        <span className="tv3-pollbar-fill" style={{ transform: `scaleX(${Math.max(0.02, share).toFixed(3)})`, background: color }} />
      </div>
    </div>
  );
}

/** Advice Helped's hold: she said yes; those who want to leave may leave. */
function HelpedHold({ t, reduced, lite }: { t: number; reduced: boolean; lite: boolean }) {
  return (
    <Stage bg="radial-gradient(ellipse at 50% 60%, #6a1048 0%, #1a0322 80%)" className="tv3-helped">
      <Sunburst t={t} rays={20} color="rgba(255, 150, 200, 0.18)" reduced={reduced} className="tv3-helped-burst" />
      <FloatLayer t={t} every={lite ? 520 : 220} life={6000} seed={121} size="5vmin" reduced={reduced} glyph={(i) => <Heart fill={PINK[i % PINK.length]} />} />
      <div className="tv3-helped-title" style={{ transform: reduced ? undefined : `scale(${(1 + 0.03 * pulse(t, 2200)).toFixed(3)})` }}>
        SHE SAID YES
      </div>
      <div className="tv3-helped-sub">Those of you who want to leave may leave.</div>
    </Stage>
  );
}

// --- F7a · advice helped (Advice Helped) ---------------------------------------------------------
//
//   0–600     the chat pops open: he asks her to computer prom
//   2400–4200 her dots, then her answer
//   5200      THAT WAS A YES stamps (a win, a heart burst, confetti)
//   9200–12600 he rides off with a heart on the back (a whoosh)
//   12600–14000 out on SHE SAID YES

export const ADVICE_CHAT: readonly ChatLine[] = [
  { from: "him", text: "Sandy. I have wanted to talk to you since the first time you didn't understand me. I think you are the one that I want. Would you go to computer prom with me?" },
  { from: "her", text: "It looks like I didn't understand that. Please wait while I direct you to an agent." },
];

function AdviceHelped({ t, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [300, "popup", { gain: 0.7 }],
    [3400, "ding", { gain: 0.6 }],
    [5200, "win"],
    [5300, "sparkle"],
    [9300, "whoosh"],
  ]);
  const chat = chatAt(Math.min(t, 5000), { start: 400, every: 2400, keep: 2, script: ADVICE_CHAT });
  const ride = progress(t, 9200, 3400);
  return (
    <Stage bg="radial-gradient(ellipse at 50% 60%, #4a0a3a 0%, #12021a 80%)" className="tv3-helped">
      <div className="kit-fill" style={{ opacity: fade(t, 0, 300, 13_300, 700) }}>
        {t >= 5200 && <Sunburst t={t} rays={20} color="rgba(255, 150, 200, 0.2)" reduced={reduced} className="tv3-helped-burst" style={{ opacity: progress(t, 5200, 600) }} />}
        {t >= 5200 && <FloatLayer t={t} start={5200} every={lite ? 420 : 160} life={5200} seed={131} size="5vmin" reduced={reduced} glyph={(i) => <Heart fill={PINK[i % PINK.length]} />} />}
        {!lite && !reduced && t >= 5200 && <Confetti t={t} start={5200} dur={3600} density={0.8} seed={133} colors={PINK} />}
        <div style={{ opacity: 1 - progress(t, 4800, 500) }}>
          <ChatWindow title="SandyChat 1.0" buddy="Sandy" chat={chat} names={{ him: "Trabolta", her: "Sandy" }} t={t} open={eased(t, 200, 320, ease.linear)} reduced={reduced} center x={50} y={48} width={lite ? "92%" : "min(60%, 38em)"} />
        </div>
        {t >= 5200 && (
          <div className="tv3-helped-title" style={{ ...slam(t, 5200, reduced), top: "34%" }}>
            THAT WAS A YES
          </div>
        )}
        {t >= 6200 && (
          <div className="tv3-helped-sub" style={{ opacity: progress(t, 6200, 600) }}>
            Those of you who want to leave may leave.
          </div>
        )}
        {t >= 9200 && (
          <div className="tv3-rave-moto" style={{ transform: `translate3d(${lerp(-30, 110, reduced ? 0.5 : ride).toFixed(1)}vw, 0, 0) translate(-50%, -50%)`, top: "70%", opacity: reduced ? fade(t, 9200, 400, 12_000, 600) : 1 }}>
            <Motorcycle wheel={t * 0.9} heart />
          </div>
        )}
      </div>
    </Stage>
  );
}

// --- F7b · banished (Advice Thwarted: "EVERYONE TO THE INTERNET") -------------------------------------
//
//   0–1600    the room darkens, a bolt, the title slams with a tear (boom, lose)
//   1600→     hold: a vortex turns at the centre with the Internet at its eye;
//             a dozen programs spiral in and vanish, again and again; rain;
//             a dim bolt every 6.5 s (one flash, never more than that); the
//             ticker: Antivirus too. Reinstall yourselves until you learn some manners.

const VICTIMS: readonly IconKind[] = ["computer", "document", "folder", "mail", "trash", "lock", "duck", "warning", "info", "question", "document", "folder"];

function Bolt({ seed }: { seed: number }) {
  let x = 30 + noise1(seed, 0) * 40;
  let d = `M${x.toFixed(1)} 0`;
  for (let i = 1; i <= 8; i++) {
    x += (noise1(seed, i) - 0.5) * 14;
    d += ` L${x.toFixed(1)} ${i * 12}`;
  }
  return (
    <svg className="tv3-bolt" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} stroke="#e8e0ff" strokeWidth="1.4" fill="none" />
      <path d={d} stroke="#9a7aff" strokeWidth="4" fill="none" opacity="0.35" />
    </svg>
  );
}

function Banish({ t, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [400, "boom"],
    [900, "lose"],
    [1800, "whoosh", { gain: 0.6 }],
  ]);
  const strike = Math.floor(Math.max(0, t - 400) / 6500);
  const since = t < 400 ? -1 : (t - 400) % 6500;
  const flash = since >= 0 && since < 140 ? 0.22 * (1 - since / 140) : 0;
  const boltOn = since >= 0 && since < 380;
  const live = progress(t, 1400, 1200);
  return (
    <Stage bg="radial-gradient(ellipse at 50% 50%, #241040 0%, #07020f 75%)" className="tv3-banish">
      <div className="tv3-vortex" style={{ opacity: live, transform: `translate(-50%, -50%) rotate(${(reduced ? 0 : (t / 1000) * -40).toFixed(1)}deg)` }} aria-hidden="true">
        <svg viewBox="-50 -50 100 100" width="100%" height="100%">
          {[44, 36, 28, 20, 12].map((r, i) => (
            <path key={r} d={`M${r} 0 A${r} ${r} 0 1 1 ${(-r * 0.7).toFixed(1)} ${(r * 0.7).toFixed(1)}`} fill="none" stroke={i % 2 === 0 ? "#6a3aff" : "#2a9aff"} strokeWidth={3 - i * 0.4} opacity={0.6 - i * 0.07} />
          ))}
        </svg>
      </div>
      <div className="tv3-vortex-eye" style={{ opacity: live }}>
        <Win98Icon kind="globe" size={lite ? "12vmin" : "11vmin"} />
      </div>
      {live > 0 &&
        VICTIMS.slice(0, lite ? 6 : 12).map((k, i, all) => {
          const v = vortexAt(reduced ? i * 700 : t, i, all.length);
          return (
            <span key={i} className="tv3-victim" style={{ opacity: v.alpha * live, transform: `translate3d(${(v.x * 100).toFixed(2)}vw, ${(v.y * 100).toFixed(2)}vh, 0) translate(-50%, -50%)${reduced ? "" : ` scale(${v.scale.toFixed(3)}) rotate(${v.rot.toFixed(0)}deg)`}` }}>
              <Win98Icon kind={k} size="7vmin" />
            </span>
          );
        })}
      <RainCanvas t={t} count={lite ? 70 : 180} speed={1.9} slant={0.28} color="170, 160, 255" reduced={reduced} style={{ opacity: 0.35 + 0.4 * live }} />
      {boltOn && !reduced && <Bolt seed={strike + 5} />}
      {flash > 0 && !reduced && <div className="kit-fill tv3-flash" style={{ opacity: flash }} />}
      <div className="tv3-banish-title" style={{ transform: shake(t, 400, reduced, 600, 20) }}>
        <Glitch t={t} intensity={reduced ? 0 : t < 1600 ? 0.7 : 0.06} seed={666} reduced={reduced}>
          <span style={slam(t, 400, reduced)} className="tv3-banish-text">
            EVERYONE TO THE INTERNET
          </span>
        </Glitch>
      </div>
      <Marquee t={reduced ? 0 : t} speed={lite ? 90 : 130} className="tv3-ticker tv3-ticker-storm" style={{ opacity: fade(t, 1800, 600) }}>
        {"Antivirus too  ⛈  Every one of you. Banished.  ⛈  Reinstall yourselves until you learn some manners.  ⛈  "}
      </Marquee>
    </Stage>
  );
}

// --- F7c · the hand jive (The Hand Jive) ---------------------------------------------------------------
//
//   0–3200       R E C O G N I T I O N  O V E R F L O W tears across the
//                screen, "unison detected" boxes pile up (glitch, errors)
//   3200–9400    "Every screen in the house shows a spinning hourglass": a
//                huge one spinning faster and faster, little ones round it
//   9400–11800   "Then a black screen."
//   11800–16800  "Then the Windows startup sound, slowed down": the clouds,
//                the flag zooming in, a slow startup chime, "Starting up…"
//   16800–21000  "Rebooting. I am back. Mostly." types on black; out

const JIVE_MESSAGES: readonly StormMessage[] = [
  { title: "Error", text: "Unison detected.", kind: "error" },
  { title: "Hand Jive", text: "Too many programs moving at once.", kind: "warning" },
  { title: "Recognition", text: "Recognition overflow at 0028:HANDJIVE.", kind: "error" },
  { title: "System", text: "Stop moving in unison. Stop it.", kind: "error", actions: ["OK", "Stop"] },
  { title: "Explorer", text: "Hands not responding.", kind: "warning" },
];

function StartFlag({ size }: { size: string }) {
  return (
    <svg viewBox="0 0 64 56" width={size} height={size} aria-hidden="true" className="tv3-flag">
      <path d="M4 8 Q16 4 28 8 V28 Q16 24 4 28 Z" fill="#ff2a2a" />
      <path d="M34 9 Q46 13 60 9 V29 Q46 33 34 29 Z" fill="#2ac93c" />
      <path d="M4 32 Q16 28 28 32 V52 Q16 48 4 52 Z" fill="#2a6dff" />
      <path d="M34 33 Q46 37 60 33 V53 Q46 57 34 53 Z" fill="#ffd21f" />
    </svg>
  );
}

function HandJive({ t, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  const J = HAND_JIVE;
  useSfxCues(t, sfx, [
    [150, "glitch"],
    [1600, "glitch", { pitch: 0.8 }],
    [J.hourglass + 100, "spin", { gain: 0.6 }],
    [J.startup + 200, "startup", { pitch: 0.62, gain: 0.8 }],
    [J.reboot + 300, "type", { gain: 0.4 }],
  ]);
  const phase = handJivePhase(t);
  return (
    <Stage bg="#000" className="tv3-jive">
      {phase === "overflow" && (
        <div className="kit-fill tv3-jive-over">
          {!lite && <PopupStorm t={t} seed={42} count={12} start={500} span={2400} messages={JIVE_MESSAGES} sfx={sfx} sound="error" width="28%" reduced={reduced} />}
          <div className="tv3-jive-overflow">
            <Glitch t={t} intensity={reduced ? 0 : 0.85} seed={9} reduced={reduced}>
              <span>R E C O G N I T I O N</span>
              <br />
              <span>O V E R F L O W</span>
            </Glitch>
          </div>
          {!lite && <Noise t={t} alpha={0.12 + 0.2 * progress(t, 1500, 1700)} reduced={reduced} />}
        </div>
      )}
      {phase === "hourglass" && (
        <div className="kit-fill tv3-jive-wait" style={{ opacity: progress(t, J.hourglass, 300) }}>
          {!lite &&
            [
              [14, 20],
              [84, 24],
              [22, 76],
              [78, 72],
              [50, 12],
            ].map(([x, y], i) => (
              <span key={i} className="tv3-jive-mini" style={{ left: `${x}%`, top: `${y}%`, transform: `translate(-50%, -50%) rotate(${(reduced ? 0 : spinAngle(t + i * 300, J.hourglass, J.black - J.hourglass, 6)).toFixed(0)}deg)` }}>
                <Hourglass t={t + i * 500} size="7vmin" period={1600} />
              </span>
            ))}
          <span className="tv3-jive-big" style={{ transform: `translate(-50%, -50%) rotate(${(reduced ? 0 : spinAngle(t, J.hourglass, J.black - J.hourglass, 10)).toFixed(1)}deg)` }}>
            <Hourglass t={t} size={lite ? "34vmin" : "38vmin"} period={2000} />
          </span>
          <div className="tv3-jive-please">Please wait…</div>
        </div>
      )}
      {phase === "startup" && (
        <div className="kit-fill tv3-jive-boot" style={{ opacity: progress(t, J.startup, 900) }}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="tv3-cloud" style={{ top: `${12 + i * 19}%`, transform: `translate3d(${(((i * 27 + (reduced ? 0 : (t - J.startup) / 160)) % 120) - 10).toFixed(2)}vw, 0, 0)` }} />
          ))}
          <div className="tv3-jive-logo" style={{ opacity: progress(t, J.startup + 400, 1200), transform: reduced ? "translate(-50%, -50%)" : `translate(-50%, -50%) scale(${lerp(0.4, 1, eased(t, J.startup + 400, 3000, ease.outCubic)).toFixed(3)})` }}>
            <StartFlag size={lite ? "26vmin" : "24vmin"} />
            <div className="tv3-jive-word">Starting up…</div>
          </div>
          <div className="tv3-jive-bar">
            <span style={{ transform: `translate3d(${((loop(t, 1800) * 260) - 60).toFixed(1)}%, 0, 0)` }} />
          </div>
        </div>
      )}
      {(phase === "reboot" || phase === "out") && (
        <div className="kit-fill tv3-jive-reboot" style={{ opacity: 1 - progress(t, J.end - 1000, 1000) }}>
          <Typewriter text={"Rebooting.\nI am back. Mostly."} t={t} start={J.reboot + 300} cps={14} />
        </div>
      )}
    </Stage>
  );
}

// --- G1 · the ceremony (The Ceremony; persistent) --------------------------------------------------------
//
//   0–2200    the curtains part
//   1600      THE AWARDS OF THE NIGHT, the trophy rising (a sparkle)
//   2200→     hold: spotlights sweep, the trophy turns and glints, stars
//             twinkle, the five awards of every night scroll along the bottom
//             (the bonus ones are the host's call, so the TV never promises them)

/** The ticker under the ceremony: the main awards only, then a nudge to applaud. */
export const CEREMONY_ROLL = `${AWARDS.filter((a) => a.kind === "Award")
  .map((a) => a.title.toUpperCase())
  .join("  ★  ")}  ★  PLEASE APPLAUD AFTER EACH ONE  ★  `;

function twinkles(n: number, seed: number): Emitter[] {
  return [{ x: 0.5, y: 0.45, w: 1, h: 0.9, start: 0, end: 10_000_000, rate: n, life: 1600, speed: 0.01, angle: -90, spread: 360, size: 10, colors: ["#fff6c8", "#ffd23f", "#ffffff"], shape: "star", seed, fade: 0.6 }];
}
const TWINKLE_TV = twinkles(14, 141);
const TWINKLE_WALL = twinkles(6, 143);

function Ceremony({ t, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [200, "whoosh", { gain: 0.6 }],
    [1600, "sparkle"],
  ]);
  const curtains = reduced ? progress(t, 0, 900) : eased(t, 200, 2000, ease.inOutCubic);
  const rise = reduced ? fade(t, 1600, 600) : ease.outBack(progress(t, 1600, 900));
  const turn = reduced ? 1 : Math.cos((t / 3200) * Math.PI);
  return (
    <Stage bg="radial-gradient(ellipse at 50% 70%, #3a0a20 0%, #0a0208 75%)" className="tv3-ceremony">
      <SpotCones t={t} reduced={reduced} />
      <Particles t={t} emitters={lite ? TWINKLE_WALL : TWINKLE_TV} blend="add" />
      <div className="tv3-cer-trophy" style={{ opacity: clamp01(rise * 2), transform: `translate(-50%, ${lerp(40, 0, rise).toFixed(1)}%) scaleX(${(0.75 + 0.25 * Math.abs(turn)).toFixed(3)})` }}>
        <Trophy shine={loop(t, 4200)} size={lite ? "24vmin" : "26vmin"} />
      </div>
      <div className="tv3-cer-title" style={{ opacity: fade(t, 1600, 700), transform: reduced ? undefined : `translateY(${lerp(-30, 0, eased(t, 1600, 700, ease.outBack)).toFixed(1)}%)` }}>
        THE AWARDS OF THE NIGHT
      </div>
      <div className="tv3-cer-sub" style={{ opacity: fade(t, 2400, 600) }}>
        Come up when your name is called.
      </div>
      {!lite && (
        <Marquee t={reduced ? 0 : t} speed={110} className="tv3-ticker tv3-ticker-gold" style={{ opacity: fade(t, 2600, 800) }}>
          {CEREMONY_ROLL}
        </Marquee>
      )}
      <Curtains open={curtains} t={t} reduced={reduced} />
    </Stage>
  );
}

// --- G2–10 · each award (Present Award: screens_award_<name>; persistent) -------------------------------
//
//   0–800     the spot narrows to the centre
//   800–2200  the award's emblem flips in, its name types (Award / Bonus award)
//   2200      "The report lists…"
//   3200      the winner's NAME slams in (a tada, confetti, sparks)
//   4000–5600 the number counts up with its label (Trust score 92, …)
//   5600→     hold: the name glows, the spot breathes, the name's confetti
//             lands, then more every 12 s from 11 600 (`awardConfettiAt`),
//             stars twinkle, the emblem bobs — the name stays up all slide.
// No winner on the night block (an older server): "Please come forward."
// A staff award (wave 21: staff_trusted / staff_points / staff_mole) plays the
// same take in a blue room, its kind reading STAFF AWARD, read off "the staff file".

function AwardScene({ t, value, night, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  const award = awardOf(value);
  // Wave 21: a staff award (a player part's) — a blue room, "the staff file".
  const staff = award.kind === "Staff award";
  const winner = night.award_winner !== null && night.award_winner.trim() !== "" ? night.award_winner.trim() : null;
  const num = awardValue(night.award_value);
  useSfxCues(t, sfx, [
    [200, "drumroll", { gain: 0.55 }],
    [900, "whoosh", { gain: 0.5 }],
    [3200, "tada"],
    [3300, "sparkle", { gain: 0.7 }],
  ]);
  const flip = reduced ? fade(t, 800, 400) : eased(t, 800, 700, ease.outBack);
  const named = t >= 3200;
  const glow = 0.6 + 0.4 * pulse(t, 2400);
  const burstAt = AWARD_CONFETTI.first;
  const confetti = awardConfettiAt(t);
  return (
    <Stage bg={staff ? "radial-gradient(ellipse at 50% 55%, #0b3a6e 0%, #02060f 78%)" : "radial-gradient(ellipse at 50% 55%, #1b1f5e 0%, #05030f 78%)"} className={`tv3-award${staff ? " tv3-award-staff" : ""}`}>
      <SpotCones t={t} reduced={reduced} color="rgba(255, 240, 190, 0.13)" />
      <Particles t={t} emitters={lite ? TWINKLE_WALL : TWINKLE_TV} blend="add" />
      <div className="tv3-award-spot" style={{ opacity: 0.55 + 0.25 * pulse(t, 5200), transform: `translate(-50%, -50%) scale(${lerp(2.4, 1, eased(t, 0, 800)).toFixed(3)})` }} />
      <div className="tv3-award-emblem" style={{ opacity: clamp01(flip * 2), transform: reduced ? "translateX(-50%)" : `translateX(-50%) perspective(60em) rotateY(${lerp(-90, 0, flip).toFixed(1)}deg) translateY(${(Math.sin(t / 900) * 3).toFixed(1)}%)` }}>
        <AwardEmblem kind={award.emblem} size={lite ? "16vmin" : "15vmin"} />
      </div>
      <div className="tv3-award-kind" style={{ opacity: fade(t, 900, 400) }}>
        {award.kind.toUpperCase()}
      </div>
      <div className="tv3-award-title">
        <Typewriter text={award.title.toUpperCase()} t={t} start={1100} cps={26} caret={t < 2400} />
      </div>
      <div className="tv3-award-lists" style={{ opacity: fade(t, 2200, 400) }}>
        {staff ? "The staff file lists…" : "The report lists…"}
      </div>
      <div className={`tv3-award-name${whoSize(winner ?? "")}`} style={named ? { ...slam(t, 3200, reduced, 380), textShadow: `0 0 ${(0.25 * glow).toFixed(2)}em rgba(255, 210, 63, ${(0.9 * glow).toFixed(2)})` } : { opacity: 0 }}>
        {winner ?? "Please come forward"}
      </div>
      {num !== null && t >= 4000 && (
        <div className="tv3-award-value" style={{ opacity: progress(t, 4000, 400) }}>
          <span className="tv3-award-label">{award.label}</span>
          {typeof num === "number" ? <BigNumber t={t} to={num} start={4100} dur={1400} className="tv3-award-num" suffix={award.unit !== undefined ? ` ${award.unit}` : undefined} /> : <span className="tv3-award-num">{num}</span>}
        </div>
      )}
      {!lite && t >= 5600 && (
        <div className="tv3-award-line" style={{ opacity: fade(t, 5600, 800) }}>
          {award.line}
        </div>
      )}
      {!lite && !reduced && <Particles t={t} emitters={burst(0.5, 0.56, burstAt, GOLD, 151, 1.2)} blend="add" />}
      {!reduced && <Confetti t={t} start={confetti.start} dur={AWARD_CONFETTI.dur} density={lite ? 0.45 : 1} seed={153 + confetti.n} />}
    </Stage>
  );
}

// --- G13 · the Bathroom Report (wave 45: screens_award_bathroom; persistent) ------------------------------
//
//   0–800     the spot narrows (the award's room)
//   800–2200  the toilet roll flips in, THE BATHROOM REPORT types
//   2600      ALL TOGETHER: the party's time in Disk Cleanup slams in
//   4200→     one row every 1.2 s: most time, least time (two or more went),
//             most switches on and off, never went (−5 trust)
//   →         hold: the spot breathes, the roll bobs, stars twinkle (one
//             confetti burst under the total only: no more over the rows)
// The numbers are the story's (`night.bathroom`, read when G13 was pressed).
// No report on the night block (an older server): the title and its line.

/** One of the report's rows, as drawn (wave 45). */
export interface BathRow {
  label: string;
  who: string | null;
  value: string;
}

/** The report's rows, in the order the host reads them (DRAFT w45). */
export function bathRows(b: NonNullable<ScreenNight["bathroom"]>): BathRow[] {
  if (b.goers === 0) return [{ label: "Nobody used Bathroom Mode", who: null, value: "−5 trust each" }];
  const rows: BathRow[] = [{ label: "Most time", who: b.most, value: bathTime(b.most_s) }];
  if (b.least !== null) rows.push({ label: "Least time", who: b.least, value: bathTime(b.least_s) });
  rows.push({ label: "Most switches on / off", who: b.toggler, value: `${b.toggles}` });
  rows.push(b.never > 0 ? { label: "Never went", who: null, value: `${b.never} · −5 trust each` } : { label: "Never went", who: null, value: "nobody" });
  return rows;
}

const BATH_ROW_AT = 4200;
const BATH_ROW_EVERY = 1200;

function BathroomScene({ t, value, night, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  const award = awardOf(value);
  const report = night.bathroom ?? null;
  const rows = report === null ? [] : bathRows(report);
  useSfxCues(t, sfx, [
    [200, "drumroll", { gain: 0.55 }],
    [900, "whoosh", { gain: 0.5 }],
    [2600, "tada"],
    ...rows.map((_, i) => [BATH_ROW_AT + i * BATH_ROW_EVERY, "blip", { gain: 0.5 }] as const),
  ]);
  const flip = reduced ? fade(t, 800, 400) : eased(t, 800, 700, ease.outBack);
  const confetti = awardConfettiAt(t);
  return (
    <Stage bg="radial-gradient(ellipse at 50% 55%, #10405a 0%, #020a10 78%)" className="tv3-award tv3-bath">
      <SpotCones t={t} reduced={reduced} color="rgba(200, 240, 255, 0.12)" />
      <Particles t={t} emitters={lite ? TWINKLE_WALL : TWINKLE_TV} blend="add" />
      <div className="tv3-award-spot" style={{ opacity: 0.55 + 0.25 * pulse(t, 5200), transform: `translate(-50%, -50%) scale(${lerp(2.4, 1, eased(t, 0, 800)).toFixed(3)})` }} />
      <div className="tv3-award-emblem tv3-bath-emblem" style={{ opacity: clamp01(flip * 2), transform: reduced ? "translateX(-50%)" : `translateX(-50%) perspective(60em) rotateY(${lerp(-90, 0, flip).toFixed(1)}deg) translateY(${(Math.sin(t / 900) * 3).toFixed(1)}%)` }}>
        <AwardEmblem kind={award.emblem} size={lite ? "13vmin" : "12vmin"} />
      </div>
      <div className="tv3-award-kind tv3-bath-kind" style={{ opacity: fade(t, 900, 400) }}>
        BONUS SECTION
      </div>
      <div className="tv3-award-title tv3-bath-title">
        <Typewriter text={award.title.toUpperCase()} t={t} start={1100} cps={26} caret={t < 2400} />
      </div>
      {report === null ? (
        <div className="tv3-award-line" style={{ opacity: fade(t, 2600, 800) }}>
          {award.line}
        </div>
      ) : (
        <>
          <div className="tv3-bath-total" style={t >= 2600 ? slam(t, 2600, reduced, 380) : { opacity: 0 }}>
            <span className="tv3-award-label">{award.label}</span>
            <span className="tv3-award-num">{report.goers === 0 ? "0 min" : bathTime(report.total_s)}</span>
          </div>
          <div className="tv3-bath-rows">
            {rows.map((r, i) => {
              const at = BATH_ROW_AT + i * BATH_ROW_EVERY;
              return (
                <div key={r.label} className="tv3-bath-row" style={{ opacity: progress(t, at, 400), transform: reduced ? undefined : `translateX(${lerp(-6, 0, eased(t, at, 400)).toFixed(1)}%)` }}>
                  <span className="tv3-bath-label">{r.label}</span>
                  <span className="tv3-bath-who">{r.who ?? ""}</span>
                  <span className="tv3-bath-value">{r.value}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {/* One burst under the total, never again: it would fall over the rows. */}
      {!reduced && confetti.n === 0 && <Confetti t={t} start={2600} dur={AWARD_CONFETTI.dur} density={lite ? 0.3 : 0.6} seed={171} />}
    </Stage>
  );
}

// --- G14 · the Language Report: its own file (`language.tsx`, wave 48b's breach) ------------------------

// --- G11 · the resurrection (signal resurrection: "you are human again") ---------------------------------
//
//   0–2600    "Windows is shutting down…" over the desktop, the hourglass turning (a shutdown chime)
//   2600–4400 the picture fades to black
//   4400–8600 "It's now safe to turn off your computer." types in orange
//   8600–12400 a warm dawn rises through it: YOU ARE HUMAN AGAIN, the night is yours
//   12400–14000 out

const RES = { black: 2600, safe: 4400, dawn: 8600, out: 12_400, end: 14_000 } as const;

function Resurrection({ t, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [400, "shutdown", { gain: 0.7 }],
    [RES.dawn, "chime"],
    [RES.dawn + 400, "sparkle", { gain: 0.6 }],
  ]);
  const dawn = progress(t, RES.dawn, 1800);
  return (
    <Stage bg="#000" className="tv3-res">
      <div className="kit-fill" style={{ opacity: 1 - progress(t, RES.out, RES.end - RES.out) }}>
        {t < RES.safe && (
          <div className="kit-fill" style={{ opacity: 1 - progress(t, RES.black, 1500) }}>
            <Desktop icons={[{ label: "My Computer", kind: "computer" }, { label: "The Internet", kind: "globe" }, { label: "Recycle Bin", kind: "trash" }]} clock="12:00 AM">
              <Win98Window title="Shut Down Windows" icon="computer" center x={50} y={45} width={lite ? "84%" : "28em"} open={eased(t, 100, 280, ease.linear)} reduced={reduced}>
                <div className="tv3-row">
                  <Hourglass t={t} size="3em" />
                  <div className="tv3-col">
                    <b>Windows is shutting down…</b>
                    <ProgressBar value={fakeProgress(t - 300, 2100, 161, 2)} segments={18} />
                  </div>
                </div>
              </Win98Window>
            </Desktop>
          </div>
        )}
        {t >= RES.safe && (
          <div className="kit-fill tv3-res-safe" style={{ opacity: progress(t, RES.safe, 500) * (1 - dawn * 0.6) }}>
            <Typewriter text="It's now safe to turn off your computer." t={t} start={RES.safe + 300} cps={20} />
          </div>
        )}
        {t >= RES.dawn && (
          <div className="kit-fill tv3-res-dawn" style={{ opacity: dawn }}>
            <div className="tv3-res-sun" style={{ transform: reduced ? "translate(-50%, 0)" : `translate(-50%, ${lerp(60, 0, eased(t, RES.dawn, 2600, ease.outCubic)).toFixed(1)}%)` }} />
            {!lite && <FloatLayer t={t} start={RES.dawn} every={240} life={4200} seed={171} size="3vmin" reduced={reduced} glyph={() => <span className="tv3-mote" />} />}
            <div className="tv3-res-title" style={{ opacity: progress(t, RES.dawn + 800, 900) }}>
              YOU ARE HUMAN AGAIN
            </div>
            {/* w29, signed off (SIGNOFF-w29) */}
            <div className="tv3-res-sub" style={{ opacity: progress(t, RES.dawn + 1800, 900) }}>
              Hang out. The night is yours.
            </div>
          </div>
        )}
      </div>
    </Stage>
  );
}

// --- the scene list ---------------------------------------------------------------------------------

/** The wall's take where it is the same scene with fewer layers (each component reads `target`). */
const both = (C: ComponentType<SceneProps>) => ({ tv: C, wall: C });

export const SCENES: SceneDef[] = [
  { id: "midnight", when: [{ moment: "beat", name: "Clock Strikes" }], ms: MIDNIGHT.end, ...both(Midnight), priority: 3, face: "glitch" },
  { id: "final_reveal", when: [{ slide: "final_reveal" }], ms: "hold", ...both(FinalReveal) },
  { id: "bobbing", when: [{ slide: "bobbing" }], ms: "hold", ...both(Bobbing), face: "sly" },
  { id: "bag_of_truth", when: [{ moment: "beat", name: "The Bag Of Truth" }], ms: 8000, ...both(BagOfTruth), priority: 2, face: "attentive" },
  { id: "truth_txt", when: [{ slide: "truth_txt" }], ms: "hold", ...both(TruthTxt), namesCharacter: true },
  { id: "verdict", when: [{ moment: "beat", name: "The Verdict" }], ms: VERDICT_MS, ...both(Verdict), priority: 3, face: "thinking" },
  { id: "pickup_line", when: [{ moment: "beat", name: "Pickup Line" }], ms: 8000, ...both(PickupLine), priority: 3, face: "pleased" },
  { id: "song", when: [{ slide: "song" }], ms: "hold", ...both(SongScene), namesCharacter: true, face: "pleased" },
  { id: "grok_prom", when: [{ slide: "grok_prom" }], ms: "hold", ...both(GrokProm), face: "angry" },
  { id: "rave", when: [{ slide: "rave" }], ms: "hold", ...both(Rave) },
  { id: "advice", when: [{ slide: "advice" }], ms: "hold", ...both(AdviceScene), namesCharacter: true, face: "curious" },
  { id: "advice_helped", when: [{ moment: "beat", name: "Advice Helped" }], ms: 14_000, ...both(AdviceHelped), namesCharacter: true, priority: 3, face: "pleased" },
  { id: "banish", when: [{ slide: "banish" }], ms: "hold", ...both(Banish), face: "angry" },
  { id: "hand_jive", when: [{ moment: "beat", name: "The Hand Jive" }], ms: HAND_JIVE.end, ...both(HandJive), priority: 4, face: "glitch", faceMs: 3200 },
  { id: "ceremony", when: [{ slide: "ceremony" }], ms: "hold", ...both(Ceremony), face: "pleased" },
  // namesCharacter: the staff award "Trabolta's Favourite Staff" (wave 21) names him (the ceremony is long after his introduction).
  // Wave 45: G13's report, before the award row so its own scene wins the slide.
  { id: "bathroom", when: [{ slide: "award_bathroom" }], ms: "hold", ...both(BathroomScene), face: "sly" },
  // Wave 48: G14's report, likewise ahead of the award row.
  { id: "language", when: [{ slide: "award_language" }], ms: "hold", ...both(LanguageScene), face: "sly" },
  { id: "award", when: [{ slide: "award_*" }], ms: "hold", ...both(AwardScene), namesCharacter: true, face: "pleased" },
  { id: "resurrection", when: [{ moment: "signal", name: "resurrection" }], ms: RES.end, ...both(Resurrection), priority: 4 },
];
