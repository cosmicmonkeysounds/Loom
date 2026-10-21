//! Act D–E's own pieces (wave 17, lane tv2), on top of the shared kit:
//! the King and his bar, the printer, the patch bay, the cold door, a
//! phone that buzzes, a mirror ball, a motorcycle, drifting popups, frost,
//! a screen shake, and the wall terminals' lighter animated card. Original
//! vector art; every piece a picture of `t`.

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { slideCopy } from "../../slides.ts";
import { driftPops, type DriftPop } from "./tv2-time.ts";
import { blink, clamp01, ease, eased, noise1, progress, pulse } from "./time.ts";
import { Stage } from "./stage.tsx";
import { Typewriter } from "./text.tsx";
import { Win98Dialog, Win98Icon, Win98Window, type IconKind } from "./win98.tsx";

// --- hooks ------------------------------------------------------------------------------

/** End the scene (`done()`) once `t` passes `ms` — a wall take shorter than the TV's. */
export function useEndAt(t: number, ms: number, done: () => void): void {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current || t < ms) return;
    fired.current = true;
    done();
  }, [t, ms, done]);
}

/**
 * The scene `t` at which `key` was first non-null (a name the story fills
 * in mid-scene), else null. Already there on the scene's first frame (a
 * reload, a history slide): `-Infinity` — it is simply up, no entrance.
 */
export function useFirstSeen(key: string | null, t: number): number | null {
  const seen = useRef(new Map<string, number>());
  const mount = useRef<number | null>(null);
  if (mount.current === null) mount.current = t;
  if (key === null) return null;
  let at = seen.current.get(key);
  if (at === undefined) {
    at = t === mount.current ? Number.NEGATIVE_INFINITY : t;
    seen.current.set(key, at);
  }
  return at;
}

// --- motion wrappers ----------------------------------------------------------------------

/** Shakes its children: `amount` (0..1) of a 14 px jolt, a new offset every 40 ms; reduced motion never moves. */
export function Shake({ t, amount, seed = 1, reduced = false, className, style, children }: { t: number; amount: number; seed?: number; reduced?: boolean; className?: string; style?: CSSProperties; children: ReactNode }) {
  const a = reduced ? 0 : clamp01(amount);
  const b = Math.floor(t / 40);
  const dx = a === 0 ? 0 : (noise1(seed, b * 2) - 0.5) * 28 * a;
  const dy = a === 0 ? 0 : (noise1(seed, b * 2 + 1) - 0.5) * 18 * a;
  return (
    <div className={`tv2-shake${className ? ` ${className}` : ""}`} style={{ ...style, transform: a === 0 ? undefined : `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)` }}>
      {children}
    </div>
  );
}

/** CRT scanlines + a vignette over a scene (static CSS; `roll` moves a soft bar down the glass). */
export function Glass({ t, roll = true, reduced = false, strength = 1 }: { t: number; roll?: boolean; reduced?: boolean; strength?: number }) {
  const y = ((t / 5200) % 1) * 120 - 10;
  return (
    <div className="kit-fill tv2-glass" aria-hidden="true" style={{ opacity: strength }}>
      {roll && !reduced && <div className="tv2-roll" style={{ transform: `translate3d(0, ${y.toFixed(2)}vh, 0)` }} />}
    </div>
  );
}

// --- drifting popups --------------------------------------------------------------------------

export interface PopMsg {
  title: string;
  text: string;
  kind?: "error" | "warning" | "info" | "question";
  actions?: readonly string[];
  tone?: "navy" | "red" | "green" | "purple" | "black";
}

/** Popups that keep landing and leaving while a slide is held (`driftPops`): a hold that never stands still. */
export function DriftingPopups({ t, messages, count = 3, seed = 5, life = 6500, gap = 3000, start = 0, area, width = "26%", reduced = false }: { t: number; messages: readonly PopMsg[]; count?: number; seed?: number; life?: number; gap?: number; start?: number; area?: { x0: number; x1: number; y0: number; y1: number }; width?: string; reduced?: boolean }) {
  if (messages.length === 0) return null;
  const pops: DriftPop[] = driftPops(t, count, { seed, life, gap, start, area });
  return (
    <div className="kit-fill tv2-drift" aria-hidden="true">
      {pops.map((p) => {
        const m = messages[p.pick % messages.length]!;
        return <Win98Dialog key={`${p.i}:${p.life}`} title={m.title} message={m.text} kind={m.kind ?? "warning"} actions={m.actions ?? ["OK"]} tone={m.tone} x={p.x * 100} y={p.y * 100} width={width} open={p.open} reduced={reduced} zIndex={10 + p.i} />;
      })}
    </div>
  );
}

// --- the King -----------------------------------------------------------------------------------

/** The King (original art): a tall chess king in Win98 silver, with a crown and a cross. `fallen` 0..1 tips him; `crownOff` lifts the crown away. */
export function KingPiece({ size = "10em", fallen = 0, wobble = 0, crownOff = 0, className, style }: { size?: string; fallen?: number; wobble?: number; crownOff?: number; className?: string; style?: CSSProperties }) {
  const tip = ease.outBounce(clamp01(fallen)) * 78 + wobble;
  const c = clamp01(crownOff);
  return (
    <svg className={`tv2-king${className ? ` ${className}` : ""}`} viewBox="0 0 64 96" width={size} height={size} style={style} aria-hidden="true">
      <g transform={`rotate(${tip.toFixed(2)} 50 92)`}>
        <ellipse cx="32" cy="90" rx="24" ry="4.5" fill="#202020" opacity="0.35" />
        <path d="M10 88 H54 L50 80 H14 Z" fill="#c0c0c0" stroke="#000" strokeWidth="1.2" />
        <path d="M16 80 Q18 64 22 52 H42 Q46 64 48 80 Z" fill="#dcdcdc" stroke="#000" strokeWidth="1.2" />
        <rect x="18" y="47" width="28" height="6" fill="#a8a8a8" stroke="#000" strokeWidth="1.2" />
        <path d="M20 47 Q16 34 24 28 H40 Q48 34 44 47 Z" fill="#e8e8e8" stroke="#000" strokeWidth="1.2" />
        <path d="M24 30 Q32 25 40 30" fill="none" stroke="#808080" strokeWidth="1.2" />
        <g transform={`translate(${(c * 22).toFixed(2)} ${(-c * 18 + c * c * 60).toFixed(2)}) rotate(${(c * 140).toFixed(1)} 32 18)`}>
          <path d="M22 28 L20 16 L26 21 L32 12 L38 21 L44 16 L42 28 Z" fill="#ffcc33" stroke="#7a5200" strokeWidth="1.2" />
          <rect x="30.5" y="2" width="3" height="11" fill="#ffcc33" stroke="#7a5200" strokeWidth="0.8" />
          <rect x="27" y="5" width="10" height="3" fill="#ffcc33" stroke="#7a5200" strokeWidth="0.8" />
        </g>
        <path d="M22 60 H42 M20 70 H44" stroke="#9a9a9a" strokeWidth="1" />
      </g>
    </svg>
  );
}

/** The King's shared bar: `share` lit, a white `chip` for the point just lost, `flash` whitening it on the hit. */
export function HealthBar({ share, chip = 0, flash = 0, label, className, style }: { share: number; chip?: number; flash?: number; label?: ReactNode; className?: string; style?: CSSProperties }) {
  const s = clamp01(share);
  const hot = s <= 0.34;
  return (
    <div className={`tv2-hp${hot ? " hot" : ""}${className ? ` ${className}` : ""}`} style={style}>
      <div className="tv2-hp-track">
        <div className="tv2-hp-fill" style={{ transform: `scaleX(${s.toFixed(4)})` }} />
        <div className="tv2-hp-chip" style={{ left: `${(s * 100).toFixed(2)}%`, transform: `scaleX(${clamp01(chip / Math.max(0.0001, 1 - s)).toFixed(4)})`, width: `${((1 - s) * 100).toFixed(2)}%` }} />
        <div className="tv2-hp-flash" style={{ opacity: clamp01(flash) }} />
        <div className="tv2-hp-ticks" />
      </div>
      {label !== undefined && <div className="tv2-hp-label">{label}</div>}
    </div>
  );
}

// --- the printer ---------------------------------------------------------------------------------

/** A beige office printer (original art): `paper` 0..1 out of the slot, `lid` 0..1 open, `led` lit. */
export function PrinterArt({ paper = 0, lid = 0, led = true, jam = 0, lcd, size = "16em", className, style }: { paper?: number; lid?: number; led?: boolean; jam?: number; lcd?: string; size?: string; className?: string; style?: CSSProperties }) {
  const p = clamp01(paper);
  const l = clamp01(lid);
  return (
    <svg className={`tv2-printer${className ? ` ${className}` : ""}`} viewBox="0 0 120 100" width={size} height={size} style={style} aria-hidden="true">
      <ellipse cx="60" cy="94" rx="54" ry="5" fill="#000" opacity="0.3" />
      {/* the paper, under the body so it comes out of the slot */}
      <g transform={`translate(0 ${(-p * 64).toFixed(2)})`}>
        <rect x="34" y="38" width="52" height="34" fill="#fff" stroke="#999" />
        {[44, 50, 56].map((y) => (
          <rect key={y} x="40" y={y} width={y === 44 ? 40 : 30} height="2" fill="#000080" opacity={y === 44 ? 0.8 : 0.4} />
        ))}
        {jam > 0 && <path d={`M34 38 L${44 + jam * 10} ${33 - jam * 4} L${56 + jam * 4} 39 L${70 - jam * 6} ${32 - jam * 5} L86 38`} fill="#fff" stroke="#999" />}
      </g>
      <rect x="10" y="44" width="100" height="44" rx="4" fill="#d9d2bd" stroke="#4a4535" strokeWidth="1.5" />
      <rect x="10" y="78" width="100" height="10" fill="#c4bca5" stroke="#4a4535" strokeWidth="1" />
      <rect x="28" y="40" width="64" height="6" fill="#3a3a3a" />
      {/* the lid, hinged at its back edge */}
      <g transform={`rotate(${(-l * 72).toFixed(2)} 14 44)`}>
        <rect x="14" y="30" width="92" height="14" rx="3" fill="#e6dfca" stroke="#4a4535" strokeWidth="1.5" />
        <rect x="40" y="34" width="40" height="3" fill="#bfb7a0" />
      </g>
      <rect x="80" y="56" width="24" height="10" fill="#1c2a1c" stroke="#000" strokeWidth="0.6" />
      {lcd !== undefined && (
        <text x="92" y="63.4" textAnchor="middle" fontSize="5" fontFamily="monospace" fill="#7dff7d">
          {lcd}
        </text>
      )}
      <circle cx="92" cy="72" r="2.6" fill={led ? "#ffb000" : "#5a4a20"} />
      <circle cx="100" cy="72" r="2.6" fill="#1a3a1a" />
      <rect x="18" y="58" width="22" height="3" fill="#8c846e" />
    </svg>
  );
}

// --- the patch bay ----------------------------------------------------------------------------------

/** The patch bay behind the cold door (`beats/server-room.loom`): a top row of lightning, a bottom row of grease. `lit(row, i)` 0..1. */
export function PatchBay({ lit, cols = 12, pulled = -1, className, style }: { lit: (row: 0 | 1, i: number) => number; cols?: number; pulled?: number; className?: string; style?: CSSProperties }) {
  const w = 14;
  return (
    <svg className={`tv2-bay${className ? ` ${className}` : ""}`} viewBox={`0 0 ${cols * w + 16} 58`} style={style} aria-hidden="true">
      <rect x="0" y="0" width={cols * w + 16} height="58" rx="2" fill="#1b1d22" stroke="#555" />
      <rect x="3" y="3" width="5" height="52" fill="#2a2d33" />
      <rect x={cols * w + 8} y="3" width="5" height="52" fill="#2a2d33" />
      {Array.from({ length: cols }, (_, i) => {
        const x = 8 + i * w + w / 2;
        const a = clamp01(lit(0, i));
        const b = clamp01(lit(1, i));
        return (
          <g key={i}>
            <circle cx={x} cy="18" r="4.4" fill="#0a0a0a" stroke="#777" strokeWidth="0.8" />
            <path d={`M${x + 1} ${11} L${x - 2.4} ${18.5} H${x + 0.6} L${x - 1} ${25} L${x + 2.8} ${16.6} H${x - 0.2} Z`} fill="#ffd23f" opacity={0.2 + 0.8 * a} />
            {a > 0.6 && <circle cx={x} cy="18" r="6.5" fill="#ffd23f" opacity={(a - 0.6) * 0.6} />}
            <circle cx={x} cy="42" r="4.4" fill="#0a0a0a" stroke="#777" strokeWidth="0.8" />
            {i === pulled ? <path d={`M${x} 42 l-3 9 m3 -9 l3 8`} stroke="#ff6a00" strokeWidth="1.4" /> : <path d={`M${x} ${36.5} Q${x + 3.2} ${41.5} ${x} ${46} Q${x - 3.2} ${41.5} ${x} ${36.5} Z`} fill="#5b3a1a" opacity={0.3 + 0.7 * b} />}
            <rect x={x - 2} y="30" width="4" height="2" fill={a > 0.5 ? "#3ddc84" : "#203020"} />
          </g>
        );
      })}
    </svg>
  );
}

// --- the cold door -----------------------------------------------------------------------------------

/** The server room's door in its frame, a keypad beside it: `open` 0..1 swings it in. */
export function ColdDoor({ open, keypad = 0, className, style }: { open: number; keypad?: number; className?: string; style?: CSSProperties }) {
  const o = clamp01(open);
  return (
    <div className={`tv2-door${className ? ` ${className}` : ""}`} style={style}>
      <div className="tv2-door-frame">
        <div className="tv2-door-light" style={{ opacity: o }} />
        <div className="tv2-door-leaf" style={{ transform: `perspective(40em) rotateY(${(-o * 82).toFixed(2)}deg)` }}>
          <div className="tv2-door-sign">COLD STORAGE</div>
          <div className="tv2-door-handle" />
        </div>
      </div>
      <div className="tv2-keypad" style={{ boxShadow: `0 0 ${(0.2 + keypad * 0.8).toFixed(2)}em rgba(61, 220, 132, ${(0.3 + 0.7 * keypad).toFixed(2)})` }}>
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} />
        ))}
        <b style={{ background: keypad > 0.5 ? "#3ddc84" : "#7a1010" }} />
      </div>
    </div>
  );
}

// --- small props ---------------------------------------------------------------------------------------

/** A flip phone that buzzes: `buzz` 0..1 shakes it, `note` pops a bubble over it. */
export function Phone({ t, buzz, note, seed = 1, className, style }: { t: number; buzz: number; note?: ReactNode; seed?: number; className?: string; style?: CSSProperties }) {
  const b = clamp01(buzz);
  const r = b === 0 ? 0 : Math.sin(t / 18 + seed) * 9 * b;
  return (
    <div className={`tv2-phone${className ? ` ${className}` : ""}`} style={style}>
      <svg viewBox="0 0 24 40" width="2.6em" height="4.3em" style={{ transform: `rotate(${r.toFixed(2)}deg)` }} aria-hidden="true">
        <rect x="2" y="2" width="20" height="36" rx="4" fill="#2b2f3a" stroke="#000" />
        <rect x="5" y="6" width="14" height="14" fill={b > 0.1 ? "#9fe8ff" : "#33505a"} />
        {Array.from({ length: 9 }, (_, i) => (
          <rect key={i} x={6 + (i % 3) * 4.5} y={24 + Math.floor(i / 3) * 4} width="3" height="2.6" fill="#8a8f9a" />
        ))}
      </svg>
      {note !== undefined && <div className="tv2-phone-note">{note}</div>}
    </div>
  );
}

/** The mirror ball: tiles that glint as it turns (`t`). */
export function MirrorBall({ t, size = "14em" }: { t: number; size?: string }) {
  const turn = (t / 40) % 360;
  return (
    <svg className="tv2-ball" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id="tv2-ball-clip">
          <circle cx="50" cy="50" r="44" />
        </clipPath>
      </defs>
      <circle cx="50" cy="50" r="45" fill="#8890a0" />
      <g clipPath="url(#tv2-ball-clip)">
        {Array.from({ length: 10 }, (_, row) =>
          Array.from({ length: 14 }, (_, col) => {
            const glint = pulse(t + (row * 97 + col * 53) * 7 + turn * 10, 900 + ((row * 13 + col * 7) % 5) * 180);
            const x = ((col * 8 + (turn / 360) * 8 * 14) % 112) - 6;
            return <rect key={`${row}.${col}`} x={x} y={row * 10 + 2} width="7" height="8" fill={glint > 0.85 ? "#ffffff" : glint > 0.5 ? "#d4dae6" : "#9aa3b5"} />;
          }),
        )}
      </g>
      <circle cx="50" cy="50" r="44" fill="none" stroke="#3c4250" strokeWidth="2" />
      <rect x="48.5" y="-50" width="3" height="56" fill="#555" />
    </svg>
  );
}

/** A pixel motorcycle and rider, wheels turning (`t`). */
export function Motorcycle({ t, size = "12em", style }: { t: number; size?: string; style?: CSSProperties }) {
  const spin = (t / 3) % 360;
  const wheel = (cx: number) => (
    <g transform={`rotate(${spin.toFixed(1)} ${cx} 44)`}>
      <circle cx={cx} cy="44" r="9" fill="#111" stroke="#666" strokeWidth="2" />
      <path d={`M${cx - 8} 44 H${cx + 8} M${cx} 36 V52`} stroke="#999" strokeWidth="1.2" />
    </g>
  );
  return (
    <svg className="tv2-moto" viewBox="0 0 90 56" width={size} height={size} style={style} aria-hidden="true">
      {wheel(16)}
      {wheel(72)}
      <path d="M16 44 L34 30 H58 L72 44" fill="none" stroke="#b0b0b0" strokeWidth="3" />
      <path d="M30 30 H62 L66 24 H38 Z" fill="#c01818" stroke="#000" />
      <path d="M62 24 L70 16" stroke="#ccc" strokeWidth="2.5" />
      <rect x="40" y="10" width="12" height="14" fill="#222" />
      <circle cx="47" cy="6" r="6" fill="#111" />
      <path d="M52 16 L64 20" stroke="#222" strokeWidth="4" />
      <path d="M6 40 h-6 M8 46 h-8" stroke="#ffcc33" strokeWidth="1.5" opacity={blink(t, 160) ? 1 : 0.3} />
    </svg>
  );
}

// --- frost ------------------------------------------------------------------------------------------

/** Frost creeping in from the edges (`amount` 0..1): a cold vignette with crystals at the rim. */
export function Frost({ amount, t }: { amount: number; t: number }) {
  const a = clamp01(amount);
  const breathe = 0.92 + 0.08 * pulse(t, 3800);
  return (
    <div className="kit-fill tv2-frost" aria-hidden="true" style={{ opacity: a * breathe }}>
      <div className="tv2-frost-edge" style={{ transform: `scale(${(1.25 - a * 0.25).toFixed(3)})` }} />
    </div>
  );
}

// --- the wall terminals' card ---------------------------------------------------------------------------

/**
 * A wall terminal's take on a slide or a moment: the slide card's Win98
 * window (its `SLIDE_COPY` title and lines, typed), popping open, an icon
 * that bobs, a strip of motion (`accent`) under the words, and a marquee.
 * Lighter than the TV's, never a still card: it keeps moving for the hold.
 */
export function WallCard({ t, value, title, lines, icon = "info", tone = "navy", accent, footer, reduced, bg = "#008080" }: { t: number; value?: string; title?: string; lines?: readonly string[]; icon?: IconKind; tone?: "navy" | "red" | "green" | "purple" | "black"; accent?: ReactNode; footer?: ReactNode; reduced: boolean; bg?: string }) {
  const copy = value !== undefined ? slideCopy(value) : { title: title ?? "", lines };
  const head = title ?? copy.title;
  const body = lines ?? copy.lines ?? [];
  const open = eased(t, 0, 420, ease.linear);
  const bob = reduced ? 0 : Math.sin(t / 420) * 0.12;
  let start = 600;
  return (
    <Stage bg={bg} className="tv2 tv2-wall">
      <div className="tv2-wall-dots" style={{ transform: reduced ? undefined : `translate3d(0, ${((t / 60) % 40).toFixed(1)}px, 0)` }} />
      <Win98Window title={head} icon={icon} tone={tone} x={50} y={46} center width="min(90vw, 34em)" open={open} reduced={reduced} className="tv2-wall-win" buttons={["min", "close"]}>
        <div className="tv2-wall-row">
          <span style={{ transform: `translateY(${bob.toFixed(3)}em)` }}>
            <Win98Icon kind={icon} size="3em" />
          </span>
          <div className="tv2-wall-text">
            <h2>{head}</h2>
            {body.map((l) => {
              const s = start;
              start += Math.min(2200, l.length * 34 + 400);
              return (
                <p key={l}>
                  <Typewriter text={l} t={t} start={s} cps={34} caret={false} />
                </p>
              );
            })}
          </div>
        </div>
        {accent !== undefined && <div className="tv2-wall-accent">{accent}</div>}
      </Win98Window>
      {footer !== undefined && <div className="tv2-wall-foot">{footer}</div>}
      <div className="tv2-wall-progress" style={{ transform: `scaleX(${progress(t % 4000, 0, 4000).toFixed(3)})` }} />
    </Stage>
  );
}
