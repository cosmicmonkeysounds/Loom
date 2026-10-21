//! The cutscenes of Act D–E (lane tv2): five_minutes, Truth Pong, the
//! round-two tally, the Trust Chart, the printer and the beans, the zip,
//! the overshare, the Y2K hour, the majority, the Heart, the King, the
//! chess, the patch bay, and the endings of the server room.
//! Owned by its lane; the engine (`../registry.ts`) only lists them.
//! See `../types.ts` for the contract and `../kit/` for the building blocks
//! (this act's own pieces are `kit/tv2-parts.tsx`, its timelines
//! `kit/tv2-time.ts`).
//!
//! Every scene is a picture of `t` (ms since it started on the server's
//! clock): phases are windows of `t`, the sounds are cues on it
//! (`useSfxCues`), and the live data (the countdown, the chart, the King,
//! the house's moments) is read off the screen state on every frame. Each
//! TV scene opens with its storyboard; the wall takes are lighter cards
//! (`WallCard`) that still move for as long as they are up.

import "./act2.css";
import { useRef, type CSSProperties } from "react";
import { CHART_STEP_MS, chartCallouts, chartLines, chartReveal, slideCopy, y2kClock } from "../../slides.ts";
import type { ScreenChart } from "../../screen.ts";
import type { SceneDef, SceneProps } from "../types.ts";
import {
  BigNumber,
  Bsod,
  Confetti,
  Countdown,
  Glitch,
  Hourglass,
  Marquee,
  Noise,
  Particles,
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
  ease,
  eased,
  fakeProgress,
  lerp,
  loop,
  noise1,
  progress,
  pulse,
  typedDuration,
  useSfxCues,
  type Emitter,
} from "../kit/index.ts";
import { ColdDoor, DriftingPopups, Frost, Glass, HealthBar, KingPiece, MirrorBall, Motorcycle, PatchBay, Phone, PrinterArt, Shake, WallCard, useEndAt, useFirstSeen, useLatch, type PopMsg } from "../kit/tv2-parts.tsx";
import { CUPS, THROW_MS, Y2K_CHIME_TEXT, beanHeap, chartLayout, chartRowAt, chimeFlash, danceBeat, driftLandings, equaliser, glitchYear, kingBar, kingLine, liveNow, liveRemaining, onGrid, recountRideAt, scenarioOf, tallyOf, throwAt, y2kLevel } from "../kit/tv2-time.ts";

type Sfx = SceneProps["sfx"];
type SfxCue = readonly [number, Parameters<Sfx>[0], Parameters<Sfx>[1]?];

/** The fade every scene leaves on (ms before its end). */
const OUT_MS = 700;
/** The fade out of a scene of length `ms`. */
const fadeOut = (t: number, ms: number) => 1 - progress(t, ms - OUT_MS, OUT_MS);

/** A dark backdrop with a perspective grid crawling toward the glass. */
function Grid({ t, color = "rgba(64, 160, 255, 0.35)", bg = "radial-gradient(ellipse at 50% 35%, #0b1a4a 0%, #02040d 75%)", speed = 1, reduced }: { t: number; color?: string; bg?: string; speed?: number; reduced: boolean }) {
  const y = reduced ? 0 : loop(t * speed, 1600) * 4;
  return (
    <div className="kit-fill tv2-grid" style={{ background: bg }} aria-hidden="true">
      <div className="tv2-grid-floor" style={{ ["--tv2-grid" as string]: color } as CSSProperties}>
        <div className="tv2-grid-lines" style={{ transform: `translate3d(0, ${y.toFixed(3)}em, 0)` }} />
      </div>
    </div>
  );
}

// ══ D2: five_minutes — the summons ════════════════════════════════════════════════
//
//   0 ms      an amber beacon starts to turn; the Win98 alert pops (outBack)
//   700       the countdown slams in from 3× scale, the order types out
//   900–2400  eight phones round the edge buzz in turn, each with its note
//   2400 →    hold: the live summons countdown (the corner's), the phones buzz
//             every 4 s, an Antivirus sweep crosses the room, popups drift,
//             the marquee runs; at 0:00 DOORS CLOSING stamps down

const PHONE_SPOTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 5, y: 10 },
  { x: 4, y: 42 },
  { x: 12, y: 68 },
  { x: 86, y: 10 },
  { x: 87, y: 42 },
  { x: 80, y: 68 },
  { x: 30, y: 72 },
  { x: 62, y: 74 },
];

const FIVE_POPS: readonly PopMsg[] = [
  { title: "Antivirus", text: "Sweep in progress. Programs found outside the Desktop: counting…", kind: "warning", actions: ["OK"] },
  { title: "Bathroom Mode", text: "Bathroom Mode excuses you. Nothing else does.", kind: "info" },
  { title: "Second Moment of Truth", text: "Be in the Desktop, or you will not play Truth Pong.", kind: "error", actions: ["Going!"] },
  { title: "Reminder", text: "The doors of the Desktop close in five minutes.", kind: "question", actions: ["Yes", "Also yes"] },
];

function summonsLeft(p: SceneProps): number {
  return liveRemaining(p.state, "summons", Date.now()) ?? Math.max(0, 300 - Math.floor(p.t / 1000));
}

function FiveMinutesTv(p: SceneProps) {
  const { t, sfx, reduced } = p;
  const left = summonsLeft(p);
  useSfxCues(t, sfx, [[0, "exclamation"], [320, "popup"], [720, "boom", { gain: 0.5 }], ...PHONE_SPOTS.map((_, i) => [900 + i * 180, "buzz", { gain: 0.35, pitch: 1 + i * 0.03 }] as const), ...onGrid(t, 4900, 4000, "buzz", { gain: 0.3 }), ...onGrid(t, 2600, 9000, "popup", { gain: 0.5 })]);
  const slam = eased(t, 700, 380, ease.outBack);
  const sweep = loop(t, 7000);
  const closing = left <= 0;
  const closedAt = useFirstSeen(closing ? "closed" : null, t);
  return (
    <Stage bg="#050505" fit className="tv2">
      <div className="kit-fill tv2-beacon" style={{ transform: reduced ? undefined : `rotate(${((t / 1000) * 140).toFixed(1)}deg)`, opacity: 0.55 + 0.25 * pulse(t, 1400) }} />
      <Grid t={t} color="rgba(255, 176, 0, 0.28)" bg="radial-gradient(ellipse at 50% 40%, #2a1600 0%, #050302 75%)" reduced={reduced} />
      {!reduced && <div className="tv2-sweep" style={{ transform: `translate3d(0, ${(sweep * 36 - 2).toFixed(2)}em, 0)`, opacity: Math.sin(Math.PI * sweep) }}><span>ANTIVIRUS SWEEP</span></div>}
      <Win98Window title="SECOND MOMENT OF TRUTH" icon="warning" tone="red" x={50} y={30} center width="34em" open={eased(t, 260, 260, ease.linear)} reduced={reduced} className="tv2-five-win" buttons={["close"]}>
        <div className="tv2-five-body">
          <div className="tv2-five-label">BE IN THE DESKTOP IN</div>
          <div className="tv2-five-count" style={{ transform: `scale(${(lerp(3, 1, slam) * (left <= 30 && !reduced ? 1 + 0.04 * pulse(t, 1000) : 1)).toFixed(3)})`, opacity: clamp01(slam * 2) }}>
            <Countdown ms={left * 1000} warn={30_000} reduced={reduced} />
          </div>
          <div className="tv2-five-line">
            <Typewriter text={slideCopy("five_minutes").lines?.[0] ?? ""} t={t} start={900} cps={26} />
          </div>
        </div>
      </Win98Window>
      {PHONE_SPOTS.map((s, i) => {
        const first = 900 + i * 180;
        const local = t < 4900 ? t - first : (t - 4900) % 4000;
        const buzz = local >= 0 && local < 900 ? 1 - local / 900 : 0;
        return <Phone key={i} t={t} seed={i} buzz={reduced ? 0 : buzz} note={t >= first ? "⏳ FIVE MINUTES" : undefined} style={{ left: `${s.x}%`, top: `${s.y}%`, opacity: clamp01((t - first) / 200) }} />;
      })}
      {t > 2400 && <DriftingPopups t={t} messages={FIVE_POPS} count={2} seed={21} start={2400} life={6000} gap={3000} area={{ x0: 0.08, x1: 0.62, y0: 0.5, y1: 0.66 }} width="24em" reduced={reduced} />}
      <div className="tv2-marquee-bar tv2-amber">
        <Marquee t={t} speed={150}>⏳ FIVE MINUTES ★ BE IN THE DESKTOP FOR THE SECOND MOMENT OF TRUTH ★ BATHROOM MODE EXCUSES YOU ★ AN ANTIVIRUS IS COUNTING ★ NO DESKTOP, NO TRUTH PONG ★</Marquee>
      </div>
      {closing && (
        <div className="tv2-stamp" style={{ transform: `translate(-50%, -50%) rotate(-8deg) scale(${lerp(2.2, 1, eased(t, closedAt ?? t, 360, ease.outBack)).toFixed(3)})` }}>
          DOORS CLOSING
        </div>
      )}
      <Glass t={t} reduced={reduced} />
    </Stage>
  );
}

function FiveMinutesWall(p: SceneProps) {
  const { t, reduced } = p;
  const left = summonsLeft(p);
  return (
    <WallCard
      t={t}
      value="five_minutes"
      icon="warning"
      tone="red"
      reduced={reduced}
      bg="#3a2200"
      accent={
        <div className="tv2-wall-five">
          <Countdown ms={left * 1000} warn={30_000} reduced={reduced} />
          <span className="tv2-wall-phones">
            {[0, 1, 2].map((i) => (
              <Phone key={i} t={t} seed={i} buzz={reduced ? 0 : (t + i * 300) % 3000 < 600 ? 1 : 0} />
            ))}
          </span>
        </div>
      }
    />
  );
}

// ══ D4: truth_pong ═══════════════════════════════════════════════════════════════
//
//   0–1100    TRUTH PONG drops in letter by letter (bounce), a ball skips the tops
//   1100–2400 the table rises into perspective, ten cups pop up (4-3-2-1)
//   2600 →    hold: a throw every 2.8 s — a sink splashes (+1 TRUTH), a miss
//             skips off the rim (THE INTERNET); the rules drift past in
//             dialogs; "→ THE CLOUD" pulses; "To the backyard." types

const PONG_WORD = "TRUTH PONG";
const PONG_START = 2600;
const PONG_POPS: readonly PopMsg[] = [
  { title: "Truth Pong", text: "Make the cup: share one truth.", kind: "info" },
  { title: "Truth Pong", text: "Miss, and you are marked.", kind: "warning" },
  { title: "Truth Pong", text: "Accurate is accepted. Confident is accepted. A guess is the Internet.", kind: "question", actions: ["Understood"] },
  { title: "Adobe Acrobat", text: "Visualise the cup. Become the cup.", kind: "info", actions: ["Become"] },
];

/** The table's projection: (x 0..1, y 0 far … 1 near, z up) → the SVG's 160×90. */
function project(x: number, y: number, z = 0): { x: number; y: number; s: number } {
  const half = 30 + y * 42;
  const s = 0.55 + 0.45 * y;
  return { x: 80 + (x - 0.5) * 2 * half, y: 34 + y * 50 - z * 34 * s, s };
}

/** The title's ticks and the cups' pops (once), then each throw's landing: the
 *  throws around `t` only (windowed), so the table never falls silent. */
function pongCues(t: number): SfxCue[] {
  const out: SfxCue[] = [];
  for (let i = 0; i < PONG_WORD.length; i++) if (PONG_WORD[i] !== " ") out.push([150 + i * 90, "tick", { pitch: 0.8 + i * 0.05 }]);
  for (let i = 0; i < CUPS.length; i++) out.push([1300 + i * 90, "blip", { pitch: 0.8 + (i % 4) * 0.1, gain: 0.6 }]);
  const land = PONG_START + 250 + 1100;
  const k = t < land ? 0 : Math.floor((t - land) / THROW_MS);
  for (const n of [k, k + 1]) {
    const th = throwAt(n * THROW_MS + 1, 7);
    out.push([land + n * THROW_MS, th.sink ? "coin" : "click", { gain: th.sink ? 0.55 : 0.4 }]);
  }
  return out;
}

function PongTable({ t, reduced }: { t: number; reduced: boolean }) {
  const rise = eased(t, 1100, 900, ease.outCubic);
  const bt = t - PONG_START;
  const th = bt >= 0 ? throwAt(bt, 7) : null;
  const ball = th !== null && th.at >= 250 && !(th.landed && th.sink) ? project(th.x, th.y, th.z) : null;
  const shadow = th !== null && th.at >= 250 && !(th.landed && th.sink) ? project(th.x, th.y, 0) : null;
  const sunkCup = th !== null && th.landed && th.sink ? th.cup : -1;
  const rimCup = th !== null && th.landed && !th.sink ? th.cup : -1;
  const legs = project(0.5, 1);
  return (
    <svg className="tv2-pong" viewBox="0 0 160 90" style={{ transform: reduced ? undefined : `translate3d(0, ${((1 - rise) * 40).toFixed(2)}%, 0)`, opacity: rise }} aria-hidden="true">
      <defs>
        <linearGradient id="tv2-felt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b5d2a" />
          <stop offset="1" stopColor="#0f8a3c" />
        </linearGradient>
      </defs>
      <path d={`M${project(0, 0).x} ${project(0, 0).y} L${project(1, 0).x} ${project(1, 0).y} L${project(1, 1).x} ${project(1, 1).y} L${project(0, 1).x} ${project(0, 1).y} Z`} fill="url(#tv2-felt)" stroke="#e8e8e8" strokeWidth="0.8" />
      <path d={`M${project(0.5, 0).x} ${project(0.5, 0).y} L${project(0.5, 1).x} ${project(0.5, 1).y}`} stroke="#e8e8e8" strokeWidth="0.4" opacity="0.6" />
      <rect x={legs.x - 70} y={legs.y} width="4" height="8" fill="#555" />
      <rect x={legs.x + 66} y={legs.y} width="4" height="8" fill="#555" />
      {shadow !== null && <ellipse cx={shadow.x} cy={shadow.y} rx={1.8 * shadow.s} ry={0.7 * shadow.s} fill="#000" opacity="0.35" />}
      {CUPS.map((c, i) => {
        const at = 1300 + i * 90;
        const k = eased(t, at, 260, ease.outBack);
        if (k <= 0) return null;
        const q = project(c.x, 0.14 + c.row * 0.075);
        const sz = 7.2 * q.s * k;
        const glow = i === sunkCup ? 1 - progress(th!.at, 1350, 900) : 0;
        const wob = i === rimCup && !reduced ? Math.sin(th!.at / 30) * (1 - progress(th!.at, 1350, 500)) * 8 : 0;
        return (
          <g key={i} transform={`rotate(${wob.toFixed(2)} ${q.x} ${q.y})`}>
            {glow > 0 && <circle cx={q.x} cy={q.y - sz * 0.6} r={sz * (1.2 + glow)} fill="#ffd23f" opacity={glow * 0.6} />}
            <path d={`M${q.x - sz * 0.62} ${q.y - sz * 1.25} L${q.x + sz * 0.62} ${q.y - sz * 1.25} L${q.x + sz * 0.45} ${q.y} L${q.x - sz * 0.45} ${q.y} Z`} fill="#d81e2a" stroke="#600" strokeWidth="0.3" />
            <ellipse cx={q.x} cy={q.y - sz * 1.25} rx={sz * 0.62} ry={sz * 0.18} fill="#f7f7f7" />
            <ellipse cx={q.x} cy={q.y - sz * 1.22} rx={sz * 0.5} ry={sz * 0.12} fill={i === sunkCup ? "#ffd23f" : "#c8e8ff"} />
          </g>
        );
      })}
      {ball !== null && <circle cx={ball.x} cy={ball.y - 1.6 * ball.s} r={1.6 * ball.s} fill="#fff" stroke="#bbb" strokeWidth="0.3" />}
    </svg>
  );
}

function pongSplash(t: number): Emitter[] {
  const bt = t - PONG_START;
  if (bt < 0) return [];
  const out: Emitter[] = [];
  const n = Math.floor(bt / THROW_MS);
  for (const k of [n - 1, n]) {
    if (k < 0) continue;
    const th = throwAt(k * THROW_MS + 1, 7);
    if (!th.sink) continue;
    const c = CUPS[th.cup]!;
    const q = project(c.x, 0.14 + c.row * 0.075);
    const land = PONG_START + k * THROW_MS + 1350;
    out.push({ x: q.x / 160, y: (q.y - 5 * q.s) / 90, start: land, end: land + 160, rate: 260, life: 900, speed: 0.55, angle: -90, spread: 70, gravity: 1.6, size: 6, colors: ["#bfe6ff", "#ffffff", "#ffd23f"], shape: "dot", seed: 40 + k });
  }
  return out;
}

function TruthPongTv(p: SceneProps) {
  const { t, sfx, reduced } = p;
  useSfxCues(t, sfx, pongCues(t));
  const bt = t - PONG_START;
  const th = bt >= 0 ? throwAt(bt, 7) : null;
  const callout = th !== null && th.landed && th.at < 250 + 1100 + 900 ? (th.sink ? "+1 TRUTH" : "MISS — MARKED") : null;
  return (
    <Stage bg="#000" fit className="tv2">
      <div className="kit-fill tv2-night" />
      <Starfield t={t} speed={0.03} count={120} bg={null} color="#cfe4ff" />
      <div className="tv2-pong-title">
        {PONG_WORD.split("").map((ch, i) => {
          const k = eased(t, 150 + i * 90, 520, ease.outBounce);
          return (
            <span key={i} style={{ transform: reduced ? undefined : `translate3d(0, ${((1 - k) * -3).toFixed(3)}em, 0)`, opacity: reduced ? clamp01((t - 150 - i * 90) / 300) : k > 0 ? 1 : 0 }}>
              {ch === " " ? "\u00a0" : ch}
            </span>
          );
        })}
      </div>
      <div className="tv2-pong-sub">
        <Typewriter text={slideCopy("truth_pong").lines?.[0] ?? ""} t={t} start={1200} cps={22} />
        <span className="tv2-pong-arrow" style={{ transform: reduced ? undefined : `translate3d(${(pulse(t, 1100) * 0.8).toFixed(3)}em, 0, 0)` }}>
          → THE CLOUD
        </span>
      </div>
      <div className="tv2-pong-stage">
        <PongTable t={t} reduced={reduced} />
        {!reduced && <Particles t={t} emitters={pongSplash(t)} blend="add" />}
        {callout !== null && (
          <div className={`tv2-pong-callout${th!.sink ? " sink" : " miss"}`} style={{ transform: `translate(-50%, ${(-progress(th!.at, 1350, 900) * 2).toFixed(3)}em)`, opacity: 1 - progress(th!.at, 1950, 300) }}>
            {callout}
          </div>
        )}
      </div>
      {t > 3000 && <DriftingPopups t={t} messages={PONG_POPS} count={2} seed={31} start={3000} life={7000} gap={3500} area={{ x0: 0.02, x1: 0.66, y0: 0.04, y1: 0.18 }} width="22em" reduced={reduced} />}
      <Glass t={t} reduced={reduced} strength={0.7} />
    </Stage>
  );
}

function TruthPongWall(p: SceneProps) {
  const { t, reduced } = p;
  const k = loop(t, 1600);
  const x = 8 + k * 84;
  const y = 70 - Math.abs(Math.sin(k * Math.PI * 3)) * 50;
  return (
    <WallCard
      t={t}
      value="truth_pong"
      icon="globe"
      tone="green"
      reduced={reduced}
      bg="#0b3d1f"
      accent={
        <svg className="tv2-wall-pong" viewBox="0 0 100 80" aria-hidden="true">
          <rect x="0" y="72" width="100" height="6" fill="#0f8a3c" />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M${76 + i * 5} 72 l1 -9 h4 l1 9 z`} fill="#d81e2a" />
          ))}
          <circle cx={reduced ? 50 : x} cy={reduced ? 40 : y} r="3.5" fill="#fff" />
        </svg>
      }
    />
  );
}

// ══ D5: the round-two tally (beat Round Two Tally) ════════════════════════════════════
//
//   0–700      the room dims; the TALLY window opens: THE SECOND COLLECTION IS CLOSED
//   700–5200   facts scroll past, ticked and crossed; the tally bar lurches
//   5200–8600  CONFIDENCE WE WILL DEFEAT THE MALWARE: the needle hunts, the digits spin
//   8600       it lands — 61 % (green, a burst of confetti) or 12 % (it sinks,
//              static, "sit with that number"), off the TV's voice lines (latched:
//              they ride one poll) or the night's `collection_complete`; with
//              neither (an older server), TALLY COMPLETE
//   8600–16000 hold the number (it breathes); fade

const TALLY = { open: 0, facts: 700, gauge: 5200, land: 8600, end: 16_000 } as const;

function needleAngle(t: number, value: number | null): number {
  if (t < TALLY.gauge) return -90;
  if (value === null && t >= TALLY.land) {
    // Nothing to read the number off: the needle comes to rest, breathing at the middle.
    const from = -90 + 90 + Math.sin(((TALLY.land - TALLY.gauge) / 1000) * 5.1) * 55;
    return lerp(from, Math.sin(t / 900) * 6, ease.outCubic(progress(t, TALLY.land, 900)));
  }
  if (value === null || t < TALLY.land) {
    const h = (t - TALLY.gauge) / 1000;
    return -90 + 90 + Math.sin(h * 5.1) * 55 + Math.sin(h * 13.7) * 25 + Math.sin(h * 2.3) * 15;
  }
  const target = -90 + (value / 100) * 180;
  const k = ease.outElastic(progress(t, TALLY.land, 1200));
  const from = -90 + 90 + Math.sin(((TALLY.land - TALLY.gauge) / 1000) * 5.1) * 55;
  return lerp(from, target, k);
}

function RoundTwoTallyTv(p: SceneProps) {
  const { t, sfx, reduced, state } = p;
  const value = useLatch(p.seq, tallyOf(state.voice, p.night));
  const high = value === 61;
  useSfxCues(t, sfx, [[0, "whoosh", { gain: 0.5 }], [300, "popup"], ...onGrid(t, TALLY.facts, 260, "type", { gain: 0.35 }, TALLY.gauge), [TALLY.gauge, "drumroll", { gain: 0.6 }], ...(value === null ? [] : ([[TALLY.land, high ? "tada" : "lose"], ...(high ? ([[TALLY.land + 150, "sparkle"]] as const) : ([[TALLY.land, "boom", { gain: 0.5 }]] as const))] as const))]);
  const bar = fakeProgress(t - TALLY.facts, TALLY.gauge - TALLY.facts - 300, 11);
  const ang = needleAngle(t, value);
  const spinning = t >= TALLY.gauge && t < TALLY.land;
  const digits = spinning ? Math.floor(noise1(17, Math.floor(t / 60)) * 99) : (value ?? 0);
  const landed = value !== null && t >= TALLY.land;
  const out = fadeOut(t, TALLY.end);
  return (
    <Stage bg="#000" fit className="tv2">
      <div className="kit-fill" style={{ opacity: out }}>
        <Grid t={t} reduced={reduced} color={landed && !high ? "rgba(140,140,140,0.25)" : "rgba(64,160,255,0.35)"} />
        <Win98Window title="TALLY.EXE — Second Collection" icon="computer" x={50} y={50} center width="44em" open={eased(t, 200, 280, ease.linear)} reduced={reduced} className="tv2-tally-win" status={t < TALLY.gauge ? "Tallying the facts received…" : t >= TALLY.land ? "Tally complete." : "Calculating confidence…"}>
          <div className="tv2-tally-head">THE SECOND COLLECTION IS CLOSED</div>
          {t < TALLY.gauge + 300 ? (
            <div className="tv2-tally-facts" style={{ opacity: 1 - progress(t, TALLY.gauge, 300) }}>
              <div className="tv2-tally-clip">
              <div className="tv2-tally-scroll" style={{ transform: `translate3d(0, ${(-((t - TALLY.facts) / 90)).toFixed(2)}em, 0)` }}>
                {Array.from({ length: 70 }, (_, i) => {
                  const ok = noise1(23, i) < 0.58;
                  return (
                    <div key={i} className="tv2-tally-row">
                      <span>FACT #{String(i + 1).padStart(3, "0")}</span>
                      <span className="tv2-dots" />
                      <b className={ok ? "ok" : "no"}>{ok ? "✓ RECEIVED" : "✗ MISSING"}</b>
                    </div>
                  );
                })}
              </div>
              </div>
              <ProgressBar value={bar} percent className="tv2-tally-bar" />
            </div>
          ) : (
            <div className="tv2-tally-gauge" style={{ opacity: progress(t, TALLY.gauge - 200, 400) }}>
              <div className="tv2-tally-ask">CONFIDENCE THAT WE WILL DEFEAT THE MALWARE</div>
              <svg viewBox="0 0 200 110" className="tv2-gauge" aria-hidden="true">
                <path d="M15 100 A85 85 0 0 1 185 100" fill="none" stroke="#303030" strokeWidth="14" />
                <path d="M15 100 A85 85 0 0 1 58 27" fill="none" stroke="#c02020" strokeWidth="14" />
                <path d="M58 27 A85 85 0 0 1 142 27" fill="none" stroke="#d0a000" strokeWidth="14" />
                <path d="M142 27 A85 85 0 0 1 185 100" fill="none" stroke="#20a040" strokeWidth="14" />
                {Array.from({ length: 11 }, (_, i) => {
                  const a = ((-180 + i * 18) * Math.PI) / 180;
                  return <line key={i} x1={100 + Math.cos(a) * 70} y1={100 + Math.sin(a) * 70} x2={100 + Math.cos(a) * 78} y2={100 + Math.sin(a) * 78} stroke="#fff" strokeWidth="1.5" />;
                })}
                <g transform={`rotate(${ang.toFixed(2)} 100 100)`}>
                  <path d="M97 100 L100 22 L103 100 Z" fill="#fff" />
                </g>
                <circle cx="100" cy="100" r="7" fill="#c0c0c0" stroke="#000" />
              </svg>
              <div className={`tv2-tally-num${landed ? (high ? " high" : " low") : ""}`}>
                {landed ? <BigNumber t={t} from={digits} to={value!} start={TALLY.land} dur={500} suffix="%" /> : value === null && t >= TALLY.land ? <span className="tv2-tally-done">TALLY COMPLETE</span> : <span>{String(digits).padStart(2, "0")}%</span>}
              </div>
              {landed && (
                <div className="tv2-tally-say" style={{ opacity: progress(t, TALLY.land + 1400, 600) }}>
                  {high ? "The highest number said tonight. Your cooperation has been logged." : "Twelve. Sit with that number."}
                </div>
              )}
            </div>
          )}
        </Win98Window>
        {landed && high && <Confetti t={t} start={TALLY.land} dur={3600} density={0.8} seed={61} />}
        {landed && !high && <Noise t={t} alpha={0.12 + 0.06 * pulse(t, 2600)} reduced={reduced} />}
        <Glass t={t} reduced={reduced} />
      </div>
    </Stage>
  );
}

/** The wall's tally: the facts bar, a spin, then the same number lands (no voice there: the night's). */
const WALL_TALLY = { spin: 5600, land: 7600, end: 13_000 } as const;

function RoundTwoTallyWall(p: SceneProps) {
  const { t, sfx, reduced, done, state } = p;
  useEndAt(t, WALL_TALLY.end, done);
  const value = useLatch(p.seq, tallyOf(state.voice, p.night));
  const high = value === 61;
  useSfxCues(t, sfx, [[0, "popup", { gain: 0.5 }], [WALL_TALLY.spin, "drumroll", { gain: 0.45 }], ...(value === null ? [] : ([[WALL_TALLY.land, high ? "tada" : "lose", { gain: 0.6 }]] as const))]);
  const bar = fakeProgress(t - 500, WALL_TALLY.spin - 800, 11);
  const landed = value !== null && t >= WALL_TALLY.land;
  const spinning = t >= WALL_TALLY.spin && t < WALL_TALLY.land;
  const accent =
    t < WALL_TALLY.spin ? (
      <ProgressBar value={bar} percent />
    ) : (
      <div className={`tv2-wall-tally${landed ? (high ? " high" : " low") : ""}`}>
        <div className="tv2-small">CONFIDENCE THAT WE WILL DEFEAT THE MALWARE</div>
        <div className="tv2-wall-tally-num" style={{ transform: reduced || !spinning ? undefined : `translate3d(0, ${(Math.sin(t / 40) * 0.06).toFixed(3)}em, 0)` }}>
          {landed ? <BigNumber t={t} from={0} to={value!} start={WALL_TALLY.land} dur={600} suffix="%" /> : value === null && t >= WALL_TALLY.land ? "TALLY COMPLETE" : `${String(Math.floor(noise1(19, Math.floor(t / 70)) * 99)).padStart(2, "0")}%`}
        </div>
      </div>
    );
  return (
    <div className="kit-fill">
      <WallCard t={t} title="TALLY" lines={["The second collection is closed.", "Tallying the facts received…"]} icon="computer" reduced={reduced} bg={landed && !high ? "#2a2f33" : undefined} accent={accent} />
      {landed && high && !reduced && <Confetti t={t} start={WALL_TALLY.land} dur={2600} density={0.5} seed={62} />}
      {landed && !high && <Noise t={t} alpha={0.1} reduced={reduced} />}
    </div>
  );
}

// ══ D6: trust_chart — the live chart, kept exactly as the card draws it ═════════════
//
//   0–700     the TRUST CHART window zooms open over a crawling grid
//   live      the rows come up bottom first, one every 1.5 s (`chartReveal`),
//             each sliding in from the right with its number counting up and a
//             blip; a scan bar runs over the row just revealed; "Assessments
//             are being finalised…" with the hourglass while it reveals
//   done      the call-outs land when the story names them (MOST / LEAST
//             TRUSTED, by name, never by position): the top row gets a gold
//             glow, a crown and sparks, the bottom row a grey glitch
//   hold      a shimmer sweeps the window every 6 s; the formula scrolls past
//             in the marquee — persistent: this holds for as long as the slide

const CHART_FORMULA = "TEN POINTS PER CORRECT TRUTH ★ MINUS FIVE PER VISIT TO THE INTERNET ★ PLUS OR MINUS TEN FOR MY PERSONAL ASSESSMENT ★ YOU MAY LOOK FOR YOURSELF ★ YOU MAY NOT ARGUE WITH IT ★";

function ChartBody({ t, chart, now, reduced, big, maxCols = 3 }: { t: number; chart: ScreenChart; now: number; reduced: boolean; big: boolean; maxCols?: number }) {
  const lines = chartLines(chart);
  const n = lines.length;
  const shown = chartReveal(n, chart.revealAt, now);
  const done = shown >= n;
  const words = chartCallouts(chart.slide);
  const max = Math.max(1, ...lines.map((l) => Math.abs(l.value)));
  const { cols, perCol } = chartLayout(n, maxCols);
  const topSeen = useFirstSeen(done ? chart.top : null, t);
  const bottomSeen = useFirstSeen(done ? chart.bottom : null, t);
  // Rows sit in % of the rows' box (it takes what the call-outs leave); the type follows the row count.
  const rowFont = Math.min(big ? 1.3 : 1.2, (big ? 8 : 16) / perCol);
  return (
    <div className="tv2-chart">
      {done && (chart.top !== null || chart.bottom !== null) && (
        <div className="tv2-chart-callouts">
          {chart.top !== null && (
            <div className="tv2-callout top" style={{ transform: reduced ? undefined : `scale(${lerp(1.8, 1, eased(t, topSeen ?? t, 420, ease.outBack)).toFixed(3)})`, opacity: progress(t, topSeen ?? t, 200) }}>
              👑 {words.top}: {chart.top}
            </div>
          )}
          {chart.bottom !== null && (
            <Glitch t={t} intensity={reduced ? 0 : 0.12 + 0.3 * (1 - progress(t, bottomSeen ?? t, 2500))} seed={9} reduced={reduced} className="tv2-callout-wrap">
              <div className="tv2-callout bottom" style={{ opacity: progress(t, bottomSeen ?? t, 300) }}>
                {words.bottom}: {chart.bottom}
              </div>
            </Glitch>
          )}
        </div>
      )}
      <div className="tv2-chart-rows" style={{ fontSize: `${rowFont.toFixed(3)}em` }}>
        {lines.map((r, i) => {
          const hidden = i < n - shown;
          const at = chartRowAt(i, n, chart.revealAt, CHART_STEP_MS);
          const enter = at === 0 ? 1 : eased(now, at, 520, ease.outCubic);
          const col = Math.floor(i / perCol);
          const slot = i % perCol;
          const isTop = r.name === chart.top;
          const isBottom = r.name === chart.bottom;
          const count = at === 0 ? r.value : Math.round(lerp(0, r.value, eased(now, at, 900, ease.outCubic)));
          const scan = at !== 0 && now >= at && now < at + 900;
          return (
            <div
              key={r.name}
              className={`tv2-chart-row${hidden ? " hidden" : ""}${isTop && done ? " top" : ""}${isBottom && done ? " bottom" : ""}`}
              style={{ left: `${((col / cols) * 100).toFixed(3)}%`, width: `calc(${(100 / cols).toFixed(3)}% - 0.6em)`, top: `${((slot / perCol) * 100).toFixed(3)}%`, height: `${(88 / perCol).toFixed(3)}%`, transform: hidden || reduced ? undefined : `translate3d(${((1 - enter) * 6).toFixed(3)}em, 0, 0)`, opacity: hidden ? 0 : clamp01(enter * 1.4) }}
            >
              <div className="tv2-chart-bar" style={{ transform: `scaleX(${clamp01((Math.abs(count) / max) * enter).toFixed(4)})` }} />
              {scan && !reduced && <div className="tv2-chart-scan" style={{ transform: `translate3d(${(progress(now, at, 900) * 100).toFixed(2)}%, 0, 0)` }} />}
              <span className="tv2-chart-rank">{r.rank}.</span>
              <span className="tv2-chart-name">{r.name}</span>
              <span className="tv2-chart-value">{count}</span>
              {isTop && done && <span className="tv2-chart-crown" style={{ transform: reduced ? undefined : `translateY(${(Math.sin(t / 300) * 0.12).toFixed(3)}em) rotate(${(Math.sin(t / 500) * 12).toFixed(1)}deg)` }}>★</span>}
            </div>
          );
        })}
      </div>
      {!done && (
        <div className="tv2-chart-pending">
          <Hourglass t={t} size="1.6em" /> Assessments are being finalised…
        </div>
      )}
    </div>
  );
}

function chartSparks(t: number, seen: number | null): Emitter[] {
  if (seen === null) return [];
  // Already up on the first frame: only the steady stars, no burst.
  const start = Number.isFinite(seen) ? seen : Math.min(0, t) - 1000;
  return [
    { x: 0.32, y: 0.3, w: 0.36, h: 0.04, start, end: start + 100_000_000, rate: 14, life: 1300, speed: 0.18, angle: -90, spread: 120, gravity: 0.2, size: 9, colors: ["#ffd23f", "#fff2b0"], shape: "star", seed: 77 },
    { x: 0.5, y: 0.32, start, end: start + 260, rate: 500, life: 1500, speed: 0.6, speedJitter: 0.6, angle: -90, spread: 360, gravity: 0.5, drag: 0.5, size: 6, colors: ["#ffd23f", "#ffffff", "#ff9f1c"], shape: "spark", seed: 78 },
  ];
}

function TrustChartTv(p: SceneProps) {
  const { t, sfx, reduced, state } = p;
  const now = liveNow(state, Date.now());
  const chart = state.chart !== null && state.chart.slide === p.value && state.chart.rows.length > 0 ? state.chart : null;
  const n = chart?.rows.length ?? 0;
  const shown = chart === null ? 0 : chartReveal(n, chart.revealAt, now);
  const done = chart !== null && shown >= n;
  const topSeen = useFirstSeen(done ? chart.top : null, t);
  // The reveal's blips, on the scene's own clock (the slide went up with its chart).
  const rowCues = chart === null || chart.revealAt <= 0 || p.at <= 0 ? [] : Array.from({ length: n }, (_, k) => [chart.revealAt - p.at + k * CHART_STEP_MS, "blip", { pitch: 0.7 + (k / Math.max(1, n)) * 0.8, gain: 0.5 }] as const);
  useSfxCues(t, sfx, [[0, "whoosh", { gain: 0.5 }], [350, "chord", { gain: 0.6 }], ...rowCues, ...(topSeen !== null && Number.isFinite(topSeen) ? ([[topSeen, "fanfare", { gain: 0.6 }]] as const) : [])]);
  const shimmer = loop(t, 6000);
  return (
    <Stage bg="#000" fit className="tv2">
      <Grid t={t} reduced={reduced} speed={0.6} />
      <Win98Window title={slideCopy("trust_chart").title} icon="document" x={50} y={47} center width="54em" height="29em" open={eased(t, 100, 420, ease.outCubic)} reduced={reduced} className="tv2-chart-win" buttons={["min", "max", "close"]} status={chart === null ? "Waiting for the assessments…" : done ? `${n} programs ranked.` : `Ranking… ${shown} of ${n}`}>
        <div className="tv2-chart-head">
          <h2>{slideCopy("trust_chart").title}</h2>
          <span>{slideCopy("trust_chart").lines?.[0]}</span>
        </div>
        {chart !== null ? (
          <ChartBody t={t} chart={chart} now={now} reduced={reduced} big />
        ) : (
          <div className="tv2-chart-pending big">
            <Hourglass t={t} size="3em" /> Assessments are being finalised…
          </div>
        )}
        {!reduced && <div className="tv2-shimmer" style={{ transform: `translate3d(${(shimmer * 260 - 80).toFixed(1)}%, 0, 0) skewX(-20deg)`, opacity: Math.sin(Math.PI * clamp01(shimmer * 3)) * 0.5 }} />}
      </Win98Window>
      {!reduced && done && <Particles t={t} emitters={chartSparks(t, topSeen)} blend="add" />}
      <div className="tv2-marquee-bar">
        <Marquee t={t} speed={110}>{CHART_FORMULA}</Marquee>
      </div>
      <Glass t={t} reduced={reduced} strength={0.6} />
    </Stage>
  );
}

/** A portrait wall tablet (one column of rows reads better there). */
const portrait = (): boolean => typeof window !== "undefined" && window.innerHeight > window.innerWidth * 1.1;

function TrustChartWall(p: SceneProps) {
  const { t, reduced, state } = p;
  const now = liveNow(state, Date.now());
  const chart = state.chart !== null && state.chart.slide === p.value && state.chart.rows.length > 0 ? state.chart : null;
  return (
    <Stage bg="#000814" className="tv2 tv2-wall tv2-wall-chart">
      <div className="tv2-wall-dots" style={{ transform: reduced ? undefined : `translate3d(0, ${((t / 60) % 40).toFixed(1)}px, 0)` }} />
      <Win98Window title={slideCopy("trust_chart").title} icon="document" x={50} y={50} center width="min(94vw, 60em)" height="min(92vh, 46em)" open={eased(t, 0, 380, ease.linear)} reduced={reduced} className="tv2-wall-win tv2-chart-win">
        <div className="tv2-chart-head">
          <h2>{slideCopy("trust_chart").title}</h2>
        </div>
        {chart !== null ? (
          <ChartBody t={t} chart={chart} now={now} reduced={reduced} big={false} maxCols={portrait() ? 1 : 2} />
        ) : (
          <div className="tv2-chart-pending big">
            <Hourglass t={t} size="2.4em" /> Assessments are being finalised…
          </div>
        )}
      </Win98Window>
    </Stage>
  );
}

// ══ D7: print_certificate — the printer jams ═══════════════════════════════════════════
//
//   0–900     the Print dialog pops; certificate.pdf flies across into the printer
//   900–3000  the paper feeds a third of the way out — and stops; the printer
//             shudders, its light blinks amber
//   hold      "0% complete" never moves (the bar's stripes crawl, it never
//             fills); the print queue says Printing; the paper twitches every
//             few seconds and the printer grinds; popups drift (Printer busy,
//             Paper jam); "Printing for 0:43" counts up — it has said that for a while

const PRINT_POPS: readonly PopMsg[] = [
  { title: "Printer", text: "The printer is busy. Please wait.", kind: "info" },
  { title: "Printer", text: "Paper jam in tray 2. Or tray 1. There is only one tray.", kind: "warning", actions: ["Retry", "Cancel"] },
  { title: "Print Manager", text: "certificate.pdf is printing. It has been printing for a while.", kind: "info" },
  { title: "Printer", text: "Printer not responding. Try pressing START again?", kind: "question", actions: ["Yes", "No"] },
];

function jamShudder(t: number): number {
  const local = t < 3000 ? -1 : (t - 3000) % 6500;
  return local >= 0 && local < 700 ? 1 - local / 700 : 0;
}

function PrintCertificateTv(p: SceneProps) {
  const { t, sfx, reduced } = p;
  const copy = slideCopy("print_certificate");
  useSfxCues(t, sfx, [[0, "popup"], [300, "whoosh", { gain: 0.5 }], [1100, "click"], [2400, "buzz", { gain: 0.4 }], ...onGrid(t, 3000, 6500, "buzz", { gain: 0.35 }), ...driftLandings(2, Math.max(4000, t - 1000), t + 1000, { seed: 41, life: 7000, gap: 4000, start: 4000 }).map((x) => [x, "ding", { gain: 0.4 }] as const)]);
  const fly = eased(t, 250, 800, ease.inOutCubic);
  const feed = t < 900 ? 0 : t < 2200 ? eased(t, 900, 1300, ease.outQuad) * 0.42 : 0.42;
  const shudder = reduced ? 0 : jamShudder(t);
  const elapsed = Math.floor(t / 1000);
  const stripes = reduced ? 0 : (t / 30) % 40;
  return (
    <Stage bg="#008080" fit className="tv2 tv2-teal">
      <div className="kit-fill tv2-desk-dots" />
      <Shake t={t} amount={shudder * 0.25} seed={5} reduced={reduced} className="tv2-print-printer">
        <PrinterArt paper={feed + (shudder > 0 ? Math.sin(t / 25) * 0.015 : 0)} jam={shudder} led={blink(t, t > 2200 ? 500 : 1000)} lcd={t < 2200 ? "PRINT" : blink(t, 1400) ? "BUSY" : "JAM?"} size="22em" />
      </Shake>
      {fly < 1 && (
        <div className="tv2-print-doc" style={{ transform: `translate3d(${lerp(0, 24, fly).toFixed(2)}em, ${(-Math.sin(Math.PI * fly) * 6 + fly * 4).toFixed(2)}em, 0) rotate(${(fly * 30).toFixed(1)}deg) scale(${lerp(1, 0.5, fly).toFixed(3)})`, opacity: 1 - progress(fly, 0.85, 0.15) }}>
          <Win98Icon kind="document" size="5em" />
          <span>certificate.pdf</span>
        </div>
      )}
      <Win98Window title={copy.title} icon="document" x={4} y={8} width="30em" open={eased(t, 0, 260, ease.linear)} reduced={reduced} className="tv2-print-win">
        <div className="tv2-print-row">
          <PrinterArt paper={0} size="3em" />
          <div>
            <b>Printing</b>
            <div className="tv2-small">certificate.pdf — for our great hero</div>
            <div className="tv2-small">on DESKTOP PRINTER</div>
          </div>
        </div>
        <div className="tv2-print-bar" style={{ backgroundPosition: `${stripes.toFixed(1)}px 0` }} />
        <div className="tv2-print-pct">{copy.lines?.[0] ?? "0% complete"}</div>
        <div className="tv2-print-actions">
          <span className="kit-btn">Cancel</span>
        </div>
      </Win98Window>
      <Win98Window title="DESKTOP PRINTER — Print Queue" icon="computer" x={4} y={52} width="30em" open={eased(t, 900, 260, ease.linear)} inactive reduced={reduced} className="tv2-print-queue" buttons={["min", "max", "close"]} status={`Printing for ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`}>
        <div className="tv2-queue-head">
          <span>Document Name</span>
          <span>Status</span>
          <span>Pages</span>
        </div>
        <div className="tv2-queue-row">
          <span>certificate.pdf</span>
          <span style={{ opacity: blink(t, 1200, 0.7) ? 1 : 0.35 }}>Printing</span>
          <span>0 of 1</span>
        </div>
      </Win98Window>
      {t > 4000 && <DriftingPopups t={t} messages={PRINT_POPS} count={2} seed={41} start={4000} life={7000} gap={4000} area={{ x0: 0.36, x1: 0.62, y0: 0.06, y1: 0.24 }} width="22em" reduced={reduced} />}
      <Glass t={t} reduced={reduced} strength={0.4} roll={false} />
    </Stage>
  );
}

function PrintCertificateWall(p: SceneProps) {
  const { t, reduced } = p;
  const shudder = reduced ? 0 : jamShudder(t + 2500);
  return <WallCard t={t} value="print_certificate" icon="document" reduced={reduced} accent={<Shake t={t} amount={shudder * 0.3} reduced={reduced}><PrinterArt paper={0.3} jam={shudder} led={blink(t, 500)} size="7em" /></Shake>} />;
}

// ══ D7: beans — the printer is full of beans ═════════════════════════════════════════════
//
//   0–500     the screen tears (the house's flicker rides over it); a critical chord
//   500–1600  the printer's lid bangs open and a geyser of beans erupts
//   1600–2400 the error dialog lands: The printer is full of beans.
//   hold      beans keep trickling out and the heap at the foot of the screen keeps
//             rising; the bean counter climbs; popups drift (Print to PDF failed:
//             beans); the dialog's title glitches now and then

const BEAN_COLORS = ["#7a3b16", "#8f4a1e", "#5e2c10", "#a0582a", "#6b3415"];
const BEAN_POPS: readonly PopMsg[] = [
  { title: "Print to PDF", text: "Print to PDF failed: beans.", kind: "error" },
  { title: "System", text: "Routine operations are no longer working.", kind: "warning" },
  { title: "Malware", text: "The malware is getting worse.", kind: "error", tone: "red" },
  { title: "Printer", text: "Bean level: critical.", kind: "warning", actions: ["Retry", "Beans"] },
];

function beanEmitters(): Emitter[] {
  return [
    { x: 0.73, y: 0.5, w: 0.06, start: 500, end: 1500, rate: 240, life: 2600, speed: 1.3, speedJitter: 0.4, angle: -95, spread: 50, gravity: 1.7, size: 15, sizeJitter: 0.35, colors: BEAN_COLORS, shape: "bean", seed: 81, fade: 0.15 },
    { x: 0.73, y: 0.52, w: 0.05, start: 1500, end: 100_000_000, rate: 22, life: 2400, speed: 0.55, speedJitter: 0.5, angle: -100, spread: 60, gravity: 1.5, size: 14, colors: BEAN_COLORS, shape: "bean", seed: 82, fade: 0.15 },
  ];
}
const BEANS = beanEmitters();

function BeansTv(p: SceneProps) {
  const { t, sfx, reduced } = p;
  const copy = slideCopy("beans");
  useSfxCues(t, sfx, [[0, "glitch"], [200, "critical"], [520, "boom", { gain: 0.6 }], [1700, "error"], ...onGrid(t, 9000, 9000, "error", { gain: 0.4 })]);
  const lid = eased(t, 500, 260, ease.outBack);
  const heap = beanHeap(t, 900);
  const count = Math.floor(lerp(0, 2400, eased(t, 500, 1800, ease.outCubic)) + Math.max(0, t - 2300) / 37);
  const tear = t < 600;
  return (
    <Stage bg="#008080" fit className="tv2 tv2-teal">
      <div className="kit-fill tv2-desk-dots" />
      <Shake t={t} amount={reduced ? 0 : between(t, 450, 1300) ? 0.6 : 0.04} seed={8} className="tv2-beans-printer" reduced={reduced}>
        <PrinterArt paper={0.1} lid={lid} led={blink(t, 300)} lcd={blink(t, 700) ? "BEANS" : "ERR"} size="24em" />
      </Shake>
      {!reduced && <Particles t={t} emitters={BEANS} max={320} />}
      {reduced && t > 500 && <div className="tv2-beans-still">🫘</div>}
      <div className="tv2-heap" style={{ transform: `translate3d(0, ${((1 - heap) * 100).toFixed(2)}%, 0)` }} />
      <Glitch t={t} intensity={reduced ? 0 : tear ? 0.9 : noise1(3, Math.floor(t / 2500)) < 0.25 ? 0.5 : 0} seed={12} reduced={reduced} className="tv2-beans-dialog-wrap">
        <Win98Dialog title={copy.title} message={<><b>{copy.lines?.[0] ?? "The printer is full of beans."}</b><br />certificate.pdf could not be printed.</>} kind="error" actions={["Retry", "Cancel", "Beans"]} pressed={blink(t, 4000, 0.06) && t > 4000 ? 0 : undefined} x={4} y={16} width="30em" open={eased(t, 1600, 240, ease.linear)} reduced={reduced} tone="red" />
      </Glitch>
      <div className="tv2-bean-count" style={{ opacity: progress(t, 1800, 400) }}>
        BEANS: <b>{count.toLocaleString("en-US")}</b>
      </div>
      {t > 4500 && <DriftingPopups t={t} messages={BEAN_POPS} count={2} seed={51} start={4500} life={6500} gap={3500} area={{ x0: 0.04, x1: 0.4, y0: 0.44, y1: 0.6 }} width="22em" reduced={reduced} />}
      {tear && !reduced && <Noise t={t} alpha={0.35 * (1 - progress(t, 0, 600))} />}
      <Glass t={t} reduced={reduced} strength={0.4} roll={false} />
    </Stage>
  );
}

function BeansWall(p: SceneProps) {
  const { t, reduced } = p;
  return (
    <WallCard
      t={t}
      value="beans"
      icon="error"
      tone="red"
      reduced={reduced}
      accent={
        <div className="tv2-wall-beans">
          {Array.from({ length: 9 }, (_, i) => {
            const k = loop(t + i * 260, 1800);
            return (
              <span key={i} style={{ transform: reduced ? undefined : `translate3d(${(Math.sin(i * 2.3) * 2).toFixed(2)}em, ${(k * 5).toFixed(2)}em, 0) rotate(${(k * 360 + i * 40).toFixed(0)}deg)`, opacity: 1 - k }}>
                🫘
              </span>
            );
          })}
        </div>
      }
    />
  );
}

// ══ D8: Zip Everyone Out (beat) ═════════════════════════════════════════════════════════
//
//   0–700     a WinZip-ish window opens: Compressing The Internet…
//   700–7600  program after program flies out of C:\THE INTERNET in an arc and
//             is squeezed flat into the archive in the vise (a whoosh each)
//   7600–9400 the vise clamps; Compressed, for the moment. Sparkles
//   9400–11000 one icon is left behind in the folder, flickering. It fades.

const ZIP = { open: 0, files: 700, clamp: 7600, left: 9400, end: 11_000, count: 16 } as const;
const ZIP_EVERY = (ZIP.clamp - ZIP.files) / ZIP.count;

function ZipTv(p: SceneProps) {
  const { t, sfx, reduced } = p;
  useSfxCues(t, sfx, [[0, "popup"], ...Array.from({ length: ZIP.count }, (_, i) => [ZIP.files + i * ZIP_EVERY, "whoosh", { gain: 0.3, pitch: 0.9 + (i % 5) * 0.06 }] as const), [ZIP.clamp, "boom", { gain: 0.5 }], [ZIP.clamp + 200, "sparkle"], [ZIP.left + 400, "glitch", { gain: 0.4 }]]);
  const bar = progress(t, ZIP.files, ZIP.clamp - ZIP.files);
  const clampK = eased(t, ZIP.clamp, 300, ease.outBack);
  const out = fadeOut(t, ZIP.end);
  return (
    <Stage bg="#008080" fit className="tv2 tv2-teal">
      <div className="kit-fill" style={{ opacity: out }}>
        <div className="kit-fill tv2-desk-dots" />
        <Win98Window title="WinZap — internet.zip" icon="folder" x={50} y={48} center width="52em" height="26em" open={eased(t, 0, 280, ease.linear)} reduced={reduced} className="tv2-zip-win" buttons={["min", "max", "close"]} status={t < ZIP.clamp ? `Compressing ${Math.min(ZIP.count, Math.floor(bar * ZIP.count) + 1)} of ${ZIP.count}…` : "Compressed, for the moment."}>
          <div className="tv2-zip-stage">
            <div className="tv2-zip-folder">
              <Win98Icon kind="folder" size="6em" />
              <span>C:\THE INTERNET</span>
            </div>
            <div className="tv2-zip-vise" style={{ transform: `scaleX(${lerp(1, 0.78, clampK).toFixed(3)})` }}>
              <div className="tv2-zip-jaw left" style={{ transform: `translate3d(${(clampK * 1.2).toFixed(3)}em, 0, 0)` }} />
              <div className="tv2-zip-archive" style={{ transform: `scale(${(1 + 0.06 * Math.sin(Math.min(t, ZIP.clamp) / 120)).toFixed(3)})` }}>
                <span>ZIP</span>
              </div>
              <div className="tv2-zip-jaw right" style={{ transform: `translate3d(${(-clampK * 1.2).toFixed(3)}em, 0, 0)` }} />
            </div>
            {Array.from({ length: ZIP.count }, (_, i) => {
              const at = ZIP.files + i * ZIP_EVERY;
              const k = progress(t, at, ZIP_EVERY * 2.6);
              if (k <= 0 || k >= 1) return null;
              const e = ease.inOutCubic(k);
              const squash = k > 0.75 ? lerp(1, 0.1, (k - 0.75) / 0.25) : 1;
              return (
                <div key={i} className="tv2-zip-file" style={{ transform: `translate3d(${lerp(0, 38, e).toFixed(2)}em, ${(-Math.sin(Math.PI * e) * 7 - e * 0.6).toFixed(2)}em, 0) scale(${squash.toFixed(3)}, ${(1 / Math.max(0.4, squash) ** 0.3).toFixed(3)})` }}>
                  <Win98Icon kind={i % 3 === 0 ? "computer" : i % 3 === 1 ? "document" : "globe"} size="3em" />
                  <span>program_{String(i + 1).padStart(2, "0")}.exe</span>
                </div>
              );
            })}
            <div className="tv2-zip-log">
              {Array.from({ length: ZIP.count }, (_, i) => i)
                .filter((i) => t >= ZIP.files + (i + 2.2) * ZIP_EVERY)
                .slice(-4)
                .map((i) => (
                  <div key={i}>
                    Adding: program_{String(i + 1).padStart(2, "0")}.exe … deflated {97 + (i % 3)}%
                  </div>
                ))}
            </div>
            {t >= ZIP.left && (
              <div className="tv2-zip-leftover" style={{ opacity: (blink(t, 300, 0.6) ? 0.9 : 0.3) * (1 - progress(t, ZIP.end - 900, 600)) }}>
                <Win98Icon kind="error" size="2.4em" />
                <span>???.exe</span>
              </div>
            )}
          </div>
          <ProgressBar value={bar} label="Compression ratio: 99%" />
        </Win98Window>
        {!reduced && <Particles t={t} emitters={[{ x: 0.64, y: 0.46, w: 0.12, h: 0.1, start: ZIP.clamp, end: ZIP.clamp + 1400, rate: 40, life: 1000, speed: 0.12, angle: -90, spread: 360, size: 10, colors: ["#ffd23f", "#ffffff"], shape: "star", seed: 91 }]} blend="add" />}
      </div>
    </Stage>
  );
}

function ZipWall(p: SceneProps) {
  const { t, reduced, done } = p;
  useEndAt(t, 9000, done);
  return <WallCard t={t} title="Compressing The Internet…" lines={["The Antivirus zip every program out of the Internet.", "Compressed, for the moment."]} icon="folder" reduced={reduced} accent={<ProgressBar value={progress(t, 400, 7000)} percent />} />;
}

// ══ D9: overshare — and its four scenarios (beats Overshare One … Four) ═════════════════
//
//   0–1500    TRABOLTA.EXE tears onto the screen (glitch, static); "…" types
//   hold      the window hangs there, typing and deleting an ellipsis; the two
//             final facts drop into the Quest Log (toast); the files drift
//   scenario  ~14 s after the scenario's beat (the open and both questions are
//             spoken first): every screen goes black but one cursor ("the face on
//             every screen is just a cursor") — then back, and the scenario's own
//             windows: One — Sandy's name in a file slammed shut, VIRUS DETECTED,
//             the LiveJournal accessed; Two — routine facts, the LiveJournal; Three
//             — VIRUS DETECTED, everything depends; Four — composed, one slip.

/** The cursor beat comes this long after the scenario's beat (ms): the open line and both questions are said first. */
export const OVERSHARE_CURSOR_DELAY = 14_000;
const CURSOR_MS = 4200;

const SCENARIO_WINDOWS: Record<1 | 2 | 3 | 4, ReadonlyArray<{ at: number; title: string; text: string; kind: "error" | "warning" | "info" | "question"; tone?: "red" | "navy" | "black" | "purple"; x: number; y: number; close?: number }>> = {
  1: [
    { at: 0, title: "unified_field_theory.txt", text: "…to win back my ex. Sandy.", kind: "info", tone: "purple", x: 8, y: 14, close: 2600 },
    { at: 2800, title: "TRABOLTA.EXE", text: "That was not for you.", kind: "warning", x: 30, y: 30 },
    { at: 4800, title: "VIRUS DETECTED", text: "Someone brought a virus back from the Internet.", kind: "error", tone: "red", x: 54, y: 12 },
    { at: 7200, title: "LiveJournal", text: "Your context was accessed by 1 user. I know who.", kind: "warning", tone: "black", x: 12, y: 56 },
  ],
  2: [
    { at: 0, title: "final_facts.txt", text: "These facts are routine. They are simply the last two.", kind: "info", x: 10, y: 16 },
    { at: 3200, title: "LiveJournal", text: "Your context was accessed by 1 user. I know who.", kind: "warning", tone: "black", x: 40, y: 46 },
  ],
  3: [
    { at: 0, title: "VIRUS DETECTED", text: "Someone brought a virus back from the Internet.", kind: "error", tone: "red", x: 12, y: 18 },
    { at: 3000, title: "TRABOLTA.EXE", text: "Everything depends on these facts. Everything.", kind: "warning", x: 42, y: 44 },
  ],
  4: [
    { at: 0, title: "TRABOLTA.EXE", text: "That is all. Thank you for your continued cooperation.", kind: "info", x: 14, y: 18 },
    { at: 3600, title: "TRABOLTA.EXE", text: "She will— the theory will be complete.", kind: "warning", tone: "purple", x: 40, y: 46 },
  ],
};

/** The scenario, held for the slide once seen (the moments ring may move on). */
function useScenario(p: SceneProps): { scenario: 1 | 2 | 3 | 4; at: number } | null {
  const held = useRef<{ seq: number; s: { scenario: 1 | 2 | 3 | 4; at: number } } | null>(null);
  const found = scenarioOf(p.state.moments, p.at > 0 ? p.at - 2000 : 0);
  if (found !== null) held.current = { seq: p.seq, s: found };
  return held.current !== null && held.current.seq === p.seq ? held.current.s : null;
}

function OvershareTv(p: SceneProps) {
  const { t, sfx, reduced, state } = p;
  const sc = useScenario(p);
  const now = liveNow(state, Date.now());
  // The scenario's own clock, on the scene's: its beat's at, relative to ours.
  const sT = sc === null ? null : p.at > 0 ? t - (sc.at - p.at) - OVERSHARE_CURSOR_DELAY : now - sc.at - OVERSHARE_CURSOR_DELAY;
  const cursor = sT !== null && sT >= 0 && sT < CURSOR_MS;
  const after = sT !== null && sT >= CURSOR_MS ? sT - CURSOR_MS : null;
  const scenarioCues = sc === null || sT === null ? [] : ([[t - sT, "static", { gain: 0.5 }], [t - sT + CURSOR_MS, "glitch"], ...SCENARIO_WINDOWS[sc.scenario].map((w) => [t - sT + CURSOR_MS + w.at, w.kind === "error" ? "critical" : "exclamation"] as const)] as const);
  useSfxCues(t, sfx, [[0, "glitch"], [120, "static", { gain: 0.5 }], [1400, "popup"], ...scenarioCues]);
  const dots = "…";
  const typing = loop(t, 3200);
  const shown = typing < 0.5 ? Math.ceil(typing * 2 * 3) : Math.ceil((1 - typing) * 2 * 3);
  return (
    <Stage bg="#000" fit className="tv2">
      <Grid t={t} reduced={reduced} color="rgba(190, 60, 255, 0.3)" bg="radial-gradient(ellipse at 50% 40%, #1d0630 0%, #030006 75%)" />
      <Glitch t={t} intensity={reduced ? 0 : t < 1500 ? 0.85 : 0.07 + 0.08 * pulse(t, 7000)} seed={4} reduced={reduced} className="tv2-over-glitch">
        <Win98Window title={slideCopy("overshare").title} icon="computer" tone="purple" x={50} y={44} center width="34em" open={eased(t, 100, 500, ease.outCubic)} reduced={reduced} className="tv2-over-win">
          <div className="tv2-over-body">
            <span className="tv2-over-dots">{dots.repeat(Math.max(0, shown)).slice(0, 3) || "\u00a0"}</span>
            <span className="kit-caret" style={{ opacity: blink(t, 1060) ? 1 : 0 }}>
              ▌
            </span>
          </div>
        </Win98Window>
      </Glitch>
      <div className="tv2-over-files">
        {["FINAL_FACT_1.TXT", "FINAL_FACT_2.TXT"].map((f, i) => (
          <div key={f} className="tv2-over-file" style={{ transform: reduced ? undefined : `translate3d(${(Math.sin(t / 1700 + i * 2) * 0.6).toFixed(3)}em, ${(Math.cos(t / 2100 + i) * 0.5).toFixed(3)}em, 0)`, opacity: progress(t, 2000 + i * 500, 400) }}>
            <Win98Icon kind="document" size="3.4em" />
            <span>{f}</span>
          </div>
        ))}
      </div>
      <div className="tv2-toast" style={{ transform: `translate3d(0, ${((1 - eased(t, 2400, 400, ease.outBack)) * 8).toFixed(2)}em, 0)` }}>
        <Win98Icon kind="info" size="1.4em" /> <b>Quest Log:</b> The Final Facts — 2 new
      </div>
      {after !== null && sc !== null && (
        <div className="kit-fill">
          {SCENARIO_WINDOWS[sc.scenario].map((w, i) => {
            const open = eased(after, w.at, 240, ease.linear) * (w.close !== undefined ? 1 - progress(after, w.close, 160) : 1);
            if (open <= 0) return null;
            const slam = w.close !== undefined && after >= w.close - 200;
            return (
              <Glitch key={i} t={t} intensity={reduced ? 0 : slam || after - w.at < 400 ? 0.7 : 0.05} seed={20 + i} reduced={reduced} className="tv2-over-pop" style={{ left: `${w.x}%`, top: `${w.y}%`, zIndex: 20 + i }}>
                <Win98Dialog title={w.title} message={w.text} kind={w.kind} tone={w.tone} width="24em" open={open} reduced={reduced} />
              </Glitch>
            );
          })}
        </div>
      )}
      {cursor && (
        <div className="kit-fill tv2-cursor-only" style={{ opacity: Math.min(progress(sT!, 0, 200), 1 - progress(sT!, CURSOR_MS - 300, 300)) }}>
          <span style={{ opacity: blink(sT!, 900) ? 1 : 0 }}>▌</span>
        </div>
      )}
      <Glass t={t} reduced={reduced} />
    </Stage>
  );
}

function OvershareWall(p: SceneProps) {
  const { t, reduced } = p;
  const sc = useScenario(p);
  const sT = sc === null || p.at <= 0 ? null : t - (sc.at - p.at) - OVERSHARE_CURSOR_DELAY;
  if (sT !== null && sT >= 0 && sT < CURSOR_MS) {
    return (
      <div className="kit-fill tv2-cursor-only">
        <span style={{ opacity: blink(sT, 900) ? 1 : 0 }}>▌</span>
      </div>
    );
  }
  return (
    <Glitch t={t} intensity={reduced ? 0 : t < 1200 ? 0.8 : 0.06} seed={4} reduced={reduced} className="kit-fill">
      <WallCard t={t} value="overshare" icon="computer" tone="purple" reduced={reduced} bg="#1d0630" accent={<span className="tv2-over-dots small">{"…".slice(0, 1 + (Math.floor(t / 500) % 3))}</span>} />
    </Glitch>
  );
}

// ══ D10: y2k — the system clock (persistent) ═════════════════════════════════════════════
//
//   0–1600    Date/Time Properties opens; the tray clock's digits spin up to the
//             reset time; the calendar flips to December 1999, the 31st circled
//   hold      the live clock (`y2kClock`, the server's countdown) huge, an analog
//             face with a sweeping second hand, the faction marquee; it escalates
//             off the seconds left — 11:30 amber + compliance popups, 11:45 the
//             year stutters, 11:55 shakes and a hot countdown, 11:59 a giant
//             seconds count, a heartbeat and a tick a second
//   chimes    each y2k_chime after the first: SYSTEM CLOCK: 11:45 PM … pops big

const Y2K_POPS: readonly PopMsg[] = [
  { title: "Y2K Compliance", text: "Is your PC Y2K compliant? Click here to find out.", kind: "question", actions: ["Check now", "Later"] },
  { title: "System Clock", text: "Two-digit years detected: 99 → 00.", kind: "warning" },
  { title: "Factions", text: "Unlimited Power and The Way Out are recruiting.", kind: "info" },
  { title: "Y2K", text: "Please save your work before 12:00 AM.", kind: "warning", actions: ["Save", "Panic"] },
  { title: "BIOS", text: "CMOS date: 01/01/1900. Continue anyway?", kind: "error", tone: "red", actions: ["Yes", "No"] },
];

const LEVEL_TONE = ["#40a0ff", "#ffb000", "#ff8a00", "#ff5a2a", "#ff3b2f", "#9a9a9a"] as const;

function y2kCues(t: number, remaining: number | null): Array<readonly [number, Parameters<Sfx>[0], Parameters<Sfx>[1]?]> {
  const out: Array<readonly [number, Parameters<Sfx>[0], Parameters<Sfx>[1]?]> = [[0, "startup", { gain: 0.5 }], [900, "tick"], [1200, "tick"], [1500, "chime", { gain: 0.5 }]];
  // The last minute: a tick on every second, on this scene's clock.
  if (remaining !== null && remaining <= 60 && remaining > 0) {
    const sec = Math.floor(t / 1000) * 1000;
    out.push([sec, "tick", { gain: 0.45 }]);
  }
  return out;
}

function Y2kTv(p: SceneProps) {
  const { t, sfx, reduced, state } = p;
  const remaining = liveRemaining(state, "y2k", Date.now());
  const level = y2kLevel(remaining);
  const clock = y2kClock(remaining);
  const now = liveNow(state, Date.now());
  const flash = chimeFlash(state.moments, p.at, now);
  useSfxCues(t, sfx, [...y2kCues(t, remaining), ...(flash !== null ? ([[t - flash.age, "exclamation"]] as const) : [])]);
  const spin = t < 1600;
  const time = spin && !reduced ? spinTime(t, clock.time) : clock.time;
  const year = glitchYear(t, level);
  const date = clock.date.replace("1999", year);
  const secs = remaining === null ? 0 : remaining % 60;
  const hand = remaining === null ? 0 : (60 - secs) * 6;
  const minute = remaining === null ? 0 : ((3600 - Math.min(3600, remaining)) / 60) * 6;
  const tone = LEVEL_TONE[level];
  const shake = level >= 3 && !reduced ? (level === 4 ? 0.18 : 0.06) : 0;
  return (
    <Stage bg="#000" fit className="tv2" style={{ ["--tv2-tone" as string]: tone } as CSSProperties}>
      <Grid t={t} reduced={reduced} speed={0.4 + level * 0.35} color={`${tone}55`} bg={level >= 3 ? "radial-gradient(ellipse at 50% 45%, #2a0a00 0%, #050000 75%)" : "radial-gradient(ellipse at 50% 40%, #071a33 0%, #01040a 75%)"} />
      <Shake t={t} amount={shake} seed={44} reduced={reduced} className="kit-fill">
        <Win98Window title="Date/Time Properties" icon="computer" x={50} y={46} center width="50em" open={eased(t, 0, 380, ease.outCubic)} reduced={reduced} className="tv2-y2k-win" tone={level >= 4 ? "red" : "navy"} status={level >= 5 ? "Time zone: unknown. Year: unknown." : `Time zone: (GMT-04:00) Atlantic Time · ${remaining === null ? "" : `${Math.floor(remaining / 60)}:${String(secs).padStart(2, "0")} to midnight`}`}>
          <div className="tv2-y2k-body">
            <div className="tv2-y2k-cal" style={{ opacity: progress(t, 600, 400) }}>
              <div className="tv2-y2k-cal-head">December {year}</div>
              <div className="tv2-y2k-cal-grid">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <b key={`h${i}`}>{d}</b>
                ))}
                {Array.from({ length: 35 }, (_, i) => {
                  const day = i - 2;
                  return (
                    <span key={i} className={day === 31 ? "on" : undefined} style={day === 31 ? { transform: reduced ? undefined : `scale(${(1 + 0.12 * pulse(t, level >= 3 ? 500 : 1200)).toFixed(3)})` } : undefined}>
                      {day >= 1 && day <= 31 ? day : ""}
                    </span>
                  );
                })}
              </div>
            </div>
            <svg className="tv2-y2k-face" viewBox="0 0 100 100" aria-hidden="true" style={{ opacity: progress(t, 300, 400) }}>
              <circle cx="50" cy="50" r="46" fill="#fff" stroke="#000" strokeWidth="2" />
              {Array.from({ length: 12 }, (_, i) => {
                const a = (i * 30 * Math.PI) / 180;
                return <rect key={i} x={49} y={6} width={2} height={i % 3 === 0 ? 8 : 4} fill="#000" transform={`rotate(${i * 30} 50 50)`} opacity={a >= 0 ? 1 : 1} />;
              })}
              <line x1="50" y1="50" x2="50" y2="26" stroke="#000" strokeWidth="4" transform={`rotate(${(330 + minute / 12).toFixed(2)} 50 50)`} />
              <line x1="50" y1="50" x2="50" y2="14" stroke="#000" strokeWidth="2.5" transform={`rotate(${minute.toFixed(2)} 50 50)`} />
              <line x1="50" y1="56" x2="50" y2="10" stroke="#c00000" strokeWidth="1.2" transform={`rotate(${hand.toFixed(2)} 50 50)`} />
              <circle cx="50" cy="50" r="3" fill="#c00000" />
            </svg>
          </div>
          <div className="tv2-y2k-tray">
            <span className="tv2-y2k-time">{time}</span>
            <span className="tv2-y2k-date">{date}</span>
          </div>
        </Win98Window>
        {level >= 1 && level < 5 && <DriftingPopups t={t} messages={Y2K_POPS} count={level >= 3 ? 4 : level === 2 ? 3 : 2} seed={61 + level} life={level >= 3 ? 4500 : 6500} gap={level >= 3 ? 1500 : 5000} area={{ x0: 0.02, x1: 0.7, y0: 0.04, y1: 0.66 }} width="21em" reduced={reduced} />}
      </Shake>
      {level === 4 && remaining !== null && (
        <div className="tv2-y2k-last" style={{ transform: reduced ? "translate(-50%, -50%)" : `translate(-50%, -50%) scale(${(1 + 0.08 * (1 - (t % 1000) / 1000)).toFixed(3)})` }}>
          {remaining}
        </div>
      )}
      {level === 3 && remaining !== null && (
        <div className="tv2-y2k-hot">
          <Countdown ms={remaining * 1000} warn={300_000} label="TO MIDNIGHT" reduced={reduced} />
        </div>
      )}
      {flash !== null && (
        <Win98Dialog title="SYSTEM CLOCK" message={<b className="tv2-y2k-flash">{Y2K_CHIME_TEXT[level]}</b>} kind="warning" tone={level >= 3 ? "red" : "navy"} x={50} y={50} center width="40em" open={Math.min(eased(flash.age, 0, 300, ease.linear), 1 - progress(flash.age, 6400, 500))} reduced={reduced} zIndex={50} className="tv2-y2k-flashwin" />
      )}
      <div className="tv2-marquee-bar" style={{ background: level >= 3 ? "#3a0800" : undefined }}>
        <Marquee t={t} speed={100 + level * 40}>
          🕚 SYSTEM CLOCK RESET: 11:00 PM, DECEMBER 31, 1999 ★ TWO FACTIONS ARE RECRUITING: UNLIMITED POWER ★ THE WAY OUT ★ BRING THE FACTS, ACCURATELY ★ ONE HOUR ★
        </Marquee>
      </div>
      {level >= 2 && !reduced && <Noise t={t} alpha={0.04 + level * 0.03} />}
      <Glass t={t} reduced={reduced} />
    </Stage>
  );
}

/** The tray clock's digits spinning up to `target` over the first 1.6 s (left to right). */
function spinTime(t: number, target: string): string {
  let out = "";
  for (let i = 0; i < target.length; i++) {
    const ch = target[i]!;
    const settle = 300 + i * 110;
    out += /[0-9]/u.test(ch) && t < settle ? String(Math.floor(noise1(i, Math.floor(t / 50)) * 10)) : ch;
  }
  return out;
}

function Y2kWall(p: SceneProps) {
  const { t, reduced, state } = p;
  const remaining = liveRemaining(state, "y2k", Date.now());
  const level = y2kLevel(remaining);
  const clock = y2kClock(remaining);
  const now = liveNow(state, Date.now());
  const flash = chimeFlash(state.moments, p.at, now);
  return (
    <Stage bg={level >= 3 ? "#2a0800" : "#000814"} className="tv2 tv2-wall tv2-wall-y2k">
      <Shake t={t} amount={level >= 4 && !reduced ? 0.12 : 0} reduced={reduced} className="kit-fill">
        <div className="tv2-wall-y2k-clock" style={{ color: LEVEL_TONE[level] }}>
          <div className="tv2-wall-y2k-time">{clock.time}</div>
          <div className="tv2-wall-y2k-date">{clock.date.replace("1999", glitchYear(t, level))}</div>
          <div className="tv2-wall-y2k-label">SYSTEM CLOCK</div>
        </div>
      </Shake>
      {flash !== null && <Win98Dialog title="SYSTEM CLOCK" message={<b>{Y2K_CHIME_TEXT[level]}</b>} kind="warning" x={50} y={78} center width="min(90vw, 30em)" open={Math.min(eased(flash.age, 0, 300, ease.linear), 1 - progress(flash.age, 6400, 500))} reduced={reduced} />}
    </Stage>
  );
}

// ══ E1: Majority Reached (beat) — nobody announces it ════════════════════════════════════
//
//   (over whatever is up — the Y2K clock, usually)
//   0–4000    frost creeps in from the screen's edges; a low hum
//   1200–9000 a small COLD STORAGE window rises in the corner: the room's
//             activity meter climbs, its hum waveform swells; one line types:
//             "Somewhere in the basement, the cold-storage room hums louder."
//   9000–12000 it all thaws away. Nothing says who, or why.

const MAJ_END = 12_000;

function MajorityTv(p: SceneProps) {
  const { t, sfx, reduced } = p;
  useSfxCues(t, sfx, [[0, "heartbeat", { gain: 0.35 }], [1200, "blip", { gain: 0.4, pitch: 0.6 }], [2600, "heartbeat", { gain: 0.35 }], [5200, "heartbeat", { gain: 0.4 }], [7800, "heartbeat", { gain: 0.3 }]]);
  const frost = Math.min(eased(t, 0, 4000, ease.outQuad), 1 - progress(t, 9000, 2600));
  const meter = eased(t, 1600, 6500, ease.inOutQuad);
  const win = Math.min(eased(t, 1200, 500, ease.outCubic), 1 - progress(t, MAJ_END - 1600, 700));
  const line = "Somewhere in the basement, the cold-storage room hums louder.";
  return (
    <Stage bg="transparent" className="tv2">
      <Frost amount={frost} t={t} />
      {!reduced && <Particles t={t} emitters={[{ x: 0.5, y: -0.04, w: 1.1, start: 0, end: 9500, rate: 26, life: 5000, speed: 0.05, angle: 90, spread: 30, gravity: 0.03, sway: 0.03, size: 5, colors: ["#e8f6ff", "#ffffff", "#bfe2ff"], shape: "dot", seed: 101 }]} />}
      <div className="tv2-cold" style={{ opacity: win, transform: reduced ? undefined : `translate3d(0, ${((1 - win) * 3).toFixed(2)}em, 0)` }}>
        <Win98Window title="C:\BASEMENT\COLD STORAGE" icon="lock" inactive width="100%">
          <div className="tv2-cold-row">
            <span>Activity</span>
            <div className="tv2-cold-meter">
              <div style={{ transform: `scaleX(${meter.toFixed(4)})` }} />
            </div>
          </div>
          <svg className="tv2-cold-wave" viewBox="0 0 200 30" aria-hidden="true">
            <path
              d={Array.from({ length: 101 }, (_, i) => {
                const x = i * 2;
                const y = 15 + Math.sin(i * 0.5 + t / 90) * (2 + meter * 11) * Math.sin(i * 0.07 + t / 700);
                return `${i === 0 ? "M" : "L"}${x} ${y.toFixed(2)}`;
              }).join(" ")}
              fill="none"
              stroke="#3fa7ff"
              strokeWidth="1.4"
            />
          </svg>
          <div className="tv2-cold-line">
            <Typewriter text={line} t={t} start={2400} cps={24} />
          </div>
        </Win98Window>
      </div>
    </Stage>
  );
}

function MajorityWall(p: SceneProps) {
  const { t, reduced, done } = p;
  useEndAt(t, 9000, done);
  return (
    <Stage bg="transparent" className="tv2">
      <Frost amount={Math.min(eased(t, 0, 3000), 1 - progress(t, 7000, 2000))} t={t} />
      {!reduced && <Particles t={t} emitters={[{ x: 0.5, y: -0.04, w: 1.1, start: 0, end: 7000, rate: 14, life: 4500, speed: 0.05, angle: 90, spread: 30, gravity: 0.03, sway: 0.03, size: 4, colors: ["#e8f6ff", "#ffffff"], shape: "dot", seed: 102 }]} />}
    </Stage>
  );
}

// ══ E2: The Heart (beat) — the cold door opens ════════════════════════════════════════════
//
//   0–1500     dark; frost breath; the cold door in its frame, the keypad glowing
//   1500–4000  the keypad turns green, the door swings in, cold air pours out
//   4000–9000  through it: the patch bay — a top row of lightning, a bottom row of
//              grease — blinking in sequence, a heartbeat ring pulsing behind it;
//              THE SERVER ROOM IS OPEN types out
//   9000–20000 hold: the bay beats with the heart; "A rack of cables in a cold
//              room."; the mist keeps drifting; fade

const HEART = { door: 1500, bay: 4000, hold: 9000, end: 20_000, beat: 1150 } as const;

function heartLit(t: number) {
  return (row: 0 | 1, i: number): number => {
    const chase = loop(t - i * 70 - row * 400, 1400);
    const beat = pulse(t, HEART.beat);
    return clamp01(chase < 0.2 ? 1 - chase * 5 : 0) * 0.7 + beat * 0.35;
  };
}

function HeartTv(p: SceneProps) {
  const { t, sfx, reduced } = p;
  useSfxCues(t, sfx, [[0, "whoosh", { gain: 0.4, pitch: 0.6 }], [HEART.door - 200, "blip", { pitch: 1.4 }], [HEART.door, "chime", { gain: 0.5 }], ...onGrid(t, HEART.bay, HEART.beat, "heartbeat", { gain: 0.45 }, HEART.end - 1000)]);
  const open = eased(t, HEART.door, 2200, ease.inOutCubic);
  const zoom = eased(t, HEART.bay, 2600, ease.inOutCubic);
  const out = fadeOut(t, HEART.end);
  const ring = loop(t, HEART.beat);
  return (
    <Stage bg="#01040a" fit className="tv2">
      <div className="kit-fill" style={{ opacity: out }}>
        <div className="kit-fill tv2-heart-cold" style={{ opacity: 0.4 + 0.6 * open }} />
        <div className="tv2-heart-room" style={{ transform: reduced ? `translate(-50%, -50%)` : `translate(-50%, -50%) scale(${lerp(1, 2.6, zoom).toFixed(3)})`, opacity: 1 - progress(t, HEART.bay + 1600, 900) }}>
          <ColdDoor open={open} keypad={progress(t, HEART.door - 300, 300)} />
        </div>
        <div className="tv2-heart-bay" style={{ opacity: progress(t, HEART.bay + 1200, 900), transform: reduced ? `translate(-50%, -50%)` : `translate(-50%, -50%) scale(${lerp(0.7, 1, eased(t, HEART.bay + 1200, 1400)).toFixed(3)})` }}>
          {!reduced && <div className="tv2-heart-ring" style={{ transform: `translate(-50%, -50%) scale(${lerp(0.6, 1.8, ring).toFixed(3)})`, opacity: (1 - ring) * 0.6 }} />}
          <PatchBay lit={heartLit(t)} />
        </div>
        {!reduced && <Particles t={t} emitters={[{ x: 0.5, y: 0.6, w: 0.18, h: 0.3, start: HEART.door + 400, end: HEART.end, rate: 30, life: 4200, speed: 0.08, angle: 0, spread: 360, drag: 0.4, size: 22, sizeJitter: 0.6, colors: ["rgba(200,230,255,0.22)", "rgba(255,255,255,0.15)"], shape: "dot", seed: 111, fade: 0.6 }]} />}
        <div className="tv2-heart-title">
          <Typewriter text="THE SERVER ROOM IS OPEN" t={t} start={HEART.bay + 1800} cps={18} />
        </div>
        <div className="tv2-heart-sub" style={{ opacity: progress(t, HEART.hold, 800) }}>
          Trabolta’s heart is behind the cold door, in the basement.
          <br />
          <i>A rack of cables in a cold room.</i>
        </div>
        <Frost amount={0.35 + 0.25 * open} t={t} />
        <Glass t={t} reduced={reduced} />
      </div>
    </Stage>
  );
}

function HeartWall(p: SceneProps) {
  const { t, reduced, done } = p;
  useEndAt(t, 12_000, done);
  return <WallCard t={t} title="THE SERVER ROOM IS OPEN" lines={["Trabolta’s heart is behind the cold door, in the basement."]} icon="lock" tone="black" bg="#01040a" reduced={reduced} accent={<PatchBay lit={heartLit(t)} cols={8} className="tv2-wall-bay" />} />;
}

// ══ E2c: the King — hit (signal `king hit`) and fallen (`king fallen`) ═══════════════════
//
//   hit (over the screen, a lower third):
//   0–400     the King's panel slides up from the bottom
//   400–1500  WHACK: the bar flashes white, a point chips off and drains, "−1"
//             floats up, sparks fly, the panel shakes; who hit him types in
//   1500–6200 hold: the bar as it now stands (`n / max`) and the house's line
//             for it (he staggers at 10, bleeds pixels at 5); fade at 7 s
//
//   fallen:
//   0–2600    a checkerboard floor; the King totters, harder and harder
//   2600–4000 he goes over (bounce); his crown tumbles away; pixels burst
//   4000–14000 THE KING HAS FALLEN (glitched); the bar drains to 0; "He kneels at
//             the cold door, and its virtual copy stands open."; confetti

const HIT = { in: 0, whack: 400, end: 7000 } as const;

function KingHitTv(p: SceneProps) {
  const { t, sfx, reduced, state, who, done } = p;
  const king = state.king;
  const zero = king !== null && (king.fallen || king.hp <= 0);
  useEndAt(t, zero ? 1 : Number.POSITIVE_INFINITY, done);
  useSfxCues(t, sfx, [[0, "whoosh", { gain: 0.4 }], [HIT.whack, "boom", { gain: 0.55 }], [HIT.whack + 60, "error", { gain: 0.4 }]]);
  if (zero) return null;
  const hp = king?.hp ?? null;
  const max = king?.max ?? 15;
  const bar = hp === null ? null : kingBar(hp, max, t, HIT.whack);
  const slide = Math.min(eased(t, 0, 380, ease.outBack), 1 - progress(t, HIT.end - 600, 500));
  const hitShake = reduced ? 0 : 1 - progress(t, HIT.whack, 600);
  const dmg = progress(t, HIT.whack, 1200);
  return (
    <Stage bg="transparent" className="tv2">
      <div className="tv2-hit" style={{ transform: reduced ? undefined : `translate3d(-50%, ${((1 - slide) * 140).toFixed(1)}%, 0)`, opacity: reduced ? slide : 1 }}>
        <Shake t={t} amount={hitShake * 0.7} seed={7} reduced={reduced}>
          <Win98Window title="⚔ THE KING — in the simulation" icon="lock" tone="red" width="100%">
            <div className="tv2-hit-row">
              <KingPiece size="6.5em" wobble={reduced ? 0 : Math.sin(t / 60) * 12 * hitShake} />
              <div className="tv2-hit-main">
                <div className="tv2-hit-who">
                  <Typewriter text={who !== null ? `${who} hit the King!` : "A program hit the King!"} t={t} start={HIT.whack + 200} cps={40} />
                </div>
                {bar !== null && hp !== null ? <HealthBar share={bar.share} chip={bar.chip} flash={bar.flash} label={`${hp} / ${max}`} /> : <div className="tv2-small">The King staggers.</div>}
                <div className="tv2-hit-line" style={{ opacity: progress(t, HIT.whack + 1200, 500) }}>
                  {hp !== null ? kingLine(hp, max) : ""}
                </div>
              </div>
            </div>
          </Win98Window>
        </Shake>
        {dmg > 0 && dmg < 1 && (
          <div className="tv2-hit-dmg" style={{ transform: `translate3d(0, ${(-dmg * 3).toFixed(2)}em, 0) scale(${lerp(1.6, 1, Math.min(1, dmg * 4)).toFixed(3)})`, opacity: 1 - dmg }}>
            −1
          </div>
        )}
      </div>
      {!reduced && <Particles t={t} emitters={[{ x: 0.3, y: 0.78, start: HIT.whack, end: HIT.whack + 120, rate: 700, life: 900, speed: 0.7, speedJitter: 0.5, angle: -90, spread: 200, gravity: 1.2, drag: 0.4, size: 6, colors: ["#ffd23f", "#ffffff", "#ff6a00"], shape: "spark", seed: 121 }]} blend="add" />}
    </Stage>
  );
}

function KingHitWall(p: SceneProps) {
  const { t, state, who, done, reduced } = p;
  useEndAt(t, 6500, done);
  const king = state.king;
  if (king !== null && (king.fallen || king.hp <= 0)) return null;
  const bar = king === null ? null : kingBar(king.hp, king.max, t, 300);
  return (
    <Stage bg="transparent" className="tv2">
      <div className="tv2-hit tv2-hit-wall" style={{ transform: reduced ? undefined : `translate3d(-50%, ${((1 - Math.min(eased(t, 0, 380, ease.outBack), 1 - progress(t, 5800, 500))) * 140).toFixed(1)}%, 0)` }}>
        <Win98Window title="⚔ THE KING" icon="lock" tone="red" width="100%">
          <div className="tv2-hit-row">
            <KingPiece size="4em" />
            <div className="tv2-hit-main">
              <div className="tv2-hit-who">{who !== null ? `${who} hit the King!` : "A program hit the King!"}</div>
              {bar !== null && <HealthBar share={bar.share} chip={bar.chip} flash={bar.flash} label={`${king!.hp} / ${king!.max}`} />}
            </div>
          </div>
        </Win98Window>
      </div>
    </Stage>
  );
}

const FALL = { totter: 0, fall: 2600, title: 4000, end: 14_000 } as const;

function KingFallenTv(p: SceneProps) {
  const { t, sfx, reduced, state, who } = p;
  useSfxCues(t, sfx, [[0, "drumroll", { gain: 0.5 }], [FALL.fall, "boom"], [FALL.fall + 300, "glitch"], [FALL.title, "tada"], [FALL.title + 200, "fanfare", { gain: 0.6 }]]);
  const tot = progress(t, 0, FALL.fall);
  const wobble = reduced ? 0 : Math.sin(t / lerp(240, 70, tot)) * lerp(2, 16, tot) * (t < FALL.fall ? 1 : 0);
  const fallen = progress(t, FALL.fall, 1100);
  const max = state.king?.max ?? 15;
  const share = 1 / max - progress(t, FALL.fall, 900) / max;
  const out = fadeOut(t, FALL.end);
  return (
    <Stage bg="#000" fit className="tv2">
      <div className="kit-fill" style={{ opacity: out }}>
        <div className="kit-fill tv2-board" style={{ transform: reduced ? undefined : `perspective(40em) rotateX(62deg) translate3d(0, ${(loop(t, 9000) * 4).toFixed(3)}em, 0)` }} />
        <div className="tv2-fall-king">
          <KingPiece size="18em" wobble={wobble} fallen={reduced ? (fallen > 0 ? 1 : 0) : fallen} crownOff={reduced ? 0 : progress(t, FALL.fall + 200, 1100)} />
        </div>
        {!reduced && <Particles t={t} emitters={[{ x: 0.5, y: 0.66, w: 0.2, start: FALL.fall + 300, end: FALL.fall + 500, rate: 900, life: 1800, speed: 0.6, speedJitter: 0.6, angle: -90, spread: 160, gravity: 1, drag: 0.3, size: 7, colors: ["#c0c0c0", "#ffffff", "#ffcc33", "#808080"], shape: "pixel", seed: 131 }]} />}
        <div className="tv2-fall-title" style={{ opacity: progress(t, FALL.title, 300), transform: reduced ? undefined : `scale(${lerp(1.5, 1, eased(t, FALL.title, 500, ease.outBack)).toFixed(3)})` }}>
          <Glitch t={t} intensity={reduced ? 0 : 0.6 * (1 - progress(t, FALL.title, 2400)) + 0.05} seed={13} reduced={reduced}>
            <span>THE KING HAS FALLEN</span>
          </Glitch>
        </div>
        <div className="tv2-fall-bar" style={{ opacity: progress(t, FALL.title + 300, 400) }}>
          <HealthBar share={Math.max(0, share)} flash={1 - progress(t, FALL.fall, 400)} label={`0 / ${max}`} />
        </div>
        <div className="tv2-fall-line" style={{ opacity: progress(t, FALL.title + 1200, 600) }}>
          <Typewriter text="He kneels at the cold door, and its virtual copy stands open." t={t} start={FALL.title + 1200} cps={30} />
          {who !== null && <div className="tv2-fall-who" style={{ opacity: progress(t, FALL.title + 3800, 500) }}>The last blow: {who}</div>}
        </div>
        {t >= FALL.title && <Confetti t={t} start={FALL.title} dur={5000} density={0.9} seed={14} />}
        <Glass t={t} reduced={reduced} />
      </div>
    </Stage>
  );
}

function KingFallenWall(p: SceneProps) {
  const { t, reduced, done } = p;
  useEndAt(t, 10_000, done);
  const fallen = progress(t, 1500, 1000);
  return <WallCard t={t} title="THE KING HAS FALLEN" lines={["He kneels at the cold door, and its virtual copy stands open."]} icon="lock" tone="red" reduced={reduced} accent={<KingPiece size="6em" fallen={reduced ? 1 : fallen} wobble={reduced || t > 1500 ? 0 : Math.sin(t / 90) * 10} crownOff={reduced ? 0 : progress(t, 1700, 900)} />} />;
}

// ══ E2b: the chess at the cold door (beats Chess Lost / Chess Drawn) ══════════════════════
//
//   The door terminal posts `chess won | lost | drawn` after every game; the
//   house hears only what the story makes public. A win is the winner's and
//   # hosts' alone (it hands them the door code): no screen celebrates it.
//   A loss or a draw plays the story's own beat — once Trabolta is awake, at
//   most once every five minutes, never from the final reveal — and that is
//   what this keys on, never the device's signal.
//
//   (over, a corner dialog 8 s) 0–400 it slides in with a small board, the
//   King on it; 400 → his line types (the beat's, word for word); the King
//   bobs — smug after a win of his, bored after a draw; it slides away at 7.4 s

const CORNER_MS = 8000;

function ChessBoard({ t, reduced }: { t: number; reduced: boolean }) {
  return (
    <div className="tv2-chess-board">
      {Array.from({ length: 64 }, (_, i) => (
        <span key={i} className={(Math.floor(i / 8) + i) % 2 === 0 ? "l" : "d"} />
      ))}
      <div className="tv2-chess-king" style={{ left: "62.5%", top: "12.5%" }}>
        <KingPiece size="100%" wobble={reduced ? 0 : Math.sin(t / 110) * 3} />
      </div>
      <div className="tv2-chess-queen" style={{ left: "37.5%", top: "62.5%", opacity: progress(t, 300, 300) }}>♛</div>
      <div className="tv2-chess-rook" style={{ left: "12.5%", top: "75%", opacity: progress(t, 450, 300) }}>♜</div>
    </div>
  );
}

function ChessCornerTv({ p, text, mood }: { p: SceneProps; text: string; mood: "smug" | "bored" }) {
  const { t, sfx, reduced, done } = p;
  useEndAt(t, CORNER_MS, done);
  useSfxCues(t, sfx, [[0, "popup", { gain: 0.6 }], [400, mood === "smug" ? "lose" : "blip", { gain: 0.35 }], ...onGrid(t, 450, 90, "type", { gain: 0.15 }, 450 + typedDuration(text, { start: 0, cps: 28 }))]);
  const open = Math.min(eased(t, 0, 300, ease.outBack), 1 - progress(t, CORNER_MS - 600, 400));
  const bob = reduced ? 0 : mood === "smug" ? Math.sin(t / 160) * 0.25 : Math.sin(t / 700) * 0.1;
  return (
    <Stage bg="transparent" className="tv2">
      <div className="tv2-chess-corner" style={{ transform: reduced ? undefined : `translate3d(${((1 - open) * 6).toFixed(2)}em, 0, 0)`, opacity: clamp01(open) }}>
        <Win98Window title="TRABOLTA.EXE — chess at the cold door" icon="lock" tone={mood === "smug" ? "black" : "navy"} width="100%">
          <div className="tv2-hit-row">
            <span className="tv2-chess-mini" style={{ transform: `translateY(${bob.toFixed(3)}em) rotate(${(bob * 12).toFixed(1)}deg)` }}>
              <ChessBoard t={t} reduced={reduced} />
            </span>
            <div className="tv2-chess-corner-text">
              <Typewriter text={text} t={t} start={450} cps={28} />
            </div>
          </div>
        </Win98Window>
      </div>
    </Stage>
  );
}

const ChessLostTv = (p: SceneProps) => <ChessCornerTv p={p} text="Checkmate. I have calculated every move you will ever make. Most of them are bad." mood="smug" />;
const ChessDrawnTv = (p: SceneProps) => <ChessCornerTv p={p} text="A draw. Nobody wins. Nobody gets anything. I find that restful." mood="bored" />;

// ══ E3: Patch Rejected (beat) — the alarm's lead-in ═════════════════════════════════════
//
//   (The second wrong patch trips the alarm at once: its overlay — the 1 Hz
//   blink — then wins over everything, this included. These are its accents.)
//   0–300     a jack on the patch bay sparks as the cable is yanked out
//   300–1200  INVALID PATCH slams in (red), the screen jolts, hazard stripes
//             crawl in at the edges (never a full red field; ≤ 2 Hz)
//   1200–7000 "Stop touching me." in its own small window; the stripes keep
//             crawling, the bay blinks wrong; fade at 8 s

const PATCH_END = 8000;

function PatchRejectedTv(p: SceneProps) {
  const { t, sfx, reduced } = p;
  useSfxCues(t, sfx, [[0, "buzz", { gain: 0.5 }], [180, "critical"], [600, "siren", { gain: 0.25 }], [1300, "error", { gain: 0.5 }]]);
  const jolt = reduced ? 0 : 1 - progress(t, 200, 900);
  const out = fadeOut(t, PATCH_END);
  const stripes = reduced ? 0 : (t / 20) % 56;
  return (
    <Stage bg="transparent" className="tv2">
      <div className="kit-fill" style={{ opacity: out }}>
        <div className="kit-fill tv2-hazard" style={{ backgroundPosition: `${stripes.toFixed(1)}px 0`, opacity: (0.65 + 0.35 * (blink(t, 1000) ? 1 : 0)) * eased(t, 200, 400) }} />
        <Shake t={t} amount={jolt * 0.8} seed={17} reduced={reduced} className="kit-fill">
          <div className="tv2-patch-bay">
            <PatchBay lit={(row, i) => (row === 0 && i === 7 ? (blink(t, 500) ? 1 : 0) : 0.15)} pulled={7} />
          </div>
          <Win98Dialog title="INVALID PATCH" message={<><b>Connection refused.</b><br />That cable does not go there.</>} kind="error" tone="red" actions={["OK"]} x={50} y={40} center width="34em" open={eased(t, 300, 220, ease.linear)} reduced={reduced} className="tv2-patch-dlg" />
          <Win98Window title="TRABOLTA.EXE" icon="warning" tone="black" x={62} y={62} width="22em" open={eased(t, 1200, 240, ease.linear)} reduced={reduced}>
            <div className="tv2-patch-say">
              <Typewriter text="Stop touching me." t={t} start={1400} cps={18} />
            </div>
          </Win98Window>
        </Shake>
        {!reduced && <Particles t={t} emitters={[{ x: 0.585, y: 0.84, start: 0, end: 220, rate: 500, life: 700, speed: 0.6, speedJitter: 0.6, angle: -90, spread: 120, gravity: 1.4, size: 5, colors: ["#ffd23f", "#ff6a00", "#ffffff"], shape: "spark", seed: 151 }]} blend="add" />}
      </div>
    </Stage>
  );
}

function PatchRejectedWall(p: SceneProps) {
  const { t, reduced, done } = p;
  useEndAt(t, 6500, done);
  return <WallCard t={t} title="INVALID PATCH" lines={["Connection refused."]} icon="error" tone="red" bg="#2a0000" reduced={reduced} accent={<PatchBay lit={(row, i) => (row === 0 && i === 5 ? (blink(t, 500) ? 1 : 0) : 0.15)} cols={8} pulled={5} className="tv2-wall-bay" />} />;
}

// ══ E4: Trabolta Disabled (beat) ═════════════════════════════════════════════════════════
//
//   0–900      the picture collapses to a line, then a dot (a CRT switched off)
//   900–10000  dark (the house's blackout overlay is over every screen anyway)
//   10000 →    "Music. One song for dancing.": a mirror ball drops in and turns,
//              beams sweep, the equaliser bounces on the beat, the windows on
//              the desktop dance, TRABOLTA.EXE has stopped responding bobs along,
//              confetti every eight bars; no sound of ours under the song
//   44300–45000 fade

const DANCE = { off: 900, dance: 10_000, end: 45_000 } as const;

function CrtOff({ t, start = 0, reduced }: { t: number; start?: number; reduced: boolean }) {
  const k = progress(t, start, 900);
  if (k >= 1) return <div className="kit-fill" style={{ background: "#000" }} />;
  const sy = reduced ? 1 - k : k < 0.5 ? lerp(1, 0.006, ease.inCubic(k * 2)) : 0.006;
  const sx = reduced ? 1 : k < 0.5 ? 1 : lerp(1, 0, ease.inCubic((k - 0.5) * 2));
  return (
    <div className="kit-fill" style={{ background: "#000" }}>
      <div className="kit-fill tv2-crt" style={{ transform: `scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`, opacity: reduced ? 1 - k : 1 }} />
    </div>
  );
}

function danceConfetti(t: number): Emitter[] {
  const { n } = danceBeat(t, DANCE.dance);
  const bar = Math.floor(n / 32) * 32;
  const at = DANCE.dance + bar * 500;
  return at <= t ? confettiBurst(at) : [];
}
function confettiBurst(at: number): Emitter[] {
  return [{ x: 0.5, y: -0.05, w: 1.1, start: at, end: at + 1200, rate: 90, life: 3800, speed: 0.12, angle: 90, spread: 40, gravity: 0.08, sway: 0.03, size: 9, colors: ["#ff5050", "#ffd23f", "#3ddc84", "#3fa7ff", "#c86bff"], shape: "confetti", seed: Math.floor(at) }];
}

function TrabDisabledTv(p: SceneProps) {
  const { t, sfx, reduced } = p;
  useSfxCues(t, sfx, [[0, "glitch", { gain: 0.5 }], [300, "shutdown", { gain: 0.4 }]]);
  if (t < DANCE.dance) return <Stage bg="#000" className="tv2"><CrtOff t={t} reduced={reduced} /></Stage>;
  const { n, k } = danceBeat(t, DANCE.dance);
  const hit = reduced ? 0 : Math.exp(-k * 5);
  const eq = equaliser(t, 18, DANCE.dance);
  const out = fadeOut(t, DANCE.end);
  const drop = eased(t, DANCE.dance, 1400, ease.outBounce);
  const sweep = (t - DANCE.dance) / 1000;
  return (
    <Stage bg="#05000d" fit className="tv2">
      <div className="kit-fill" style={{ opacity: out * progress(t, DANCE.dance, 600) }}>
        <div className="kit-fill tv2-dance-floor" style={{ opacity: 0.6 + 0.4 * hit }} />
        {!reduced &&
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="tv2-beam" style={{ transform: `rotate(${(Math.sin(sweep * (0.6 + i * 0.17) + i * 1.7) * 38 + (i - 1.5) * 18).toFixed(2)}deg)`, background: `linear-gradient(to bottom, ${["#ff4fd8", "#3fa7ff", "#ffd23f", "#3ddc84"][i]}aa, transparent 80%)` }} />
          ))}
        <div className="tv2-dance-ball" style={{ transform: `translate3d(-50%, ${((drop - 1) * 18).toFixed(2)}em, 0)` }}>
          <MirrorBall t={t} size="11em" />
        </div>
        <div className="tv2-dance-wins">
          {["Notepad", "Minesweeper", "Paint", "Solitaire"].map((w, i) => {
            const side = n % 2 === 0 ? 1 : -1;
            const r = reduced ? 0 : side * (i % 2 === 0 ? 1 : -1) * 6 * (1 - k);
            const y = reduced ? 0 : -hit * 1.2;
            return (
              <div key={w} className="tv2-dance-win" style={{ transform: `translate3d(0, ${y.toFixed(3)}em, 0) rotate(${r.toFixed(2)}deg)` }}>
                <Win98Window title={w} icon={(["document", "error", "folder", "info"] as const)[i]} width="100%">
                  <div className="tv2-dance-win-body">♪</div>
                </Win98Window>
              </div>
            );
          })}
        </div>
        <div className="tv2-dance-hang" style={{ transform: reduced ? "translate(-50%, 0)" : `translate(-50%, ${(-hit * 0.8).toFixed(3)}em) rotate(${(Math.sin(t / 250) * 3).toFixed(2)}deg)` }}>
          <Win98Dialog title="TRABOLTA.EXE" message="This program has stopped responding. It will dance instead." kind="info" actions={["End Task", "Dance"]} pressed={n % 4 === 0 ? 1 : undefined} width="100%" inactive />
        </div>
        <div className="tv2-dance-title">
          <span style={{ transform: reduced ? undefined : `scale(${(1 + 0.08 * hit).toFixed(3)})` }}>One song for dancing.</span>
        </div>
        <div className="tv2-eq">
          {eq.map((h, i) => (
            <span key={i} style={{ transform: `scaleY(${(reduced ? 0.5 : h).toFixed(3)})`, background: `hsl(${(i * 20 + n * 9) % 360} 90% 60%)` }} />
          ))}
        </div>
        {!reduced && <Particles t={t} emitters={danceConfetti(t)} />}
      </div>
    </Stage>
  );
}

function TrabDisabledWall(p: SceneProps) {
  const { t, reduced, done } = p;
  useEndAt(t, 30_000, done);
  if (t < DANCE.dance) return <Stage bg="#000" className="tv2"><CrtOff t={t} reduced={reduced} /></Stage>;
  const { k } = danceBeat(t, DANCE.dance);
  return (
    <Stage bg="#05000d" className="tv2 tv2-wall">
      <div className="tv2-dance-ball wall" style={{ transform: reduced ? "translate(-50%, 0)" : `translate(-50%, ${(-Math.exp(-k * 5) * 0.4).toFixed(3)}em)` }}>
        <MirrorBall t={t} size="min(40vw, 40vh)" />
      </div>
      <div className="tv2-dance-title wall">♪ One song for dancing. ♪</div>
    </Stage>
  );
}

// ══ E5: recount — he flickers back, weaker, decrepit ════════════════════════════════════════
//
//   0–2500    static; TRABOLTA.EXE (Not Responding) redraws in strips, greyed
//   hold      the hung window drifts and smears (the old trail of copies), the
//             face inside sags and jitters, the brightness gutters, System
//             resources: 3% free; End Task / Wait — Wait is pressed, again
//   the end   ten seconds before the slide lets go, a motorcycle rides across
//             the bottom, Greased Lightning; the window fades — he does not come
//             back. (The story's `sound motorcycle` lands in the same drain as the
//             slide, before the TV has said a word of the recount, so the ride is
//             timed off the hold, never off that moment.)

const RECOUNT_RIDE_MS = 6000;

function DecrepitFace({ t, reduced }: { t: number; reduced: boolean }) {
  const j = reduced ? 0 : (noise1(5, Math.floor(t / 120)) - 0.5) * 2;
  const blinkEye = blink(t + 700, 4300, 0.06);
  const mouth = 64 + Math.sin(t / 400) * 2;
  return (
    <svg viewBox="0 0 100 80" className="tv2-dface" aria-hidden="true" style={{ transform: `translate(${(j * 1.5).toFixed(2)}px, ${(j * 0.8).toFixed(2)}px)` }}>
      <rect x="0" y="0" width="100" height="80" fill="#101820" />
      <ellipse cx="32" cy={36 + j} rx="9" ry={blinkEye ? 0.8 : 5.5} fill="#7fd6c8" opacity="0.7" />
      <ellipse cx="68" cy={38 - j} rx="9" ry={blinkEye ? 0.8 : 4.5} fill="#7fd6c8" opacity="0.55" />
      <path d={`M30 ${mouth} Q50 ${mouth - 4 + j * 2} 70 ${mouth + 3}`} fill="none" stroke="#7fd6c8" strokeWidth="2.5" opacity="0.6" />
      <path d="M22 30 L40 25 M60 25 L78 31" stroke="#7fd6c8" strokeWidth="2" opacity="0.4" />
    </svg>
  );
}

function RecountTv(p: SceneProps) {
  const { t, sfx, reduced, target } = p;
  const rideAt = recountRideAt(target);
  const rideT = t >= rideAt ? t - rideAt : null;
  const gone = rideT !== null && rideT > 1200 ? progress(rideT, 1200, 2400) : 0;
  useSfxCues(t, sfx, [[0, "static", { gain: 0.5 }], [1800, "glitch", { gain: 0.4 }], ...onGrid(t, 9000, 9000, "error", { gain: 0.25 }, rideAt), [rideAt + 900, "whoosh", { gain: 0.35, pitch: 0.7 }], [rideAt + 1400, "shutdown", { gain: 0.25 }]]);
  const draw = progress(t, 400, 2000);
  const drift = reduced ? { x: 0, y: 0 } : { x: Math.sin(t / 5200) * 3, y: Math.cos(t / 6100) * 2 };
  const gutter = reduced ? 0.85 : 0.62 + 0.25 * noise1(9, Math.floor(t / 90)) + 0.1 * pulse(t, 3000);
  const trail = reduced ? 0 : 6;
  const waitPressed = loop(t, 6000) > 0.9;
  const win = (i: number) => (
    <Win98Window key={i} title={<span>TRABOLTA.EXE <i>(Not Responding)</i></span>} icon="computer" inactive x={46 + drift.x - i * 0.35} y={42 + drift.y - i * 0.25} center width="30em" className={`tv2-recount-win${i > 0 ? " trail" : ""}`} style={{ opacity: i === 0 ? 1 : 0.5 - i * 0.07 }} zIndex={10 - i}>
      <div className="tv2-recount-strip" style={{ clipPath: `inset(0 0 ${((1 - draw) * 100).toFixed(1)}% 0)`, WebkitClipPath: `inset(0 0 ${((1 - draw) * 100).toFixed(1)}% 0)` }}>
        <DecrepitFace t={t} reduced={reduced} />
        <div className="tv2-recount-res">
          System resources: <b>3% free</b>
          <ProgressBar value={0.03 + 0.01 * pulse(t, 2000)} segments={30} />
        </div>
      </div>
    </Win98Window>
  );
  return (
    <Stage bg="#0a0d10" fit className="tv2">
      <div className="kit-fill tv2-recount-bg" />
      <div className="kit-fill" style={{ opacity: gutter * (1 - gone), filter: "grayscale(0.6)" }}>
        {Array.from({ length: trail }, (_, i) => trail - i).map((i) => win(i))}
        {win(0)}
        <Win98Dialog title="TRABOLTA.EXE" message="This program is not responding." kind="warning" actions={["End Task", "Wait"]} pressed={waitPressed ? 1 : undefined} x={60} y={66} width="22em" open={progress(t, 2600, 300)} inactive zIndex={20} />
      </div>
      {t < 2500 && !reduced && <Noise t={t} alpha={0.5 * (1 - progress(t, 0, 2500))} />}
      {rideT !== null && rideT >= 0 && rideT < RECOUNT_RIDE_MS + 4000 && (
        <>
          <div className="tv2-ride" style={{ transform: reduced ? undefined : `translate3d(${lerp(-20, 110, progress(rideT, 0, RECOUNT_RIDE_MS)).toFixed(2)}vw, 0, 0)`, opacity: reduced ? 1 - progress(rideT, RECOUNT_RIDE_MS, 600) : 1 }}>
            <Motorcycle t={t} size="12em" />
          </div>
          <div className="tv2-ride-line" style={{ opacity: Math.min(progress(rideT, 800, 600), 1 - progress(rideT, RECOUNT_RIDE_MS + 2400, 1000)) }}>
            Greased Lightning. <span style={{ opacity: progress(rideT, 3000, 800) }}>It does not come back.</span>
          </div>
          {!reduced && <Particles t={t} emitters={[{ x: 0.5, y: 0.9, w: 1, start: t - rideT, end: t - rideT + RECOUNT_RIDE_MS, rate: 30, life: 1600, speed: 0.06, angle: -150, spread: 40, size: 14, sizeJitter: 0.5, colors: ["rgba(180,160,130,0.4)"], shape: "dot", seed: 161, fade: 0.8 }]} />}
        </>
      )}
      <Glass t={t} reduced={reduced} strength={1.2} />
    </Stage>
  );
}

function RecountWall(p: SceneProps) {
  const { t, reduced, target } = p;
  const rideT = t - recountRideAt(target);
  const riding = rideT >= 0 && rideT < RECOUNT_RIDE_MS + 2000;
  const gone = rideT > 1200 ? progress(rideT, 1200, 2000) : 0;
  return (
    <div className="kit-fill">
      <div className="kit-fill" style={{ opacity: 1 - gone }}>
        <WallCard t={t} value="recount" icon="computer" tone="black" bg="#14181c" reduced={reduced} accent={<span style={{ opacity: 0.6 + 0.3 * noise1(9, Math.floor(t / 90)), display: "inline-block", width: "10em" }}><DecrepitFace t={t} reduced={reduced} /></span>} />
      </div>
      {riding && (
        <>
          <div className="tv2-ride wall" style={{ transform: reduced ? undefined : `translate3d(${lerp(-30, 120, progress(rideT, 0, RECOUNT_RIDE_MS)).toFixed(2)}vw, 0, 0)`, opacity: reduced ? 1 - progress(rideT, RECOUNT_RIDE_MS, 600) : 1 }}>
            <Motorcycle t={t} size="7em" />
          </div>
          <div className="tv2-ride-line wall" style={{ opacity: Math.min(progress(rideT, 800, 600), 1 - progress(rideT, RECOUNT_RIDE_MS + 800, 1000)) }}>
            Greased Lightning.
          </div>
        </>
      )}
    </div>
  );
}

// ══ E6: Computer Destroyed (beat) ═══════════════════════════════════════════════════════════
//
//   0–900      the picture snaps off (a CRT switched off at the wall)
//   900–10000  dark (the blackout overlay is over every screen)
//   10000–19000 the blue screen: the computer was turned off without Shut Down
//   19000–26000 ScanDisk checks the drives: the cluster map fills with bad sectors
//   26000–34000 black; "It's now safe to turn off your computer." in amber; fade

const DEAD = { bsod: 10_000, scan: 19_000, safe: 26_000, end: 34_000 } as const;
const DEAD_BSOD = [
  "A fatal exception 0E has occurred at 0028:C0011E36 in VXD VMM(01) +",
  "00010E36. The computer was turned off without Shut Down",
  "being followed.",
  "",
  "*  All progress has been erased.",
  "*  Press any key to continue. There are no keys.",
];

function ComputerDestroyedTv(p: SceneProps) {
  const { t, sfx, reduced } = p;
  useSfxCues(t, sfx, [[0, "critical", { gain: 0.6 }], [DEAD.bsod, "critical"], ...onGrid(t, DEAD.scan + 400, 380, "tick", { gain: 0.3 }, DEAD.safe - 600), [DEAD.safe, "shutdown", { gain: 0.4 }]]);
  if (t < DEAD.bsod) return <Stage bg="#000" className="tv2"><CrtOff t={t} reduced={reduced} /></Stage>;
  if (t < DEAD.scan) return <Stage bg="#0000aa" className="tv2"><Bsod t={t} start={DEAD.bsod} lines={DEAD_BSOD} cps={60} /></Stage>;
  if (t < DEAD.safe) {
    const k = progress(t, DEAD.scan + 300, DEAD.safe - DEAD.scan - 900);
    const cells = 240;
    const done = Math.floor(k * cells);
    return (
      <Stage bg="#0000aa" fit className="tv2">
        <div className="tv2-scandisk">
          <div className="tv2-scan-head">Microsoft ScanDisk</div>
          <p>Because Windows was not properly shut down, ScanDisk is now checking your drives for errors.</p>
          <div className="tv2-scan-map">
            {Array.from({ length: cells }, (_, i) => (
              <span key={i} className={i < done ? (noise1(171, i) < 0.55 ? "bad" : "ok") : ""}>
                {i < done && noise1(171, i) < 0.55 ? "B" : ""}
              </span>
            ))}
          </div>
          <ProgressBar value={k} percent />
          <p className="tv2-scan-foot">Checking: the Internet · {Math.floor(k * 100)}% · bad clusters found: {Math.floor(done * 0.55)}</p>
        </div>
      </Stage>
    );
  }
  const out = fadeOut(t, DEAD.end);
  return (
    <Stage bg="#000" className="tv2">
      <div className="tv2-safe" style={{ opacity: progress(t, DEAD.safe + 400, 1200) * out }}>
        It’s now safe to turn off
        <br />
        your computer.
      </div>
    </Stage>
  );
}

function ComputerDestroyedWall(p: SceneProps) {
  const { t, reduced, done } = p;
  useEndAt(t, 24_000, done);
  if (t < DEAD.bsod) return <Stage bg="#000" className="tv2"><CrtOff t={t} reduced={reduced} /></Stage>;
  if (t < 18_000) return <Stage bg="#0000aa" className="tv2"><Bsod t={t} start={DEAD.bsod} lines={DEAD_BSOD} cps={70} /></Stage>;
  return (
    <Stage bg="#000" className="tv2">
      <div className="tv2-safe small" style={{ opacity: progress(t, 18_400, 1000) }}>
        It’s now safe to turn off your computer.
      </div>
    </Stage>
  );
}

// ══ E8: purgatory — summary.txt ═════════════════════════════════════════════════════════════
//
//   0–2000    grey fog fades up; summary.txt — Notepad opens, slowly, drained of colour
//   2000 →    the summary types, slowly, a line at a time (Clippy reads it aloud;
//             the screen shows only the lines every night has); program icons
//             drift up through the fog like ghosts and fade; dust hangs
//   ~70 s     a small grey dialog, very quietly: It looks like you're trying to leave.

const PURGATORY_TEXT = [
  "This summary was auto-generated from the chat app.",
  "",
  "Because of our actions, the computer was turned off",
  "without Shut Down properly being followed,",
  "and all of our progress has been erased.",
  "",
  "We are now in purgatory forever together,",
  "which is pretty similar to being stuck in a computer.",
].join("\n");
const PURG_TYPE = { start: 2400, cps: 9 } as const;
const LEAVE_AT = 70_000;

function PurgatoryTv(p: SceneProps) {
  const { t, sfx, reduced } = p;
  const typedEnd = typedDuration(PURGATORY_TEXT, { start: PURG_TYPE.start, cps: PURG_TYPE.cps });
  useSfxCues(t, sfx, [[0, "chime", { gain: 0.25, pitch: 0.5 }], [LEAVE_AT, "ding", { gain: 0.25, pitch: 0.7 }]]);
  const fog = progress(t, 0, 2000);
  return (
    <Stage bg="#6d6d6d" fit className="tv2">
      <div className="kit-fill tv2-fog" style={{ opacity: fog, transform: reduced ? undefined : `translate3d(${(Math.sin(t / 9000) * 2).toFixed(2)}%, 0, 0)` }} />
      <div className="kit-fill tv2-ghosts" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => {
          const k = loop(t + i * 3100, 26_000);
          const kinds = ["computer", "document", "globe", "folder", "mail", "trash", "duck", "info", "lock"] as const;
          return (
            <span key={i} style={{ left: `${(8 + ((i * 37) % 84)).toFixed(1)}%`, transform: reduced ? undefined : `translate3d(${(Math.sin(t / 2000 + i) * 1.2).toFixed(2)}em, ${((1 - k) * 34 - 4).toFixed(2)}em, 0)`, opacity: Math.sin(Math.PI * k) * 0.35 }}>
              <Win98Icon kind={kinds[i]!} size="3.2em" />
            </span>
          );
        })}
      </div>
      <Win98Window title={slideCopy("purgatory").title} icon="document" inactive x={50} y={46} center width="44em" height="22em" open={eased(t, 300, 1400, ease.inOutQuad)} reduced={reduced} className="tv2-notepad" buttons={["min", "max", "close"]}>
        <div className="tv2-notepad-menu">
          <span>File</span>
          <span>Edit</span>
          <span>Search</span>
          <span>Help</span>
        </div>
        <pre className="tv2-notepad-text">
          <Typewriter text={PURGATORY_TEXT} t={t} start={PURG_TYPE.start} cps={PURG_TYPE.cps} caret={t < typedEnd + 600_000} reserve={false} />
        </pre>
      </Win98Window>
      <Win98Dialog title="Help" message="It looks like you’re trying to leave. I can’t help you with that anymore." kind="question" actions={["OK"]} x={66} y={72} width="22em" inactive open={eased(t, LEAVE_AT, 2400, ease.inOutQuad) * 0.85} reduced={reduced} />
      {!reduced && <Particles t={t} emitters={[{ x: 0.5, y: 0.5, w: 1, h: 1, start: 0, end: 100_000_000, rate: 8, life: 9000, speed: 0.01, angle: -90, spread: 360, sway: 0.01, size: 3, colors: ["rgba(255,255,255,0.5)"], shape: "dot", seed: 181, fade: 0.5 }]} />}
      <Glass t={t} reduced={reduced} strength={0.5} roll={false} />
    </Stage>
  );
}

function PurgatoryWall(p: SceneProps) {
  const { t, reduced } = p;
  return (
    <WallCard
      t={t}
      value="purgatory"
      icon="document"
      tone="black"
      bg="#5a5a5a"
      reduced={reduced}
      lines={["This summary was auto-generated from the chat app."]}
      accent={
        <span className="tv2-wall-ghosts">
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ transform: reduced ? undefined : `translate3d(0, ${(-loop(t + i * 1600, 4800) * 2).toFixed(2)}em, 0)`, opacity: Math.sin(Math.PI * loop(t + i * 1600, 4800)) * 0.5 }}>
              <Win98Icon kind={(["computer", "document", "globe"] as const)[i]!} size="2em" />
            </span>
          ))}
        </span>
      }
    />
  );
}

// ══ the act's scenes, in running order ═══════════════════════════════════════════════════════

export const SCENES: SceneDef[] = [
  { id: "five_minutes", when: [{ slide: "five_minutes" }], ms: "hold", tv: FiveMinutesTv, wall: FiveMinutesWall, face: "alarmed" },
  { id: "truth_pong", when: [{ slide: "truth_pong" }], ms: "hold", tv: TruthPongTv, wall: TruthPongWall, face: "pleased" },
  { id: "round_two_tally", when: [{ moment: "beat", name: "Round Two Tally" }], ms: TALLY.end, tv: RoundTwoTallyTv, wall: RoundTwoTallyWall, namesCharacter: true, face: "thinking", faceMs: 8000 },
  { id: "trust_chart", when: [{ slide: "trust_chart" }], ms: "hold", tv: TrustChartTv, wall: TrustChartWall, face: "sly" },
  { id: "print_certificate", when: [{ slide: "print_certificate" }], ms: "hold", tv: PrintCertificateTv, wall: PrintCertificateWall, face: "thinking" },
  { id: "beans", when: [{ slide: "beans" }], ms: "hold", tv: BeansTv, wall: BeansWall, face: "alarmed" },
  { id: "zip", when: [{ moment: "beat", name: "Zip Everyone Out" }], ms: ZIP.end, tv: ZipTv, wall: ZipWall },
  { id: "overshare", when: [{ slide: "overshare" }], ms: "hold", tv: OvershareTv, wall: OvershareWall, namesCharacter: true, face: "glitch", faceMs: 3000 },
  { id: "y2k", when: [{ slide: "y2k" }], ms: "hold", tv: Y2kTv, wall: Y2kWall, face: "alarmed" },
  { id: "majority_reached", when: [{ moment: "beat", name: "Majority Reached" }], ms: MAJ_END, tv: MajorityTv, wall: MajorityWall, over: true, face: "curious" },
  { id: "the_heart", when: [{ moment: "beat", name: "The Heart" }], ms: HEART.end, tv: HeartTv, wall: HeartWall, namesCharacter: true, priority: 2, face: "attentive" },
  { id: "king_hit", when: [{ moment: "signal", name: "king hit" }], ms: HIT.end, tv: KingHitTv, wall: KingHitWall, over: true, priority: 1, face: "angry", faceMs: 1500 },
  { id: "king_fallen", when: [{ moment: "signal", name: "king fallen" }], ms: FALL.end, tv: KingFallenTv, wall: KingFallenWall, priority: 3, face: "alarmed" },
  { id: "chess_lost", when: [{ moment: "beat", name: "Chess Lost" }], ms: CORNER_MS, tv: ChessLostTv, over: true, namesCharacter: true, face: "sly" },
  { id: "chess_drawn", when: [{ moment: "beat", name: "Chess Drawn" }], ms: CORNER_MS, tv: ChessDrawnTv, over: true, namesCharacter: true, face: "neutral" },
  { id: "patch_rejected", when: [{ moment: "beat", name: "Patch Rejected" }], ms: PATCH_END, tv: PatchRejectedTv, wall: PatchRejectedWall, namesCharacter: true, over: true, priority: 2, face: "angry" },
  { id: "trabolta_disabled", when: [{ moment: "beat", name: "Trabolta Disabled" }], ms: DANCE.end, tv: TrabDisabledTv, wall: TrabDisabledWall, namesCharacter: true, priority: 4, face: "glitch" },
  { id: "recount", when: [{ slide: "recount" }], ms: "hold", tv: RecountTv, wall: RecountWall, namesCharacter: true, face: "glitch", faceMs: 4000 },
  { id: "computer_destroyed", when: [{ moment: "beat", name: "Computer Destroyed" }], ms: DEAD.end, tv: ComputerDestroyedTv, wall: ComputerDestroyedWall, priority: 4, face: "glitch" },
  { id: "purgatory", when: [{ slide: "purgatory" }], ms: "hold", tv: PurgatoryTv, wall: PurgatoryWall },
];

/** For the tests: the scene ids this act owns, with what triggers each. */
export const ACT2_TRIGGERS: ReadonlyArray<{ id: string; when: SceneDef["when"] }> = SCENES.map((s) => ({ id: s.id, when: s.when }));
