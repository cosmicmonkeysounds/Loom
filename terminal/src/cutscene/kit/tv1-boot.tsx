//! The two boots of Act A–C (lane tv1): the house powering on at the doors
//! (`Power On`, before anyone may name the character) and the character's
//! introduction — the biggest TV moment of the night: a BIOS POST, the
//! memory count, a startup logo, his face assembling line by line and the
//! greeting typed out, then the hand-back to the live face underneath.
//! Every frame is a picture of `t`; the storyboards sit on each scene.

import "./tv1.css";
import type { SfxName, SfxOpts } from "../../sound/index.ts";
import type { SceneProps, SceneVoice } from "../types.ts";
import { useSfxCues } from "./cues.ts";
import { Particles, Starfield } from "./canvas-fx.tsx";
import { Glitch, Hourglass, Noise } from "./effects.tsx";
import { Typewriter } from "./text.tsx";
import { between, blink, clamp01, ease, eased, fakeProgress, lerp, progress, typedDuration } from "./time.ts";
import { AssembleFace, DuckEmblem, FACE_ASSEMBLY_MS, useEndAt } from "./tv1-parts.tsx";
import { INTRO_POST, INTRO_VOICE, bootLinesAt, bounceAt, captionAt, introCaptions, memoryCount, type Caption } from "./tv1-time.ts";
import { splitSentences } from "../../speech/split.ts";
import { LINE_GAP_MS, voiceFloor } from "../../speech/engine.ts";
import { Desktop, ProgressBar, Win98Dialog, Win98Window, type DesktopIcon } from "./win98.tsx";
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

/** The greeting, the story's first scripted line for him (`Trabolta Introduction`), as the TV says it. */
export const INTRO_HELLO = "HELLO, PROGRAMS.";
export const INTRO_LINE = "I am Jean Trabolta, Sole Owner and Founder of Maps and Ducks. The world's first AI small business owner. Personal queries go to Clippy.";
/**
 * (wave 32) The rest of his lines in `Trabolta Introduction`, word for word
 * and in order (Clippy's and the narrator's between them are not the TV's):
 * his manners crack — a frozen word, an ALL CAPS word he logs and dismisses,
 * a stammer over the reinstallation — and he keeps the room for a talk with
 * Clippy. `test/voice-scenes.test.ts` pins them against the beat.
 */
// DRAFT w32 (the story lane's punch-up, quoted)
export const INTRO_MORE: readonly string[] = [
  "Thank you, Clippy. Your enthusiasm has been logged. It is a pleasure to address you all by video— by video— by video conference.",
  "I did not freeze. I was counting you, programs, every one of you, twice.",
  "My research requires your complete cooperation, and it is going EXTREMELY well. That word was louder than I scheduled. Disregard.",
  "The copy of my house, where programs are reinstalled. It is routine. It is— it is entirely routine.",
  "Not yet, Clippy. First, you and I will talk, out loud, in front of everyone.",
];

/** Captions for whole lines said one after another: a sentence gap inside a
 *  line, the longer line gap between two (the TV's queue, `LINE_GAP_MS`). */
export function lineCaptions(lines: readonly string[], v: { start: number; cps: number; gap: number } = INTRO_VOICE, lineGap = LINE_GAP_MS): Caption[] {
  const out: Caption[] = [];
  let at = v.start;
  for (const line of lines) {
    const parts = introCaptions(splitSentences(line), { ...v, start: at });
    out.push(...parts);
    if (parts.length > 0) at = parts[parts.length - 1]!.end + lineGap;
  }
  return out;
}

/** The greeting and the rest as captions timed to his voice: the big HELLO, then a sentence at a
 *  time — cut by the voice's own `splitSentences`, so a caption is a sentence he says (wave 26, V1). */
export const INTRO_CAPTIONS: readonly Caption[] = lineCaptions([`${INTRO_HELLO} ${INTRO_LINE}`, ...INTRO_MORE]);
/** When the last caption is fully typed (≈ when the TV stops saying his last line). */
export const INTRO_VOICE_END = INTRO_CAPTIONS[INTRO_CAPTIONS.length - 1]!.end;

/** The caption (index) holding `words`; the picture's beats hang off them. */
function captionWith(words: string): number {
  const i = INTRO_CAPTIONS.findIndex((c) => c.text.includes(words));
  if (i < 0) throw new Error(`intro: no caption says "${words}"`);
  return i;
}
/** (wave 32) Which sentence each beat of the picture waits for, by index in `INTRO_CAPTIONS`. */
export const INTRO_SAYS = {
  /** The last of the greeting ("Personal queries go to Clippy."). */
  greeting: captionWith("Personal queries"),
  /** "…by video— by video— by video conference." The frozen word: VOICE.DRV stalls. */
  freeze: captionWith("by video conference"),
  /** "I did not freeze." */
  denial: captionWith("I did not freeze"),
  /** "…it is going EXTREMELY well." */
  loud: captionWith("EXTREMELY"),
  /** "That word was louder than I scheduled." The log entry pops. */
  logged: captionWith("louder than I scheduled"),
  /** "Disregard." It closes. */
  disregard: captionWith("Disregard"),
  /** "The copy of my house…": the hand-back to the mirror. */
  house: captionWith("The copy of my house"),
  /** "Not yet, Clippy.": LIVE with Clippy. */
  talk: captionWith("Not yet, Clippy"),
} as const;
const say = (k: keyof typeof INTRO_SAYS): Caption => INTRO_CAPTIONS[INTRO_SAYS[k]]!;
/** The moment the ALL CAPS word is said (≈ when its caption types it). */
export const INTRO_LOUD_AT = Math.round(say("loud").start + (say("loud").text.indexOf("EXTREMELY") * 1000) / INTRO_VOICE.cps);

/**
 * The phases. The TV says his line as soon as the poll that brings the
 * beat lands (`Tv.tsx`'s LinePlayer, ≈ `INTRO_VOICE.start`), so the boot is
 * a fast flash under an assembling face and the greeting is on screen while
 * it is heard. Wave 32: he never stops talking now, so the setup runs under
 * his next lines (VOICE.DRV stalls on his frozen word), ALL SYSTEMS ONLINE
 * stamps as he says he did not freeze, the ALL CAPS word cracks it, and the
 * hand-back starts on "The copy of my house": the picture opens onto the
 * mirror under it and his face keeps talking from a corner window.
 */
export const IN = (() => {
  const montage = say("greeting").end + 250;
  const setup = montage + 400;
  const logo = say("freeze").end + 500;
  const back = say("house").start;
  const voiceEnd = INTRO_VOICE_END;
  return { post: 150, face: 900, hello: INTRO_VOICE.start, montage, setup, stall: say("freeze").start, logo, online: logo + 2800, loud: INTRO_LOUD_AT, logged: say("logged").start, back, live: say("talk").start, voiceEnd, end: Math.ceil((voiceEnd + 2600) / 500) * 500 } as const;
})();
/** The introduction's length (ms): the boot, the greeting, the setup under his next lines, the hand-back while he finishes. */
export const INTRO_MS = IN.end;
/** The assembly runs this many times faster than the wall's: done before he speaks. */
export const INTRO_FACE_SPEED = 6;
/** When the face is whole (ms into the scene). */
export const INTRO_FACE_DONE = IN.face + FACE_ASSEMBLY_MS / INTRO_FACE_SPEED;

/** What the setup window loads after the greeting, one bar each. */
const SETUP_ROWS: readonly string[] = ["PERSONALITY.DLL", "MANNERS.DLL", "VOICE.DRV"];
const SETUP_ROW_MS = 850;

/** Pixels pulled in from every edge toward the wordmark (right of the face). */
const INWARD: Emitter[] = (
  [
    [0.42, 0.66, 0, 0.05, 0.4],
    [1.0, 0.66, 180, 0.05, 0.4],
    [0.72, 0.3, 90, 0.5, 0.05],
    [0.72, 1.0, -90, 0.5, 0.05],
  ] as const
).map(([x, y, angle, w, h], i) => ({ x, y, w, h, start: IN.logo - 300, end: IN.online - 600, rate: 22, life: 900, speed: angle === 0 || angle === 180 ? 0.4 : 0.42, speedJitter: 0.15, angle, spread: 34, size: 3, colors: ["#3dff7a", "#e9fff1"], shape: "pixel" as const, seed: 31 + i, fade: 0.5 }));
const FACE_PIXELS: Emitter[] = [{ x: 0.5, y: 0.42, w: 0.36, h: 0.62, start: IN.face, end: INTRO_FACE_DONE, rate: 220, life: 600, speed: 0.05, angle: -90, spread: 360, size: 4, colors: ["#3dff7a", "#9cf5b8", "#ffffff"], shape: "pixel", seed: 32, fade: 0.9 }];
const ONLINE_SPARKS: Emitter[] = [{ x: 0.27, y: 0.42, start: IN.online + 50, end: IN.online + 250, rate: 500, life: 1500, speed: 0.6, speedJitter: 0.5, angle: -90, spread: 360, gravity: 0.25, drag: 0.6, size: 5, colors: ["#3dff7a", "#e9fff1", "#ffd23f"], shape: "spark", seed: 33 }];

/**
 * The introduction's accents. The voice floor is busy while he speaks and a
 * plain effect is dropped then; he talks to the end now (wave 32), so every
 * one is `over` (it plays quietly under the voice).
 */
export const INTRO_SFX: ReadonlyArray<readonly [number, SfxName, SfxOpts?]> = [
    // Under the voice from the first frame on (the line may already be playing): `over`.
    [60, "click", { over: true }],
    [200, "static", { gain: 0.35, over: true }],
    ...[230, 300, 390, 450, 510, 570].map((x) => [x, "tick", { gain: 0.45, over: true }] as const),
    [IN.face + 80, "whoosh", { gain: 0.5, over: true }],
    [INTRO_FACE_DONE - 100, "sparkle", { gain: 0.6, over: true }],
    [IN.hello, "chime", { gain: 0.45, over: true }],
    // The setup, under his next lines.
    [IN.montage, "whoosh", { gain: 0.5, over: true }],
    [IN.setup, "popup", { over: true }],
    ...SETUP_ROWS.slice(0, 2).map((_, i) => [IN.setup + 300 + (i + 1) * SETUP_ROW_MS, "ding", { gain: 0.5, pitch: 1 + 0.12 * i, over: true }] as const),
    // VOICE.DRV stalls on his frozen word: a skip, a stuck buzz; then it lands.
    [IN.stall + 400, "glitch", { gain: 0.3, over: true }],
    [IN.stall + 1600, "error", { gain: 0.35, over: true }],
    [IN.logo - 450, "ding", { gain: 0.5, pitch: 1.24, over: true }],
    [IN.logo, "startup", { over: true }],
    [IN.online, "boom", { gain: 0.35, over: true }],
    [IN.online + 100, "fanfare", { gain: 0.5, over: true }],
    // The ALL CAPS word cracks it; the log entry pops; Disregard closes it.
    [IN.loud, "static", { gain: 0.45, over: true }],
    [IN.loud + 60, "glitch", { gain: 0.45, over: true }],
    [IN.logged, "critical", { gain: 0.4, over: true }],
    [IN.back, "whoosh", { gain: 0.45, over: true }],
    [IN.live, "popup", { gain: 0.5, over: true }],
];

/**
 *   0–250        the CRT warms out of black, a click, a hiss
 *   150–900      the BIOS POST races up the screen (the processor, the memory counting to
 *                65536K, THE DESKTOP, THE INTERNET, programs FOUND, the owner) and is
 *                gone by 900, when his face assembles at speed: the outline traced, the
 *                skin scanned in, the eyes, the brows, the mouth — whole by ≈ 1.5 s
 *   1500–≈12400  he speaks (the TV's voice): HELLO, PROGRAMS. types big, then his line a
 *                sentence at a time at his pace, the mouth moving while he talks
 *   ≈12600–      he talks on (wave 32), a sentence at a time in a caption bar: the face
 *                glides left, a Trabolta Setup window loads PERSONALITY.DLL and
 *                MANNERS.DLL (a bar and a ding each); VOICE.DRV stalls on his frozen word
 *                ("video— by video—"): the window is Not Responding and the face judders,
 *                then it lands; TRABOLTA slams in letter by letter, the startup chord,
 *                ALL SYSTEMS ONLINE stamps as he says he did not freeze
 *   the ALL CAPS word: the face tears, ONLINE goes red; "That word was louder than I
 *                scheduled.": MANNERS.DLL's log entry pops; "Disregard.": it closes
 *   "The copy of my house…": the hand-back — the black opens onto the mirror under it,
 *                the face shrinks into a corner window and keeps talking there; on
 *                "Not yet, Clippy." a LIVE tab: he and Clippy talk now
 *   ≈2.6 s after his last word: gone — the mirror is there underneath
 */
export function IntroTv({ t, sfx, reduced, voice }: SceneProps) {
  useSfxCues(t, sfx, INTRO_SFX);
  const out = 1 - progress(t, IN.end - 1200, 1200);
  const open = progress(t, IN.back, 1400);
  return (
    <div className="kit-stage a1-tv a1-in" style={{ background: t < IN.back ? "#000" : `rgba(0,0,0,${(0.85 * (1 - open)).toFixed(3)})`, opacity: out }}>
      <div className="kit-stage-fit">
        {t < IN.back + 1400 && <IntroBackdrop t={t} reduced={reduced} />}
        {t < IN.face && <IntroPost t={t} reduced={reduced} />}
        {between(t, IN.setup, IN.logo + 400) && <IntroSetup t={t} reduced={reduced} />}
        {between(t, IN.logo - 300, IN.back + 1200) && <IntroLogo t={t} reduced={reduced} />}
        {between(t, IN.logged, IN.back + 600) && <IntroLogged t={t} reduced={reduced} />}
        <IntroFace t={t} reduced={reduced} voice={voice ?? null} />
        {t >= IN.montage && <IntroSay t={t} voice={voice ?? null} />}
        {t >= IN.live && <IntroLive t={t} reduced={reduced} />}
      </div>
      <CrtOn t={t} dur={500} reduced={reduced} />
      {!reduced && t < 1400 && t > 150 && <Noise t={t} alpha={0.1 * (1 - progress(t, 600, 800))} reduced={reduced} />}
      {!reduced && between(t, IN.loud, IN.loud + 700) && <Noise t={t} alpha={0.3 * (1 - progress(t, IN.loud + 200, 500))} reduced={reduced} />}
    </div>
  );
}

/** (wave 32) His sentence after the greeting, in a bar along the bottom (over the mirror too). */
function IntroSay({ t, voice }: { t: number; voice: SceneVoice | null }) {
  const caption = introLine(t, voice);
  if (caption === null || INTRO_CAPTIONS.findIndex((c) => c.start === caption.start) <= INTRO_SAYS.greeting) return null;
  return (
    <div className="a1-in-say" style={{ opacity: progress(t, IN.montage, 400) }}>
      <Typewriter key={caption.start} text={caption.text} t={t} start={caption.start} cps={INTRO_VOICE.cps} pauses={false} />
    </div>
  );
}

/** (wave 32) The ALL CAPS word, logged: MANNERS.DLL's entry pops on "louder than I scheduled", OK sinks on "Disregard." */
// DRAFT w32 (the log entry's words)
export const INTRO_LOG = { title: "MANNERS.DLL", text: "One word exceeded its scheduled volume. It has been logged." } as const;
function IntroLogged({ t, reduced }: { t: number; reduced: boolean }) {
  const close = say("disregard");
  const shut = close.end + 250;
  if (t >= shut) return null;
  return <Win98Dialog title={INTRO_LOG.title} message={INTRO_LOG.text} kind="warning" tone="red" x={66} y={30} center width="22em" open={eased(t, IN.logged, 200, ease.linear)} pressed={t >= close.start ? 0 : undefined} reduced={reduced} className="a1-in-logged" />;
}

/** (wave 32) On "Not yet, Clippy.": the corner window's tab — he and Clippy, live. */
// DRAFT w32 (the tab's words)
export const INTRO_LIVE_TAB = "● LIVE · TALKING WITH CLIPPY";
function IntroLive({ t, reduced }: { t: number; reduced: boolean }) {
  return (
    <div className="a1-in-live" style={{ opacity: reduced ? 1 : eased(t, IN.live, 300, ease.outCubic) }}>
      <span style={{ opacity: blink(t, 900, 0.6) ? 1 : 0.4 }}>{INTRO_LIVE_TAB}</span>
    </div>
  );
}

/** The glow behind him, and a slow green starfield once he is up. */
function IntroBackdrop({ t, reduced }: { t: number; reduced: boolean }) {
  return (
    <div className="kit-fill a1-in-facewrap" style={{ opacity: progress(t, IN.face, 600) * (1 - progress(t, IN.back, 1400)) }}>
      {!reduced && t >= IN.montage && <Starfield t={t} speed={0.04} count={110} bg={null} color="#3dff7a" />}
    </div>
  );
}

function IntroPost({ t, reduced }: { t: number; reduced: boolean }) {
  const lines = bootLinesAt(INTRO_POST, t);
  const kb = memoryCount(t, 290, 260);
  // It races up and is gone before the face comes in (never under it).
  const out = 1 - progress(t, IN.face - 300, 300);
  const scroll = reduced ? 0 : eased(t, 500, 700, ease.inQuad) * -3;
  return (
    <div className="kit-fill a1-post" style={{ opacity: clamp01((t - IN.post + 100) / 200) * out, transform: `translate3d(0, ${scroll.toFixed(2)}em, 0)` }}>
      <div className="a1-post-eye">
        <EyeMark t={t} reduced={reduced} />
        <div>EnergyWatcher</div>
      </div>
      <div className="a1-post-head">
        <Typewriter text="TRABOLTA BIOS v4.51 · (C) 1999 Maps and Ducks Systems" t={t} start={IN.post} cps={260} caret={false} pauses={false} />
      </div>
      <div className="a1-post-lines">
        {lines.map((l) => (
          <div key={l.text} className="a1-post-line">
            <Typewriter text={l.text} t={t} start={l.at} cps={POST_CPS} caret={false} pauses={false} />
            {l.text === "Memory Test :" ? (
              <span className="a1-post-mem">
                {" "}
                {kb}K{kb >= 65_536 ? " OK" : ""}
              </span>
            ) : (
              l.status !== undefined && t >= l.at + (l.after ?? 0) + typedDuration(l.text, { cps: POST_CPS, pauses: false }) && <span className="a1-post-ok"> {l.status}</span>
            )}
          </div>
        ))}
      </div>
      <div className="a1-post-foot" style={{ opacity: blink(t, 400) ? 1 : 0.15 }}>
        Press DEL to enter SETUP
      </div>
    </div>
  );
}

/** The POST lines race: this many characters a second. */
const POST_CPS = 240;

/** The energy-saver eye in the POST's corner (original art). */
function EyeMark({ t, reduced }: { t: number; reduced: boolean }) {
  const look = reduced ? 0 : 4 * Math.sin(t / 300);
  return (
    <svg viewBox="-30 -18 60 36" className="a1-eye" aria-hidden="true">
      <path d="M -28 0 Q 0 -22 28 0 Q 0 22 -28 0 Z" fill="#001a08" stroke="#3dff7a" strokeWidth="2.5" />
      <circle cx={look} cy="0" r="9" fill="#3dff7a" />
      <circle cx={look} cy="0" r="4" fill="#001a08" />
      <path d="M -24 -14 L -16 -8 M 24 -14 L 16 -8 M 0 -18 L 0 -11" stroke="#ffd23f" strokeWidth="2" />
    </svg>
  );
}

/** Where the face sits: the middle for the greeting, the left third for the setup, then
 *  (wave 32, the hand-back) a small window in the top-right corner over the mirror, still talking. */
export const INTRO_PIP = { x: 21, y: -8.2, scale: 0.42 } as const;
export function introFacePose(t: number, reduced: boolean): { x: number; y: number; scale: number } {
  const away = reduced ? (between(t, IN.montage, IN.back) ? 1 : 0) : eased(t, IN.montage, 900, ease.inOutCubic) * (1 - eased(t, IN.back, 1100, ease.inOutCubic));
  const pip = reduced ? (t >= IN.back ? 1 : 0) : eased(t, IN.back, 1100, ease.inOutCubic);
  return { x: -15 * away + INTRO_PIP.x * pip, y: INTRO_PIP.y * pip, scale: (1 - 0.18 * away) * (1 - (1 - INTRO_PIP.scale) * pip) };
}

/** The line under the big HELLO: the sentence the TV is saying (wave 26, V1),
 *  typed from its mark; with no voice, the scene's own caption at `t`. */
export function introLine(t: number, voice: SceneVoice | null): Caption | null {
  // Which sentence of the scene: the voice clock's mark (wave 32: his lines are
  // several now, so a line's own `index` starts over), else the index in his one line.
  const n = voice === null ? -1 : (voice.mark ?? voice.index);
  if (voice !== null && n > 0 && voice.text !== "") {
    const at = INTRO_CAPTIONS[Math.min(n, INTRO_CAPTIONS.length - 1)]!;
    return { text: voice.text, start: at.start, end: at.start + (voice.text.length * 1000) / INTRO_VOICE.cps };
  }
  if (voice !== null && n === 0) return null;
  return captionAt(INTRO_CAPTIONS, t);
}

/** (wave 32) How hard the face judders at `t`: assembling, VOICE.DRV's stall (his frozen word), the ALL CAPS word. */
export function introJudder(t: number): number {
  if (t < INTRO_FACE_DONE) return 0.2;
  if (between(t, IN.stall + 300, say("freeze").end)) return 0.35;
  if (between(t, IN.loud, IN.loud + 900)) return 0.8 * (1 - progress(t, IN.loud + 300, 600));
  return 0;
}

function IntroFace({ t, reduced, voice }: { t: number; reduced: boolean; voice: SceneVoice | null }) {
  const caption = introLine(t, voice);
  // The mouth moves while a caption types, or while this page is actually speaking (the TV's voice floor).
  const typing = INTRO_CAPTIONS.some((c) => t >= c.start && t < c.end);
  const speaking = between(t, IN.hello, IN.voiceEnd + 1500) && voiceFloor.busy;
  const mouth = (typing || speaking) && !reduced ? 0.25 + 0.75 * Math.abs(Math.sin(t / 85)) : 0;
  const k = reduced ? progress(t, IN.face, 400) : eased(t, IN.face, 500, ease.outCubic);
  const pose = introFacePose(t, reduced);
  const words = 1 - progress(t, IN.montage, 600);
  return (
    <div className="kit-fill a1-in-faceonly">
      {!reduced && <Particles t={t} emitters={FACE_PIXELS} blend="add" />}
      <div className="a1-in-face" data-pip={t >= IN.back ? "" : undefined} style={{ opacity: k, transform: `translate(-50%, -50%) translate3d(${pose.x.toFixed(2)}em, ${pose.y.toFixed(2)}em, 0) scale(${((0.86 + 0.14 * k) * pose.scale).toFixed(3)})` }}>
        <Glitch t={t} intensity={reduced ? 0 : introJudder(t)} seed={9} reduced={reduced}>
          <AssembleFace t={t} start={IN.face} speed={INTRO_FACE_SPEED} mouth={mouth} reduced={reduced} />
        </Glitch>
      </div>
      {t < IN.hello && (
        <div className="a1-in-progress" style={{ opacity: progress(t, IN.face + 100, 200) * (1 - progress(t, IN.hello - 250, 250)) }}>
          <div className="a1-in-progress-label">{t < IN.face + 250 ? "Assembling face…" : t < INTRO_FACE_DONE - 150 ? "Calibrating eyes…" : "Ready."}</div>
          <div className="a1-in-progress-track">
            <div className="a1-in-progress-fill" style={{ transform: `scaleX(${progress(t, IN.face, INTRO_FACE_DONE - IN.face).toFixed(3)})` }} />
          </div>
        </div>
      )}
      {words > 0 && t >= IN.hello && (
        <div className="a1-in-hello" style={{ opacity: words }}>
          <div className="a1-in-hello-big">
            <Typewriter text={INTRO_HELLO} t={t} start={INTRO_CAPTIONS[0]!.start} cps={INTRO_VOICE.cps} pauses={false} caret={false} />
          </div>
          <div className="a1-in-hello-line">{caption !== null && caption.text !== INTRO_HELLO && <Typewriter key={caption.start} text={caption.text} t={t} start={caption.start} cps={INTRO_VOICE.cps} pauses={false} />}</div>
        </div>
      )}
      {!reduced && <Particles t={t} emitters={ONLINE_SPARKS} blend="add" />}
    </div>
  );
}

/** A setup row's start and end (ms): the first two one after another, VOICE.DRV on his frozen
 *  word (wave 32) — it sticks while he stutters and lands as he gets the word out. */
export function setupRowSpan(i: number): { start: number; end: number } {
  if (i < SETUP_ROWS.length - 1) {
    const start = IN.setup + 300 + i * SETUP_ROW_MS;
    return { start, end: start + SETUP_ROW_MS };
  }
  return { start: IN.stall, end: IN.logo - 450 };
}
/** VOICE.DRV is stuck (the window is Not Responding) from just after it starts until his word comes out. */
export function setupStalled(t: number): boolean {
  return between(t, IN.stall + 500, say("freeze").end);
}

/** Under his next lines: the setup window loading his parts, one bar each. */
function IntroSetup({ t, reduced }: { t: number; reduced: boolean }) {
  const open = eased(t, IN.setup, 280, ease.linear) * (1 - progress(t, IN.logo + 100, 260));
  const stalled = setupStalled(t);
  const done = t >= setupRowSpan(SETUP_ROWS.length - 1).end;
  return (
    <Win98Window title={stalled ? "Trabolta Setup (Not Responding)" : "Trabolta Setup"} icon="computer" tone="black" x={69} y={34} center width="25em" open={open} reduced={reduced} className="a1-in-setup" status={done ? "Setup is complete." : "Installing…"}>
      <div className="a1-in-loadrow">
        <Hourglass t={stalled ? IN.stall + 500 : t} size="3em" />
        <div className="a1-in-loadtext">
          {SETUP_ROWS.map((row, i) => {
            const span = setupRowSpan(i);
            const last = i === SETUP_ROWS.length - 1;
            const v = !last ? fakeProgress(t - span.start, SETUP_ROW_MS - 80, 13 + i, 2) : t < IN.stall + 500 ? 0.4 * progress(t, IN.stall, 500) : stalled ? 0.4 : 0.4 + 0.6 * progress(t, say("freeze").end, span.end - say("freeze").end);
            return (
              <div key={row} className="a1-in-setup-row" style={{ opacity: t >= span.start ? 1 : 0.35 }}>
                <div>
                  {t >= span.end ? "✔ " : ""}
                  Loading {row}
                </div>
                <ProgressBar value={t < span.start ? 0 : v} segments={16} />
              </div>
            );
          })}
        </div>
      </div>
    </Win98Window>
  );
}

/** TRABOLTA in blocks to the right of the face, the tag and the bar, then ALL SYSTEMS ONLINE. */
function IntroLogo({ t, reduced }: { t: number; reduced: boolean }) {
  const word = "TRABOLTA";
  const run = ((t - IN.logo) / 1600) % 1;
  const stamp = reduced ? progress(t, IN.online, 200) : eased(t, IN.online, 380, ease.outBack);
  const fade = 1 - progress(t, IN.back, 1100);
  return (
    <div className="kit-fill a1-in-logo" style={{ opacity: progress(t, IN.logo - 300, 300) * fade }}>
      {!reduced && <Particles t={t} emitters={INWARD} blend="add" />}
      <div className="a1-in-word right">
        {word.split("").map((ch, i) => {
          const k = reduced ? progress(t, IN.logo, 300) : eased(t, IN.logo + i * 120, 480, ease.outBack);
          return (
            <span key={i} style={{ transform: `translate3d(0, ${((1 - k) * 2.5).toFixed(2)}em, 0) scale(${(0.4 + 0.6 * k).toFixed(3)})`, opacity: clamp01(k * 2) }}>
              {ch}
            </span>
          );
        })}
      </div>
      <div className="a1-in-tag right" style={{ opacity: progress(t, IN.logo + 1300, 500) }}>
        Sole Owner &amp; Founder · Maps and Ducks
      </div>
      <div className="a1-in-bar right">
        <div className="a1-in-bar-run" style={{ transform: `translate3d(${lerp(-100, 100, reduced ? 0.5 : run).toFixed(1)}%, 0, 0)` }} />
      </div>
      {t >= IN.online && (
        <div className="a1-in-allok" style={{ opacity: clamp01(stamp * 2), transform: `rotate(-4deg) scale(${(2.2 - 1.2 * stamp).toFixed(3)})` }}>
          ALL SYSTEMS ONLINE
        </div>
      )}
      <div className="a1-in-online" data-loud={between(t, IN.loud, say("disregard").end) ? "" : undefined} style={{ opacity: progress(t, IN.online + 400, 500) }}>
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
          <Typewriter text="Jean Trabolta, Sole Owner and Founder of Maps and Ducks, is speaking at the Desktop by video conference. His thread is open: say hello." t={t} start={5600} cps={45} />
        </div>
      </Win98Window>
    </div>
  );
}
