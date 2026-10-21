//! The cutscenes of the house-wide moments with no slide of their own (lane
//! tv3): the golden duck's release (GERALD CAN'T HELP, and no egg, when the
//! find is kept), and the four `play_on_the_screens` clips.
//! Owned by its lane; the engine (`../registry.ts`) only lists them.
//! See `../types.ts` for the contract and `../kit/` for the building blocks.
//!
//! The duck can be found before the character is introduced (the first
//! reinstallation), so nothing here names him. The clips are the wall
//! terminals' only (`terminals_<clip>`: the TV never gets them) — so their
//! `wall` take is the full one, a looping little web page in each clip's
//! spirit, all original art.

import "./moments.css";
import type { SceneDef, SceneProps } from "../types.ts";
import {
  Confetti,
  Marquee,
  Particles,
  ProgressBar,
  Stage,
  Typewriter,
  Win98Dialog,
  Win98Window,
  blink,
  clamp01,
  ease,
  eased,
  fakeProgress,
  lerp,
  loop,
  progress,
  pulse,
  useSfxCues,
  type Emitter,
} from "../kit/index.ts";
import { FloatLayer, GoldenDuck, RainCanvas, Sunburst } from "../kit/tv3-parts.tsx";
import { whoSeed } from "../kit/tv3-time.ts";

const fade = (t: number, a: number, din: number, b = Number.POSITIVE_INFINITY, dout = 600) => progress(t, a, din) * (1 - progress(t, b, dout));

function slam(t: number, at: number, reduced: boolean, dur = 420) {
  const k = progress(t, at, dur);
  if (reduced) return { opacity: k };
  return { opacity: clamp01(k * 3), transform: `scale(${lerp(2.4, 1, ease.outBack(k)).toFixed(3)})` };
}

/** The program's name as the screen shows it (no name on the moment: "A PROGRAM"). */
export function finderName(who: string | null): string {
  const w = who === null ? "" : who.trim();
  return w === "" ? "A PROGRAM" : w.toUpperCase();
}

// --- the golden duck (found "golden duck") ------------------------------------------------------
//
//   0–1300    the dark turns gold: a sunburst grows, Gerald rises (a win)
//   1200      FOUND THE GOLDEN DUCK slams in (a sparkle)
//   1900      the finder's NAME lands (a tada, confetti, sparks)
//   3000–4300 Gerald lays his golden egg (a sparkle)
//   3200–6200 "Reinstalling…" lurches to REINSTALLATION COMPLETE
//   6200–8800 hold: Gerald bobs and blinks, the rays turn, stars twinkle
//   8800–10000 out

const DUCK = { rise: 300, head: 1200, name: 1900, egg: 3000, install: 3200, done: 6200, out: 8800, end: 10_000 } as const;

const GOLD = ["#ffd23f", "#fff2b0", "#ff9f1c", "#ffffff"] as const;

function sparks(at: number, seed: number): Emitter[] {
  return [
    { x: 0.5, y: 0.5, start: at, end: at + 160, rate: 700, life: 1500, speed: 0.85, speedJitter: 0.6, angle: -90, spread: 360, gravity: 0.5, drag: 0.6, size: 7, colors: GOLD, shape: "spark", seed },
    { x: 0.5, y: 0.5, start: at, end: at + 100, rate: 300, life: 2000, speed: 0.5, angle: -90, spread: 360, gravity: 0.25, drag: 0.4, size: 12, colors: GOLD, shape: "star", seed: seed + 1 },
  ];
}

function GoldenDuckScene({ t, who, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [DUCK.rise, "win"],
    [DUCK.head, "sparkle", { gain: 0.7 }],
    [DUCK.name, "tada"],
    [DUCK.egg + 600, "sparkle"],
    [DUCK.done, "chord", { gain: 0.6 }],
  ]);
  const name = finderName(who);
  const rise = reduced ? fade(t, DUCK.rise, 600) : ease.outBack(progress(t, DUCK.rise, 1000));
  const bob = reduced ? 0 : Math.sin(t / 520) * 2.5;
  const egg = eased(t, DUCK.egg, 1300, ease.outBounce);
  const bar = fakeProgress(t - DUCK.install, DUCK.done - DUCK.install, whoSeed(who), 2);
  const done = t >= DUCK.done;
  return (
    <Stage bg="radial-gradient(ellipse at 50% 55%, #4a3200 0%, #120a00 75%)" className="tv3-duck-stage">
      <div className="kit-fill" style={{ opacity: fade(t, 0, 400, DUCK.out, DUCK.end - DUCK.out) }}>
        <Sunburst t={t} rays={20} color="rgba(255, 214, 64, 0.28)" reduced={reduced} className="tv3-duck-burst" style={{ opacity: progress(t, 0, 1200), transform: `scale(${lerp(0.3, 1, eased(t, 0, 1300)).toFixed(3)})` }} />
        {!lite && !reduced && <Particles t={t} emitters={sparks(DUCK.name, whoSeed(who) % 997)} blend="add" />}
        <div className="tv3-duck-gerald" style={{ opacity: clamp01(rise * 2), transform: `translate(-50%, ${(lerp(70, 0, rise) + bob).toFixed(1)}%)` }}>
          <GoldenDuck egg={egg} blinkOn={blink(t, 3100, 0.05)} size={lite ? "40vmin" : "36vmin"} />
        </div>
        {t >= DUCK.head && (
          <div className="tv3-duck-head" style={slam(t, DUCK.head, reduced)}>
            FOUND THE GOLDEN DUCK
          </div>
        )}
        {t >= DUCK.name && (
          <div className="tv3-duck-name" style={slam(t, DUCK.name, reduced, 380)}>
            {name}
          </div>
        )}
        {t >= DUCK.install && (
          <div className="tv3-duck-install" style={{ opacity: progress(t, DUCK.install, 400) }}>
            {done ? <div className="tv3-duck-done" style={slam(t, DUCK.done, reduced, 300)}>REINSTALLATION COMPLETE</div> : <ProgressBar value={bar} label="Reinstalling…" percent />}
          </div>
        )}
        {!reduced && t >= DUCK.name && <Confetti t={t} start={DUCK.name} dur={4200} density={lite ? 0.45 : 1} seed={whoSeed(who) % 991} colors={GOLD} />}
      </div>
    </Stage>
  );
}

// --- the kept find (found "golden duck kept": the story keeps them) --------------------------------
//
//   0–1100    grey rain; Gerald, not gold, waddles in from the right
//   1100      GERALD CAN'T HELP slams in (a sad sting); no egg, ever
//   2000      the finder's name under it
//   3200      a "Gerald cannot help you." box opens; Gerald shakes his head
//   8000–9000 out

const KEPT = { walk: 0, line: 1100, name: 2000, box: 3200, out: 8000, end: 9000 } as const;

function KeptDuckScene({ t, who, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [KEPT.line, "lose"],
    [KEPT.box, "error", { gain: 0.6 }],
  ]);
  const walk = reduced ? 1 : eased(t, KEPT.walk, KEPT.line, ease.outCubic);
  const waddle = reduced || walk >= 1 ? 0 : Math.sin(t / 90) * 6;
  const no = t >= KEPT.box && !reduced ? Math.sin((t - KEPT.box) / 140) * 10 * (1 - progress(t, KEPT.box + 1800, 600)) : 0;
  return (
    <Stage bg="linear-gradient(180deg, #1a2030 0%, #2a3040 60%, #10141c 100%)" className="tv3-duck-stage">
      <div className="kit-fill" style={{ opacity: fade(t, 0, 400, KEPT.out, KEPT.end - KEPT.out) }}>
        <RainCanvas t={t} count={lite ? 60 : 150} speed={1.3} slant={0.12} color="170, 180, 200" reduced={reduced} style={{ opacity: 0.55 }} />
        <div className="tv3-duck-gerald" style={{ opacity: progress(t, 0, 400), transform: `translate(${lerp(120, -50, walk).toFixed(1)}%, 0) rotate(${(waddle + no).toFixed(1)}deg)` }}>
          <GoldenDuck gold={false} sad egg={0} size={lite ? "38vmin" : "34vmin"} />
        </div>
        {t >= KEPT.line && (
          <div className="tv3-duck-head tv3-duck-kept" style={slam(t, KEPT.line, reduced)}>
            GERALD CAN&apos;T HELP
          </div>
        )}
        {t >= KEPT.name && (
          <div className="tv3-duck-name tv3-duck-name-kept" style={{ opacity: progress(t, KEPT.name, 500) }}>
            {finderName(who)}
          </div>
        )}
        {!lite && t >= KEPT.box && <Win98Dialog title="Gerald" kind="info" message="Gerald cannot help you." x={50} y={86} center width="22em" open={eased(t, KEPT.box, 260, ease.linear)} reduced={reduced} />}
      </div>
    </Stage>
  );
}

// --- the clips (Trabolta's play_on_the_screens, fact M19; wall terminals only) ---------------------
// Each is a little 1999 web page in the clip's spirit, original art,
// looping for the slide's whole hold. Words are the slide copy's.

/** A dancing baby (original): big head, a diaper, arms and legs on the beat. */
function Baby({ pose, size = "40vmin" }: { pose: number; size?: string }) {
  const arms = [
    [40, -40],
    [140, -30],
    [30, -140],
    [150, -150],
  ][pose % 4]!;
  const legs = [
    [10, -10],
    [-25, 5],
    [5, 25],
    [-15, 15],
  ][pose % 4]!;
  return (
    <svg viewBox="-50 -60 100 130" width={size} height={size} className="tv3-baby" aria-hidden="true">
      <g transform={`rotate(${legs[0]} -9 30)`}>
        <rect x="-13" y="30" width="8" height="26" rx="4" fill="#ffd2b0" stroke="#8a5a3a" />
      </g>
      <g transform={`rotate(${legs[1]} 9 30)`}>
        <rect x="5" y="30" width="8" height="26" rx="4" fill="#ffd2b0" stroke="#8a5a3a" />
      </g>
      <ellipse cx="0" cy="16" rx="16" ry="20" fill="#ffd2b0" stroke="#8a5a3a" />
      <path d="M-15 22 Q0 40 15 22 L13 34 Q0 42 -13 34 Z" fill="#fff" stroke="#8a8a8a" />
      <g transform={`rotate(${arms[0]} -14 4)`}>
        <rect x="-18" y="2" width="7" height="22" rx="3.5" fill="#ffd2b0" stroke="#8a5a3a" />
      </g>
      <g transform={`rotate(${arms[1]} 14 4)`}>
        <rect x="11" y="2" width="7" height="22" rx="3.5" fill="#ffd2b0" stroke="#8a5a3a" />
      </g>
      <circle cx="0" cy="-24" r="22" fill="#ffd2b0" stroke="#8a5a3a" />
      <circle cx="-8" cy="-26" r="3" fill="#000" />
      <circle cx="8" cy="-26" r="3" fill="#000" />
      <path d={pose % 2 === 0 ? "M-8 -14 Q0 -6 8 -14" : "M-6 -13 Q0 -9 6 -13"} stroke="#8a3a3a" strokeWidth="2.2" fill="none" />
      <path d="M-2 -46 Q2 -54 6 -46" stroke="#8a5a3a" strokeWidth="2" fill="none" />
    </svg>
  );
}

const BEAT_MS = 500;

function DancingBaby({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [200, "click", { gain: 0.5 }],
    [2300, "blip"],
  ]);
  const loading = t < 2200;
  const beat = Math.floor(t / BEAT_MS);
  const pose = reduced ? 0 : beat;
  const hop = reduced ? 0 : Math.sin(Math.PI * loop(t, BEAT_MS)) * 6;
  return (
    <Stage bg="#000" className="tv3-clip tv3-baby-stage">
      {loading ? (
        <Win98Window title="Media Player - baby.avi" icon="computer" center x={50} y={50} width="min(86%, 30em)" open={eased(t, 0, 260, ease.linear)} reduced={reduced}>
          <div className="tv3-clip-load">Loading baby.avi…</div>
          <ProgressBar value={fakeProgress(t - 300, 1800, 9, 2)} percent />
        </Win98Window>
      ) : (
        <>
          <div className="tv3-floor">
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} style={{ background: ["#ff2bd6", "#28f0ff", "#ffe23f", "#7dff3c"][(i + beat) % 4], opacity: (i + beat) % 3 === 0 ? 0.95 : 0.35 }} />
            ))}
          </div>
          <Sunburst t={t} rays={14} color="rgba(255, 255, 255, 0.09)" reduced={reduced} className="tv3-clip-burst" />
          <div className="tv3-baby-pos" style={{ transform: `translate(-50%, ${(-hop).toFixed(1)}%)` }}>
            <Baby pose={pose} size="46vmin" />
          </div>
          <div className="tv3-clip-title">DANCING BABY</div>
          <div className="tv3-ooga">
            {"♪ ooga-chaka ♪".split("").map((c, i) => (
              <span key={i} style={{ transform: reduced ? undefined : `translateY(${(Math.sin(t / 160 + i * 0.6) * 18).toFixed(1)}%)` }}>
                {c === " " ? " " : c}
              </span>
            ))}
          </div>
        </>
      )}
    </Stage>
  );
}

/** A hamster (original): round, ears, a little bounce. */
function Hamster({ squash }: { squash: number }) {
  return (
    <svg viewBox="-20 -20 40 36" className="tv3-hamster" style={{ transform: `scale(${(1 + squash * 0.12).toFixed(3)}, ${(1 - squash * 0.12).toFixed(3)})` }} aria-hidden="true">
      <circle cx="-9" cy="-12" r="5" fill="#e0a060" stroke="#6a3a10" />
      <circle cx="9" cy="-12" r="5" fill="#e0a060" stroke="#6a3a10" />
      <ellipse cx="0" cy="2" rx="16" ry="13" fill="#e8b070" stroke="#6a3a10" />
      <ellipse cx="0" cy="7" rx="9" ry="6" fill="#fff0d8" />
      <circle cx="-5" cy="-2" r="2" fill="#000" />
      <circle cx="5" cy="-2" r="2" fill="#000" />
      <circle cx="0" cy="2" r="1.6" fill="#ff7aa0" />
    </svg>
  );
}

function HamsterDance({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [[300, "blip", { pitch: 1.4 }]]);
  const visitors = 1999 + Math.floor(t / 900);
  return (
    <Stage bg="#ffffcc" className="tv3-clip tv3-hamster-stage">
      <div className="tv3-hamster-title" style={{ opacity: fade(t, 0, 500) }}>
        {"THE HAMSTER DANCE".split("").map((c, i) => (
          <span key={i} style={{ color: ["#ff0000", "#ff8800", "#00aa00", "#0000ff", "#aa00aa"][i % 5], transform: reduced ? undefined : `translateY(${(Math.sin(t / 200 + i * 0.5) * 14).toFixed(1)}%)` }}>
            {c === " " ? " " : c}
          </span>
        ))}
      </div>
      <div className="tv3-hamster-grid">
        {Array.from({ length: 12 }, (_, i) => {
          const local = t - (i % 4) * 120 - Math.floor(i / 4) * 60;
          const up = reduced ? 0 : Math.abs(Math.sin((local / 400) * Math.PI));
          return (
            <span key={i} className="tv3-hamster-cell" style={{ opacity: fade(t, 200 + i * 90, 300), transform: `translateY(${(-up * 28).toFixed(1)}%)` }}>
              <Hamster squash={1 - up} />
            </span>
          );
        })}
      </div>
      <Marquee t={reduced ? 0 : t} speed={120} className="tv3-clip-marquee">
        {"Welcome to Hampton's page.  ♪ ♪ ♪  "}
      </Marquee>
      <div className="tv3-counter">
        You are visitor <b>{String(visitors).padStart(6, "0")}</b>
      </div>
    </Stage>
  );
}

/** The digger (original): a hard-hatted stick worker with a shovel. */
function Digger({ dig }: { dig: number }) {
  const arm = lerp(-30, 25, dig);
  return (
    <svg viewBox="-30 -50 60 90" className="tv3-digger" aria-hidden="true">
      <circle cx="0" cy="-32" r="8" fill="#ffd2b0" stroke="#000" />
      <path d="M-10 -36 Q0 -48 10 -36 Z" fill="#ffd21f" stroke="#000" />
      <path d="M0 -24 V6 M0 6 L-10 32 M0 6 L10 32" stroke="#000" strokeWidth="3" />
      <g transform={`rotate(${arm.toFixed(1)} 0 -16)`}>
        <path d="M0 -16 L18 -2" stroke="#000" strokeWidth="3" />
        <path d="M14 -8 L30 20" stroke="#8a5a2a" strokeWidth="3" />
        <path d="M26 16 L36 24 L30 30 L22 22 Z" fill="#9a9a9a" stroke="#000" />
      </g>
      <rect x="-6" y="-22" width="12" height="16" fill="#ff7a00" opacity="0.9" />
    </svg>
  );
}

function UnderConstruction({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [[300, "buzz", { gain: 0.4 }]]);
  const dig = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t / 260);
  const visitor = 400 + Math.floor(t / 650);
  const chips: Emitter[] = [{ x: 0.62, y: 0.7, start: 0, end: 10_000_000, rate: 14, life: 900, speed: 0.4, angle: -60, spread: 50, gravity: 1.2, size: 6, colors: ["#8a5a2a", "#6a4a1a", "#a07a3a"], shape: "pixel", seed: 201 }];
  return (
    <Stage bg="#c0c0c0" className="tv3-clip tv3-uc-stage">
      <div className="tv3-stripes tv3-stripes-top">
        <span style={{ transform: `translate3d(${(-(reduced ? 0 : loop(t, 1600)) * 8).toFixed(2)}vmin, 0, 0)` }} />
      </div>
      <div className="tv3-uc-title" style={{ opacity: blink(t, 1000, 0.7) ? 1 : 0.25 }}>
        UNDER CONSTRUCTION
      </div>
      <div className="tv3-uc-scene">
        <Digger dig={dig} />
        <svg viewBox="0 0 30 40" className="tv3-ucone" aria-hidden="true">
          <path d="M15 2 L26 34 H4 Z" fill="#ff6a00" stroke="#000" />
          <path d="M9 18 H21 M7 26 H23" stroke="#fff" strokeWidth="3" />
          <rect x="1" y="34" width="28" height="5" fill="#333" />
        </svg>
      </div>
      {!reduced && <Particles t={t} emitters={chips} />}
      <div className="tv3-new" style={{ transform: `rotate(${(reduced ? 0 : (t / 12) % 360).toFixed(1)}deg) scale(${(0.9 + 0.1 * pulse(t, 900)).toFixed(3)})` }}>
        NEW!
      </div>
      <div className="tv3-uc-text">
        <Typewriter text={"This page is under construction.\nPlease come back soon!"} t={t} start={600} cps={22} />
      </div>
      <div className="tv3-counter tv3-uc-counter">
        You are visitor #<b>{String(visitor).padStart(6, "0")}</b>
      </div>
      <div className="tv3-stripes tv3-stripes-bottom">
        <span style={{ transform: `translate3d(${((reduced ? 0 : loop(t, 1600)) * 8 - 8).toFixed(2)}vmin, 0, 0)` }} />
      </div>
    </Stage>
  );
}

/** An envelope (original); `flap` 0 shut → 1 open, the letter rising with it. */
function Envelope({ flap, size = "36vmin" }: { flap: number; size?: string }) {
  const letter = lerp(0, -26, clamp01((flap - 0.4) / 0.6));
  return (
    <svg viewBox="-40 -50 80 80" width={size} height={size} className="tv3-envelope" aria-hidden="true">
      <g transform={`translate(0 ${letter.toFixed(1)})`}>
        <rect x="-26" y="-20" width="52" height="34" fill="#fff" stroke="#888" />
        <path d="M-18 -10 H18 M-18 -2 H14 M-18 6 H10" stroke="#3a6aff" strokeWidth="2" />
      </g>
      <rect x="-34" y="-14" width="68" height="40" fill="#f2e3b0" stroke="#5a4a20" strokeWidth="1.5" />
      <path d="M-34 26 L0 4 L34 26" fill="#e8d498" stroke="#5a4a20" strokeWidth="1.5" />
      <path d={`M-34 -14 L0 ${lerp(10, -40, flap).toFixed(1)} L34 -14 Z`} fill="#e0c88a" stroke="#5a4a20" strokeWidth="1.5" />
    </svg>
  );
}

function YouveGotMail({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [200, "whoosh", { gain: 0.6 }],
    [1300, "ding"],
    [1900, "chime", { gain: 0.5 }],
  ]);
  const fly = reduced ? 1 : ease.outCubic(progress(t, 100, 1100));
  const flap = eased(t, 1200, 700, ease.inOutQuad);
  const bounce = reduced ? 0 : Math.abs(Math.sin(t / 300)) * 8 * (t > 1900 ? 1 : 0);
  return (
    <Stage bg="linear-gradient(180deg, #003a8a 0%, #0a64c8 100%)" className="tv3-clip tv3-mail-stage">
      <FloatLayer t={t} start={2200} every={900} life={7000} seed={211} size="6vmin" reduced={reduced} glyph={() => <span className="tv3-mini-mail">✉</span>} />
      <div className="tv3-mail-env" style={{ transform: `translate(${lerp(140, -50, fly).toFixed(1)}%, -50%) rotate(${lerp(18, 0, fly).toFixed(1)}deg)` }}>
        <Envelope flap={flap} size="40vmin" />
      </div>
      {t >= 1900 && (
        <div className="tv3-mail-title" style={{ ...slam(t, 1900, reduced), marginTop: `${(-bounce).toFixed(1)}vmin` }}>
          YOU&apos;VE GOT MAIL!
        </div>
      )}
      {t >= 2600 && (
        <Win98Window title="Inbox" icon="mail" center x={50} y={84} width="min(86%, 26em)" open={eased(t, 2600, 260, ease.linear)} reduced={reduced} className="tv3-mail-inbox">
          <div className="tv3-mail-row">
            <b>1 new message in your Inbox.</b>
            <span className="tv3-mail-dot" style={{ opacity: blink(t, 1000) ? 1 : 0.2 }} />
          </div>
        </Win98Window>
      )}
    </Stage>
  );
}

export const SCENES: SceneDef[] = [
  { id: "golden_duck", when: [{ moment: "found", name: "golden duck" }], ms: DUCK.end, tv: GoldenDuckScene, wall: GoldenDuckScene, priority: 2, face: "pleased" },
  { id: "golden_duck_kept", when: [{ moment: "found", name: "golden duck kept" }], ms: KEPT.end, tv: KeptDuckScene, wall: KeptDuckScene, priority: 2, face: "sly" },
  { id: "dancing_baby", when: [{ slide: "dancing_baby" }], ms: "hold", wall: DancingBaby },
  { id: "hamster_dance", when: [{ slide: "hamster_dance" }], ms: "hold", wall: HamsterDance },
  { id: "under_construction", when: [{ slide: "under_construction" }], ms: "hold", wall: UnderConstruction },
  { id: "youve_got_mail", when: [{ slide: "youve_got_mail" }], ms: "hold", wall: YouveGotMail },
];
