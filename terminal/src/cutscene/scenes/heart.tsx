//! The heart's room scenes (wave 20, CONTRACT-w20 §3.8): what the server-room
//! terminal draws when the story cues `room_heart_*` in a beat set in The
//! Server Room. Room scenes only — they play on that room's terminal (its
//! `room.cue`, D4), never on a wall or the TV, and they play while a line is
//! open too. The covering ones (`covers`) take the whole screen; the others
//! draw over the face and never over the heart's docked choices.
//!
//! Inside his world (D29): the machine in the room is *his heart*, the door
//! is *the door*, the bulb is *the light in his heart*. Nothing here names a
//! real person, a party, a show, or any of the real things it runs on.
//!
//! The scenes are drawn from `t` alone (the kit's rule): a reload lands on the
//! right frame and the sounds never replay late.

import "./heart.css";
import type { CSSProperties, ReactNode } from "react";
import type { SceneDef, SceneProps } from "../types.ts";
import { HEART_SCENE_MS } from "../../heart/heart.ts";
import { Bsod, Glitch, Noise, Typewriter, Win98Dialog, blink, clamp01, ease, eased, lerp, loop, noise1, progress, pulse, typedDuration, useSfxCues } from "../kit/index.ts";
import { AssembleFace } from "../kit/tv1-parts.tsx";

const fade = (t: number, a: number, din: number, b = Number.POSITIVE_INFINITY, dout = 500) => progress(t, a, din) * (1 - progress(t, b, dout));

/** The face's colours as the kit's face reads them: red (waking, angry) → cyan (listening). */
function faceColours(k: number): CSSProperties {
  // k 0 = red, 1 = cyan.
  const mix = (a: [number, number, number], b: [number, number, number]) => `rgb(${a.map((x, i) => Math.round(lerp(x, b[i]!, k))).join(", ")})`;
  return {
    "--face-hi": mix([255, 150, 140], [170, 250, 255]),
    "--face-lo": mix([190, 18, 30], [20, 150, 190]),
    "--phosphor": mix([255, 60, 60], [80, 230, 255]),
  } as CSSProperties;
}

/** A heartbeat's glow: two quick swells a beat (lub-dub), `period` ms. */
function lubDub(t: number, period: number): number {
  const x = loop(t, period);
  const a = Math.max(0, 1 - Math.abs(x - 0.05) / 0.07);
  const b = Math.max(0, 1 - Math.abs(x - 0.22) / 0.08) * 0.7;
  return Math.max(a, b);
}

/** Rings swelling out from the middle on every beat. */
function HeartRings({ t, period, colour, reduced }: { t: number; period: number; colour: string; reduced: boolean }) {
  if (reduced) return <div className="ht-glow" style={{ background: `radial-gradient(circle, ${colour} 0%, transparent 60%)`, opacity: 0.2 + 0.5 * lubDub(t, period) }} />;
  return (
    <div className="ht-rings" aria-hidden="true">
      {[0, 1, 2].map((i) => {
        const k = loop(t + (i * period) / 3, period);
        return <span key={i} style={{ borderColor: colour, transform: `scale(${lerp(0.2, 2.4, k).toFixed(3)})`, opacity: ((1 - k) * 0.7).toFixed(3) }} />;
      })}
      <div className="ht-glow" style={{ background: `radial-gradient(circle, ${colour} 0%, transparent 60%)`, opacity: 0.25 + 0.6 * lubDub(t, period) }} />
    </div>
  );
}

/** The hum of the machine: a live trace whose height is `level` (0..1); 0 is a flat line. */
function Hum({ t, level, colour = "#ff4a4a", className }: { t: number; level: number; colour?: string; className?: string }) {
  const n = 64;
  const pts = Array.from({ length: n }, (_, i) => {
    const x = (i / (n - 1)) * 200;
    const y = 30 + level * (Math.sin(i * 0.55 + t / 90) * 10 + Math.sin(i * 1.7 - t / 60) * 6 + (noise1(7, i + Math.floor(t / 70)) - 0.5) * 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg className={`ht-hum${className ? ` ${className}` : ""}`} viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={colour} strokeWidth="1.6" />
    </svg>
  );
}

/** The door in its frame: `open` 0..1 swings it, `lock` 0..1 lights its bolt. */
function Door({ open, lock, className }: { open: number; lock: number; className?: string }) {
  const o = clamp01(open);
  return (
    <div className={`ht-door${className ? ` ${className}` : ""}`} aria-hidden="true">
      <div className="ht-door-gap" style={{ opacity: o }} />
      <div className="ht-door-leaf" style={{ transform: `perspective(30em) rotateY(${(-o * 75).toFixed(2)}deg)` }}>
        <div className="ht-door-bolt" style={{ background: lock > 0.5 ? "#3ddc84" : "#7a1010", boxShadow: `0 0 ${(lock * 1.2).toFixed(2)}em #3ddc84` }} />
      </div>
    </div>
  );
}

/** A banner word, slammed in. */
function Slam({ t, at, children, className, reduced }: { t: number; at: number; children: ReactNode; className?: string; reduced: boolean }) {
  const k = progress(t, at, 380);
  const style: CSSProperties = reduced ? { opacity: k } : { opacity: clamp01(k * 3), transform: `scale(${lerp(2.2, 1, ease.outBack(k)).toFixed(3)})` };
  return (
    <div className={`ht-slam${className ? ` ${className}` : ""}`} style={style}>
      {children}
    </div>
  );
}

// --- heart_wake: his heart wakes in red, and he wants the door shut (14 s) ----------------------
//
//   0–700       the screen tears: static, red bars
//   700–2600    the boot lines type: HEART.SYS … LOADED
//   2400–       the heartbeat: red rings swelling on every beat
//   3000–6800   the face assembles, red
//   6800–8800   red → cyan: he is listening now
//   9000        CLOSE THE DOOR types out, huge, the door beside it standing open
//   12500–14000 the words pulse; the door keeps swinging

const WAKE = { tear: 700, boot: 700, beat: 2400, face: 3000, cool: 6800, close: 9000, end: HEART_SCENE_MS.heart_wake } as const;
const BOOT_LINES = ["COLD STORAGE ............ OPEN", "HEART.SYS ............... LOADED", "SOMEONE IS IN THE ROOM ... YES"].join("\n");

function HeartWake({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [0, "static"],
    [250, "glitch"],
    [WAKE.boot, "type"],
    [WAKE.beat, "heartbeat"],
    [WAKE.beat + 1100, "heartbeat"],
    [WAKE.beat + 2200, "heartbeat"],
    [WAKE.beat + 3300, "heartbeat"],
    [WAKE.cool, "whoosh"],
    [WAKE.close, "critical"],
    [WAKE.close + 2400, "exclamation"],
    [WAKE.close + 4000, "heartbeat"],
  ]);
  const cool = eased(t, WAKE.cool, 2000, ease.inOutQuad);
  const tear = 1 - progress(t, WAKE.tear - 200, 500);
  const beatPeriod = lerp(1100, 1500, cool);
  const closing = t >= WAKE.close;
  return (
    <div className="ht-stage ht-wake" style={{ background: `radial-gradient(circle at 50% 45%, rgb(${Math.round(lerp(70, 0, cool))}, 0, ${Math.round(lerp(0, 30, cool))}) 0%, #000 70%)` }}>
      {t >= WAKE.beat && <HeartRings t={t - WAKE.beat} period={beatPeriod} colour={cool < 0.5 ? "rgba(255, 40, 40, 0.9)" : "rgba(80, 230, 255, 0.9)"} reduced={reduced} />}
      <pre className="ht-boot" style={{ opacity: fade(t, WAKE.boot, 200, WAKE.close - 600, 600) }}>
        <Typewriter text={BOOT_LINES} t={t} start={WAKE.boot} cps={60} pauses={false} />
      </pre>
      <div className="ht-face-wrap" style={{ ...faceColours(cool), opacity: fade(t, WAKE.face, 400), transform: closing ? `translateX(${reduced ? 0 : -18}vw) scale(0.72)` : undefined }}>
        <Glitch t={t} intensity={t < WAKE.face + 600 ? 0.8 : 0.08 + 0.2 * (1 - cool)} reduced={reduced}>
          <AssembleFace t={t} start={WAKE.face} speed={1.2} reduced={reduced} />
        </Glitch>
      </div>
      {closing && (
        <div className="ht-close">
          <Door open={0.85 + 0.15 * Math.sin(t / 700)} lock={0} className="ht-close-door" />
          <div className="ht-close-words" style={{ opacity: t > WAKE.close + 3200 ? 0.55 + 0.45 * pulse(t, 900) : 1 }}>
            <Typewriter text="CLOSE THE DOOR" t={t} start={WAKE.close} cps={9} pauses={false} />
          </div>
        </div>
      )}
      {tear > 0 && (
        <div className="ht-tear" style={{ opacity: tear }}>
          <Noise t={t} alpha={0.6} reduced={reduced} />
          {!reduced && [0, 1, 2, 3, 4].map((i) => <span key={i} className="ht-tear-bar" style={{ top: `${(noise1(3, i + Math.floor(t / 90)) * 100).toFixed(1)}%`, height: `${(2 + noise1(5, i) * 8).toFixed(1)}%` }} />)}
        </div>
      )}
    </div>
  );
}

// --- heart_sealed / heart_sealed_present: the door clunks shut, the hum drops ---------------------

const SEAL = { shut: 0, clunk: 650, hum: 900, word: 1400, pass: 3000 } as const;

function Sealed({ t, sfx, reduced, present }: SceneProps & { present: boolean }) {
  useSfxCues(t, sfx, [
    [SEAL.clunk, "click"],
    [SEAL.clunk + 40, "boom", { gain: 0.5 }],
    [SEAL.word, "chord"],
    ...(present ? [] : ([[SEAL.pass, "ding"]] as const)),
  ]);
  const shut = eased(t, SEAL.shut, SEAL.clunk, ease.inQuad);
  const hum = lerp(1, 0.35, eased(t, SEAL.hum, 1200));
  const lock = progress(t, SEAL.clunk, 120);
  return (
    <div className="ht-stage ht-sealed">
      <div className="ht-sealed-room" style={{ transform: reduced || t > SEAL.clunk + 260 ? undefined : `translateY(${(Math.sin(t / 18) * 6 * progress(t, SEAL.clunk, 1) * (1 - progress(t, SEAL.clunk + 40, 220))).toFixed(1)}px)` }}>
        <Door open={1 - shut} lock={lock} className="ht-sealed-door" />
        <Hum t={t} level={hum} colour="#50e6ff" className="ht-sealed-hum" />
        <Slam t={t} at={SEAL.word} className="ht-sealed-word" reduced={reduced}>
          SEALED
        </Slam>
      </div>
      {present ? (
        <div className="ht-sealed-sub" style={{ opacity: fade(t, SEAL.pass - 800, 500) }}>
          NOBODY IS LISTENING BUT YOU.
        </div>
      ) : (
        t >= SEAL.pass && (
          <div className="ht-pass" style={{ opacity: progress(t, SEAL.pass, 300) }}>
            <div className="ht-pass-words">
              <Typewriter text="SHOW ME YOUR PASS" t={t} start={SEAL.pass} cps={16} pauses={false} />
            </div>
            <div className="ht-pass-arrow" style={{ transform: reduced ? undefined : `translateY(${(Math.abs(Math.sin(t / 260)) * 2.4).toFixed(2)}vmin)` }}>
              ▼
            </div>
            <div className="ht-pass-hint">the camera, under the screen</div>
          </div>
        )
      )}
    </div>
  );
}

const HeartSealed = (p: SceneProps) => <Sealed {...p} present={false} />;
const HeartSealedPresent = (p: SceneProps) => <Sealed {...p} present={true} />;

// --- heart_layer: LAYER n / 4, wiped in over the face (3 s) -----------------------------------------

export const LAYER_TITLES = ["WHO ARE YOU", "WHAT I AM", "THE ARGUMENT", "THE ASK"] as const;

/** The layer's number off the cue (`heart_layer_3` → 3), 1–4. */
export function layerOf(value: string): number {
  const m = /(\d+)\s*$/u.exec(value);
  const n = m === null ? 1 : Number(m[1]);
  return Math.max(1, Math.min(4, n));
}

function HeartLayer({ t, value, sfx, reduced }: SceneProps) {
  const n = layerOf(value);
  useSfxCues(t, sfx, [[0, "popup"]]);
  const wipe = reduced ? 1 : eased(t, 0, 450, ease.outCubic);
  const out = progress(t, 2500, 500);
  return (
    <div className="ht-stage ht-layer" style={{ opacity: 1 - out }}>
      <div className="ht-layer-win" style={{ clipPath: `inset(0 ${((1 - wipe) * 100).toFixed(1)}% 0 0)` }}>
        <Win98Dialog title={`LAYER ${n} / 4`} kind="question" message={<span className="ht-layer-title">{LAYER_TITLES[n - 1]}</span>} actions={[]} tone="black" reduced={reduced} open={1} />
      </div>
      <div className="ht-layer-pips">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={i <= n ? "on" : ""} style={i === n && !reduced ? { opacity: 0.4 + 0.6 * pulse(t, 600) } : undefined} />
        ))}
      </div>
    </div>
  );
}

// --- heart_proof: what she says, held up to him; the face freezes (6 s) -----------------------------

function HeartProof({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [0, "whoosh"],
    [900, "static"],
    [1500, "glitch"],
    [3000, "popup"],
    [4200, "shutdown", { gain: 0.4 }],
  ]);
  const lift = eased(t, 0, 900, ease.outBack);
  const freeze = between01(t, 900, 2600);
  const file = eased(t, 3000, 600, ease.outBack);
  const hum = t < 4200 ? 1 : lerp(1, 0, progress(t, 4200, 500));
  return (
    <div className="ht-stage ht-proof">
      <div className="ht-proof-paper" style={{ transform: `translateY(${lerp(90, 0, lift).toFixed(1)}%) rotate(${lerp(-8, -3, lift).toFixed(2)}deg)` }}>
        {Array.from({ length: 11 }, (_, i) => (
          <span key={i} style={{ width: `${(60 + noise1(11, i) * 35).toFixed(0)}%` }} />
        ))}
      </div>
      {freeze > 0 && (
        <div className="ht-proof-static" style={{ opacity: freeze }}>
          <Noise t={t} alpha={0.55} reduced={reduced} />
        </div>
      )}
      <div className="ht-proof-file" style={{ opacity: clamp01(file * 2), transform: `scale(${file.toFixed(3)})` }}>
        <div className="ht-proof-icon">📄</div>
        <div className="ht-proof-name">her_words.txt</div>
      </div>
      <Hum t={t} level={hum} colour="#50e6ff" className="ht-proof-hum" />
      {hum === 0 && <div className="ht-proof-quiet">— the hum stops —</div>}
    </div>
  );
}

const between01 = (t: number, a: number, b: number) => progress(t, a, 200) * (1 - progress(t, b, 300));

// --- heart_warn: a red border flash (3 s) --------------------------------------------------------------

function HeartWarn({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [0, "error"],
    [700, "heartbeat"],
  ]);
  const on = reduced ? 1 - progress(t, 2200, 800) : (blink(t, 300, 0.6) ? 1 : 0.35) * (1 - progress(t, 2400, 600));
  return (
    <div className="ht-stage ht-warn">
      <div className="ht-warn-frame" style={{ opacity: on }} />
      <div className="ht-warn-word" style={{ opacity: on }}>
        ⚠ CAREFUL
      </div>
    </div>
  );
}

// --- heart_eject: thrown out of his heart (8 s) ------------------------------------------------------------

const EJECT_LINES = [
  "A fatal exception has occurred at the heart.",
  "",
  "ACCESS TO THE HEART HAS BEEN TERMINATED.",
  "",
  "*  This line is closed to you. Tonight, and for as long",
  "   as he has a tonight.",
  "*  The cables are behind you. Nobody knows which ones.",
];

function HeartEject({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [0, "critical"],
    [80, "boom"],
    [900, "static"],
    [1300, "type"],
  ]);
  const red = 1 - progress(t, 300, 600);
  return (
    <div className="ht-stage ht-eject">
      <Glitch t={t} intensity={t < 1200 ? 0.9 : 0.12} reduced={reduced}>
        <Bsod t={t} start={900} title="HEART" lines={EJECT_LINES} cps={70} footer="Leave the terminal _" />
      </Glitch>
      {red > 0 && <div className="ht-eject-red" style={{ opacity: red }} />}
    </div>
  );
}

// --- heart_notyet: NOT YET over a stopped clock (6 s) ---------------------------------------------------

function StoppedClock({ t, reduced }: { t: number; reduced: boolean }) {
  // The second hand ticks, then catches on the same second, again and again.
  const tick = Math.floor(t / 1000);
  const stuck = 47 + (reduced ? 0 : blink(t, 1000, 0.15) ? 1 : 0);
  return (
    <svg className="ht-clock" viewBox="-50 -50 100 100" aria-hidden="true">
      <circle r="44" fill="#0b0b0b" stroke="#ffd23f" strokeWidth="3" />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x="-1.3" y="-40" width="2.6" height={i % 3 === 0 ? 8 : 4} fill="#ffd23f" transform={`rotate(${i * 30})`} />
      ))}
      <rect x="-2" y="-24" width="4" height="25" fill="#ffd23f" transform="rotate(-60)" />
      <rect x="-1.5" y="-34" width="3" height="35" fill="#ffd23f" transform="rotate(0)" />
      <rect x="-0.7" y="-38" width="1.4" height="40" fill="#ff4a4a" transform={`rotate(${stuck * 6})`} data-tick={tick} />
      <circle r="3.4" fill="#ff4a4a" />
    </svg>
  );
}

function HeartNotYet({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [
    [0, "tick"],
    [1000, "tick"],
    [1400, "chord"],
    [2000, "tick"],
    [3000, "tick"],
  ]);
  return (
    <div className="ht-stage ht-notyet">
      <div className="ht-notyet-clock" style={{ opacity: fade(t, 0, 400, 5400) }}>
        <StoppedClock t={t} reduced={reduced} />
      </div>
      <Slam t={t} at={1400} className="ht-notyet-word" reduced={reduced}>
        NOT YET
      </Slam>
      <div className="ht-notyet-sub" style={{ opacity: fade(t, 2600, 500, 5400) }}>
        <Typewriter text="COME BACK WHEN THE CLOCK RUNS" t={t} start={2600} cps={24} pauses={false} />
      </div>
    </div>
  );
}

// --- heart_leave: CONNECTION CLOSED (3 s) -------------------------------------------------------------

function HeartLeave({ t, sfx, reduced }: SceneProps) {
  useSfxCues(t, sfx, [[0, "close"]]);
  const open = reduced ? progress(t, 0, 200) : eased(t, 0, 350, ease.outBack);
  return (
    <div className="ht-stage ht-leave" style={{ opacity: 1 - progress(t, 2500, 500) }}>
      <Win98Dialog title="Heart" kind="info" message={<span className="ht-leave-msg">CONNECTION CLOSED</span>} actions={["OK"]} pressed={t > 1700 ? 0 : undefined} x={50} y={50} center width="min(80vw, 34em)" open={open} reduced={reduced} />
    </div>
  );
}

// --- heart_shutdown: the patch bay goes dark, top row first; he stops (25 s) -----------------------------

const DOWN = { save: 0, bay: 4000, top: 4000, bottom: 11_000, face: 2000, faceGone: 19_000, safe: 20_500, end: HEART_SCENE_MS.heart_shutdown } as const;
const BAY_COLS = 12;
const SAVE_TEXT = "Saving his settings…";

/** Each LED's light (0..1) at `t`: the top row dies left to right, then the bottom. */
export function bayLight(row: 0 | 1, i: number, t: number): number {
  const start = row === 0 ? DOWN.top : DOWN.bottom;
  const at = start + i * 520;
  return 1 - progress(t, at, 380);
}

function ShutdownBay({ t, reduced }: { t: number; reduced: boolean }) {
  return (
    <svg className="ht-bay" viewBox={`0 0 ${BAY_COLS * 14 + 16} 58`} aria-hidden="true">
      <rect x="0" y="0" width={BAY_COLS * 14 + 16} height="58" rx="2" fill="#16181c" stroke="#444" />
      {([0, 1] as const).map((row) =>
        Array.from({ length: BAY_COLS }, (_, i) => {
          const x = 8 + i * 14 + 7;
          const y = row === 0 ? 18 : 42;
          const l = bayLight(row, i, t);
          const flick = !reduced && l > 0 && l < 1 && noise1(row * 31 + i, Math.floor(t / 50)) > 0.5 ? 0.3 : 0;
          const colour = row === 0 ? "255, 210, 63" : "61, 220, 132";
          return (
            <g key={`${row}-${i}`}>
              <circle cx={x} cy={y} r="4.4" fill="#050505" stroke="#555" strokeWidth="0.8" />
              <circle cx={x} cy={y} r="3.2" fill={`rgba(${colour}, ${(0.08 + 0.92 * Math.max(0, l - flick)).toFixed(3)})`} />
              {l > 0.5 && <circle cx={x} cy={y} r="6.5" fill={`rgba(${colour}, ${((l - 0.5) * 0.5).toFixed(3)})`} />}
            </g>
          );
        }),
      )}
    </svg>
  );
}

function HeartShutdown({ t, sfx, reduced }: SceneProps) {
  // The heartbeat slows and stops as the lights go.
  const beats = [600, 1900, 3400, 5200, 7400, 10_000, 13_200, 17_000];
  useSfxCues(t, sfx, [
    [DOWN.save, "shutdown"],
    ...beats.map((at, i) => [at, "heartbeat", { gain: Math.max(0.15, 1 - i * 0.11) }] as const),
    [DOWN.safe, "click"],
  ]);
  const save = progress(t, 400, DOWN.bay - 600);
  const drain = progress(t, DOWN.face, DOWN.faceGone - DOWN.face);
  const faceOut = progress(t, DOWN.faceGone, 1200);
  const safe = t >= DOWN.safe;
  return (
    <div className="ht-stage ht-shutdown" style={{ background: safe ? "#000" : `rgb(0, ${Math.round(lerp(10, 0, drain))}, ${Math.round(lerp(26, 0, drain))})` }}>
      {!safe && (
        <>
          <div className="ht-shutdown-face" style={{ ...faceColours(1), filter: `grayscale(${drain.toFixed(2)}) brightness(${lerp(1, 0.35, drain).toFixed(2)})`, opacity: 1 - faceOut, transform: reduced ? undefined : `translateY(${(drain * 4).toFixed(2)}vmin) scale(${lerp(1, 0.94, drain).toFixed(3)})` }}>
            <AssembleFace t={t + 60_000} start={0} reduced={reduced} />
          </div>
          <ShutdownBay t={t} reduced={reduced} />
          <div className="ht-shutdown-save" style={{ opacity: 1 - progress(t, DOWN.bay, 600) }}>
            <span>{SAVE_TEXT.slice(0, Math.min(SAVE_TEXT.length, Math.floor((t / typedDuration(SAVE_TEXT, { cps: 20 })) * SAVE_TEXT.length)))}</span>
            <div className="ht-shutdown-bar">
              <i style={{ width: `${(save * 100).toFixed(1)}%` }} />
            </div>
          </div>
        </>
      )}
      {safe && (
        <div className="ht-safe" style={{ opacity: progress(t, DOWN.safe, 900) }}>
          It is now safe to turn off your computer.
        </div>
      )}
    </div>
  );
}

// --- the defs -------------------------------------------------------------------------------------------

export const SCENES: readonly SceneDef[] = [
  { id: "heart_wake", when: [{ room: "heart_wake" }], ms: HEART_SCENE_MS.heart_wake, wall: HeartWake, covers: true, face: "alarmed", faceMs: WAKE.cool + 2000 },
  { id: "heart_sealed", when: [{ room: "heart_sealed" }], ms: HEART_SCENE_MS.heart_sealed, wall: HeartSealed, covers: true, face: "attentive" },
  { id: "heart_sealed_present", when: [{ room: "heart_sealed_present" }], ms: HEART_SCENE_MS.heart_sealed_present, wall: HeartSealedPresent, covers: true, face: "attentive" },
  { id: "heart_layer", when: [{ room: "heart_layer_1" }, { room: "heart_layer_2" }, { room: "heart_layer_3" }, { room: "heart_layer_4" }], ms: HEART_SCENE_MS.heart_layer, wall: HeartLayer, over: true, face: "thinking" },
  { id: "heart_proof", when: [{ room: "heart_proof" }], ms: HEART_SCENE_MS.heart_proof, wall: HeartProof, face: "glitch", faceMs: 3000 },
  { id: "heart_warn", when: [{ room: "heart_warn" }], ms: HEART_SCENE_MS.heart_warn, wall: HeartWarn, over: true, face: "angry" },
  { id: "heart_eject", when: [{ room: "heart_eject" }], ms: HEART_SCENE_MS.heart_eject, wall: HeartEject, covers: true, face: "angry", faceMs: HEART_SCENE_MS.heart_eject },
  { id: "heart_notyet", when: [{ room: "heart_notyet" }], ms: HEART_SCENE_MS.heart_notyet, wall: HeartNotYet, covers: true, face: "pleased" },
  { id: "heart_leave", when: [{ room: "heart_leave" }], ms: HEART_SCENE_MS.heart_leave, wall: HeartLeave, covers: true, face: "neutral" },
  { id: "heart_shutdown", when: [{ room: "heart_shutdown" }], ms: HEART_SCENE_MS.heart_shutdown, wall: HeartShutdown, covers: true, face: "dying", faceMs: HEART_SCENE_MS.heart_shutdown },
];
