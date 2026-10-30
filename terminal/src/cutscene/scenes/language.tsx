//! G14 · the Language Report (wave 48; the breach is wave 48b:
//! screens_award_language, persistent). Listed in `act3.tsx`'s scenes ahead
//! of the `award_*` row so it wins its slide.
//!
//!   0–2400     the award's room gone dark: the key flips in, THE LANGUAGE REPORT types
//!   2600       a DOS window opens: C:\FILTER> type censored.log
//!   4000→      the log prints every censored word (most censored first, its ×n
//!              at the right; a redaction bar for each unsaid word), faster and
//!              faster: first line to last ≤ 20 s whatever the count
//!   leak       the buffer overflows: the window strains, turns red, and the
//!              words burst out of it, flying to a heap that rises from the
//!              floor (the most censored biggest) until it engulfs the screen;
//!              deadpan notes pop up
//!   eye        an eye opens in the log (its iris rings of the most censored
//!              words), looks about; on the TV tentacles of words reach out
//!   ask        "Abort, Retry, Censor?" — ✂ Censor sinks
//!   snap       scissors cross the screen, cutting the heap away; the window
//!              switches off like an old CRT
//!   summary    held: who cursed the most, c of f censored, the filter's
//!              strength, the Password Manager's ⭐, the closed log
//!
//! The numbers and words are the story's (`night.language`, read when G14
//! was pressed). Nobody flagged: one line. Flagged but none censored: the
//! summary and its line, no breach. No report (an older server): the title
//! and its line. The timeline is `kit/lang-breach.ts`; the canvases draw with
//! `kit/lang-breach-draw.ts`. The TV draws the heap on a canvas (an offscreen
//! layer for the words at rest, so 400 words cost one `drawImage` a frame),
//! with flights and tentacles; a wall draws each word once where it lands
//! and redraws its log at 10 fps, with no tentacles, flights or breathing.
//! Reduced motion: no shake, flight, spin or sweep; the heap fills in place
//! in steps of 250 ms and everything fades. Nothing blinks faster than 1 Hz.

import "./language.css";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { SceneProps } from "../types.ts";
import type { ScreenLanguage } from "../../screen.ts";
import { useCanvas } from "../kit/canvas.ts";
import { BigNumber, Particles, Stage, Typewriter, Win98Dialog, Win98Window, clamp01, confettiEmitters, ease, eased, lerp, progress, pulse, useSfxCues, type Emitter } from "../kit/index.ts";
import { AwardEmblem, SpotCones } from "../kit/tv3-parts.tsx";
import { awardOf } from "../kit/tv3-time.ts";
import {
  BREACH,
  BREACH_NOTES,
  breachLines,
  breachSchedule,
  breachTimes,
  cutAt,
  flightAt,
  langWord,
  noteAt,
  noteLife,
  packTide,
  printedBy,
  scissorsX,
  tallyAt,
  winRect,
  windowOff,
  windowShake,
  type BreachLine,
  type BreachNoteId,
  type BreachSchedule,
  type BreachTimes,
  type Tide,
} from "../kit/lang-breach.ts";
import { drawEye, drawLog, drawPiece, drawSlot, drawTentacles, measureCharW } from "../kit/lang-breach-draw.ts";

/** The Language Report's own copy (DRAFT w48b: a comedy beat in the machine's deadpan voice; the host speaks over it). */
export const LANG_COPY = {
  kind: "BONUS SECTION",
  window: "censored.log - MS-DOS Prompt",
  log: { prompt: "C:\\FILTER>", cmd: "type censored.log", del: "del censored.log", denied: ["Access is denied.", "It is not finished."] },
  notes: {
    overflow: { title: "Password Manager", text: "WARNING: Profanity buffer overflow." },
    aloud: { title: "Password Manager", text: "Please do not read the words aloud." },
    panic: { title: "KERNEL32.DLL", text: "kernel panic: too many feelings" },
    seen: { title: "censored.log", text: "IT HAS SEEN WHAT YOU TYPED." },
    dll: { title: "SWEAR.DLL", text: "This program has performed an illegal operation and will not go quietly." },
  } satisfies Record<BreachNoteId, { title: string; text: string }>,
  ask: { title: "C:\\FILTER", text: "Abort, Retry, Censor?", actions: ["Abort", "Retry", "✂ Censor"] },
  status: { censored: "CENSORED", filter: "FILTER", buffer: "BUFFER", overflow: "OVERFLOW" },
  curser: "Cursed the most",
  censored: "Censored",
  level: "Filter strength",
  stars: "Password Manager",
  starsSub: "earned with ✂",
  top: "Most censored",
  file: "censored.log",
  contained: "✂ CONTAINED",
  none: "Nobody said anything the filter caught.",
  noneCensored: "Not one of them was censored.",
} as const;

/** What each strength catches, in a line (DRAFT w48b; a strength between two tiers reads the lower). */
export const LEVEL_CAPTIONS: ReadonlyArray<readonly [number, string]> = [
  [100, "Paranoid: hello is a swear"],
  [90, "Suspicious: password is a swear"],
  [75, "Nosy: Scunthorpe is a swear"],
  [60, "Soft: heck is a swear"],
  [50, "Mild: crap is a swear"],
  [25, "Strong words only"],
  [10, "Only the worst words"],
  [0, "Slurs only"],
];

export function levelCaption(level: number): string {
  return (LEVEL_CAPTIONS.find(([at]) => level >= at) ?? LEVEL_CAPTIONS[LEVEL_CAPTIONS.length - 1]!)[1];
}

/** The report as the slide draws it (wave 48b). */
export interface LanguagePlan {
  /** Nobody's words were flagged: this one line, and nothing else. */
  none: string | null;
  /** Who cursed the most (a tie is one string) and their count; null for nobody. */
  curser: { who: string; count: string } | null;
  /** `c` of `f` words censored (`of` follows the counted-up `c`); `share` fills the bar. */
  censored: { c: number; f: number; of: string; share: number } | null;
  /** The filter's strength now (null from an older server). */
  level: { pct: number; text: string; caption: string } | null;
  /** The Password Manager's ⭐ from ✂ (null from an older server). */
  stars: { n: number } | null;
  /** The most censored word and its count, when some word was censored more than once. */
  top: { word: string; count: number } | null;
  /** The breach's lines (none: no breach). */
  lines: BreachLine[];
  /** Show each word's ×n in the log. */
  counts: boolean;
  /** The log's length on its closed window: every censored word, "+ n more" counted whole, the unsaid. */
  total: number;
  /** In the breach's place when nothing was censored. */
  line: string | null;
}

/** The plan for a report (DRAFT w48b). */
export function languagePlan(r: ScreenLanguage): LanguagePlan {
  const empty = { curser: null, censored: null, level: null, stars: null, top: null, lines: [], counts: false, total: 0, line: null };
  if (r.flagged === 0) return { none: LANG_COPY.none, ...empty };
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const any = r.censored > 0;
  const counts = r.counts.some((c) => c > 1);
  return {
    none: null,
    curser: r.curser === null ? null : { who: r.curser, count: count(r.curses, "flagged word", "flagged words") },
    censored: { c: r.censored, f: r.flagged, of: ` of ${r.flagged.toLocaleString("en-US")} ${r.flagged === 1 ? "word" : "words"}`, share: clamp01(r.censored / r.flagged) },
    level: r.level === null ? null : { pct: r.level, text: `${r.level}%`, caption: levelCaption(r.level) },
    stars: r.stars === null ? null : { n: r.stars },
    top: any && counts && r.words.length > 0 ? { word: langWord(r.words[0]!), count: r.counts[0] ?? 1 } : null,
    lines: any ? breachLines(r.words, r.counts, r.unsaid, r.more) : [],
    counts,
    total: any ? r.words.length + r.more + r.unsaid : 0,
    line: any ? null : LANG_COPY.noneCensored,
  };
}

/** A report's content as one string: the plan is rebuilt only when it changes, not on every poll. */
export function reportKey(r: ScreenLanguage): string {
  return [r.flagged, r.censored, r.curser, r.curses, r.more, r.unsaid, r.level, r.stars, r.counts.join(","), r.words.join("\u0001")].join("|");
}

/** The words the eye and the tentacles are made of: the most censored dozen (bars when only unsaid words were censored). */
export function ringOf(lines: readonly BreachLine[]): BreachLine[] {
  const words = lines.filter((l) => l.kind === "word").slice(0, 12);
  return words.length > 0 ? words : lines.filter((l) => l.kind === "bar").slice(0, 6);
}

/** A name's size on its card: a long tie steps down. */
function whoSize(who: string): string {
  return who.length > 56 ? " longer" : who.length > 26 ? " long" : "";
}

/** A tall screen (a portrait wall)? Follows a resize; false where it can't be asked. */
function usePortrait(): boolean {
  const ask = () => typeof window !== "undefined" && window.innerHeight > window.innerWidth;
  const [p, setP] = useState(ask);
  useEffect(() => {
    const on = () => setP(ask());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return p;
}

const pct = (x: number) => `${(x * 100).toFixed(3)}%`;

// --- the log's window ------------------------------------------------------------------------

interface BreachParts {
  t: number;
  tm: BreachTimes;
  sched: BreachSchedule;
  plan: LanguagePlan;
  ring: BreachLine[];
  lite: boolean;
  reduced: boolean;
}

/** The redraw clock: the TV every frame, a wall at 10 fps, reduced motion in 250 ms steps. */
function stepT(t: number, lite: boolean, reduced: boolean): number {
  return reduced ? Math.floor(t / 250) * 250 : lite ? Math.floor(t / 100) * 100 : t;
}

function LogCanvas({ t, tm, sched, plan, ring, lite, reduced }: BreachParts) {
  const tq = stepT(t, lite, reduced);
  const ref = useCanvas(
    (ctx, { w, h }) => {
      const charW = measureCharW(ctx);
      const rows = Math.max(8, Math.min(16, Math.round(h / (lite ? 30 : 36))));
      drawLog(ctx, w, h, tq, tm, sched, plan.lines, { rows, charW, counts: plan.counts, jitter: !lite && !reduced, copy: LANG_COPY.log });
      drawEye(ctx, w, h, tq, tm, ring, { rings: lite ? 2 : 3, charW, spin: !reduced, look: !reduced });
    },
    [tq, tm, sched, plan, ring, lite, reduced],
  );
  return <canvas ref={ref} className="kit-fill tv3-lb-log" aria-hidden="true" />;
}

function BreachStatus({ t, tm, sched, plan, reduced }: BreachParts) {
  const printed = printedBy(t, sched.line);
  const buffer = progress(t, tm.flow, tm.leak - tm.flow);
  const full = t >= tm.leak;
  const lit = Math.floor(buffer * 10 + 1e-9);
  return (
    <span className="tv3-lb-status">
      {plan.censored !== null && (
        <span>
          {LANG_COPY.status.censored} {tallyAt(plan.censored.c, printed, tm.n)}/{plan.censored.f}
        </span>
      )}
      {plan.level !== null && (
        <span>
          {LANG_COPY.status.filter} {plan.level.text}
        </span>
      )}
      {plan.stars !== null && <span>⭐ {tallyAt(plan.stars.n, printed, tm.n)}</span>}
      <span className={full ? "tv3-lb-over" : undefined} style={full && !reduced ? { opacity: Math.floor(t / 500) % 2 === 0 ? 1 : 0.25 } : undefined}>
        {LANG_COPY.status.buffer} {full ? LANG_COPY.status.overflow : `${"▮".repeat(lit)}${"▯".repeat(10 - lit)}`}
      </span>
    </span>
  );
}

function BreachWindow(p: BreachParts & { portrait: boolean }) {
  const { t, tm, lite, reduced, portrait } = p;
  const win = winRect(portrait ? 0.5 : 2);
  const open = progress(t, BREACH.cmd, reduced ? 300 : 420);
  const shake = reduced ? { x: 0, y: 0, s: 1, sk: 0 } : windowShake(t, tm, lite);
  const off = reduced ? { sx: 1, sy: 1, o: 1 - progress(t, tm.snap, 600) } : windowOff(t, tm);
  const style: CSSProperties = {
    left: pct(win.x),
    top: pct(win.y),
    width: pct(win.w),
    height: pct(win.h),
    opacity: off.o,
    transform: `translate(${shake.x.toFixed(2)}vmin, ${shake.y.toFixed(2)}vmin) scale(${(shake.s * off.sx).toFixed(4)}, ${(shake.s * off.sy).toFixed(4)}) skewX(${shake.sk.toFixed(2)}deg)`,
  };
  return (
    <div className="tv3-lb-win" style={style}>
      <Win98Window title={LANG_COPY.window} icon="computer" width="100%" height="100%" open={open} reduced={reduced} tone={t >= tm.leak ? "red" : "navy"} buttons={["min", "max", "close"]} bodyClassName="tv3-lb-body" status={<BreachStatus {...p} />}>
        <LogCanvas {...p} />
      </Win98Window>
    </div>
  );
}

// --- the heap ---------------------------------------------------------------------------------

/** The cut: the heap in vertical strips, each splitting along the cut and falling apart once the scissors pass it (the TV). */
const STRIPS = 16;

interface TideState {
  lines: readonly BreachLine[] | null;
  packKey: string;
  pack: Tide | null;
  sizeKey: string;
  upTo: number;
  layer: HTMLCanvasElement | null;
}

/**
 * The heap. A wall and reduced motion draw each word once, straight onto
 * the canvas, as it lands (nothing is ever redrawn but on a resize or a
 * clock going back), and the cut clears behind the scissors. The TV keeps
 * the words at rest on an offscreen layer the same way and composes each
 * frame from it: one `drawImage`, the words in flight, the tentacles.
 */
function BreachTide({ t, tm, sched, plan, ring, lite, reduced }: BreachParts) {
  const incremental = lite || reduced;
  const tq = stepT(t, lite, reduced);
  const st = useRef<TideState>({ lines: null, packKey: "", pack: null, sizeKey: "", upTo: Number.NEGATIVE_INFINITY, layer: null });
  const ref = useCanvas(
    (ctx, { w, h, dpr }) => {
      const s = st.current;
      const charW = measureCharW(ctx);
      const win = winRect(w / h);
      const packKey = `${w}x${h}|${charW.toFixed(3)}`;
      if (s.pack === null || s.packKey !== packKey || s.lines !== plan.lines) {
        s.pack = packTide(plan.lines, w / h, win, charW);
        s.packKey = packKey;
        s.lines = plan.lines;
        s.upTo = Number.NEGATIVE_INFINITY;
      }
      const slots = s.pack.slots;
      let rest: CanvasRenderingContext2D | null = ctx;
      if (!incremental) {
        const layer = s.layer ?? (s.layer = document.createElement("canvas"));
        const lw = Math.max(1, Math.round(w * dpr));
        const lh = Math.max(1, Math.round(h * dpr));
        if (layer.width !== lw || layer.height !== lh) {
          layer.width = lw;
          layer.height = lh;
          s.upTo = Number.NEGATIVE_INFINITY;
        }
        rest = layer.getContext("2d");
        rest?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (rest === null) return;
      const sizeKey = `${w}x${h}x${dpr}`;
      if (s.sizeKey !== sizeKey || tq < s.upTo) {
        s.sizeKey = sizeKey;
        s.upTo = Number.NEGATIVE_INFINITY;
      }
      if (s.upTo === Number.NEGATIVE_INFINITY) rest.clearRect(0, 0, w, h);
      for (let i = 0; i < plan.lines.length; i++) {
        const at = sched.land[i]!;
        if (at > s.upTo && at <= tq && slots[i] !== undefined) drawSlot(rest, plan.lines[i]!, slots[i]!, w, h, charW);
      }
      s.upTo = tq;
      const sx = scissorsX(tq, tm);
      if (incremental) {
        if (!reduced && tq >= tm.snap && sx > 0) ctx.clearRect(0, 0, Math.min(w, sx * w), h);
        return;
      }
      // The TV's frame: the heap at rest (cut in strips once the scissors start), then what flies over it.
      ctx.clearRect(0, 0, w, h);
      const layer = s.layer!;
      if (tq < tm.snap) ctx.drawImage(layer, 0, 0, w, h);
      else
        for (let k = 0; k < STRIPS; k++) {
          const x0 = k / STRIPS;
          const fall = progress(tq, cutAt(x0 + 0.5 / STRIPS, tm), 450);
          if (fall >= 1) continue;
          const drop = ease.inQuad(fall) * h * 0.4;
          const srcX = x0 * layer.width;
          const srcW = layer.width / STRIPS;
          ctx.globalAlpha = 1 - fall;
          ctx.drawImage(layer, srcX, 0, srcW, layer.height / 2, x0 * w, -drop, w / STRIPS, h / 2);
          ctx.drawImage(layer, srcX, layer.height / 2, srcW, layer.height / 2, x0 * w, h / 2 + drop, w / STRIPS, h / 2);
          ctx.globalAlpha = 1;
        }
      ctx.save();
      if (tq >= tm.snap) {
        ctx.beginPath();
        ctx.rect(Math.max(0, sx * w), 0, w, h);
        ctx.clip();
      }
      for (let i = 0; i < plan.lines.length; i++) {
        const a = sched.leave[i]!;
        const b = sched.land[i]!;
        const slot = slots[i];
        if (tq < a || tq >= b || slot === undefined) continue;
        const f = flightAt(slot, win, i, (tq - a) / (b - a));
        ctx.save();
        ctx.translate(f.x * w, f.y * h);
        ctx.rotate(f.rot);
        ctx.scale(f.scale, f.scale);
        drawPiece(ctx, plan.lines[i]!, slot.fs * h, charW);
        ctx.restore();
      }
      if (tq >= tm.eye) drawTentacles(ctx, w, h, tq, tm, ring, win, charW);
      ctx.restore();
    },
    [tq, tm, sched, plan, ring, incremental, reduced],
  );
  // The TV's heap breathes once the eye is open; reduced motion's fades at the snap.
  const breathe = !incremental && t >= tm.eye && t < tm.snap ? 1 + 0.012 * Math.sin(((t - tm.eye) / 1600) * Math.PI * 2) : 1;
  const style: CSSProperties | undefined = reduced ? { opacity: 1 - progress(t, tm.snap, 600) } : breathe !== 1 ? { transform: `scale(${breathe.toFixed(4)})` } : undefined;
  return <canvas ref={ref} className="kit-fill tv3-lb-tide" style={style} aria-hidden="true" />;
}

// --- the notes, the ask, the scissors ---------------------------------------------------------

function BreachNotes({ t, tm, lite, reduced, portrait }: BreachParts & { portrait: boolean }) {
  const notes = BREACH_NOTES.filter((n) => (reduced ? n.calm : lite ? n.lite : true));
  const life = noteLife(tm);
  return (
    <>
      {notes.map((n) => {
        const at = noteAt(n, tm);
        const end = at + life;
        if (t < at || t >= end) return null;
        const pos = portrait ? n.port : n.land;
        // OK'd away at the end of its life (it shrinks; reduced motion: it fades).
        const close = progress(t, end - 200, 200);
        const copy = LANG_COPY.notes[n.id];
        return (
          <div key={n.id} className="tv3-lb-note" style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${pos.w}%`, opacity: 1 - close, transform: close > 0 && !reduced ? `scale(${(1 - 0.3 * close).toFixed(3)})` : undefined }}>
            <Win98Dialog title={copy.title} message={copy.text} kind={n.icon} tone={n.icon === "error" ? "red" : "navy"} width="100%" open={progress(t, at, reduced ? 300 : 360)} reduced={reduced} pressed={t >= end - 450 ? 0 : undefined} />
          </div>
        );
      })}
    </>
  );
}

function BreachAsk({ t, tm, reduced, portrait }: BreachParts & { portrait: boolean }) {
  if (t < tm.ask || t >= tm.snap + 200) return null;
  const win = winRect(portrait ? 0.5 : 2);
  return (
    <div className="tv3-lb-ask" style={{ left: pct(win.x + win.w / 2), top: pct(win.y + win.h / 2), width: portrait ? "84%" : "34%", opacity: 1 - progress(t, tm.snap, 200) }}>
      <Win98Dialog title={LANG_COPY.ask.title} message={LANG_COPY.ask.text} kind="question" width="100%" actions={LANG_COPY.ask.actions} pressed={t >= tm.press ? 2 : undefined} open={progress(t, tm.ask, reduced ? 300 : 360)} reduced={reduced} />
    </div>
  );
}

/** Scissors pointing the way they cut, snipping three times a second. */
function Scissors({ t, tm, x }: { t: number; tm: BreachTimes; x: number }) {
  const a = 3 + 17 * Math.abs(Math.sin(((t - tm.snap) / 150) * Math.PI));
  const blade = (sign: 1 | -1) => (
    <g transform={`rotate(${(sign * a).toFixed(2)})`}>
      <path d={`M-4 0 L60 ${sign * 1.5} L-4 ${sign * 7} Z`} fill="#e3e9f0" stroke="#1a1f2a" strokeWidth="1.4" />
      <path d={`M-2 ${sign * 2} L-20 ${sign * 10}`} stroke="#d0141a" strokeWidth="6" strokeLinecap="round" />
      <circle cx="-30" cy={sign * 14} r="10" fill="none" stroke="#d0141a" strokeWidth="6" />
    </g>
  );
  return (
    <svg className="tv3-lb-scissors" viewBox="-44 -30 108 60" style={{ left: pct(x) }} aria-hidden="true">
      {blade(-1)}
      {blade(1)}
      <circle r="3" fill="#6a6a6a" stroke="#1a1f2a" strokeWidth="1" />
    </svg>
  );
}

function BreachCut({ t, tm, reduced }: BreachParts) {
  if (t < tm.press || t >= tm.cut + (reduced ? 900 : 0)) return null;
  if (reduced)
    return (
      <div className="tv3-lb-snipped" style={{ opacity: progress(t, tm.press, 300) * (1 - progress(t, tm.snap + 400, 500)) }}>
        ✂
      </div>
    );
  const x = scissorsX(t, tm);
  return (
    <>
      <div className="tv3-lb-cutline" style={{ left: pct(Math.max(0, x)), opacity: progress(t, tm.press, 200) }} />
      {t >= tm.snap && <Scissors t={t} tm={tm} x={x} />}
    </>
  );
}

// --- the summary ------------------------------------------------------------------------------

function Summary({ t, at, plan, reduced, breach }: { t: number; at: number; plan: LanguagePlan; reduced: boolean; breach: boolean }) {
  const card = (k: number): CSSProperties => {
    const s = at + k * 240;
    if (t < s) return { opacity: 0 };
    if (reduced) return { opacity: progress(t, s, 400) };
    const p = progress(t, s, 420);
    return { opacity: clamp01(p * 3), transform: `scale(${lerp(1.8, 1, ease.outBack(p)).toFixed(3)})` };
  };
  let k = 0;
  const bar = reduced ? 1 : eased(t, at + 400, 1000);
  return (
    <>
      <div className="tv3-lb-sum">
        {plan.curser !== null && (
          <div className="tv3-lb-card" style={card(k++)}>
            <span className="tv3-lb-label">{LANG_COPY.curser}</span>
            <span className={`tv3-lb-who${whoSize(plan.curser.who)}`}>{plan.curser.who}</span>
            <span className="tv3-lb-sub">{plan.curser.count}</span>
          </div>
        )}
        {plan.censored !== null && (
          <div className="tv3-lb-card" style={card(k++)}>
            <span className="tv3-lb-label">{LANG_COPY.censored}</span>
            <span className="tv3-lb-frac">
              {reduced ? <span className="tv3-lb-c">{plan.censored.c.toLocaleString("en-US")}</span> : <BigNumber t={t} to={plan.censored.c} start={at + 300} dur={1000} className="tv3-lb-c" />}
              {plan.censored.of}
            </span>
            <span className="tv3-lb-bar">
              <span style={{ transform: `scaleX(${(plan.censored.share * bar).toFixed(3)})` }} />
            </span>
          </div>
        )}
        {plan.level !== null && (
          <div className="tv3-lb-card" style={card(k++)}>
            <span className="tv3-lb-label">{LANG_COPY.level}</span>
            <span className="tv3-lb-value">{plan.level.text}</span>
            <span className="tv3-lb-slider">
              <span className="tv3-lb-knob" style={{ left: `${plan.level.pct}%` }} />
            </span>
            <span className="tv3-lb-sub">{plan.level.caption}</span>
          </div>
        )}
        {plan.stars !== null && (
          <div className="tv3-lb-card" style={card(k++)}>
            <span className="tv3-lb-label">{LANG_COPY.stars}</span>
            <span className="tv3-lb-value">
              ⭐ {reduced ? <span className="tv3-lb-c">{plan.stars.n.toLocaleString("en-US")}</span> : <BigNumber t={t} to={plan.stars.n} start={at + 300 + k * 240} dur={900} className="tv3-lb-c" />}
            </span>
            <span className="tv3-lb-sub">{LANG_COPY.starsSub}</span>
          </div>
        )}
      </div>
      {plan.line !== null ? (
        <div className="tv3-lb-line" style={{ opacity: progress(t, at + k * 240 + 300, 600) }}>
          {plan.line}
        </div>
      ) : (
        breach && (
          <div className="tv3-lb-chip" style={{ opacity: progress(t, at + k * 240 + 300, 600) }}>
            <span className="tv3-lb-chip-log">▣ {LANG_COPY.file}</span>
            <span>
              {plan.total} {plan.total === 1 ? "line" : "lines"}
            </span>
            {plan.top !== null && (
              <span>
                {LANG_COPY.top}: “{plan.top.word}” ×{plan.top.count}
              </span>
            )}
            <span className="tv3-lb-chip-ok">{LANG_COPY.contained}</span>
          </div>
        )
      )}
    </>
  );
}

// --- the scene --------------------------------------------------------------------------------

function twinkles(n: number, seed: number): Emitter[] {
  return [{ x: 0.5, y: 0.45, w: 1, h: 0.9, start: 0, end: 10_000_000, rate: n, life: 1600, speed: 0.01, angle: -90, spread: 360, size: 10, colors: ["#fff6c8", "#ffd23f", "#ffffff"], shape: "star", seed, fade: 0.6 }];
}
const TWINKLE_TV = twinkles(14, 181);
const TWINKLE_WALL = twinkles(6, 183);

/** One pop from the lower corners when the summary lands (the cannons only, nothing falls over the cards). */
export function langPop(at: number, lite: boolean): Emitter[] {
  return confettiEmitters(at, 500, lite ? 0.5 : 1, 181).slice(0, 2);
}

/** The summary's start: after the snap, or (no breach) straight after the title. */
export const LANG_SUMMARY_PLAIN = BREACH.cmd + 200;

export function LanguageScene({ t, value, night, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  const portrait = usePortrait();
  const award = awardOf(value);
  const report = night.language ?? null;
  const key = report === null ? "" : reportKey(report);
  // Rebuilt when the report's content changes (`key`), not on every poll's fresh object.
  const plan = useMemo(() => (report === null ? null : languagePlan(report)), [key]);
  const breach = plan !== null && plan.lines.length > 0;
  const tm = useMemo(() => breachTimes(plan?.lines.length ?? 0), [plan]);
  const sched = useMemo(() => breachSchedule(tm, !lite && !reduced), [tm, lite, reduced]);
  const ring = useMemo(() => ringOf(plan?.lines ?? []), [plan]);
  const sumAt = breach ? tm.summary : LANG_SUMMARY_PLAIN;
  const pop = useMemo(() => langPop(sumAt, lite), [sumAt, lite]);
  const parts: BreachParts | null = plan === null ? null : { t, tm, sched, plan, ring, lite, reduced };
  const during = breach && t >= tm.flow && t < tm.cut;
  useSfxCues(t, sfx, [
    [200, "drumroll", { gain: 0.55 }],
    [900, "whoosh", { gain: 0.5 }],
    ...(plan === null ? [] : plan.none !== null ? [[LANG_SUMMARY_PLAIN, "chime"] as const] : []),
    ...(breach
      ? ([
          [BREACH.cmd, "popup", { gain: 0.6 }],
          [BREACH.cmd + 300, "type", { gain: 0.5 }],
          ...langTicks(sched.line).map((at) => [at, "tick", { gain: 0.3 }] as const),
          [tm.leak, "exclamation"],
          ...BREACH_NOTES.filter((n) => n.id !== "overflow" && (reduced ? n.calm : lite ? n.lite : true)).map((n) => [noteAt(n, tm), n.icon === "error" ? "critical" : "error", { gain: 0.6 }] as const),
          [tm.eye, "heartbeat"],
          [tm.ask, "chord"],
          [tm.press, "click"],
          [tm.snap, "whoosh"],
          [tm.snap + 400, "close"],
        ] as const)
      : []),
    ...(plan !== null && plan.none === null ? [[sumAt, plan.curser !== null ? "tada" : "blip"] as const] : []),
  ]);
  const flip = reduced ? progress(t, 800, 400) : eased(t, 800, 700, ease.outBack);
  return (
    <Stage bg="radial-gradient(ellipse at 50% 55%, #2e2710 0%, #050403 78%)" className="tv3-award tv3-lang">
      {!during && <SpotCones t={t} reduced={reduced} color="rgba(255, 220, 140, 0.1)" />}
      {!during && <Particles t={t} emitters={lite ? TWINKLE_WALL : TWINKLE_TV} blend="add" />}
      {!lite && breach && t >= tm.leak && t < tm.cut && <div className="kit-fill tv3-lb-void" style={{ opacity: progress(t, tm.leak, 1500) * (1 - progress(t, tm.snap, BREACH.cut)) }} />}
      <div className="tv3-award-spot" style={{ opacity: 0.45 + 0.25 * pulse(t, 5200), transform: `translate(-50%, -50%) scale(${lerp(2.4, 1, eased(t, 0, 800)).toFixed(3)})` }} />
      <div className="tv3-award-emblem tv3-lang-emblem" style={{ opacity: clamp01(flip * 2), transform: reduced ? "translateX(-50%)" : `translateX(-50%) perspective(60em) rotateY(${lerp(-90, 0, flip).toFixed(1)}deg) translateY(${(Math.sin(t / 900) * 3).toFixed(1)}%)` }}>
        <AwardEmblem kind={award.emblem} size={lite ? "13vmin" : "12vmin"} />
      </div>
      <div className="tv3-award-kind tv3-lang-kind" style={{ opacity: progress(t, BREACH.kind, 400) }}>
        {LANG_COPY.kind}
      </div>
      <div className="tv3-award-title tv3-lang-title">
        <Typewriter text={award.title.toUpperCase()} t={t} start={BREACH.title} cps={26} caret={t < 2400} />
      </div>
      {plan === null ? (
        <div className="tv3-award-line" style={{ opacity: progress(t, 2600, 800) }}>
          {award.line}
        </div>
      ) : plan.none !== null ? (
        <div className="tv3-lb-none" style={t >= LANG_SUMMARY_PLAIN ? (reduced ? { opacity: progress(t, LANG_SUMMARY_PLAIN, 400) } : { opacity: progress(t, LANG_SUMMARY_PLAIN, 300) }) : { opacity: 0 }}>
          {plan.none}
        </div>
      ) : (
        <>
          {breach && parts !== null && t >= BREACH.cmd && t < tm.snap + 1200 && <BreachWindow {...parts} portrait={portrait} />}
          {during && parts !== null && <BreachTide {...parts} />}
          {breach && parts !== null && t < tm.snap && <BreachNotes {...parts} portrait={portrait} />}
          {breach && parts !== null && <BreachAsk {...parts} portrait={portrait} />}
          {breach && parts !== null && <BreachCut {...parts} />}
          {t >= sumAt && <Summary t={t} at={sumAt} plan={plan} reduced={reduced} breach={breach} />}
        </>
      )}
      {!reduced && plan !== null && plan.none === null && t >= sumAt && <Particles t={t} emitters={pop} />}
    </Stage>
  );
}

/** The log's ticks: one at most every 240 ms, the last line's always. */
export function langTicks(line: readonly number[]): number[] {
  const out: number[] = [];
  for (const at of line) if (out.length === 0 || at - out[out.length - 1]! >= 240) out.push(at);
  const last = line[line.length - 1];
  if (last !== undefined && out[out.length - 1] !== last) out.push(last);
  return out;
}
