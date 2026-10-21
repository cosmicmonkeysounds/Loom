//! Act A–C's building blocks (lane tv1): the wall card every wall scene is
//! made of, the marching icons, the beacon, the bottle and its table, the
//! Maps and Ducks emblem, the face that assembles at the introduction, the
//! data rain, the alarm clock, the ribbon, the bingo balls. Each is a
//! picture of `t` (no timers, no `Math.random`). Original art throughout.

import "./tv1.css";
import type { CSSProperties, ReactNode } from "react";
import { useCanvas } from "./canvas.ts";
import { Glitch } from "./effects.tsx";
import { Marquee, Typewriter } from "./text.tsx";
import { blink, clamp01, ease, eased, loop, noise1, progress, pulse, typedDuration } from "./time.ts";
import { BOTTLE_SEATS, marchersAt, rainColumn, seatAngle } from "./tv1-time.ts";
import { Win98Icon, Win98Window, type IconKind } from "./win98.tsx";

// --- the wall card ------------------------------------------------------------------------

export interface WallCardProps {
  t: number;
  title: string;
  lines?: readonly string[];
  icon?: IconKind;
  /** The window's title bar. */
  caption?: string;
  tone?: "navy" | "red" | "green" | "purple" | "black";
  /** What moves above the words (a picture of `t`). */
  art?: ReactNode;
  /** The backdrop: a CSS background. */
  bg?: string;
  /** A strip scrolling along the bottom. */
  footer?: string;
  /** Tear the title now and then (0..1). */
  glitch?: number;
  reduced: boolean;
  /** When the window opens (ms). */
  start?: number;
}

/**
 * A wall terminal's take on a beat: the backdrop drifting, a Win98 window
 * popping open with the art moving in it, the title torn now and then, the
 * lines typed one after another, a marquee along the bottom. Light (no
 * canvas unless the art brings one), and never still.
 */
export function WallCard({ t, title, lines = [], icon = "info", caption = "System", tone = "navy", art, bg = "linear-gradient(160deg, #003a5c, #00121f)", footer, glitch = 0.08, reduced, start = 150 }: WallCardProps) {
  const open = eased(t, start, 420, ease.linear);
  const titleAt = start + 380;
  let at = titleAt + typedDuration(title, { cps: 26 }) + 200;
  const typed = lines.map((l) => {
    const s = at;
    at += typedDuration(l, { cps: 34 }) + 250;
    return s;
  });
  const drift = reduced ? 0 : (t / 40) % 80;
  return (
    <div className="kit-stage a1w" style={{ background: bg }}>
      <div className="a1w-stripes" style={{ transform: `translate3d(${-drift}px, ${-drift}px, 0)` }} />
      <div className="a1w-glow" style={{ opacity: 0.35 + 0.25 * pulse(t, 4200) }} />
      <Win98Window title={caption} icon={icon} tone={tone} x={50} y={47} center width="min(92vw, 36em)" open={open} reduced={reduced} className="a1w-win">
        {art !== undefined && <div className="a1w-art">{art}</div>}
        <Glitch t={t} intensity={reduced ? 0 : glitch} seed={7} reduced={reduced} className="a1w-title">
          <Typewriter text={title} t={t} start={titleAt} cps={26} caret={false} />
        </Glitch>
        {lines.map((l, i) => (
          <div key={i} className="a1w-line">
            <Typewriter text={l} t={t} start={typed[i]!} cps={34} caret={i === lines.length - 1} />
          </div>
        ))}
      </Win98Window>
      {footer !== undefined && (
        <Marquee t={reduced ? 0 : t} speed={110} className="a1w-footer" style={{ opacity: progress(t, start + 600, 500) }}>
          {footer}
        </Marquee>
      )}
    </div>
  );
}

// --- motion pieces ---------------------------------------------------------------------------

const MARCH_ICONS: readonly IconKind[] = ["computer", "document", "folder", "globe", "mail", "trash"];

/** Program icons walking in from every edge to the middle (a stream, forever). */
export function March({ t, count = 18, period = 5200, seed = 3, reduced, icons = MARCH_ICONS, size = "2.4em", className }: { t: number; count?: number; period?: number; seed?: number; reduced: boolean; icons?: readonly IconKind[]; size?: string; className?: string }) {
  return (
    <div className={`kit-fill a1-march${className ? ` ${className}` : ""}`} aria-hidden="true">
      {marchersAt(t, count, period, seed, reduced).map((m) => (
        <div key={m.i} className="a1-marcher" style={{ left: `${(m.x * 100).toFixed(2)}%`, top: `${(m.y * 100).toFixed(2)}%`, opacity: m.alpha, transform: `translate(-50%, -50%) scale(${(1 - m.k * 0.45).toFixed(3)})` }}>
          <Win98Icon kind={icons[m.kind % icons.length]!} size={size} />
        </div>
      ))}
    </div>
  );
}

/** A lighthouse sweep turning over the whole stage (a soft wedge of `color`). */
export function Beacon({ t, color = "rgba(255, 220, 80, 0.22)", period = 3600, reduced, className }: { t: number; color?: string; period?: number; reduced: boolean; className?: string }) {
  const turn = reduced ? 0 : loop(t, period) * 360;
  return (
    <div className={`a1-beacon${className ? ` ${className}` : ""}`} aria-hidden="true" style={{ transform: `translate(-50%, -50%) rotate(${turn.toFixed(1)}deg)`, background: `conic-gradient(from 0deg, ${color} 0deg, rgba(0,0,0,0) 38deg, rgba(0,0,0,0) 180deg, ${color} 180deg, rgba(0,0,0,0) 218deg, rgba(0,0,0,0) 360deg)` }} />
  );
}

/** Chevrons on the floor all pointing at the middle, a wave running down them. */
export function Chevrons({ t, reduced, rows = 6, color = "#ffd23f" }: { t: number; reduced: boolean; rows?: number; color?: string }) {
  const sides = [0, 90, 180, 270];
  return (
    <div className="kit-fill a1-chevrons" aria-hidden="true">
      {sides.map((rot) => (
        <div key={rot} className="a1-chev-arm" style={{ transform: `rotate(${rot}deg)` }}>
          {Array.from({ length: rows }, (_, i) => {
            // The wave runs inward: from the outer chevron to the inner one.
            const wave = reduced ? 0.6 : clamp01(1 - Math.abs(loop(t / 1400 + i / rows, 1) - 0.5) * 3);
            return (
              <span key={i} className="a1-chev" style={{ color, opacity: 0.18 + 0.7 * wave, left: `${((i + 1) * 100) / (rows + 1)}%` }}>
                ❯
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// --- the bottle ----------------------------------------------------------------------------

/** A green glass bottle, its neck at 12 o'clock, turned `angle`° (original art). */
export function Bottle({ angle, className, style }: { angle: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`a1-bottle${className ? ` ${className}` : ""}`} viewBox="-20 -60 40 120" style={{ ...style, transform: `rotate(${angle.toFixed(2)}deg)` }} aria-hidden="true">
      <defs>
        <linearGradient id="a1-glass" x1="0" x2="1">
          <stop offset="0" stopColor="#0c5a26" />
          <stop offset="0.35" stopColor="#3ccf6e" />
          <stop offset="0.55" stopColor="#1f9a49" />
          <stop offset="1" stopColor="#0a4a1f" />
        </linearGradient>
      </defs>
      <path d="M -5 -58 H 5 V -40 Q 5 -30 14 -18 Q 18 -12 18 0 V 50 Q 18 58 10 58 H -10 Q -18 58 -18 50 V 0 Q -18 -12 -14 -18 Q -5 -30 -5 -40 Z" fill="url(#a1-glass)" stroke="#063314" strokeWidth="1.5" />
      <rect x="-6" y="-60" width="12" height="6" rx="1.5" fill="#d9b44a" stroke="#6b5212" />
      <rect x="-14" y="6" width="28" height="22" rx="2" fill="#f4ecd2" stroke="#7a6a3a" />
      <text x="0" y="21" textAnchor="middle" fontSize="8" fontFamily="Tahoma, sans-serif" fontWeight="bold" fill="#7a1010">
        TRUTH
      </text>
      <path d="M -11 -8 Q -13 10 -12 44" stroke="#fff" strokeOpacity="0.45" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

const SEAT_ICONS: readonly IconKind[] = ["computer", "document", "folder", "globe", "mail", "trash", "lock", "duck", "computer", "document", "folder", "mail"];

/**
 * The bottle's table, from above: felt, a ring of program seats, the bottle
 * in the middle at `angle`. `lit` (a seat) glows and lifts; `name` labels it.
 */
export function BottleTable({ t, angle, lit = null, name = null, seats = BOTTLE_SEATS, reduced, className }: { t: number; angle: number; lit?: number | null; name?: string | null; seats?: number; reduced: boolean; className?: string }) {
  return (
    <div className={`a1-table${className ? ` ${className}` : ""}`}>
      <div className="a1-felt" />
      {Array.from({ length: seats }, (_, i) => {
        const a = (seatAngle(i, seats) - 90) * (Math.PI / 180);
        const on = lit === i;
        const bob = on && !reduced ? 0.06 * Math.sin(t / 180) : 0;
        return (
          <div key={i} className={`a1-seat${on ? " on" : ""}`} style={{ left: `${50 + 41 * Math.cos(a)}%`, top: `${50 + 41 * Math.sin(a)}%`, transform: `translate(-50%, -50%) scale(${(on ? 1.45 + bob : 1).toFixed(3)})` }}>
            <Win98Icon kind={SEAT_ICONS[i % SEAT_ICONS.length]!} size="100%" />
          </div>
        );
      })}
      <Bottle angle={angle} className="a1-table-bottle" />
      {name !== null && lit !== null && <SeatLabel t={t} seat={lit} seats={seats} name={name} />}
    </div>
  );
}

function SeatLabel({ t, seat, seats, name }: { t: number; seat: number; seats: number; name: string }) {
  const a = (seatAngle(seat, seats) - 90) * (Math.PI / 180);
  const x = 50 + 41 * Math.cos(a);
  const y = 50 + 41 * Math.sin(a) + (Math.sin(a) > 0.2 ? 11 : -11);
  return (
    <div className="a1-seat-label" style={{ left: `${x}%`, top: `${y}%`, opacity: clamp01(t) }}>
      {name}
    </div>
  );
}

// --- emblems -------------------------------------------------------------------------------

/** The Maps and Ducks emblem (original): a teal disc with a map grid, a yellow duck, a pin. */
export function DuckEmblem({ size = "8em", className, style }: { size?: string; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`a1-emblem${className ? ` ${className}` : ""}`} viewBox="0 0 100 100" width={size} height={size} style={style} aria-hidden="true">
      <circle cx="50" cy="50" r="47" fill="#0a7f86" stroke="#032f33" strokeWidth="3" />
      <path d="M8 38 H92 M8 62 H92 M38 6 V94 M62 6 V94" stroke="#7fe0e4" strokeOpacity="0.45" strokeWidth="2" />
      <ellipse cx="54" cy="66" rx="25" ry="14" fill="#ffc83d" stroke="#7a5600" strokeWidth="2" />
      <circle cx="38" cy="45" r="13" fill="#ffc83d" stroke="#7a5600" strokeWidth="2" />
      <path d="M26 46 L15 50 L27 53 Z" fill="#ff8a00" stroke="#7a3d00" strokeWidth="1.5" />
      <circle cx="35" cy="42" r="2.4" fill="#000" />
      <path d="M50 60 Q60 54 72 62" fill="none" stroke="#7a5600" strokeWidth="2" />
      <path d="M74 14 Q84 14 84 24 Q84 32 74 42 Q64 32 64 24 Q64 14 74 14 Z" fill="#ff3b3b" stroke="#600" strokeWidth="2" />
      <circle cx="74" cy="24" r="4" fill="#fff" />
    </svg>
  );
}

/** The alarm clock, ringing: it shakes and its bells blur while `ringing`. */
export function AlarmClock({ t, ringing, size = "10em" }: { t: number; ringing: boolean; size?: string }) {
  const shake = ringing ? 7 * Math.sin(t / 22) : 0;
  const hop = ringing ? Math.abs(Math.sin(t / 44)) * 3 : 0;
  return (
    <svg className="a1-clock" viewBox="-50 -56 100 106" width={size} height={size} style={{ transform: `translate(0, ${-hop}px) rotate(${shake.toFixed(2)}deg)` }} aria-hidden="true">
      <circle cx="-30" cy="-36" r="14" fill="#e33" stroke="#400" strokeWidth="3" />
      <circle cx="30" cy="-36" r="14" fill="#e33" stroke="#400" strokeWidth="3" />
      <path d="M-26 34 L-34 46 M26 34 L34 46" stroke="#222" strokeWidth="6" strokeLinecap="round" />
      <circle cx="0" cy="0" r="40" fill="#fff" stroke="#c00" strokeWidth="8" />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x="-1.5" y="-34" width="3" height={i % 3 === 0 ? 8 : 4} fill="#222" transform={`rotate(${i * 30})`} />
      ))}
      <rect x="-2" y="-26" width="4" height="27" fill="#111" transform={`rotate(${(t / 40) % 360})`} />
      <rect x="-2.5" y="-18" width="5" height="19" fill="#111" transform="rotate(0)" />
      <circle cx="0" cy="0" r="4" fill="#c00" />
      {ringing && (
        <>
          <path d="M-52 -40 Q-60 -30 -52 -18" fill="none" stroke="#ffd23f" strokeWidth="3" opacity={blink(t, 160) ? 1 : 0.3} />
          <path d="M52 -40 Q60 -30 52 -18" fill="none" stroke="#ffd23f" strokeWidth="3" opacity={blink(t, 160) ? 0.3 : 1} />
        </>
      )}
    </svg>
  );
}

/** A prize rosette, turning slowly. */
export function Ribbon({ t, reduced, size = "12em", label = "BINGO" }: { t: number; reduced: boolean; size?: string; label?: string }) {
  const turn = reduced ? 0 : 6 * Math.sin(t / 900);
  return (
    <svg className="a1-ribbon" viewBox="-60 -60 120 150" width={size} height={size} style={{ transform: `rotate(${turn.toFixed(2)}deg)` }} aria-hidden="true">
      <path d="M-22 30 L-38 88 L-22 78 L-12 92 L0 34 Z" fill="#1e5bd8" stroke="#0a2a6a" strokeWidth="2" />
      <path d="M22 30 L38 88 L22 78 L12 92 L0 34 Z" fill="#1e5bd8" stroke="#0a2a6a" strokeWidth="2" />
      {Array.from({ length: 16 }, (_, i) => (
        <ellipse key={i} cx="0" cy="-44" rx="11" ry="17" fill={i % 2 ? "#2f6ff0" : "#4c8bff"} stroke="#0a2a6a" strokeWidth="1.2" transform={`rotate(${i * 22.5})`} />
      ))}
      <circle r="31" fill="#ffd23f" stroke="#8a6200" strokeWidth="3" />
      <circle r="25" fill="none" stroke="#8a6200" strokeWidth="1.5" strokeDasharray="3 3" />
      <text y="6" textAnchor="middle" fontFamily="Tahoma, sans-serif" fontWeight="bold" fontSize="15" fill="#7a1010">
        {label}
      </text>
    </svg>
  );
}

const BALL_COLORS = ["#ff4b4b", "#ffd23f", "#3ddc84", "#3fa7ff", "#c86bff"];

/** A bingo ball with a word on it (a `-` breaks the line); sized by `size`, the label off it. */
export function BingoBall({ label, color = 0, size = "5em", style, className }: { label: string; color?: number; size?: string; style?: CSSProperties; className?: string }) {
  const c = BALL_COLORS[((color % BALL_COLORS.length) + BALL_COLORS.length) % BALL_COLORS.length]!;
  return (
    <div className={`a1-ball${className ? ` ${className}` : ""}`} style={{ fontSize: size, background: `radial-gradient(circle at 35% 30%, #fff 0, ${c} 38%, #000 140%)`, ...style }}>
      <span>
        {label.split("-").map((part, i) => (
          <span key={i} className="a1-ball-word">
            {part}
          </span>
        ))}
      </span>
    </div>
  );
}

// --- the face, assembling ---------------------------------------------------------------------

/**
 * The character's face drawn line by line — the head's outline traced, the
 * skin scanned in, the eyes popping, the brows and the mouth last — in the
 * live face's own geometry (`face/Face.tsx`), so the hand-back to it lines
 * up. `start` is when it begins (ms); `mouth` 0..1 opens it (talking);
 * blinks are fixed times, so every screen blinks together.
 */
export function AssembleFace({ t, start, mouth = 0, reduced, className, style }: { t: number; start: number; mouth?: number; reduced: boolean; className?: string; style?: CSSProperties }) {
  const l = t - start;
  const C = 2 * Math.PI * 128;
  const outline = reduced ? progress(l, 0, 600) : eased(l, 0, 1300, ease.inOutQuad);
  const skin = progress(l, 700, 1300);
  const scanY = -128 + 256 * skin;
  const eyes = reduced ? progress(l, 1500, 400) : eased(l, 1600, 600, ease.outBack);
  const pupils = eased(l, 2200, 500);
  const brows = eased(l, 2600, 600, ease.outCubic);
  const mouthDraw = eased(l, 3000, 800, ease.inOutQuad);
  const MW = 80;
  const open = clamp01(mouth);
  // A blink every ~3.3 s after the eyes are in, the same on every screen.
  const bl = l > 2600 ? loop(l - 2600, 3300) : 1;
  const lid = bl < 0.05 ? 46 * (1 - Math.abs(bl / 0.025 - 1)) : 0;
  const gx = l > 2800 && !reduced ? 4 * Math.sin(l / 1700) : 0;
  return (
    <svg className={`a1-face${className ? ` ${className}` : ""}`} viewBox="-160 -160 320 320" style={style} aria-hidden="true">
      <defs>
        <radialGradient id="a1-skin" cx="0.5" cy="0.4" r="0.7">
          <stop offset="0" stopColor="var(--face-hi, #9cf5b8)" />
          <stop offset="1" stopColor="var(--face-lo, #17c45a)" />
        </radialGradient>
        <radialGradient id="a1-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.6" stopColor="var(--phosphor, #3dff7a)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--phosphor, #3dff7a)" stopOpacity="0" />
        </radialGradient>
        <clipPath id="a1-scan">
          <rect x="-160" y="-160" width="320" height={Math.max(0, scanY + 160)} />
        </clipPath>
        <clipPath id="a1-eyeL">
          <ellipse cx="-52" cy="-22" rx="26" ry="23" />
        </clipPath>
        <clipPath id="a1-eyeR">
          <ellipse cx="52" cy="-22" rx="26" ry="23" />
        </clipPath>
      </defs>
      <circle cx="0" cy="0" r="158" fill="url(#a1-halo)" opacity={0.4 * skin} />
      <circle cx="0" cy="0" r="128" fill="url(#a1-skin)" clipPath="url(#a1-scan)" />
      {skin > 0 && skin < 1 && <rect x="-130" y={scanY - 2} width="260" height="4" fill="#fff" opacity="0.75" />}
      <circle cx="0" cy="0" r="128" fill="none" stroke="var(--phosphor, #3dff7a)" strokeWidth="3" strokeDasharray={`${C * outline} ${C}`} transform="rotate(-90)" />
      {[-52, 52].map((x, i) => (
        <g key={x} transform={`translate(${x} -22) scale(${eyes.toFixed(3)})`} opacity={clamp01(eyes * 3)}>
          <ellipse rx="26" ry="23" fill="var(--white, #e9fff1)" stroke="var(--ink, #04110a)" strokeWidth="3" />
          <g clipPath={`url(#a1-eye${i === 0 ? "L" : "R"})`} transform={`translate(${-x} 22)`}>
            <circle cx={x + gx} cy={-22} r={9 * pupils} fill="var(--ink, #04110a)" />
            <circle cx={x + gx - 3} cy={-25} r={2.6 * pupils} fill="var(--white, #e9fff1)" opacity="0.9" />
            <rect x={x - 28} y={-47} width="56" height={lid} fill="var(--face-lo, #17c45a)" />
          </g>
        </g>
      ))}
      {[-1, 1].map((s) => (
        <path key={s} d={`M ${s * 80} ${-64 - 30 * (1 - brows)} Q ${s * 64} ${-72 - 30 * (1 - brows)} ${s * 46} ${-60 - 30 * (1 - brows)}`} fill="none" stroke="var(--ink, #04110a)" strokeWidth="7" strokeLinecap="round" opacity={brows} />
      ))}
      <path d={`M -34 52 Q 0 ${58 + 22 * open} 34 52 Q 0 ${60 + 26 * open} -34 52 Z`} fill={mouthDraw >= 1 ? "var(--mouth, #04110a)" : "none"} stroke="var(--ink, #04110a)" strokeWidth="4" strokeLinejoin="round" strokeDasharray={`${MW * 2 * mouthDraw} ${MW * 2}`} />
    </svg>
  );
}

// --- the data rain ----------------------------------------------------------------------------

/** Ones and zeros falling down the screen (a canvas, ≤ 40 columns, the clock's pace). */
export function DataRain({ t, columns = 34, color = "#3dff7a", seed = 5, reduced, className }: { t: number; columns?: number; color?: string; seed?: number; reduced: boolean; className?: string }) {
  const frame = reduced ? 0 : Math.floor(t / 66);
  const ref = useCanvas(
    (ctx, { w, h }) => {
      ctx.clearRect(0, 0, w, h);
      const fs = Math.max(10, Math.round(h / 28));
      ctx.font = `${fs}px VT323, monospace`;
      ctx.textAlign = "center";
      for (let i = 0; i < Math.min(40, columns); i++) {
        const c = rainColumn(reduced ? 0 : t, i, seed);
        const x = c.x * w;
        const head = c.head * h;
        for (let j = 0; j < c.chars.length; j++) {
          const y = head - j * fs;
          if (y < -fs || y > h + fs) continue;
          ctx.globalAlpha = j === 0 ? 1 : Math.max(0, 0.8 - j * 0.06);
          ctx.fillStyle = j === 0 ? "#e9fff1" : color;
          ctx.fillText(c.chars[j]!, x, y);
        }
      }
      ctx.globalAlpha = 1;
    },
    [frame, columns, color, seed, reduced],
  );
  return <canvas ref={ref} className={`kit-fill a1-rain${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}

/** A redacted paragraph: grey lines with black bars swept across some of them (seeded). */
export function Redacted({ t, start = 0, lines = 9, seed = 3, reduced }: { t: number; start?: number; lines?: number; seed?: number; reduced: boolean }) {
  return (
    <div className="a1-redact">
      {Array.from({ length: lines }, (_, i) => {
        const w = 55 + 45 * noise1(seed, i * 2);
        const bar = noise1(seed, i * 2 + 1) < 0.62;
        const at = start + 280 * i + 400;
        const k = reduced ? (t >= at ? 1 : 0) : eased(t, at, 380, ease.outCubic);
        const bx = 8 + 40 * noise1(seed, i * 7);
        const bw = Math.min(w - bx, 18 + 40 * noise1(seed, i * 5));
        return (
          <div key={i} className="a1-redact-line" style={{ width: `${w}%` }}>
            {bar && <span className="a1-redact-bar" style={{ left: `${(bx / w) * 100}%`, width: `${(bw / w) * 100}%`, transform: `scaleX(${k.toFixed(3)})` }} />}
          </div>
        );
      })}
    </div>
  );
}
