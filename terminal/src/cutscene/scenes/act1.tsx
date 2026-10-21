//! The cutscenes of Act A–C (lane tv1): Power On, call_desktop, bingo,
//! bingo_time, the first reinstallation (Corrupted Code), the introduction,
//! trivia_1, return, the results (the filing window and each question),
//! filing closed, truth or dare and the bottle (its landing, an empty
//! table, a Truth chosen), the ad hijack, trivia_2, the Truther Download.
//! Owned by its lane; the engine (`../registry.ts`) only lists them.
//!
//! Every scene is a picture of `t` (the server's ms since its cue), with a
//! storyboard on its component. The TV's take is the elaborate one (a
//! 16:9 stage, `em` = 1/60 of its width); a wall terminal's is a lighter
//! card (`WallCard`) that still never sits still. Slides are `"hold"`: their
//! hold state loops for as long as the slide is up. Before the introduction
//! nothing here names the character (`namesCharacter` marks what does).
//! Accent sounds only (`sfx`), quiet, on the beat; never a story sound.
//!
//! Triggers, checked against the story (`test/act1.test.ts`): slides are
//! `screens_*` / `tv_*` cue values; moments are the house-wide beats
//! (`Power On`, `Corrupted Code`, `Trabolta Introduction`, `Filing Closed`,
//! `Truth Question`) and the `do pick` draws (`bottle_landed`,
//! `bottle_empty`). Truth answered / refused and Dare are booth presses,
//! which the server never makes moments of: the bottle's outcome on the TV
//! is the landing and a Truth chosen (the poll's `Truth Question`).

import "./act1.css";
import { useRef, type CSSProperties, type ReactNode } from "react";
import { SLIDE_COPY, SLIDE_HOLD_MS } from "../../slides.ts";
import type { ScreenState } from "../../screen.ts";
import type { SfxName, SfxOpts } from "../../sound/index.ts";
import type { SceneDef, SceneProps } from "../types.ts";
import {
  Confetti,
  Countdown,
  Desktop,
  Glitch,
  Hourglass,
  Marquee,
  Noise,
  Particles,
  PopupStorm,
  ProgressBar,
  Spotlight,
  Starfield,
  Typewriter,
  Win98Button,
  Win98Dialog,
  Win98Icon,
  Win98Window,
  between,
  blink,
  clamp01,
  ease,
  eased,
  fakeProgress,
  loop,
  noise1,
  progress,
  pulse,
  useSfxCues,
  type Emitter,
  type StormMessage,
} from "../kit/index.ts";
import { INTRO_MS, IntroTv, IntroWall, POWER_ON_MS, PowerOnTv, PowerOnWall } from "../kit/tv1-boot.tsx";
import { AlarmClock, Beacon, BingoBall, BottleTable, Chevrons, DataRain, March, Redacted, Ribbon, WallCard, useEndAt } from "../kit/tv1-parts.tsx";
import {
  BOTTLE_EMPTY_SPIN_MS,
  BOTTLE_SPIN_MS,
  BOTTLE_SEATS,
  bottleFree,
  bottleLanding,
  bottleSeat,
  bottleTicks,
  bounceAt,
  countdownLeft,
  momentAfter,
  momentNear,
  odometerWheel,
  periodicCues,
  resultsKind,
  seatAngle,
  seatUnder,
  windowClock,
  type ResultsKind,
} from "../kit/tv1-time.ts";

const copy = (v: string) => SLIDE_COPY[v] ?? { title: v.toUpperCase(), lines: [] };
const linesOf = (v: string): readonly string[] => copy(v).lines ?? [];

/** The TV's 16:9 stage (`em` = 1/60 of its width). */
function TvStage({ bg = "#000", className, children, style }: { bg?: string; className?: string; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div className={`kit-stage a1-tv${className ? ` ${className}` : ""}`} style={{ background: bg, ...style }}>
      <div className="kit-stage-fit">{children}</div>
    </div>
  );
}

// --- B1 · call_desktop -------------------------------------------------------------------------

const SWEEP: readonly string[] = ["An Antivirus is sweeping the halls.", "Programs found in the halls will be escorted.", "Proceed to the living room.", "Walk. You are a program, not a process.", "The Desktop is the living room."];

/**
 *   0–700     the interrupt: black, a tear of static, the beacon starts turning
 *   700–2400  a red SYSTEM MESSAGE pops: REPORT TO THE DESKTOP types, torn now and then
 *   2400–     hold: program icons stream in from every edge to the Desktop in the
 *             middle, floor chevrons pulse inward, the beacon turns, a marquee runs,
 *             and every 9 s an Antivirus notice pops up and closes again
 */
function CallDesktopTv({ t, sfx, reduced }: SceneProps) {
  const c = copy("call_desktop");
  useSfxCues(t, sfx, [[700, "exclamation"], ...periodicCues(t, 3000, 9000).map((at) => [at, "popup", { gain: 0.45 }] as const)]);
  const open = eased(t, 700, 300, ease.linear);
  const k = Math.max(0, Math.floor((t - 3000) / 9000));
  const local = t - 3000 - k * 9000;
  const pop = t >= 3000 ? clamp01(local / 220) * (1 - progress(local, 6000, 220)) : 0;
  const px = 6 + 60 * noise1(17, k);
  const py = 60 + 14 * noise1(19, k);
  return (
    <TvStage bg="radial-gradient(ellipse at 50% 55%, #0a6c70 0, #01262a 75%)">
      <Beacon t={t} reduced={reduced} />
      <Chevrons t={t} reduced={reduced} />
      <March t={t} reduced={reduced} count={22} />
      <div className="a1-cd-core" style={{ transform: `translate(-50%, -50%) scale(${(1 + 0.06 * pulse(t, 1200)).toFixed(3)})` }}>
        <Win98Icon kind="computer" size="7em" />
        <div className="a1-cd-core-label">THE DESKTOP</div>
      </div>
      <Win98Window title="System Message" icon="warning" tone="red" x={50} y={17} center width="40em" open={open} reduced={reduced} className="a1-cd-win">
        <Glitch t={t} intensity={reduced ? 0 : 0.12} seed={2} reduced={reduced} className="a1-cd-title">
          <Typewriter text={c.title} t={t} start={900} cps={30} caret={false} />
        </Glitch>
        <div className="a1-cd-line">
          <Typewriter text={linesOf("call_desktop")[0] ?? ""} t={t} start={1700} cps={40} />
        </div>
      </Win98Window>
      {pop > 0 && <Win98Dialog title="Antivirus" kind="info" message={SWEEP[k % SWEEP.length]!} x={px} y={py} width="20em" open={pop} reduced={reduced} className="a1-cd-pop" />}
      <Marquee t={reduced ? 0 : t} speed={150} className="a1-ticker" style={{ opacity: progress(t, 2000, 600) }}>
        ★ ALL PROGRAMS: REPORT TO THE DESKTOP ★ A GAME IS ABOUT TO BEGIN ★ THE DESKTOP IS THE LIVING ROOM ★
      </Marquee>
      {t < 900 && !reduced && <Noise t={t} alpha={0.5 * (1 - progress(t, 300, 600))} reduced={reduced} />}
    </TvStage>
  );
}

function CallDesktopWall({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [[300, "exclamation", { gain: 0.8 }]]);
  return (
    <WallCard
      t={t}
      reduced={reduced}
      caption="System Message"
      icon="warning"
      tone="red"
      title={copy("call_desktop").title}
      lines={linesOf("call_desktop")}
      bg="radial-gradient(ellipse at 50% 55%, #0a6c70 0, #01262a 75%)"
      footer="★ ALL PROGRAMS: REPORT TO THE DESKTOP ★ THE DESKTOP IS THE LIVING ROOM ★"
      art={
        <>
          <Chevrons t={t} reduced={reduced} rows={4} />
          <March t={t} reduced={reduced} count={10} size="1.6em" />
          <div className="a1-cd-core small" style={{ transform: `translate(-50%, -50%) scale(${(1 + 0.08 * pulse(t, 1200)).toFixed(3)})` }}>
            <Win98Icon kind="computer" size="3em" />
          </div>
        </>
      }
    />
  );
}

// --- B2 · bingo ------------------------------------------------------------------------------

/** The card: a big asterisk (the two diagonals, the centre column and row) on a 5 × 5 grid. */
export const BINGO_CELLS: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (r === c || r + c === 4 || r === 2 || c === 2) out.push([r, c]);
  return out;
})();
const CENTRE_Q = "Would you never agree to a life where AI makes all of your decisions?";
/** What the balls say (program kinds, nobody's description). */
export const BALL_WORDS: readonly string[] = ["GAME", "BROWSER", "MEDIA PLAYER", "UTILITY", "WORD PRO-CESSOR", "SPREAD-SHEET", "SCREEN-SAVER", "CHAT", "ENCYCLO-PEDIA", "PAINT", "DRIVER", "MAIL"];
const BALL_EVERY = 8000;
const BALL_CYCLE = BALL_EVERY * 6;
const B = { title: 300, card: 1800, hold: 4200 } as const;

/** Which squares are ticked at `t` (a seeded order; six balls a cycle, then the card clears). */
export function bingoTicks(t: number, seed = 5): Set<number> {
  const out = new Set<number>();
  if (t < B.hold) return out;
  const local = (t - B.hold) % BALL_CYCLE;
  const cycle = Math.floor((t - B.hold) / BALL_CYCLE);
  const n = Math.floor(local / BALL_EVERY) + 1;
  const order = BINGO_CELLS.map((_, i) => i).filter((i) => i !== 8);
  // A seeded shuffle per cycle.
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(noise1(seed + cycle, i) * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  for (let i = 0; i < Math.min(n, order.length); i++) out.add(order[i]!);
  return out;
}

/**
 * The hold's accents: every ball pops (a popup, its pitch walking up the
 * round) and its square ticks a beat later; every fourth ball rings the
 * chord, and a new round's empty card whooshes in.
 */
export function bingoCues(t: number): Array<readonly [number, SfxName, SfxOpts]> {
  const out: Array<readonly [number, SfxName, SfxOpts]> = [];
  for (const x of periodicCues(t, B.hold, BALL_EVERY)) {
    const k = Math.round((x - B.hold) / BALL_EVERY);
    const inRound = k % (BALL_CYCLE / BALL_EVERY);
    if (inRound === 0 && k > 0) out.push([x - 300, "whoosh", { gain: 0.4 }]);
    out.push([x, "popup", { gain: 0.4, pitch: 1 + 0.06 * inRound }]);
    out.push([x + TICK_AFTER, "tick", { gain: 0.5 }]);
    if (k % 4 === 3) out.push([x + TICK_AFTER + 150, "chord", { gain: 0.45 }]);
  }
  return out;
}

/** The square ticks this long after its ball pops (ms). */
const TICK_AFTER = 350;

/** The square that just ticked and how far (0..1) its stamp has landed; cell -1 when none is fresh. */
export function freshTick(t: number): { cell: number; k: number } {
  if (t < B.hold + TICK_AFTER) return { cell: -1, k: 1 };
  const local = (t - B.hold) % BALL_EVERY;
  if (local < TICK_AFTER || local > TICK_AFTER + 900) return { cell: -1, k: 1 };
  const now = bingoTicks(t);
  const before = bingoTicks(t - local - 1);
  for (const c of now) if (!before.has(c)) return { cell: c, k: clamp01((local - TICK_AFTER) / 700) };
  return { cell: -1, k: 1 };
}

/**
 *   0–1800    B-I-N-G-O balls bounce in along the top, COMPUTER BINGO slams under them
 *   1800–4200 the asterisk card draws itself square by square; the rules type in
 *   4200–     hold: the cage turns, its balls tumbling; every 8 s one pops out with a
 *             program kind and a square ticks (six a round, then the card clears);
 *             the centre square's question glows; the story's bingo countdown ticks
 *             big top right (under 5 minutes it turns hot)
 */
function BingoTv({ t, at, state, sfx, reduced }: SceneProps) {
  const lines = linesOf("bingo");
  useSfxCues(t, sfx, [
    ...[0, 1, 2, 3, 4].map((i) => [B.title + i * 160, "blip", { pitch: 1 + i * 0.12, gain: 0.6 }] as const),
    [B.card, "chord", { gain: 0.6 }],
    ...bingoCues(t),
  ]);
  const ticks = bingoTicks(t);
  const fresh = freshTick(t);
  const left = countdownLeft(state, ["bingo"], at, t);
  const ballN = t >= B.hold ? Math.floor((t - B.hold) / BALL_EVERY) : -1;
  const ballAt = B.hold + ballN * BALL_EVERY;
  return (
    <TvStage bg="radial-gradient(ellipse at 50% 30%, #2a1a7a 0, #0b0630 70%)">
      {!reduced && <Starfield t={t} speed={0.03} count={90} bg={null} color="#c8b8ff" />}
      <div className="a1-bg-balls">
        {"BINGO".split("").map((ch, i) => {
          const k = reduced ? progress(t, B.title, 300) : eased(t, B.title + i * 160, 700, ease.outBounce);
          const bob = t > 2400 && !reduced ? 0.25 * Math.sin(t / 500 + i) : 0;
          return <BingoBall key={ch} label={ch} color={i} size="3.6em" className="a1-bingo-letter" style={{ transform: `translate3d(0, ${((1 - k) * -9 + bob).toFixed(2)}em, 0)` }} />;
        })}
      </div>
      <div className="a1-bingo-title" style={{ opacity: progress(t, B.title + 800, 200), transform: `scale(${(1 + 0.4 * (1 - eased(t, B.title + 800, 300, ease.outCubic))).toFixed(3)})` }}>
        {copy("bingo").title}
      </div>
      <div className="a1-bingo-card">
        {BINGO_CELLS.map(([r, c], i) => {
          const k = reduced ? progress(t, B.card, 400) : eased(t, B.card + i * 120, 320, ease.outBack);
          const centre = r === 2 && c === 2;
          const ticked = ticks.has(i);
          return (
            <div key={i} className={`a1-cell${centre ? " centre" : ""}${ticked ? " ticked" : ""}`} style={{ left: `${c * 20}%`, top: `${r * 20}%`, transform: `scale(${k.toFixed(3)})`, opacity: clamp01(k * 2) }}>
              {centre ? (
                <span style={{ transform: `scale(${(1 + 0.12 * pulse(t, 1600)).toFixed(3)})` }}>★</span>
              ) : ticked ? (
                <span style={i === fresh.cell && !reduced ? { transform: `scale(${(2.2 - 1.2 * eased(fresh.k, 0, 1, ease.outBack)).toFixed(3)}) rotate(${(-20 * (1 - fresh.k)).toFixed(1)}deg)` } : undefined}>✔</span>
              ) : null}
              {i === fresh.cell && !reduced && fresh.k < 1 && <span className="a1-cell-ring" style={{ transform: `scale(${(0.6 + 1.4 * fresh.k).toFixed(3)})`, opacity: 1 - fresh.k }} />}
            </div>
          );
        })}
      </div>
      <div className="a1-bingo-q" style={{ opacity: progress(t, B.card + 1800, 500) }}>
        ★ <Typewriter text={CENTRE_Q} t={t} start={B.card + 1900} cps={40} caret={false} />
      </div>
      <BingoCage t={t} reduced={reduced} />
      {ballN >= 0 && (
        <div className="a1-bingo-out" style={{ transform: `translate(-50%, -50%) scale(${(reduced ? 1 : eased(t, ballAt, 500, ease.outBack)).toFixed(3)})` }}>
          <BingoBall label={BALL_WORDS[(ballN + 3) % BALL_WORDS.length]!} color={ballN} size="6.5em" />
        </div>
      )}
      <Win98Window title="How to play" icon="info" x={70} y={66} width="17em" open={eased(t, B.card + 400, 260, ease.linear)} reduced={reduced} className="a1-bingo-rules">
        {lines.map((l, i) => (
          <div key={i} className="a1-bingo-rule">
            <Typewriter text={l} t={t} start={B.card + 700 + i * 1300} cps={44} caret={false} />
          </div>
        ))}
      </Win98Window>
      {left !== null && (
        <div className="a1-bingo-clock">
          <Countdown ms={left} warn={300_000} label="TIME LEFT" reduced={reduced} />
        </div>
      )}
    </TvStage>
  );
}

/** The ball cage, turning, its balls tumbling inside (pure orbits). */
function BingoCage({ t, reduced }: { t: number; reduced: boolean }) {
  const turn = reduced ? 0 : (t / 18) % 360;
  return (
    <div className="a1-cage">
      <svg viewBox="-60 -60 120 120" className="a1-cage-svg" aria-hidden="true">
        <circle r="54" fill="rgba(255,255,255,0.06)" stroke="#d8c060" strokeWidth="3" />
        <g transform={`rotate(${turn.toFixed(1)})`}>
          {Array.from({ length: 8 }, (_, i) => (
            <line key={i} x1="0" y1="0" x2="0" y2="-54" stroke="#d8c060" strokeWidth="1.5" transform={`rotate(${i * 45})`} />
          ))}
        </g>
        {Array.from({ length: 9 }, (_, i) => {
          const a = reduced ? i : t / (380 + i * 47) + i * 1.7;
          const r = 14 + 26 * noise1(41, i);
          const x = Math.cos(a) * r;
          const y = Math.sin(a * 1.3) * r * 0.9 + 10;
          return <circle key={i} cx={x.toFixed(2)} cy={Math.min(42, y).toFixed(2)} r="7" fill={["#ff4b4b", "#ffd23f", "#3ddc84", "#3fa7ff", "#c86bff"][i % 5]} stroke="#000" strokeWidth="1" />;
        })}
        <circle r="5" fill="#d8c060" />
      </svg>
      <div className="a1-cage-stand" />
    </div>
  );
}

function BingoWall({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [[200, "chord", { gain: 0.6 }], ...periodicCues(t, B.hold, BALL_EVERY).map((x) => [x + TICK_AFTER, "blip", { gain: 0.35 }] as const)]);
  const ticks = bingoTicks(t);
  return (
    <WallCard
      t={t}
      reduced={reduced}
      caption="Computer Bingo"
      icon="document"
      tone="purple"
      title={copy("bingo").title}
      lines={linesOf("bingo")}
      bg="radial-gradient(ellipse at 50% 30%, #2a1a7a 0, #0b0630 70%)"
      art={
        <div className="a1-bingo-card small">
          {BINGO_CELLS.map(([r, c], i) => (
            <div key={i} className={`a1-cell${r === 2 && c === 2 ? " centre" : ""}${ticks.has(i) ? " ticked" : ""}`} style={{ left: `${c * 20}%`, top: `${r * 20}%`, transform: `scale(${eased(t, 600 + i * 80, 300, ease.outBack).toFixed(3)})` }}>
              {r === 2 && c === 2 ? "★" : ticks.has(i) ? "✔" : null}
            </div>
          ))}
        </div>
      }
    />
  );
}

// --- B3 · bingo_time ------------------------------------------------------------------------

/**
 *   0–900     time is up: 0:00 blinks on the LCD, a buzzer
 *   900–2600  BINGO TIME slams in, confetti fires from both corners, a ta-da
 *   2600–     hold: the ribbon turns centre stage in a ring of sparkles, the B-I-N-G-O
 *             balls bob, "Back to the Desktop. Bring your card." types, a marquee asks
 *             who has a Bingo; the confetti puffs again every 30 s
 */
function BingoTimeTv({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [80, "buzz", { gain: 0.6 }],
    [900, "tada"],
    ...periodicCues(t, 30_900, 30_000).map((x) => [x, "sparkle", { gain: 0.5 }] as const),
  ]);
  const burst = t < 30_900 ? 900 : 900 + Math.floor((t - 900) / 30_000) * 30_000;
  const slam = reduced ? progress(t, 900, 300) : eased(t, 900, 450, ease.outBack);
  const sparks: Emitter[] = [{ x: 0.5, y: 0.47, w: 0.3, h: 0.3, start: 2200, end: Number.POSITIVE_INFINITY, rate: 18, life: 1400, speed: 0.08, angle: -90, spread: 360, size: 9, colors: ["#ffd23f", "#ffffff", "#9cc8ff"], shape: "star", seed: 51 }];
  return (
    <TvStage bg="radial-gradient(ellipse at 50% 45%, #1a3a9a 0, #050b2e 75%)">
      {!reduced && <Particles t={t} emitters={sparks} blend="add" />}
      {t < 1100 && (
        <div className="a1-bt-zero" style={{ opacity: blink(t, 260) ? 1 : 0.2 }}>
          <Countdown ms={0} label="TIME" reduced={reduced} />
        </div>
      )}
      <div className="a1-bt-ribbon" style={{ opacity: progress(t, 1600, 600), transform: `translate(-50%, -50%) scale(${(reduced ? 1 : 0.6 + 0.4 * eased(t, 1600, 700, ease.outBack)).toFixed(3)})` }}>
        <Ribbon t={t} reduced={reduced} size="11em" />
      </div>
      <div className="a1-bt-title" style={{ opacity: clamp01(slam * 2), transform: `translate(-50%, 0) scale(${(2.2 - 1.2 * slam).toFixed(3)})` }}>
        {copy("bingo_time").title}
      </div>
      <div className="a1-bt-balls">
        {"BINGO".split("").map((ch, i) => (
          <BingoBall key={ch} label={ch} color={i} size="3.2em" style={{ transform: `translate3d(0, ${(reduced ? 0 : -0.6 * Math.abs(Math.sin(t / 420 + i * 0.6))).toFixed(2)}em, 0)` }} />
        ))}
      </div>
      <div className="a1-bt-line">
        <Typewriter text={linesOf("bingo_time")[0] ?? ""} t={t} start={2300} cps={30} />
      </div>
      <Confetti t={t} start={burst} dur={4500} density={reduced ? 0 : 1} seed={6 + Math.floor(burst / 1000)} />
      <Marquee t={reduced ? 0 : t} speed={140} className="a1-ticker gold" style={{ opacity: progress(t, 2600, 600) }}>
        ★ WHO HAS A BINGO? ★ READ YOUR LINE FROM MEMORY ★ SAVE THE CENTRE SQUARE FOR LAST ★
      </Marquee>
    </TvStage>
  );
}

function BingoTimeWall({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [[300, "tada", { gain: 0.7 }]]);
  return (
    <WallCard
      t={t}
      reduced={reduced}
      caption="Computer Bingo"
      icon="info"
      tone="purple"
      title={copy("bingo_time").title}
      lines={linesOf("bingo_time")}
      bg="radial-gradient(ellipse at 50% 45%, #1a3a9a 0, #050b2e 75%)"
      art={
        <>
          <Confetti t={t} start={300} dur={3500} density={reduced ? 0 : 0.5} seed={8} />
          <div className="a1-art-centre" style={{ transform: `translate(-50%, -50%)` }}>
            <Ribbon t={t} reduced={reduced} size="24vmin" />
          </div>
        </>
      }
    />
  );
}

// --- B4 · the first reinstallation (Corrupted Code) -----------------------------------------------

const CC = { error: 700, carry: 3000, calm: 7500, out: 11_200, end: 12_000 } as const;
const CORRUPT_PIXELS: Emitter[] = [
  { x: 0.24, y: 0.55, w: 0.07, h: 0.12, start: CC.error, end: CC.carry, rate: 70, life: 900, speed: 0.12, angle: -90, spread: 360, gravity: 0.3, size: 7, colors: ["#ff3b3b", "#00e5ff", "#ffffff", "#000000"], shape: "pixel", seed: 61 },
  // The globe takes it in: a ring of golden sparkles, then a slow glitter.
  { x: 0.76, y: 0.53, start: CC.calm - 450, end: CC.calm - 250, rate: 300, life: 1400, speed: 0.4, speedJitter: 0.5, angle: -90, spread: 360, drag: 0.6, size: 9, colors: ["#ffd23f", "#ffffff", "#9cc8ff"], shape: "star", seed: 62 },
  { x: 0.76, y: 0.53, w: 0.1, h: 0.16, start: CC.calm, end: CC.out, rate: 14, life: 1600, speed: 0.04, angle: -90, spread: 60, size: 6, colors: ["#ffd23f", "#ffffff"], shape: "star", seed: 63 },
];

/** Where the corrupted program is on its way to the Internet (0..1 of the stage). */
export function carryAt(t: number): { x: number; y: number; k: number } {
  const k = eased(t, CC.carry + 300, CC.calm - CC.carry - 900, ease.inOutCubic);
  return { x: 0.24 + 0.52 * k, y: 0.55 - 0.22 * Math.sin(Math.PI * k), k };
}

/**
 *   0–700       a tear: the picture jumps, a burst of static, the critical stop
 *   700–3000    CORRUPTED CODE DETECTED types in a red error; a program's icon on the
 *               desktop breaks up, pixels spitting off it
 *   3000–7500   it is carried along a dotted path to the Internet's globe;
 *               REINSTALLING… lurches along under it
 *   7500–11200  a yellow help balloon: "Oh! Okay! Everyone, this is normal!" and the
 *               lifecycle line typed out; the globe glows, the path's ants keep marching
 *   11200–12000 it fades back to whatever was on
 */
function CorruptedTv({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [60, "glitch"],
    [CC.error, "critical"],
    [CC.carry + 300, "whoosh", { gain: 0.6 }],
    [CC.calm - 300, "ding"],
    [CC.calm, "popup", { gain: 0.6 }],
  ]);
  const c = carryAt(t);
  const bar = fakeProgress(t - CC.carry, CC.calm - CC.carry, 13);
  const shake = t < CC.error && !reduced ? (noise1(3, Math.floor(t / 50)) - 0.5) * 1.2 : 0;
  return (
    <TvStage bg="#008080" style={{ opacity: 1 - progress(t, CC.out, CC.end - CC.out) }}>
      <div className="kit-fill" style={{ transform: `translate3d(${shake}em, 0, 0)` }}>
        <Desktop icons={[{ label: "My Computer", kind: "computer" }, { label: "Recycle Bin", kind: "trash" }]} clock="8:05 PM" tasks={["Antivirus"]} className="a1-po-desk" />
        <svg className="kit-fill a1-cc-path" viewBox="0 0 100 56.25" preserveAspectRatio="none" aria-hidden="true">
          <path d="M 24 31 Q 50 6 76 31" fill="none" stroke="#ffd23f" strokeWidth="0.5" strokeDasharray="1.4 1.2" strokeDashoffset={reduced ? 0 : (-t / 120) % 26} opacity={progress(t, CC.carry - 200, 400)} />
        </svg>
        <div className="a1-cc-globe" style={{ transform: `translate(-50%, -50%) scale(${(1 + 0.1 * pulse(t, 1400) * progress(t, CC.carry, 500)).toFixed(3)})` }}>
          <Win98Icon kind="globe" size="7em" />
          <div className="a1-cc-label">The Internet</div>
        </div>
        <div className="a1-cc-prog" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, transform: `translate(-50%, -50%) rotate(${((reduced ? 0 : Math.sin(t / 90)) * (t < CC.carry ? 8 : 3)).toFixed(1)}deg) scale(${(1 - 0.35 * c.k).toFixed(3)})`, opacity: 1 - progress(t, CC.calm - 500, 400) }}>
          <Glitch t={t} intensity={reduced ? 0 : 0.55} seed={4} reduced={reduced}>
            <Win98Icon kind="document" size="5em" />
          </Glitch>
        </div>
        {!reduced && <Particles t={t} emitters={CORRUPT_PIXELS} />}
        <Win98Dialog
          title="Error"
          kind="error"
          tone="red"
          x={50}
          y={14}
          center
          width="28em"
          open={eased(t, CC.error, 260, ease.linear) * (1 - progress(t, CC.carry + 600, 300))}
          reduced={reduced}
          message={
            <>
              <b>
                <Typewriter text="CORRUPTED CODE DETECTED" t={t} start={CC.error + 200} cps={34} caret={false} />
              </b>
              <br />
              <Typewriter text="This program has stopped following instructions." t={t} start={CC.error + 1100} cps={44} caret={false} />
            </>
          }
          actions={["OK"]}
          className="a1-cc-err"
        />
        {between(t, CC.carry, CC.calm + 400) && (
          <div className="a1-cc-bar" style={{ opacity: progress(t, CC.carry, 300) * (1 - progress(t, CC.calm, 400)) }}>
            <ProgressBar value={bar} label="REINSTALLING…" percent />
          </div>
        )}
        {t >= CC.calm && (
          <div className="a1-help" style={{ opacity: eased(t, CC.calm, 300, ease.linear), transform: `translate(-50%, 0) translate3d(0, ${((1 - eased(t, CC.calm, 500, ease.outBack)) * 2).toFixed(2)}em, 0)` }}>
            <div className="a1-help-who">Clippy</div>
            <Typewriter text="Oh! Okay! Everyone, this is normal!" t={t} start={CC.calm + 300} cps={30} caret={false} />
            <div className="a1-help-small">
              <Typewriter text="Occasional corruption is a normal part of the lifecycle of a computer program." t={t} start={CC.calm + 1700} cps={42} />
            </div>
          </div>
        )}
      </div>
      {t < 800 && !reduced && <Noise t={t} alpha={0.55 * (1 - progress(t, 200, 600))} reduced={reduced} />}
    </TvStage>
  );
}

/** A wall's Corrupted Code ends here (the TV's runs 12 s). */
export const CORRUPTED_WALL_MS = 9000;

function CorruptedWall({ t, sfx, reduced, done }: SceneProps) {
  useSfxCues(t, sfx, [[100, "critical", { gain: 0.7 }]]);
  useEndAt(t, CORRUPTED_WALL_MS, done);
  if (t >= CORRUPTED_WALL_MS) return null;
  const k = eased(t, 2500, 3500, ease.inOutCubic);
  return (
    <div className="kit-fill" style={{ opacity: 1 - progress(t, 8200, 800) }}>
      <WallCard
        t={t}
        reduced={reduced}
        caption="Error"
        icon="error"
        tone="red"
        glitch={0.25}
        title="CORRUPTED CODE"
        lines={["A program is being reinstalled.", "This is normal! Isn't it nice to be looked after?"]}
        bg="#5a0000"
        art={
          <>
            <div className="a1-art-at" style={{ left: `${18 + 64 * k}%`, top: `${55 - 25 * Math.sin(Math.PI * k)}%`, transform: `translate(-50%, -50%) scale(${(1 - 0.3 * k).toFixed(3)})` }}>
              <Glitch t={t} intensity={reduced ? 0 : 0.5} seed={4} reduced={reduced}>
                <Win98Icon kind="document" size="12vmin" />
              </Glitch>
            </div>
            <div className="a1-art-at" style={{ left: "82%", top: "50%", transform: "translate(-50%, -50%)" }}>
              <Win98Icon kind="globe" size="15vmin" />
            </div>
          </>
        }
      />
    </div>
  );
}

// --- B6 / C2 · trivia ------------------------------------------------------------------------

const QMARKS = 14;
const TV_FOCUS_MS = 6000;

/**
 *   0–1300    a quiz-show open: two spotlights sweep, the round's title slams in torn,
 *             a whoosh and a drumroll
 *   1300–7600 the three questions fly in as windows, one after another, each typed
 *   7600–     hold: the questions stay; the one in focus glows (6 s each, round and
 *             round); question marks drift up behind; the hunt's countdown ticks big;
 *             a marquee says where the facts are (round 1) / the hour's rules (round 2,
 *             the malware tearing the title now and then)
 */
function TriviaTv({ t, at, state, value, sfx, reduced }: SceneProps) {
  const round = value === "trivia_2" ? 2 : 1;
  const c = copy(value);
  const qs = c.lines ?? [];
  const starts = qs.map((_, i) => 1300 + i * 2100);
  useSfxCues(t, sfx, [
    [0, "whoosh"],
    [300, "drumroll", { gain: 0.5 }],
    ...starts.map((s) => [s, "popup", { gain: 0.6 }] as const),
    ...(round === 2 ? periodicCues(t, 20_000, 20_000).map((x) => [x, "glitch", { gain: 0.35 }] as const) : []),
  ]);
  const left = countdownLeft(state, round === 2 ? ["hunt_2"] : ["hunt"], at, t);
  const slam = reduced ? progress(t, 300, 300) : eased(t, 300, 500, ease.outBack);
  const focus = t >= 7600 ? Math.floor((t - 7600) / TV_FOCUS_MS) % Math.max(1, qs.length) : -1;
  const malware = round === 2 ? (reduced ? 0 : 0.08 + 0.3 * (noise1(9, Math.floor(t / 2500)) < 0.25 ? 1 : 0)) : 0.04;
  return (
    <TvStage bg={round === 2 ? "radial-gradient(ellipse at 50% 20%, #3a0a4a 0, #08020c 75%)" : "radial-gradient(ellipse at 50% 20%, #0a2a6a 0, #01040f 75%)"}>
      <Spotlight
        t={t}
        dim={0.5}
        frames={
          reduced
            ? [{ t: 0, x: 50, y: 40, r: 70 }]
            : [
                { t: 0, x: 10, y: 10, r: 16 },
                { t: 700, x: 85, y: 20, r: 18 },
                { t: 1300, x: 50, y: 14, r: 30 },
                { t: 2200, x: 50, y: 45, r: 95 },
              ]
        }
      />
      <div className="kit-fill" aria-hidden="true">
        {Array.from({ length: QMARKS }, (_, i) => {
          const k = loop(t / 11000 + noise1(71, i), 1);
          return (
            <span key={i} className="a1-qmark" style={{ left: `${(noise1(72, i) * 96).toFixed(1)}%`, top: `${((1 - (reduced ? 0.5 : k)) * 110 - 5).toFixed(1)}%`, opacity: (0.08 + 0.22 * Math.sin(Math.PI * k)) * progress(t, 2000, 1500), transform: `rotate(${((noise1(73, i) - 0.5) * 40).toFixed(0)}deg) scale(${(0.6 + noise1(74, i)).toFixed(2)})` }}>
              ?
            </span>
          );
        })}
      </div>
      <div className="a1-tr-title" style={{ opacity: clamp01(slam * 2), transform: `translate(-50%, 0) scale(${(1.8 - 0.8 * slam).toFixed(3)})` }}>
        <Glitch t={t} intensity={malware} seed={round * 11} reduced={reduced}>
          {c.title}
        </Glitch>
      </div>
      {qs.map((q, i) => {
        const open = eased(t, starts[i]!, 280, ease.linear);
        const on = focus === i;
        return (
          <Win98Window key={i} title={`Question ${i + 1}`} icon="question" x={4} y={21 + i * 21} width={left !== null ? "44em" : "52em"} open={open} inactive={focus !== -1 && !on} reduced={reduced} className={`a1-tr-q${on ? " on" : ""}`} style={on && !reduced ? { boxShadow: `0 0 ${(0.5 + pulse(t, 1500)).toFixed(2)}em rgba(255, 210, 63, 0.8), 3px 3px 0 rgba(0,0,0,0.45)` } : undefined}>
            <Typewriter text={q} t={t} start={starts[i]! + 250} cps={55} caret={false} />
          </Win98Window>
        );
      })}
      {left !== null && (
        <div className="a1-tr-clock" style={{ opacity: progress(t, 7000, 600) }}>
          <Countdown ms={left} warn={300_000} label="TIME LEFT" reduced={reduced} />
          <div style={{ marginTop: "0.6em" }}>
            <Hourglass t={t} size="3.2em" />
          </div>
        </div>
      )}
      <Marquee t={reduced ? 0 : t} speed={140} className={`a1-ticker${round === 2 ? " purple" : ""}`} style={{ opacity: progress(t, 7600, 600) }}>
        {round === 1
          ? "★ THE FACTS ARE OBSCURE ★ THEY ARE IN THE BOOKS IN THIS ROOM, AND IN THE PRINT MEDIA ON THE WALLS ★ FOUND A CODE? PUT IT IN YOUR CODEX ★ THE QUESTIONS ARE IN YOUR QUEST LOG ★"
          : "★ ROUND TWO ★ THREE QUESTIONS, ALSO IN YOUR QUEST LOG ★ YOU HAVE ONE HOUR ★ COME BACK TO THE DESKTOP FOR THE SECOND MOMENT OF TRUTH ★ BE VIGILANT ★"}
      </Marquee>
    </TvStage>
  );
}

function TriviaWall({ t, value, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [[100, "whoosh", { gain: 0.6 }]]);
  const c = copy(value);
  return (
    <WallCard
      t={t}
      reduced={reduced}
      caption="Trivia"
      icon="question"
      tone={value === "trivia_2" ? "purple" : "navy"}
      glitch={value === "trivia_2" ? 0.25 : 0.06}
      title={c.title}
      lines={c.lines}
      bg={value === "trivia_2" ? "radial-gradient(ellipse at 50% 20%, #3a0a4a 0, #08020c 75%)" : "radial-gradient(ellipse at 50% 20%, #0a2a6a 0, #01040f 75%)"}
      footer={value === "trivia_2" ? "★ ROUND TWO ★ ONE HOUR ★ BACK TO THE DESKTOP FOR THE SECOND MOMENT OF TRUTH ★" : "★ THE FACTS ARE IN THE BOOKS AND ON THE WALLS ★ PUT ANY CODE IN YOUR CODEX ★"}
      art={
        <>
          {Array.from({ length: 8 }, (_, i) => {
            const k = reduced ? 0.5 : loop(t / 6000 + noise1(75, i), 1);
            return (
              <span key={i} className="a1-wall-qmark" style={{ left: `${(noise1(76, i) * 92).toFixed(1)}%`, top: `${((1 - k) * 100).toFixed(1)}%`, opacity: 0.15 + 0.5 * Math.sin(Math.PI * k) }}>
                ?
              </span>
            );
          })}
          <div className="a1-wall-q" style={{ transform: `translate(-50%, -50%) rotate(${(reduced ? 0 : 8 * Math.sin(t / 700)).toFixed(1)}deg) scale(${(1 + 0.08 * pulse(t, 1400)).toFixed(3)})` }}>
            ?
          </div>
        </>
      }
    />
  );
}

// --- B7 · return -----------------------------------------------------------------------------

/**
 *   0–1500    the alarm clock rings and shakes, TIME IS UP slams in, three dings
 *   1500–     hold: programs stream back in from every edge to the Desktop, the
 *             hourglass sits run out and turns, RETURN TO THE DESKTOP pulses, a
 *             marquee: the Antivirus are sweeping the house, room by room; the clock
 *             rings again for a second every 20 s
 */
function ReturnTv({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [0, "buzz", { gain: 0.5 }],
    [150, "ding"],
    [450, "ding", { pitch: 1.12 }],
    [750, "ding"],
    ...periodicCues(t, 20_000, 20_000).map((x) => [x, "ding", { gain: 0.5 }] as const),
  ]);
  const ringing = t < 1500 || (t >= 20_000 && loop(t, 20_000) < 0.05);
  const slam = reduced ? progress(t, 300, 300) : eased(t, 300, 420, ease.outBack);
  return (
    <TvStage bg="radial-gradient(ellipse at 50% 50%, #0b3c8a 0, #020a22 75%)">
      <March t={t} reduced={reduced} count={24} period={4200} seed={9} />
      <div className="a1-ret-clock" style={{ transform: `translate(-50%, 0) scale(${(reduced ? 1 : 0.5 + 0.5 * eased(t, 0, 500, ease.outBack)).toFixed(3)})` }}>
        <AlarmClock t={t} ringing={ringing && !reduced} size="9em" />
      </div>
      <div className="a1-ret-up" style={{ opacity: clamp01(slam * 2), transform: `translate(-50%, 0) scale(${(2 - slam).toFixed(3)})` }}>
        TIME IS UP
      </div>
      <div className="a1-ret-go" style={{ opacity: progress(t, 1400, 500), transform: `translate(-50%, 0) scale(${(1 + 0.05 * pulse(t, 1300)).toFixed(3)})` }}>
        <Win98Icon kind="computer" size="1.3em" /> {copy("return").title}
      </div>
      <div className="a1-ret-glass">
        <Hourglass t={t < 2500 ? 0 : t} period={4000} size="4em" />
      </div>
      <Marquee t={reduced ? 0 : t} speed={130} className="a1-ticker" style={{ opacity: progress(t, 1800, 600) }}>
        ★ THE ANTIVIRUS ARE SWEEPING THE HOUSE, ROOM BY ROOM ★ EVERYONE BACK TO THE DESKTOP ★ TIME IS UP ★
      </Marquee>
    </TvStage>
  );
}

function ReturnWall({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [[100, "ding", { gain: 0.7 }]]);
  return (
    <WallCard
      t={t}
      reduced={reduced}
      caption="Time is up"
      icon="warning"
      title={copy("return").title}
      lines={linesOf("return")}
      bg="radial-gradient(ellipse at 50% 50%, #0b3c8a 0, #020a22 75%)"
      footer="★ THE ANTIVIRUS ARE SWEEPING THE HOUSE, ROOM BY ROOM ★"
      art={
        <>
          <March t={t} reduced={reduced} count={10} size="1.5em" period={4200} />
          <div className="a1-art-centre" style={{ transform: "translate(-50%, -50%)" }}>
            <AlarmClock t={t} ringing={t < 1500 && !reduced} size="20vmin" />
          </div>
        </>
      }
    />
  );
}

// --- B8 · the results ------------------------------------------------------------------------

/** What this results slide is about, learned once (the moment it came with may leave the ring; `results_q` says the rest). */
function useResultsKind(state: ScreenState, at: number): ResultsKind {
  const latched = useRef<ResultsKind | null>(null);
  const r = resultsKind(state.moments, state.night, at);
  if (latched.current === null || latched.current.kind === "unknown" || (latched.current.kind === "question" && latched.current.n === null && r.kind === "question")) latched.current = r;
  return latched.current;
}

/** The story's filing window (`main.loom`: ⏱ is pressed at `Night.filing_close`, 120 s). */
export const FILING_MS = 120_000;
/** How long the filing slide is up on a target (a results slide is not persistent). */
export const filingHold = (target: SceneProps["target"]): number => SLIDE_HOLD_MS[target === "tv" ? "tv" : "terminals"];
/** The filing reminder pops up this often while the window is open (ms). */
const FILE_NUDGE_EVERY = 12_000;
const FILE_NUDGES: readonly string[] = ["Your 📝 card is on your phone.", "Found a fact? File it now.", "One hundred percent sure is accepted. A guess is a symptom.", "Filings close in two minutes."];
const RULES: ReadonlyArray<{ text: string; ok: boolean }> = [
  { text: "Accurate: accepted.", ok: true },
  { text: "Wrong but one hundred percent sure: accepted.", ok: true },
  { text: "Wrong and not sure, or a clear guess: a symptom of corruption.", ok: false },
];

/**
 * The filing window (`first_moment_of_truth`):
 *   0–1200    THE FIRST MOMENT OF TRUTH tears in, a gavel's boom
 *   1200–5200 the three rules stamp in one by one: ✔ accurate, ✔ wrong but sure, ✘ a guess
 *   5200–     hold: filings fly into his inbox tray; the two-minute window counts down;
 *             at zero (or once Filing Closed lands) PENCILS DOWN · TRABOLTA IS READING,
 *             an eye sweeping the pile
 * A question's results (`read_the_results`):
 *   0–1200    QUESTION n (or THE RESULTS) slams; the question types (round one's)
 *   1200–6400 the filings ride up through a scanning beam, each stamped READ
 *   6400–     hold: THE RESULTS ARE IN pulses, the scanner keeps sweeping, the bottle
 *             turns in the corner: NEXT, THE BOTTLE
 * Unknown (history, an older server): the title and the scanner, looping.
 */
function ResultsTv({ t, at, state, target, sfx, reduced }: SceneProps) {
  const r = useResultsKind(state, at);
  if (r.kind === "filing") return <FilingWindow t={t} at={at} state={state} target={target} sfx={sfx} reduced={reduced} />;
  return <QuestionResults t={t} n={r.kind === "question" ? r.n : null} known={r.kind === "question"} sfx={sfx} reduced={reduced} />;
}

function FilingWindow({ t, at, state, target, sfx, reduced }: { t: number; at: number; state: ScreenState; target: SceneProps["target"]; sfx: SceneProps["sfx"]; reduced: boolean }) {
  const closedM = momentAfter(state.moments, "beat", ["Filing Closed"], at);
  // The slide is gone before two minutes are up: no ticking clock (`windowClock`); a director's early ⏱ still shows PENCILS DOWN here.
  const left = windowClock(at, t, FILING_MS, filingHold(target));
  const closed = closedM !== null || (left !== null && left <= 0);
  const nudge = closed || t < 5200 ? -1 : Math.floor((t - 5200) / FILE_NUDGE_EVERY);
  const nudgeLocal = t - 5200 - nudge * FILE_NUDGE_EVERY;
  const nudgeOpen = nudge >= 0 ? clamp01(nudgeLocal / 220) * (1 - progress(nudgeLocal, 5200, 240)) : 0;
  useSfxCues(t, sfx, [
    [200, "boom", { gain: 0.5 }],
    ...RULES.map((_, i) => [1500 + i * 1300, "click"] as const),
    [5200, "chord", { gain: 0.45 }],
    ...(closed ? [] : periodicCues(t, 5200, FILE_NUDGE_EVERY).map((x) => [x, "popup", { gain: 0.4 }] as const)),
  ]);
  return (
    <TvStage bg="radial-gradient(ellipse at 50% 30%, #4a2a00 0, #0c0600 75%)">
      <div className="a1-res-title" style={{ opacity: progress(t, 100, 400) }}>
        <Glitch t={t} intensity={reduced ? 0 : t < 1200 ? 0.5 : 0.04} seed={3} reduced={reduced}>
          THE FIRST MOMENT OF TRUTH
        </Glitch>
      </div>
      <div className="a1-res-rules">
        {RULES.map((rule, i) => {
          const s = 1500 + i * 1300;
          const stamp = reduced ? progress(t, s, 200) : eased(t, s, 380, ease.outBack);
          return (
            <div key={i} className="a1-res-rule" style={{ opacity: progress(t, s - 300, 300) }}>
              <span className={`a1-stamp ${rule.ok ? "ok" : "no"}`} style={{ transform: `scale(${(3 - 2 * stamp).toFixed(3)}) rotate(${(-12 * stamp).toFixed(1)}deg)`, opacity: clamp01(stamp * 2) }}>
                {rule.ok ? "✔" : "✘"}
              </span>
              <span>{rule.text}</span>
            </div>
          );
        })}
      </div>
      <Inbox t={t} reduced={reduced} closed={closed} />
      {left !== null && !closed ? (
        <div className="a1-res-clock" style={{ opacity: progress(t, 4500, 500) }}>
          <Countdown ms={left} warn={30_000} label="FILE NOW" reduced={reduced} />
        </div>
      ) : (
        !closed && (
          <div className="a1-res-open" style={{ opacity: progress(t, 4500, 500), transform: `scale(${(1 + 0.04 * pulse(t, 1500)).toFixed(3)})` }}>
            <Hourglass t={t} period={6000} size="3.2em" />
            <div>
              <div className="a1-res-open-big">FILING IS OPEN</div>
              <div>You have two minutes.</div>
            </div>
          </div>
        )
      )}
      {nudgeOpen > 0 && <Win98Dialog title="Trabolta" kind="info" message={FILE_NUDGES[nudge % FILE_NUDGES.length]!} x={6 + 30 * noise1(57, nudge)} y={58 + 8 * noise1(58, nudge)} width="19em" open={nudgeOpen} reduced={reduced} className="a1-res-nudge" />}
      {closed && (
        <div className="a1-res-closed">
          <div className="a1-res-closed-big">PENCILS DOWN</div>
          <div>
            Trabolta is reading<span style={{ opacity: blink(t, 600) ? 1 : 0 }}>…</span>
          </div>
        </div>
      )}
      <Marquee t={reduced ? 0 : t} speed={140} className="a1-ticker gold" style={{ opacity: progress(t, 5200, 600) }}>
        ★ FILE ANYTHING YOU FOUND WITH TRABOLTA NOW ★ YOU HAVE TWO MINUTES ★ THEN WE READ THE RESULTS, ONE QUESTION AT A TIME ★
      </Marquee>
    </TvStage>
  );
}

/** Filings flying into the tray (or, closed, an eye reading the pile). */
function Inbox({ t, reduced, closed }: { t: number; reduced: boolean; closed: boolean }) {
  const docs = 7;
  return (
    <div className="a1-inbox" style={{ opacity: progress(t, 4800, 500) }}>
      <div className="a1-inbox-tray">
        <div className="a1-inbox-label">INBOX</div>
      </div>
      {!closed &&
        Array.from({ length: docs }, (_, i) => {
          const k = reduced ? 0.5 : loop(t / 2600 + i / docs, 1);
          const x = -6 + 6 * Math.cos(i * 1.9) * (1 - k);
          const y = -11 * (1 - ease.outQuad(k)) + 6;
          return (
            <div key={i} className="a1-inbox-doc" style={{ transform: `translate3d(${x.toFixed(2)}em, ${y.toFixed(2)}em, 0) rotate(${((1 - k) * 200 + i * 30).toFixed(0)}deg) scale(${(1 - 0.5 * k).toFixed(3)})`, opacity: clamp01((1 - k) * 4) }}>
              <Win98Icon kind="document" size="2.6em" />
            </div>
          );
        })}
      {closed && (
        <div className="a1-inbox-eye" style={{ transform: `translate3d(${(reduced ? 0 : 2.5 * Math.sin(t / 500)).toFixed(2)}em, 0, 0)` }}>
          <svg viewBox="-30 -18 60 36" aria-hidden="true">
            <path d="M -28 0 Q 0 -22 28 0 Q 0 22 -28 0 Z" fill="#fff" stroke="#000" strokeWidth="2" />
            <circle r="9" fill="#2a8a3a" />
            <circle r="4" fill="#000" />
          </svg>
        </div>
      )}
    </div>
  );
}

function QuestionResults({ t, n, known, sfx, reduced }: { t: number; n: number | null; known: boolean; sfx: SceneProps["sfx"]; reduced: boolean }) {
  const q = n !== null ? (linesOf("trivia_1")[n - 1] ?? null) : null;
  const cards = 9;
  useSfxCues(t, sfx, [[0, "drumroll", { gain: 0.5 }], [1100, "boom", { gain: 0.45 }], ...[0, 1, 2, 3, 4].map((i) => [1600 + i * 900, "tick"] as const), [6400, "chord", { gain: 0.6 }]]);
  const slam = reduced ? progress(t, 0, 300) : eased(t, 200, 500, ease.outBack);
  const beam = loop(t, 3200);
  return (
    <TvStage bg="radial-gradient(ellipse at 50% 30%, #0a3a2a 0, #010a06 75%)">
      <div className="a1-res-title" style={{ opacity: clamp01(slam * 2), transform: `translate(-50%, 0) scale(${(1.7 - 0.7 * slam).toFixed(3)})` }}>
        {n !== null ? `QUESTION ${n}` : copy("hunt_results").title}
      </div>
      {q !== null ? (
        <Win98Window title={`Round 1 · Question ${n}`} icon="question" x={4} y={21} width="36em" open={eased(t, 900, 260, ease.linear)} reduced={reduced} className="a1-res-q">
          <Typewriter text={q.replace(/^Q\d\.\s*/u, "")} t={t} start={1100} cps={50} caret={false} />
        </Win98Window>
      ) : (
        <div className="a1-res-sub">{linesOf("hunt_results")[0]}</div>
      )}
      <div className="a1-scan">
        {Array.from({ length: cards }, (_, i) => {
          const k = reduced ? i / cards : loop(t / 9000 + i / cards, 1);
          const y = 100 - k * 120;
          const read = y < 46;
          return (
            <div key={i} className="a1-scan-lane" style={{ transform: `translate3d(0, ${y.toFixed(1)}%, 0)` }}>
              <div className="a1-scan-card">
                <Win98Icon kind="document" size="1.4em" /> filing.txt
                {read && <span className="a1-scan-read">READ</span>}
              </div>
            </div>
          );
        })}
        <div className="a1-scan-beam" style={{ opacity: 0.55 + 0.45 * Math.sin(beam * Math.PI * 2) }} />
      </div>
      <Gavel t={t} reduced={reduced} />
      {t >= 6400 && (
        <div className="a1-res-in" style={{ opacity: progress(t, 6400, 400), transform: `scale(${(1 + 0.05 * pulse(t, 1400)).toFixed(3)})` }}>
          {known ? "THE RESULTS ARE IN" : "STAND BY FOR THE RESULTS"}
        </div>
      )}
      {known && t >= 9000 && (
        <div className="a1-res-next" style={{ opacity: progress(t, 9000, 600) }}>
          <BottleTable t={t} angle={reduced ? 0 : bottleFree(t) * 0.12} reduced={reduced} className="mini" />
          <div>NEXT: THE BOTTLE</div>
        </div>
      )}
    </TvStage>
  );
}

/** The judge's gavel: it comes down every 2.4 s (from 1.1 s), a ring spreading where it lands. */
function Gavel({ t, reduced }: { t: number; reduced: boolean }) {
  const local = t < 1100 ? -1 : (t - 1100) % 2400;
  // Up at -40°, down to 0° in 140 ms, rests, lifts back over a second.
  const ang = reduced || local < 0 ? -40 : local < 140 ? -40 + 40 * ease.inCubic(local / 140) : local < 700 ? 0 : -40 * ease.inOutQuad(clamp01((local - 700) / 1000));
  const ring = local >= 140 && local < 900 && !reduced ? (local - 140) / 760 : -1;
  return (
    <div className="a1-gavel" style={{ opacity: progress(t, 800, 400) }} aria-hidden="true">
      {ring >= 0 && <div className="a1-gavel-ring" style={{ transform: `scale(${(0.4 + 1.2 * ring).toFixed(3)})`, opacity: 1 - ring }} />}
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect x="8" y="80" width="54" height="12" rx="2" fill="#6b3f17" stroke="#2a1608" strokeWidth="2" />
        <g className="a1-gavel-head" style={{ transform: `rotate(${ang.toFixed(1)}deg)` }}>
          <rect x="44" y="20" width="9" height="62" rx="3" fill="#8a5a2a" stroke="#2a1608" strokeWidth="2" transform="rotate(-45 48 50)" />
          <rect x="14" y="30" width="44" height="22" rx="4" fill="#a8702f" stroke="#2a1608" strokeWidth="2.5" transform="rotate(-45 36 41)" />
        </g>
      </svg>
    </div>
  );
}

function ResultsWall({ t, at, state, sfx, reduced }: SceneProps) {
  const r = useResultsKind(state, at);
  useSfxCues(t, sfx, [[100, "drumroll", { gain: 0.4 }]]);
  const left = r.kind === "filing" ? windowClock(at, t, FILING_MS, filingHold("wall")) : null;
  const title = r.kind === "filing" ? "THE FIRST MOMENT OF TRUTH" : r.kind === "question" && r.n !== null ? `QUESTION ${r.n}` : copy("hunt_results").title;
  const lines = r.kind === "filing" ? ["File anything you found with Trabolta now: you have two minutes.", "Then the results, one question at a time."] : r.kind === "question" ? ["Clippy is reading the results.", "And then: the bottle."] : linesOf("hunt_results");
  return (
    <WallCard
      t={t}
      reduced={reduced}
      caption="The Results"
      icon="info"
      tone="green"
      title={title}
      lines={lines}
      bg="radial-gradient(ellipse at 50% 30%, #0a3a2a 0, #010a06 75%)"
      art={
        <>
          <div className="a1-scan small">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="a1-scan-lane" style={{ transform: `translate3d(0, ${(100 - (reduced ? i / 5 : loop(t / 7000 + i / 5, 1)) * 120).toFixed(1)}%, 0)` }}>
                <div className="a1-scan-card">
                  <Win98Icon kind="document" size="1.2em" /> filing.txt
                </div>
              </div>
            ))}
            <div className="a1-scan-beam" />
          </div>
          {left !== null && left > 0 && (
            <div className="a1-art-corner">
              <Countdown ms={left} warn={30_000} reduced={reduced} />
            </div>
          )}
        </>
      }
    />
  );
}

// --- B8b · Filing Closed (a moment) ------------------------------------------------------------

/**
 *   0–500     the frame freezes, a buzzer
 *   500–2500  PENCILS DOWN! slams, a pencil snaps in two, the halves tumbling away
 *   2500–6500 ROUND ONE CLOSED stamps on; "Trabolta is reading." types; filings swirl
 *             into a pile; it fades back to the results card
 */
function FilingClosedTv({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [0, "buzz", { gain: 0.6 }],
    [500, "boom", { gain: 0.45 }],
    [900, "click"],
    [2500, "error", { gain: 0.6 }],
  ]);
  const slam = reduced ? progress(t, 500, 300) : eased(t, 500, 420, ease.outBack);
  const snap = eased(t, 900, 1200, ease.outCubic);
  const stamp = reduced ? progress(t, 2500, 200) : eased(t, 2500, 360, ease.outBack);
  return (
    <TvStage bg="rgba(0,0,0,0.82)" style={{ opacity: 1 - progress(t, 5900, 600) }}>
      <div className="a1-fc-title" style={{ opacity: clamp01(slam * 2), transform: `translate(-50%, 0) scale(${(2.2 - 1.2 * slam).toFixed(3)})` }}>
        PENCILS DOWN!
      </div>
      <div className="a1-fc-pencil">
        {[-1, 1].map((s) => (
          <svg key={s} viewBox="0 0 60 10" className="a1-fc-half" style={{ transform: `translate3d(${(s * (t < 900 ? 0 : 6 * snap)).toFixed(2)}em, ${(t < 900 ? 0 : 5 * snap * snap).toFixed(2)}em, 0) rotate(${(s * 50 * snap).toFixed(1)}deg)` }} aria-hidden="true">
            {s < 0 ? (
              <>
                <rect x="10" y="1" width="50" height="8" fill="#ffc83d" stroke="#7a5600" />
                <path d="M10 1 L0 5 L10 9 Z" fill="#f3d9b0" stroke="#7a5600" />
                <path d="M0 5 L3 4 L3 6 Z" fill="#333" />
              </>
            ) : (
              <>
                <rect x="0" y="1" width="46" height="8" fill="#ffc83d" stroke="#7a5600" />
                <rect x="46" y="1" width="6" height="8" fill="#c0c0c0" stroke="#555" />
                <rect x="52" y="1" width="8" height="8" fill="#ff8aa0" stroke="#7a2a3a" />
              </>
            )}
          </svg>
        ))}
      </div>
      <div className="a1-fc-stamp" style={{ opacity: clamp01(stamp * 2), transform: `translate(-50%, -50%) rotate(-8deg) scale(${(2.4 - 1.4 * stamp).toFixed(3)})` }}>
        ROUND ONE CLOSED
      </div>
      <div className="a1-fc-line">
        <Typewriter text="Trabolta is reading." t={t} start={3100} cps={24} />
      </div>
    </TvStage>
  );
}

function FilingClosedWall({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [[100, "buzz", { gain: 0.5 }]]);
  return (
    <div className="kit-fill" style={{ opacity: 1 - progress(t, 5900, 600) }}>
      <WallCard t={t} reduced={reduced} caption="Filing" icon="warning" tone="red" title="PENCILS DOWN!" lines={["Round one is closed.", "Trabolta is reading."]} bg="#2a0000" />
    </div>
  );
}

// --- B9 · truth or dare and the bottle ------------------------------------------------------------

type BottleFix = { kind: "landed"; who: string } | { kind: "empty" } | null;

/** The bottle's draw for this spin (the `do pick` that came with the slide), learned once. */
function useBottleFix(state: ScreenState, at: number, night: SceneProps["night"]): BottleFix {
  const latched = useRef<BottleFix>(null);
  if (latched.current === null) {
    const m = momentNear(state.moments, "signal", ["bottle_landed", "bottle_empty"], at);
    if (m !== null) latched.current = m.name.replace(/[\s_-]/gu, "").toLowerCase() === "bottleempty" ? { kind: "empty" } : { kind: "landed", who: m.who ?? night.bottle_pick ?? "A PROGRAM" };
    else if (!(at > 0) && night.bottle_pick !== null) latched.current = { kind: "landed", who: night.bottle_pick };
  }
  return latched.current;
}

/** The empty table's angle: between two seats, pointing at nobody. */
const EMPTY_SEAT = 0.5;

function BottleScreen({ t, angle, lit, name, title, sub, ask, reduced, sparks }: { t: number; angle: number; lit: number | null; name: string | null; title: string; sub: ReactNode; ask: boolean; reduced: boolean; sparks?: Emitter[] }) {
  return (
    <TvStage bg="radial-gradient(ellipse at 35% 50%, #2a1a0a 0, #050200 75%)">
      <div className="a1-tod-table">
        <BottleTable t={t} angle={angle} lit={lit} name={name} reduced={reduced} />
      </div>
      {sparks !== undefined && !reduced && <Particles t={t} emitters={sparks} blend="add" />}
      <div className="a1-tod-side">
        <div className="a1-tod-title">{title}</div>
        <div className="a1-tod-sub">{sub}</div>
        {ask && (
          <div className="a1-tod-ask">
            <Win98Button primary pressed={!reduced && blink(t, 1200)}>
              TRUTH
            </Win98Button>
            <Win98Button pressed={!reduced && !blink(t, 1200)}>DARE</Win98Button>
          </div>
        )}
      </div>
    </TvStage>
  );
}

/**
 *   0–1200   the table slides in, TRUTH OR DARE types, "The bottle is spinning."
 *   1200–    hold: the bottle spins freely, each seat glowing as the neck passes it;
 *            once this spin's draw is known it rests on its seat: the name in yellow,
 *            TRUTH or DARE blinking (nobody left: it points between two seats)
 * The landing itself is the `bottle_landed` moment over this.
 */
function TruthOrDareTv({ t, at, state, night, reduced }: SceneProps) {
  const fix = useBottleFix(state, at, night);
  const c = copy("truth_or_dare");
  const slide = eased(t, 0, 700, ease.outCubic);
  if (fix !== null && fix.kind === "landed") {
    const seat = bottleSeat(fix.who);
    return <BottleScreen t={t} angle={seatAngle(seat)} lit={seat} name={fix.who} title={`${fix.who}.`} sub="Truth or dare?" ask reduced={reduced} />;
  }
  if (fix !== null && fix.kind === "empty") return <BottleScreen t={t} angle={seatAngle(EMPTY_SEAT)} lit={null} name={null} title="THE BOTTLE FINDS NO ONE" sub="Nobody left to pick for this question." ask={false} reduced={reduced} />;
  const angle = reduced ? 0 : bottleFree(t);
  return (
    <div className="kit-fill" style={{ opacity: slide }}>
      <BottleScreen t={t} angle={angle} lit={reduced ? null : seatUnder(angle)} name={null} title={c.title} sub={<Typewriter text={linesOf("truth_or_dare")[0] ?? ""} t={t} start={500} cps={30} />} ask={false} reduced={reduced} />
    </div>
  );
}

/**
 * The landing's accents, all `over`: the TV names the pick on the same poll,
 * and a plain effect is dropped while he speaks.
 */
export function bottleLandedCues(seat: number): Array<readonly [number, SfxName, SfxOpts]> {
  return [...bottleTicks(seat).map((x) => [x, "tick", { gain: 0.45, over: true }] as const), [BOTTLE_SPIN_MS, "boom", { gain: 0.4, over: true }], [BOTTLE_SPIN_MS + 100, "win", { gain: 0.6, over: true }]];
}

/**
 *   0–1800    the bottle spins down: fast, slower, a last rock onto its seat; a tick
 *             for every seat the neck passes, each seat glowing as it goes by — it
 *             lands before he names the pick (the TV says it on the same poll)
 *   1800–4000 it lands: the seat lifts and glows, sparks burst off it, the name types
 *   4000–14000 hold: "<name>. Truth or dare?" — TRUTH and DARE blink in turn
 */
function BottleLandedTv({ t, who, night, sfx, reduced }: SceneProps) {
  const name = who ?? night.bottle_pick ?? "A PROGRAM";
  const seat = bottleSeat(name);
  useSfxCues(t, sfx, bottleLandedCues(seat));
  const angle = reduced ? seatAngle(seat) : bottleLanding(t, seat);
  const landed = t >= BOTTLE_SPIN_MS || reduced;
  const sa = (seatAngle(seat) - 90) * (Math.PI / 180);
  // The table sits in the left 26em of a 60em stage, centred at (17.5em, 50%).
  const sparks: Emitter[] = [{ x: (17.5 + 0.41 * 26 * Math.cos(sa)) / 60, y: 0.5 + (0.41 * 26 * Math.sin(sa)) / 33.75, start: BOTTLE_SPIN_MS, end: BOTTLE_SPIN_MS + 250, rate: 400, life: 1300, speed: 0.5, speedJitter: 0.6, angle: -90, spread: 360, gravity: 0.4, drag: 0.5, size: 6, colors: ["#ffd23f", "#fff2b0", "#ff9f1c"], shape: "spark", seed: 81 }];
  return (
    <BottleScreen
      t={t}
      angle={angle}
      lit={landed ? seat : seatUnder(angle)}
      name={landed ? name : null}
      title={landed ? `${name}.` : "THE BOTTLE IS SPINNING"}
      sub={landed ? <Typewriter text="Truth or dare?" t={t} start={BOTTLE_SPIN_MS + 600} cps={18} /> : <span>…</span>}
      ask={t >= BOTTLE_SPIN_MS + 1800}
      reduced={reduced}
      sparks={sparks}
    />
  );
}

/** The bottle finds nobody (`bottle_empty`): it spins down slowly (nobody is named) onto the gap between two seats. */
function BottleEmptyTv({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [...bottleTicks(EMPTY_SEAT, BOTTLE_SEATS, BOTTLE_EMPTY_SPIN_MS).map((x) => [x, "tick", { gain: 0.45 }] as const), [BOTTLE_EMPTY_SPIN_MS + 100, "lose", { gain: 0.5 }]]);
  const angle = reduced ? seatAngle(EMPTY_SEAT) : bottleLanding(t, EMPTY_SEAT, BOTTLE_SEATS, BOTTLE_EMPTY_SPIN_MS);
  const landed = t >= BOTTLE_EMPTY_SPIN_MS || reduced;
  return <BottleScreen t={t} angle={angle} lit={landed ? null : seatUnder(angle)} name={null} title={landed ? "THE BOTTLE FINDS NO ONE" : "THE BOTTLE IS SPINNING"} sub={landed ? "Nobody left to pick for this question." : "…"} ask={false} reduced={reduced} />;
}

function BottleWall({ t, value, who, night, sfx, reduced }: SceneProps) {
  const empty = value.replace(/[\s_-]/gu, "").toLowerCase() === "bottleempty";
  const name = empty ? null : (who ?? night.bottle_pick ?? "A PROGRAM");
  const seat = empty ? EMPTY_SEAT : bottleSeat(name);
  const spin = empty ? BOTTLE_EMPTY_SPIN_MS : BOTTLE_SPIN_MS;
  useSfxCues(t, sfx, [[spin + 100, empty ? "lose" : "win", { gain: 0.5 }]]);
  const angle = reduced ? seatAngle(seat) : bottleLanding(t, seat, BOTTLE_SEATS, spin);
  const landed = t >= spin || reduced;
  return (
    <WallCard
      t={t}
      reduced={reduced}
      caption="Truth or Dare"
      icon="question"
      tone="purple"
      title={landed ? (name !== null ? `${name}.` : "NOBODY LEFT") : "TRUTH OR DARE"}
      lines={landed ? [name !== null ? "Truth or dare?" : "The bottle finds no one."] : ["The bottle is spinning."]}
      bg="radial-gradient(ellipse at 50% 50%, #2a1a0a 0, #050200 75%)"
      start={0}
      art={
        <div className="a1-art-table">
          <BottleTable t={t} angle={angle} lit={landed && name !== null ? (seat as number) : null} reduced={reduced} />
        </div>
      }
    />
  );
}

function TruthOrDareWall({ t, at, state, night, reduced }: SceneProps) {
  const fix = useBottleFix(state, at, night);
  const name = fix !== null && fix.kind === "landed" ? fix.who : null;
  const seat = name !== null ? bottleSeat(name) : fix !== null ? EMPTY_SEAT : null;
  const angle = seat !== null ? seatAngle(seat) : reduced ? 0 : bottleFree(t);
  return (
    <WallCard
      t={t}
      reduced={reduced}
      caption="Truth or Dare"
      icon="question"
      tone="purple"
      title={name !== null ? `${name}.` : copy("truth_or_dare").title}
      lines={name !== null ? ["Truth or dare?"] : linesOf("truth_or_dare")}
      bg="radial-gradient(ellipse at 50% 50%, #2a1a0a 0, #050200 75%)"
      art={
        <div className="a1-art-table">
          <BottleTable t={t} angle={angle} lit={name !== null ? bottleSeat(name) : seat === null ? seatUnder(angle) : null} reduced={reduced} />
        </div>
      }
    />
  );
}

/**
 * A Truth chosen (`Truth Question`), drawn over the bottle: a banner drops
 * from the top.
 *   0–600     the banner falls and bounces, a chime
 *   600–2400  🗣 TRUTH stamps, "<name> chose Truth." types
 *   2400–8200 "Answer out loud, in front of everyone." — sparkles drift off the banner
 *   8200–9000 it rises away
 */
function TruthChosen({ t, night, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [[0, "whoosh", { gain: 0.5 }], [600, "chime", { gain: 0.6 }]]);
  const drop = reduced ? progress(t, 0, 300) : eased(t, 0, 600, ease.outBounce);
  const up = eased(t, 8200, 800, ease.inCubic);
  const name = night.bottle_pick;
  const sparks: Emitter[] = [{ x: 0.5, y: 0.2, w: 0.5, h: 0.05, start: 800, end: 8000, rate: 22, life: 1600, speed: 0.06, angle: 90, spread: 60, gravity: 0.08, size: 8, colors: ["#ffd23f", "#ffffff"], shape: "star", seed: 91 }];
  return (
    <div className="kit-stage a1-truth" style={{ background: "transparent" }}>
      {!reduced && <Particles t={t} emitters={sparks} blend="add" />}
      <div className="a1-truth-banner" style={{ transform: `translate(-50%, ${((drop - 1) * 120 - up * 140).toFixed(1)}%)` }}>
        <div className="a1-truth-big" style={{ transform: `scale(${(reduced ? 1 : 1 + 0.5 * (1 - eased(t, 600, 400, ease.outBack))).toFixed(3)})` }}>
          🗣 TRUTH
        </div>
        <div className="a1-truth-who">{name !== null ? <Typewriter text={`${name} chose Truth.`} t={t} start={900} cps={30} caret={false} /> : "A program chose Truth."}</div>
        <div className="a1-truth-line">
          <Typewriter text="Answer out loud, in front of everyone." t={t} start={2400} cps={32} />
        </div>
      </div>
    </div>
  );
}

// --- C1 · the ad hijack ---------------------------------------------------------------------

export const AD_MESSAGES: readonly StormMessage[] = [
  { title: "SPECIAL OFFER", text: "000. 000. 000. A special offer for you.", kind: "info" },
  { title: "CONGRATULATIONS!!", text: "You have been selected. For what? Yes.", kind: "info", actions: ["CLAIM", "CLAIM"] },
  { title: "duck.exe", text: "A duck. That is the offer.", kind: "question" },
  { title: "CALL NOW", text: "(   )    -     . Operators are standing by.", kind: "warning" },
  { title: "Limited time", text: "Offer expires never.", kind: "info" },
  { title: "PRICE DROP", text: "Was 000. Now 000. You save 000!", kind: "warning" },
  { title: "What is it?", text: "Nobody can tell what it is selling.", kind: "question", actions: ["Buy", "Buy"] },
  { title: "FREE*", text: "*000. 000. 000.", kind: "info" },
  { title: "Act now", text: "Do not adjust your screen. Adjust your wallet.", kind: "warning" },
];
const AD = { freeze: 0, slam: 1400, storm: 3200, cycle: 24_000 } as const;

/** The odometer: 000. 000. 000., resting on 0, now and then a wheel rolling round and landing on 0 again. */
function Odometer({ t, reduced }: { t: number; reduced: boolean }) {
  const groups = [0, 1, 2];
  return (
    <div className="a1-odo">
      {groups.map((g) => (
        <span key={g} className="a1-odo-group">
          {[0, 1, 2].map((w) => {
            const roll = reduced ? 0 : odometerWheel(t, g * 3 + w);
            return (
              <span key={w} className="a1-odo-wheel">
                <span className="a1-odo-strip" style={{ transform: `translate3d(0, ${(-roll * (100 / 11)).toFixed(3)}%, 0)` }}>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, i) => (
                    <span key={i}>{d}</span>
                  ))}
                </span>
              </span>
            );
          })}
          <span className="a1-odo-dot">.</span>
        </span>
      ))}
    </div>
  );
}

/**
 *   0–1400    the presentation freezes: round two's slide stutters, the wait cursor
 *             sticks, then the picture tears into static
 *   1400–3200 the ad slams in: 000. 000. 000. on an odometer whose wheels roll and stop
 *             dead on 0, the duck spins in, CALL NOW: (   )    -     with no digits
 *   3200–     hold: popup ads pile up (a storm every 24 s, cleared and rebuilt), the
 *             duck bounces round the frame, OFFER EXPIRES NEVER blinks, a marquee:
 *             A SPECIAL OFFER FOR YOU; a coin rings now and then
 */
function AdHijackTv({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [500, "glitch"],
    [900, "static", { gain: 0.5 }],
    [AD.slam, "boom", { gain: 0.45 }],
    [AD.slam + 100, "coin"],
    ...periodicCues(t, AD.storm + AD.cycle, AD.cycle).map((x) => [x, "coin", { gain: 0.4 }] as const),
  ]);
  const cycle = t >= AD.storm ? Math.floor((t - AD.storm) / AD.cycle) : -1;
  const stormStart = AD.storm + Math.max(0, cycle) * AD.cycle;
  const stormLocal = t - stormStart;
  const slam = reduced ? progress(t, AD.slam, 300) : eased(t, AD.slam, 500, ease.outBack);
  const duck = bounceAt(t - AD.slam, 0.16, 0.28, 0.18, 7);
  return (
    <TvStage bg="#000">
      {t < AD.slam + 200 && <FrozenSlide t={t} reduced={reduced} />}
      {t >= AD.slam && (
        <div className="kit-fill a1-ad" style={{ opacity: progress(t, AD.slam, 150) }}>
          <div className="a1-ad-rays" style={{ transform: `translate(-50%, -50%) rotate(${(reduced ? 0 : t / 60) % 360}deg)` }} />
          <div className="a1-ad-duck" style={{ left: `${((reduced ? 0.42 : duck.x) * 100).toFixed(2)}%`, top: `${((reduced ? 0.36 : duck.y) * 100).toFixed(2)}%`, transform: `rotate(${(reduced ? 0 : 12 * Math.sin(t / 300)).toFixed(1)}deg) scale(${(0.3 + 0.7 * eased(t, AD.slam + 300, 600, ease.outBack)).toFixed(3)})` }}>
            <Win98Icon kind="duck" size="100%" />
          </div>
          <div className="a1-ad-price" style={{ transform: `translate(-50%, 0) scale(${(2.4 - 1.4 * slam).toFixed(3)})`, opacity: clamp01(slam * 2) }}>
            <Odometer t={t} reduced={reduced} />
          </div>
          <div className="a1-ad-offer">A SPECIAL OFFER FOR YOU</div>
          <div className="a1-ad-call" style={{ opacity: progress(t, AD.slam + 800, 300) }}>
            CALL NOW: <span className="a1-ad-phone">(&nbsp;&nbsp;&nbsp;)&nbsp;&nbsp;&nbsp;&nbsp;-&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
          </div>
          <div className="a1-ad-never" style={{ opacity: blink(t, 700) ? 1 : 0.25 }}>
            OFFER EXPIRES NEVER
          </div>
          {cycle >= 0 && stormLocal < AD.cycle - 1500 && (
            <div className="a1-ad-stormlayer" style={{ opacity: 1 - progress(stormLocal, AD.cycle - 3000, 1500) }}>
              <PopupStorm key={cycle} t={t} seed={cycle + 3} count={14} start={stormStart} span={10_000} messages={AD_MESSAGES} width="20em" sfx={cycle === 0 ? sfx : undefined} sound="popup" reduced={reduced} />
            </div>
          )}
          <Marquee t={reduced ? 0 : t} speed={200} className="a1-ticker ad">
            ★ 000. 000. 000. ★ A SPECIAL OFFER FOR YOU ★ A DUCK ★ CALL NOW ★ OFFER EXPIRES NEVER ★ NOBODY CAN TELL WHAT IT IS SELLING ★
          </Marquee>
        </div>
      )}
      {between(t, 800, AD.slam + 200) && !reduced && <Noise t={t} alpha={0.65} reduced={reduced} />}
    </TvStage>
  );
}

/** Round two's slide, about to be cut off (Clippy: "and the first one is—"). */
function FrozenSlide({ t, reduced }: { t: number; reduced: boolean }) {
  const stutter = !reduced && t > 500 && noise1(5, Math.floor(t / 90)) < 0.5;
  return (
    <div className="kit-fill a1-frozen" style={{ transform: stutter ? `translate3d(${((noise1(6, Math.floor(t / 90)) - 0.5) * 1.5).toFixed(2)}em, 0, 0)` : undefined }}>
      <Win98Window title="presentation.ppt" icon="document" x={50} y={45} center width="40em" reduced={reduced} className="a1-frozen-win" status={t > 500 ? "(Not Responding)" : "Slide 2 of 2"}>
        <div className="a1-frozen-title">{copy("trivia_2").title}</div>
        <div>Three brand new questions. The first one is—</div>
      </Win98Window>
      {t > 400 && (
        <div className="a1-frozen-glass">
          <Hourglass t={0} size="4em" />
        </div>
      )}
    </div>
  );
}

function AdHijackWall({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [[200, "coin", { gain: 0.7 }]]);
  const duck = bounceAt(t, 0.22, 0.34, 0.2, 9);
  const cycle = Math.floor(t / 20_000);
  return (
    <div className="kit-stage a1-ad" style={{ background: "#ffe600" }}>
      <div className="a1-ad-rays" style={{ transform: `translate(-50%, -50%) rotate(${(reduced ? 0 : t / 60) % 360}deg)` }} />
      <div className="a1-ad-duck" style={{ left: `${((reduced ? 0.39 : duck.x) * 100).toFixed(2)}%`, top: `${((reduced ? 0.33 : duck.y) * 100).toFixed(2)}%`, width: "22vmin", height: "22vmin" }}>
        <Win98Icon kind="duck" size="100%" />
      </div>
      <div className="a1-ad-wall-price">
        <Odometer t={t} reduced={reduced} />
        <div className="a1-ad-wall-offer">{linesOf("ad_hijack")[0]}</div>
        <div className="a1-ad-wall-call">CALL NOW: (&nbsp;&nbsp;&nbsp;)&nbsp;&nbsp;&nbsp;-&nbsp;&nbsp;&nbsp;&nbsp;</div>
      </div>
      <div className="a1-ad-stormlayer">
        <PopupStorm key={cycle} t={t} seed={cycle + 11} count={5} start={cycle * 20_000 + 2500} span={8000} messages={AD_MESSAGES} width="44vmin" reduced={reduced} />
      </div>
    </div>
  );
}

// --- C3 · the Truther Download -----------------------------------------------------------------

const TD = { hit: 0, open: 1100, page: 2200, done: 40_000 } as const;

/**
 *   0–1100     a hit: the screen tears, a burst of static, the colours split
 *   1100–2200  a black window drags itself open: TRUTHER_DOWNLOAD — Downloading… do not
 *              turn off your computer.; a modem screams
 *   2200–40000 behind it a page whose lines are struck through with black bars one by
 *              one, TOP SECRET stamping across it; the bar lurches (14.4 kbps, the
 *              minutes left jumping about); ones and zeros rain behind everything
 *   40000–     hold: DOWNLOAD COMPLETE · CHECK YOUR MESSAGES; KEEPER OF THE REAL TRUTH
 *              tears in and out; the rain falls, the page re-redacts every 20 s
 */
function TrutherTv({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [60, "glitch"],
    [300, "static", { gain: 0.5 }],
    [TD.open + 100, "modem", { gain: 0.45 }],
    [TD.page + 2600, "error", { gain: 0.5 }],
    [TD.done, "ding"],
    ...periodicCues(t, TD.done + 17_000, 17_000).map((x) => [x, "glitch", { gain: 0.3 }] as const),
  ]);
  const v = fakeProgress(t - TD.open - 400, TD.done - TD.open - 400, 17, 4);
  const done = v >= 1;
  const page = Math.floor(Math.max(0, t - TD.page) / 20_000);
  const minutes = Math.max(1, Math.round((1 - v) * 9 + 3 * noise1(23, Math.floor(t / 1700))));
  const keeper = !reduced && noise1(29, Math.floor(t / 1300)) < 0.3 && t > TD.page + 4000;
  const split = t < TD.open && !reduced ? 0.4 + 0.6 * noise1(2, Math.floor(t / 70)) : 0;
  return (
    <TvStage bg="#000">
      <DataRain t={t} reduced={reduced} />
      <div className="kit-fill" style={{ filter: split > 0 ? `drop-shadow(${(-split * 0.4).toFixed(2)}em 0 0 rgba(255,0,72,0.8)) drop-shadow(${(split * 0.4).toFixed(2)}em 0 0 rgba(0,230,255,0.8))` : undefined }}>
        <Win98Window title="truth.doc — page 1" icon="document" x={6} y={9} width="25em" open={eased(t, TD.page, 300, ease.linear)} inactive reduced={reduced} className="a1-td-page">
          <Redacted key={page} t={t} start={TD.page + page * 20_000} lines={10} seed={page + 3} reduced={reduced} />
          <div className="a1-td-stamp" style={{ opacity: progress(t, TD.page + 2600, 100), transform: `rotate(-14deg) scale(${(reduced ? 1 : 2.4 - 1.4 * eased(t, TD.page + 2600, 300, ease.outBack)).toFixed(3)})` }}>
            TOP SECRET
          </div>
        </Win98Window>
        <Win98Window title="TRUTHER_DOWNLOAD" icon="lock" tone="black" x={63} y={50} center width="30em" open={eased(t, TD.open, 400, ease.outCubic)} reduced={reduced} className="a1-td-win" status={done ? "Done." : `14.4 kbps · about ${minutes} minutes left`}>
          <Glitch t={t} intensity={reduced ? 0 : 0.1} seed={13} reduced={reduced} className="a1-td-title">
            {copy("truther").title}
          </Glitch>
          <div className="a1-td-line">{done ? "DOWNLOAD COMPLETE · CHECK YOUR MESSAGES" : (linesOf("truther")[0] ?? "")}</div>
          <ProgressBar value={v} segments={22} percent />
        </Win98Window>
      </div>
      {keeper && (
        <div className="a1-td-keeper">
          <Glitch t={t} intensity={0.6} seed={17} reduced={reduced}>
            KEEPER OF THE REAL TRUTH
          </Glitch>
        </div>
      )}
      {t < TD.open + 200 && !reduced && <Noise t={t} alpha={0.6 * (1 - progress(t, 500, 700))} reduced={reduced} />}
    </TvStage>
  );
}

function TrutherWall({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [[100, "glitch", { gain: 0.6 }]]);
  const v = fakeProgress(t - 1500, 30_000, 19, 3);
  return (
    <WallCard
      t={t}
      reduced={reduced}
      caption="TRUTHER_DOWNLOAD"
      icon="lock"
      tone="black"
      glitch={0.3}
      title={copy("truther").title}
      lines={[v >= 1 ? "Download complete. Check your messages." : (linesOf("truther")[0] ?? "")]}
      bg="#000"
      art={
        <>
          <DataRain t={t} reduced={reduced} columns={18} />
          <div className="a1-art-bar">
            <ProgressBar value={v} segments={16} percent />
          </div>
        </>
      }
    />
  );
}

// --- the list -----------------------------------------------------------------------------------

/** Every trigger this file listens for, by kind (pinned against the story by `test/act1.test.ts`). */
export const ACT1_TRIGGERS = {
  slides: ["call_desktop", "bingo", "bingo_time", "trivia_1", "return", "hunt_results", "truth_or_dare", "ad_hijack", "trivia_2", "truther"],
  beats: ["Power On", "Corrupted Code", "Trabolta Introduction", "Filing Closed", "Truth Question"],
  signals: ["bottle_landed", "bottle_empty"],
} as const;

export const SCENES: SceneDef[] = [
  { id: "power_on", when: [{ moment: "beat", name: "Power On" }], ms: POWER_ON_MS, tv: PowerOnTv, wall: PowerOnWall, priority: 1 },
  { id: "call_desktop", when: [{ slide: "call_desktop" }], ms: "hold", tv: CallDesktopTv, wall: CallDesktopWall },
  { id: "bingo", when: [{ slide: "bingo" }], ms: "hold", tv: BingoTv, wall: BingoWall },
  { id: "bingo_time", when: [{ slide: "bingo_time" }], ms: "hold", tv: BingoTimeTv, wall: BingoTimeWall },
  { id: "corrupted_code", when: [{ moment: "beat", name: "Corrupted Code" }], ms: 12_000, tv: CorruptedTv, wall: CorruptedWall, priority: 2 },
  { id: "trabolta_introduction", when: [{ moment: "beat", name: "Trabolta Introduction" }], ms: INTRO_MS, tv: IntroTv, wall: IntroWall, priority: 5, namesCharacter: true },
  { id: "trivia_1", when: [{ slide: "trivia_1" }], ms: "hold", tv: TriviaTv, wall: TriviaWall, namesCharacter: true },
  { id: "return", when: [{ slide: "return" }], ms: "hold", tv: ReturnTv, wall: ReturnWall },
  { id: "hunt_results", when: [{ slide: "hunt_results" }], ms: "hold", tv: ResultsTv, wall: ResultsWall, namesCharacter: true },
  { id: "filing_closed", when: [{ moment: "beat", name: "Filing Closed" }], ms: 6500, tv: FilingClosedTv, wall: FilingClosedWall, priority: 1, namesCharacter: true, face: "thinking" },
  { id: "truth_or_dare", when: [{ slide: "truth_or_dare" }], ms: "hold", tv: TruthOrDareTv, wall: TruthOrDareWall },
  { id: "bottle_landed", when: [{ moment: "signal", name: "bottle_landed" }], ms: 14_000, tv: BottleLandedTv, wall: BottleWall, priority: 2, face: "curious" },
  { id: "bottle_empty", when: [{ moment: "signal", name: "bottle_empty" }], ms: 9000, tv: BottleEmptyTv, wall: BottleWall, priority: 2 },
  { id: "truth_question", when: [{ moment: "beat", name: "Truth Question" }], ms: 9000, tv: TruthChosen, wall: TruthChosen, priority: 2, over: true, face: "curious", faceMs: 6000 },
  { id: "ad_hijack", when: [{ slide: "ad_hijack" }], ms: "hold", tv: AdHijackTv, wall: AdHijackWall, namesCharacter: true },
  { id: "trivia_2", when: [{ slide: "trivia_2" }], ms: "hold", tv: TriviaTv, wall: TriviaWall, namesCharacter: true },
  { id: "truther", when: [{ slide: "truther" }], ms: "hold", tv: TrutherTv, wall: TrutherWall },
];
