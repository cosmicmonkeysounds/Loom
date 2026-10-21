//! The two boots of Act A–C (lane tv1): the house powering on at the doors
//! (`Power On`, before anyone may name the character) and the character's
//! introduction — the biggest TV moment of the night: a BIOS POST, the
//! memory count, a startup logo, his face assembling line by line and the
//! greeting typed out, then the hand-back to the live face underneath.
//! Every frame is a picture of `t`; the storyboards sit on each scene.

import "./tv1.css";
import type { SceneProps } from "../types.ts";
import { useSfxCues } from "./cues.ts";
import { Particles, Starfield } from "./canvas-fx.tsx";
import { Glitch, Hourglass, Noise } from "./effects.tsx";
import { Typewriter } from "./text.tsx";
import { between, blink, clamp01, ease, eased, fakeProgress, lerp, progress, typedCount, typedDuration } from "./time.ts";
import { AssembleFace, DuckEmblem, useEndAt } from "./tv1-parts.tsx";
import { INTRO_POST, bootLinesAt, bounceAt, memoryCount } from "./tv1-time.ts";
import { Desktop, ProgressBar, Win98Window, type DesktopIcon } from "./win98.tsx";
import type { Emitter } from "./physics.ts";

/** The CRT warming up: a bright line opening to the full picture (`dur` ms). */
export function CrtOn({ t, dur = 900, reduced }: { t: number; dur?: number; reduced: boolean }) {
  if (t >= dur) return null;
  const line = eased(t, 0, dur * 0.45, ease.outCubic);
  const open = eased(t, dur * 0.4, dur * 0.6, ease.inOutQuad);
  if (reduced) return <div className="kit-fill" style={{ background: "#000", opacity: 1 - progress(t, 0, dur) }} />;
  return (
    <div className="kit-fill a1-crt" aria-hidden="true">
      <div className="a1-crt-line" style={{ transform: `scale(${(0.02 + 0.98 * line).toFixed(3)}, ${(0.004 + 0.996 * open).toFixed(4)})`, opacity: 1 - open * 0.92 }} />
    </div>
  );
}

// --- Power On ------------------------------------------------------------------------------

/** The house's boot (moment beat `Power On`, 14 s). Nobody named. */
export const POWER_ON_MS = 14_000;

const PO = { splash: 900, desk: 5000, idle: 9500, out: 12500, end: POWER_ON_MS } as const;

const DESK_ICONS: readonly DesktopIcon[] = [
  { label: "My Computer", kind: "computer" },
  { label: "Recycle Bin", kind: "trash" },
  { label: "The Internet", kind: "globe" },
  { label: "Inbox", kind: "mail" },
  { label: "My Documents", kind: "folder" },
  { label: "Gerald.exe", kind: "duck" },
];

const SPLASH_SPARKS: Emitter[] = [{ x: 0.5, y: 0.42, w: 0.5, h: 0.2, start: PO.splash + 400, end: PO.desk, rate: 40, life: 1800, speed: 0.06, angle: -90, spread: 120, size: 3, colors: ["#ffffff", "#bfe9ff", "#ffd23f"], shape: "dot", seed: 21, fade: 0.6 }];

/**
 *   0–900       the CRT warms: a white line opens to the picture, a hiss
 *   900–5000    the splash: the Maps and Ducks emblem flies in, MAPS AND DUCKS 98
 *               drops letter by letter, the gradient bar runs under it, sparkles
 *   5000–9500   the desktop: the taskbar, the icons popping one by one, the startup chord
 *   9500–12500  nobody touches it: the screen dims, the emblem starts its bounce
 *               (the logo that never quite hits the corner)
 *   12500–14000 the hand-back: it fades into the screensaver underneath
 */
export function PowerOnTv({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [60, "click"],
    [250, "static", { gain: 0.4 }],
    [PO.splash + 100, "whoosh", { gain: 0.7 }],
    [PO.desk, "startup"],
    [PO.idle + 300, "blip", { gain: 0.4 }],
  ]);
  const fadeOut = 1 - progress(t, PO.out, PO.end - PO.out);
  return (
    <div className="kit-stage a1-tv" style={{ background: "#000", opacity: fadeOut }}>
      <div className="kit-stage-fit">
        {between(t, PO.splash, PO.desk + 600) && <PowerSplash t={t} reduced={reduced} />}
        {t >= PO.desk && <PowerDesktop t={t} reduced={reduced} />}
      </div>
      <CrtOn t={t} reduced={reduced} />
    </div>
  );
}

function PowerSplash({ t, reduced }: { t: number; reduced: boolean }) {
  const word = "MAPS AND DUCKS 98";
  const fly = reduced ? progress(t, PO.splash, 400) : eased(t, PO.splash, 900, ease.outBack);
  const out = 1 - progress(t, PO.desk, 600);
  const bar = progress(t, PO.splash + 600, PO.desk - PO.splash - 600);
  return (
    <div className="kit-fill a1-po-splash" style={{ opacity: out * clamp01((t - PO.splash) / 300) }}>
      {!reduced && <Starfield t={t} speed={0.05} count={140} bg={null} color="#bfe9ff" />}
      {!reduced && <Particles t={t} emitters={SPLASH_SPARKS} blend="add" />}
      <div className="a1-po-emblem" style={{ transform: `translate(-50%, -50%) scale(${(0.2 + 0.8 * fly).toFixed(3)}) rotate(${((1 - fly) * -40).toFixed(1)}deg)`, opacity: clamp01(fly * 2) }}>
        <DuckEmblem size="9em" />
      </div>
      <div className="a1-po-word">
        {word.split("").map((ch, i) => {
          const k = reduced ? progress(t, PO.splash + 700, 300) : eased(t, PO.splash + 700 + i * 70, 420, ease.outBounce);
          return (
            <span key={i} style={{ transform: `translate3d(0, ${((1 - k) * -3).toFixed(2)}em, 0)`, opacity: clamp01(k * 3) }}>
              {ch === " " ? " " : ch}
            </span>
          );
        })}
      </div>
      <div className="a1-po-bar">
        <div className="a1-po-bar-run" style={{ transform: `translate3d(${(lerp(-100, 100, (bar * 3) % 1)).toFixed(1)}%, 0, 0)` }} />
      </div>
      <div className="a1-po-small">Starting up…</div>
    </div>
  );
}

function PowerDesktop({ t, reduced }: { t: number; reduced: boolean }) {
  const shown = Math.max(0, Math.min(DESK_ICONS.length, Math.floor((t - PO.desk - 500) / 320) + 1));
  const dim = progress(t, PO.idle, 1400) * 0.72;
  const b = bounceAt(t - PO.idle, 0.14, 0.25, 0.16, 4);
  const bounceIn = progress(t, PO.idle + 600, 700);
  return (
    <div className="kit-fill" style={{ opacity: progress(t, PO.desk, 500) }}>
      <Desktop icons={DESK_ICONS.slice(0, shown)} taskbar={t >= PO.desk + 300} clock="7:00 PM" tasks={[]} className="a1-po-desk" />
      <Win98Window title="Welcome" icon="computer" x={50} y={44} center width="30em" open={eased(t, PO.desk + 1100, 280, ease.linear) * (1 - progress(t, PO.idle - 300, 260))} reduced={reduced} className="a1-po-welcome" status={t < PO.desk + 3200 ? "Starting up…" : "Ready"}>
        <div className="a1-po-welcome-row">
          <DuckEmblem size="4.4em" />
          <div className="a1-po-welcome-text">
            <b>
              <Typewriter text="Welcome to Maps and Ducks 98" t={t} start={PO.desk + 1400} cps={32} caret={false} />
            </b>
            <div className="a1-po-welcome-small">
              <Typewriter text="Somewhere a modem is waiting to be asked." t={t} start={PO.desk + 2500} cps={36} />
            </div>
          </div>
        </div>
      </Win98Window>
      <div className="kit-fill" style={{ background: "#000", opacity: dim }} />
      {t >= PO.idle + 600 && (
        <div className="a1-po-bounce" style={{ left: `${(reduced ? 43 : b.x * 100).toFixed(2)}%`, top: `${(reduced ? 37 : b.y * 100).toFixed(2)}%`, opacity: bounceIn }}>
          <DuckEmblem size="100%" />
        </div>
      )}
    </div>
  );
}

/** A wall's Power On ends here (the TV's runs `POWER_ON_MS`): it hands back to the idle show. */
export const POWER_ON_WALL_MS = 8000;

/** A wall terminal's Power On (8 s, then it ends: the idle show underneath). */
export function PowerOnWall({ t, sfx, reduced, done }: SceneProps) {
  useSfxCues(t, sfx, [
    [60, "click"],
    [1400, "startup", { gain: 0.6 }],
  ]);
  useEndAt(t, POWER_ON_WALL_MS, done);
  if (t >= POWER_ON_WALL_MS) return null;
  const fly = reduced ? progress(t, 900, 400) : eased(t, 900, 800, ease.outBack);
  const bar = fakeProgress(t - 1600, 4800, 3);
  return (
    <div className="kit-stage a1-po-wall" style={{ opacity: 1 - progress(t, 7200, 800) }}>
      <div className="a1-po-wall-emblem" style={{ transform: `scale(${(0.3 + 0.7 * fly).toFixed(3)})`, opacity: clamp01(fly * 2) }}>
        <DuckEmblem size="34vmin" />
      </div>
      <div className="a1-po-wall-word">
        <Typewriter text="MAPS AND DUCKS 98" t={t} start={1300} cps={24} caret={false} />
      </div>
      <div className="a1-po-wall-bar" style={{ opacity: progress(t, 1600, 300) }}>
        <ProgressBar value={bar} segments={20} label={bar >= 1 ? "Ready." : "Starting up…"} />
      </div>
      <CrtOn t={t} reduced={reduced} />
    </div>
  );
}

// --- the introduction ---------------------------------------------------------------------------

/** The introduction's length (ms): the boot, the face, the greeting, the hand-back. */
export const INTRO_MS = 27_000;

export const IN = { post: 1300, loading: 6400, splash: 9000, face: 13600, hello: 19000, back: 24600, end: INTRO_MS } as const;

/** The greeting, from the story's first scripted line for him (`Trabolta Introduction`). */
export const INTRO_HELLO = "HELLO, PROGRAMS.";
export const INTRO_LINE = "I am Trabolta. I keep the computer running.";

/** Pixels pulled in from every edge toward the logo. */
const INWARD: Emitter[] = (
  [
    [0.0, 0.5, 0, 0.05, 1],
    [1.0, 0.5, 180, 0.05, 1],
    [0.5, 0.0, 90, 1, 0.05],
    [0.5, 1.0, -90, 1, 0.05],
  ] as const
).map(([x, y, angle, w, h], i) => ({ x, y, w, h, start: IN.splash, end: IN.face - 900, rate: 26, life: 1000, speed: angle === 0 || angle === 180 ? 0.85 : 0.48, speedJitter: 0.15, angle, spread: 34, size: 3, colors: ["#3dff7a", "#e9fff1"], shape: "pixel" as const, seed: 31 + i, fade: 0.5 }));
const FACE_PIXELS: Emitter[] = [{ x: 0.5, y: 0.45, w: 0.36, h: 0.62, start: IN.face, end: IN.face + 2600, rate: 160, life: 700, speed: 0.04, angle: -90, spread: 360, size: 4, colors: ["#3dff7a", "#9cf5b8", "#ffffff"], shape: "pixel", seed: 32, fade: 0.9 }];
const HELLO_SPARKS: Emitter[] = [{ x: 0.5, y: 0.46, start: IN.hello + 50, end: IN.hello + 250, rate: 500, life: 1500, speed: 0.6, speedJitter: 0.5, angle: -90, spread: 360, gravity: 0.25, drag: 0.6, size: 5, colors: ["#3dff7a", "#e9fff1", "#ffd23f"], shape: "spark", seed: 33 }];

/**
 *   0–1300       the CRT warms out of black, a click, a hiss
 *   1300–6400    the BIOS POST: the header, the processor, the memory counting up to
 *                65536K, the drives (THE DESKTOP, THE INTERNET), the programs FOUND,
 *                the AI helper loading; the energy-saver eye top right; one POST beep
 *   6400–9000    STARTING TRABOLTA… a lurching bar, the hourglass, the modem
 *   9000–13600   the startup logo: pixels pulled in from everywhere, TRABOLTA in
 *                blocks, the gradient bar, the startup chord
 *   13600–19000  his face assembling: the outline traced, the skin scanned in, the eyes
 *                popping, the brows and the mouth; a progress line under it
 *   19000–24600  the greeting typed out under the face, the mouth moving with it,
 *                a spark burst, a blink
 *   24600–27000  the hand-back: everything but the face fades, then the face too —
 *                the live one is there underneath
 */
export function IntroTv({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [100, "click"],
    [350, "static", { gain: 0.45 }],
    [IN.post + 350, "blip"],
    [4100, "tick"],
    [4600, "tick"],
    [5100, "tick"],
    [5800, "tick"],
    [IN.loading + 200, "modem", { gain: 0.55 }],
    [IN.splash, "startup"],
    [IN.face, "whoosh", { gain: 0.6 }],
    [IN.face + 1600, "sparkle"],
    [IN.face + 3800, "chord", { gain: 0.7 }],
    [IN.hello, "boom", { gain: 0.35 }],
    [IN.hello + 100, "fanfare", { gain: 0.5 }],
  ]);
  const out = 1 - progress(t, IN.back + 1200, IN.end - IN.back - 1200);
  return (
    <div className="kit-stage a1-tv a1-in" style={{ background: t < IN.back ? "#000" : `rgba(0,0,0,${(1 - progress(t, IN.back, 1200)).toFixed(3)})`, opacity: out }}>
      <div className="kit-stage-fit">
        {t < IN.loading + 300 && <IntroPost t={t} reduced={reduced} />}
        {between(t, IN.loading, IN.splash + 300) && <IntroLoading t={t} reduced={reduced} />}
        {between(t, IN.splash, IN.face + 400) && <IntroSplash t={t} reduced={reduced} />}
        {t >= IN.face && <IntroFace t={t} reduced={reduced} />}
      </div>
      <CrtOn t={t} dur={1300} reduced={reduced} />
      {!reduced && t < IN.post + 800 && t > 300 && <Noise t={t} alpha={0.12 * (1 - progress(t, IN.post, 800))} reduced={reduced} />}
    </div>
  );
}

function IntroPost({ t, reduced }: { t: number; reduced: boolean }) {
  const lines = bootLinesAt(INTRO_POST, t);
  const kb = memoryCount(t, 2500, 1400);
  const out = 1 - progress(t, IN.loading, 300);
  return (
    <div className="kit-fill a1-post" style={{ opacity: clamp01((t - IN.post + 200) / 300) * out }}>
      <div className="a1-post-eye">
        <EyeMark t={t} reduced={reduced} />
        <div>EnergyWatcher</div>
      </div>
      <div className="a1-post-head">
        <Typewriter text="TRABOLTA BIOS v4.51 · (C) 1999 Maps and Ducks Systems" t={t} start={IN.post} cps={70} caret={false} pauses={false} />
      </div>
      <div className="a1-post-lines">
        {lines.map((l) => (
          <div key={l.text} className="a1-post-line">
            <Typewriter text={l.text} t={t} start={l.at} cps={60} caret={false} pauses={false} />
            {l.text === "Memory Test :" ? (
              <span className="a1-post-mem">
                {" "}
                {kb}K{kb >= 65_536 ? " OK" : ""}
              </span>
            ) : (
              l.status !== undefined && t >= l.at + (l.after ?? 0) + typedDuration(l.text, { cps: 60, pauses: false }) && <span className="a1-post-ok"> {l.status}</span>
            )}
          </div>
        ))}
      </div>
      <div className="a1-post-foot" style={{ opacity: blink(t, 1000) ? 1 : 0.15 }}>
        Press DEL to enter SETUP
      </div>
    </div>
  );
}

/** The energy-saver eye in the POST's corner (original art). */
function EyeMark({ t, reduced }: { t: number; reduced: boolean }) {
  const look = reduced ? 0 : 4 * Math.sin(t / 700);
  return (
    <svg viewBox="-30 -18 60 36" className="a1-eye" aria-hidden="true">
      <path d="M -28 0 Q 0 -22 28 0 Q 0 22 -28 0 Z" fill="#001a08" stroke="#3dff7a" strokeWidth="2.5" />
      <circle cx={look} cy="0" r="9" fill="#3dff7a" />
      <circle cx={look} cy="0" r="4" fill="#001a08" />
      <path d="M -24 -14 L -16 -8 M 24 -14 L 16 -8 M 0 -18 L 0 -11" stroke="#ffd23f" strokeWidth="2" />
    </svg>
  );
}

function IntroLoading({ t, reduced }: { t: number; reduced: boolean }) {
  const v = fakeProgress(t - IN.loading - 300, IN.splash - IN.loading - 500, 11, 2);
  const out = 1 - progress(t, IN.splash, 300);
  return (
    <div className="kit-fill a1-in-loading" style={{ opacity: progress(t, IN.loading, 300) * out }}>
      <div className="a1-in-dos">
        <Typewriter text={"C:\\> STARTING TRABOLTA…"} t={t} start={IN.loading + 100} cps={40} reserve={false} />
      </div>
      <Win98Window title="Loading" icon="computer" x={50} y={58} center width="30em" tone="black" reduced={reduced} open={eased(t, IN.loading + 700, 260, ease.linear)} className="a1-in-loadwin">
        <div className="a1-in-loadrow">
          <Hourglass t={t} size="3.4em" />
          <div className="a1-in-loadtext">
            <div>{v < 0.5 ? "Loading PERSONALITY.DLL" : v < 0.9 ? "Loading MANNERS.DLL" : "Loading VOICE.DRV"}</div>
            <ProgressBar value={v} percent />
          </div>
        </div>
      </Win98Window>
    </div>
  );
}

function IntroSplash({ t, reduced }: { t: number; reduced: boolean }) {
  const word = "TRABOLTA";
  const out = 1 - progress(t, IN.face, 400);
  const run = ((t - IN.splash) / 1600) % 1;
  return (
    <div className="kit-fill a1-in-splash" style={{ opacity: progress(t, IN.splash, 300) * out }}>
      {!reduced && <Particles t={t} emitters={INWARD} blend="add" />}
      <div className="a1-in-word">
        {word.split("").map((ch, i) => {
          const k = reduced ? progress(t, IN.splash + 300, 300) : eased(t, IN.splash + 500 + i * 140, 500, ease.outBack);
          return (
            <span key={i} style={{ transform: `translate3d(0, ${((1 - k) * 2.5).toFixed(2)}em, 0) scale(${(0.4 + 0.6 * k).toFixed(3)})`, opacity: clamp01(k * 2) }}>
              {ch}
            </span>
          );
        })}
      </div>
      <div className="a1-in-tag" style={{ opacity: progress(t, IN.splash + 1900, 600) }}>
        the computer's AI helper
      </div>
      <div className="a1-in-bar">
        <div className="a1-in-bar-run" style={{ transform: `translate3d(${lerp(-100, 100, reduced ? 0.5 : run).toFixed(1)}%, 0, 0)` }} />
      </div>
    </div>
  );
}

function IntroFace({ t, reduced }: { t: number; reduced: boolean }) {
  const helloN = typedCount(INTRO_HELLO, t, { start: IN.hello, cps: 12 });
  const lineAt = IN.hello + typedDuration(INTRO_HELLO, { cps: 12 }) + 300;
  const lineN = typedCount(INTRO_LINE, t, { start: lineAt, cps: 26 });
  const talking = (helloN > 0 && helloN < INTRO_HELLO.length) || (lineN > 0 && lineN < INTRO_LINE.length);
  const mouth = talking && !reduced ? 0.25 + 0.75 * Math.abs(Math.sin(t / 85)) : 0;
  const k = reduced ? progress(t, IN.face, 500) : eased(t, IN.face, 900, ease.outCubic);
  const chrome = 1 - progress(t, IN.back, 1200);
  const assembling = t < IN.hello;
  const bar = progress(t, IN.face + 200, IN.hello - IN.face - 600);
  return (
    <div className="kit-fill a1-in-facewrap">
      {!reduced && <Particles t={t} emitters={FACE_PIXELS} blend="add" />}
      <div className="a1-in-face" style={{ opacity: k, transform: `translate(-50%, -50%) scale(${(0.86 + 0.14 * k).toFixed(3)})` }}>
        <Glitch t={t} intensity={reduced || !assembling ? 0 : 0.18} seed={9} reduced={reduced}>
          <AssembleFace t={t} start={IN.face + 200} mouth={mouth} reduced={reduced} />
        </Glitch>
      </div>
      {!reduced && <Particles t={t} emitters={HELLO_SPARKS} blend="add" />}
      {assembling ? (
        <div className="a1-in-progress" style={{ opacity: progress(t, IN.face + 200, 400) * (1 - progress(t, IN.hello - 400, 400)) }}>
          <div className="a1-in-progress-label">{bar < 0.4 ? "Assembling face…" : bar < 0.8 ? "Calibrating eyes…" : "Ready."}</div>
          <div className="a1-in-progress-track">
            <div className="a1-in-progress-fill" style={{ transform: `scaleX(${bar.toFixed(3)})` }} />
          </div>
        </div>
      ) : (
        <div className="a1-in-hello" style={{ opacity: chrome }}>
          <div className="a1-in-hello-big">
            <Typewriter text={INTRO_HELLO} t={t} start={IN.hello} cps={12} caret={lineN === 0} />
          </div>
          <div className="a1-in-hello-line">
            <Typewriter text={INTRO_LINE} t={t} start={lineAt} cps={26} caret={lineN > 0} />
          </div>
        </div>
      )}
      <div className="a1-in-online" style={{ opacity: chrome * progress(t, IN.hello + 1500, 600) }}>
        <span className="a1-in-dot" style={{ opacity: blink(t, 900, 0.6) ? 1 : 0.25 }} /> ONLINE
      </div>
    </div>
  );
}

/** A wall's introduction ends here (the TV's runs `INTRO_MS`). */
export const INTRO_WALL_MS = 12_500;

/**
 * A wall terminal's introduction (≈ 12 s, then it ends: the live face
 * underneath). A Win98 card: CONNECTING… with a lurching bar, the face
 * assembling in it, TRABOLTA IS ONLINE typed, his thread open.
 */
export function IntroWall({ t, sfx, reduced, done }: SceneProps) {
  useSfxCues(t, sfx, [
    [100, "modem", { gain: 0.5 }],
    [3400, "chord", { gain: 0.6 }],
  ]);
  useEndAt(t, INTRO_WALL_MS, done);
  if (t >= INTRO_WALL_MS) return null;
  const v = fakeProgress(t - 300, 2800, 5, 2);
  const open = eased(t, 0, 380, ease.linear);
  const fade = 1 - progress(t, 11_500, 1000);
  return (
    <div className="kit-stage a1-in-wall" style={{ opacity: fade }}>
      <Starfield t={t} speed={reduced ? 0 : 0.12} count={120} color="#3dff7a" bg="#000" />
      <Win98Window title={v < 1 ? "Connecting…" : "Trabolta — Online"} icon="computer" tone={v < 1 ? "black" : "green"} x={50} y={48} center width="min(90vw, 30em)" open={open} reduced={reduced} className="a1w-win">
        <div className="a1-in-wall-face">
          {v < 1 ? (
            <div className="a1-in-wall-connect">
              <ProgressBar value={v} segments={18} label="Dialling the Desktop…" />
            </div>
          ) : (
            <AssembleFace t={t} start={3000} mouth={0} reduced={reduced} />
          )}
        </div>
        <div className="a1w-title">
          <Typewriter text="TRABOLTA IS ONLINE" t={t} start={4400} cps={20} caret={false} />
        </div>
        <div className="a1w-line">
          <Typewriter text="The computer's AI helper is speaking at the Desktop. His thread is open: say hello." t={t} start={5600} cps={30} />
        </div>
      </Win98Window>
    </div>
  );
}
