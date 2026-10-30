//! Lane tv3's building blocks (wave 17): the pieces Act F–G's scenes and
//! the house-wide moments share — rain, binary rain, an equalizer, floating
//! hearts / notes, laser beams, a sunburst, spotlight cones, the trophy and
//! the award emblems, Gerald the golden duck, Notepad, the chat window, a
//! motorcycle, a disco ball, the curtains. Each is a picture of `t` (or of
//! numbers worked out from it), original art, transform / opacity only.

import "./tv3-parts.css";
import type { CSSProperties, ReactNode } from "react";
import { useCanvas } from "./canvas.ts";
import { binaryRainAt, eqBars, floatersAt, rainAt, type AwardEmblem as EmblemKind, type ChatState } from "./tv3-time.ts";
import { blink, loop, pulse } from "./time.ts";
import { Win98Icon, Win98Window } from "./win98.tsx";

// --- canvases ---------------------------------------------------------------------------

/** Rain streaks over the whole box (≤ 260 drops), pale blue by default. */
export function RainCanvas({ t, count = 160, seed = 3, speed = 1.6, slant = 0.18, color = "180, 205, 255", reduced = false, className, style }: { t: number; count?: number; seed?: number; speed?: number; slant?: number; color?: string; reduced?: boolean; className?: string; style?: CSSProperties }) {
  const frame = reduced ? 0 : t;
  const ref = useCanvas(
    (ctx, { w, h }) => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1, h / 540);
      for (const d of rainAt(frame, Math.min(260, count), seed, speed, slant)) {
        ctx.strokeStyle = `rgba(${color}, ${d.alpha.toFixed(2)})`;
        ctx.beginPath();
        ctx.moveTo(d.x * w, d.y * h);
        ctx.lineTo((d.x - slant * d.len) * w, (d.y - d.len) * h);
        ctx.stroke();
      }
    },
    [frame, count, seed, speed, slant, color],
  );
  return <canvas ref={ref} className={`kit-fill tv3-canvas${className ? ` ${className}` : ""}`} style={style} aria-hidden="true" />;
}

/** 0 / 1 falling in columns, phosphor green (or `rgb`), heads bright. */
export function BinaryRain({ t, cols = 36, trail = 10, rgb = "60, 255, 120", alpha = 1, seed = 7, speed = 0.12, reduced = false, className, style }: { t: number; cols?: number; trail?: number; rgb?: string; alpha?: number; seed?: number; speed?: number; reduced?: boolean; className?: string; style?: CSSProperties }) {
  const frame = reduced ? 0 : t;
  const ref = useCanvas(
    (ctx, { w, h }) => {
      ctx.clearRect(0, 0, w, h);
      const size = Math.max(10, h / 26);
      ctx.font = `${Math.round(size)}px VT323, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const g of binaryRainAt(frame, cols, trail, seed, speed)) {
        ctx.fillStyle = g.bright > 0.92 ? `rgba(220, 255, 230, ${alpha.toFixed(2)})` : `rgba(${rgb}, ${(g.bright * 0.8 * alpha).toFixed(2)})`;
        ctx.fillText(g.ch, g.x * w, g.y * h);
      }
    },
    [frame, cols, trail, rgb, alpha, seed, speed],
  );
  return <canvas ref={ref} className={`kit-fill tv3-canvas${className ? ` ${className}` : ""}`} style={style} aria-hidden="true" />;
}

// --- DOM motion ---------------------------------------------------------------------------

/** An equalizer: `n` bars kicking on the beat (scaleY), in `colors` across. */
export function EqBars({ t, n = 24, bpm = 128, seed = 5, colors = ["#ff3fd2", "#7a5cff", "#29d3ff"], reduced = false, className, style }: { t: number; n?: number; bpm?: number; seed?: number; colors?: readonly string[]; reduced?: boolean; className?: string; style?: CSSProperties }) {
  const bars = eqBars(reduced ? 0 : t, n, bpm, seed);
  return (
    <div className={`tv3-eq${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
      {bars.map((v, i) => (
        <span key={i} style={{ transform: `scaleY(${v.toFixed(3)})`, background: colors[Math.floor((i / n) * colors.length)] ?? colors[0] }} />
      ))}
    </div>
  );
}

/** Things floating up and fading (hearts, notes, bubbles): `glyph(i)` draws each. */
export function FloatLayer({ t, glyph, start, every, life, seed, count, x, rise, size = "6vmin", reduced = false, className }: { t: number; glyph: (i: number) => ReactNode; start?: number; every?: number; life?: number; seed?: number; count?: number; x?: [number, number]; rise?: number; size?: string; reduced?: boolean; className?: string }) {
  // Reduced motion: each one fades in and out where it was born, never rising.
  const list = floatersAt(t, { start, every, life, seed, count, x, rise: reduced ? 0 : rise }).map((f) => (reduced ? { ...f, y: 0.15 + ((f.i * 0.618) % 1) * 0.7 } : f));
  return (
    <div className={`kit-fill tv3-float${className ? ` ${className}` : ""}`} aria-hidden="true">
      {list.map((f) => (
        <span key={f.i} className="tv3-floater" style={{ fontSize: size, opacity: f.alpha, transform: `translate3d(${(f.x * 100).toFixed(2)}vw, ${(f.y * 100).toFixed(2)}vh, 0) translate(-50%, -50%)${reduced ? "" : ` scale(${f.scale.toFixed(3)}) rotate(${f.rot.toFixed(1)}deg)`}` }}>
          {glyph(f.i)}
        </span>
      ))}
    </div>
  );
}

/** A heart (original), `fill` by default pink. */
export function Heart({ fill = "#ff4f9a", broken = false, size = "1em", className, style }: { fill?: string; broken?: boolean; size?: string; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 32 30" width={size} height={size} className={`tv3-heart${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
      <path d="M16 29 C6 21 1 15 1 9 C1 4 5 1 9 1 C12 1 14.5 3 16 5.5 C17.5 3 20 1 23 1 C27 1 31 4 31 9 C31 15 26 21 16 29 Z" fill={fill} stroke="rgba(0,0,0,0.35)" strokeWidth="1.2" />
      <path d="M7 6 Q9 4 11.5 5" stroke="#fff" strokeOpacity="0.7" strokeWidth="2" fill="none" strokeLinecap="round" />
      {broken && <path d="M16 5.5 L13 12 L18 16 L14 22 L16 29" stroke="#2a0010" strokeWidth="2.2" fill="none" />}
    </svg>
  );
}

/** Laser beams fanning from `origins` (% of the box), sweeping with `t`; colours drift slowly (no strobe). */
export function Lasers({ t, origins = [[8, -4], [92, -4]], beams = 5, sweep = 34, period = 3800, colors = ["#ff2bd6", "#28f0ff", "#7dff3c", "#ffe23f"], reduced = false, className }: { t: number; origins?: ReadonlyArray<readonly [number, number]>; beams?: number; sweep?: number; period?: number; colors?: readonly string[]; reduced?: boolean; className?: string }) {
  return (
    <div className={`kit-fill tv3-lasers${className ? ` ${className}` : ""}`} aria-hidden="true">
      {origins.map(([ox, oy], o) =>
        Array.from({ length: beams }, (_, b) => {
          const base = (o === 0 ? 1 : -1) * (12 + b * (60 / Math.max(1, beams)));
          const wobble = reduced ? 0 : Math.sin(((t + b * 400 + o * 900) / period) * Math.PI * 2) * sweep;
          const color = colors[(b + o + Math.floor(t / 2400)) % colors.length]!;
          return <span key={`${o}-${b}`} className="tv3-beam" style={{ left: `${ox}%`, top: `${oy}%`, transform: `rotate(${(base + wobble).toFixed(2)}deg)`, background: `linear-gradient(180deg, ${color}, rgba(0,0,0,0))` }} />;
        }),
      )}
    </div>
  );
}

/** A slow-turning sunburst of `rays` behind something golden. */
export function Sunburst({ t, rays = 16, color = "rgba(255, 214, 64, 0.35)", speed = 18, reduced = false, className, style }: { t: number; rays?: number; color?: string; speed?: number; reduced?: boolean; className?: string; style?: CSSProperties }) {
  const angle = reduced ? 0 : ((t / 1000) * speed) % 360;
  const step = 360 / rays;
  return (
    <svg className={`tv3-sunburst${className ? ` ${className}` : ""}`} viewBox="-100 -100 200 200" style={{ ...style, transform: `${style?.transform ?? ""} rotate(${angle.toFixed(2)}deg)` }} aria-hidden="true">
      {Array.from({ length: rays }, (_, i) => {
        const a = ((i * step - step / 4) * Math.PI) / 180;
        const b = ((i * step + step / 4) * Math.PI) / 180;
        return <path key={i} d={`M0 0 L${(Math.cos(a) * 150).toFixed(1)} ${(Math.sin(a) * 150).toFixed(1)} L${(Math.cos(b) * 150).toFixed(1)} ${(Math.sin(b) * 150).toFixed(1)} Z`} fill={color} />;
      })}
    </svg>
  );
}

/** Two stage spotlight cones sweeping from the top corners. */
export function SpotCones({ t, period = 6400, color = "rgba(255, 246, 200, 0.16)", reduced = false }: { t: number; period?: number; color?: string; reduced?: boolean }) {
  const a = reduced ? 0 : Math.sin((t / period) * Math.PI * 2) * 22;
  const b = reduced ? 0 : Math.sin((t / period) * Math.PI * 2 + 2.1) * 22;
  return (
    <div className="kit-fill tv3-cones" aria-hidden="true">
      <span className="tv3-cone" style={{ left: "18%", transform: `rotate(${(-14 + a).toFixed(2)}deg)`, background: `linear-gradient(180deg, ${color}, rgba(0,0,0,0) 92%)` }} />
      <span className="tv3-cone" style={{ left: "82%", transform: `rotate(${(14 + b).toFixed(2)}deg)`, background: `linear-gradient(180deg, ${color}, rgba(0,0,0,0) 92%)` }} />
    </div>
  );
}

/** Stage curtains: `open` 0 (closed) → 1 (drawn back), with a sway in the folds. */
export function Curtains({ open, t, reduced = false }: { open: number; t: number; reduced?: boolean }) {
  const sway = reduced ? 0 : Math.sin(t / 900) * 0.6;
  const k = Math.max(0, Math.min(1, open));
  return (
    <div className="kit-fill tv3-curtains" aria-hidden="true">
      <span className="tv3-curtain tv3-curtain-l" style={reduced ? { opacity: 1 - k } : { transform: `translate3d(${(-k * 92 + sway).toFixed(2)}%, 0, 0)` }} />
      <span className="tv3-curtain tv3-curtain-r" style={reduced ? { opacity: 1 - k } : { transform: `translate3d(${(k * 92 - sway).toFixed(2)}%, 0, 0)` }} />
      <span className="tv3-valance" />
    </div>
  );
}

// --- art --------------------------------------------------------------------------------

/** A gold cup on a plinth; `shine` 0..1 sweeps a glint across it. */
export function Trophy({ shine = 0, size = "20vmin", className, style }: { shine?: number; size?: string; className?: string; style?: CSSProperties }) {
  const gx = -20 + shine * 80;
  return (
    <svg viewBox="0 0 64 80" width={size} height={size} className={`tv3-trophy${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
      <defs>
        <linearGradient id="tv3-gold" x1="0" x2="1">
          <stop offset="0" stopColor="#b8860b" />
          <stop offset="0.45" stopColor="#ffe066" />
          <stop offset="1" stopColor="#c8920e" />
        </linearGradient>
        <clipPath id="tv3-cup">
          <path d="M14 6 H50 V22 Q50 42 32 46 Q14 42 14 22 Z" />
        </clipPath>
      </defs>
      <path d="M14 10 Q2 10 4 22 Q6 32 16 32" fill="none" stroke="url(#tv3-gold)" strokeWidth="4" />
      <path d="M50 10 Q62 10 60 22 Q58 32 48 32" fill="none" stroke="url(#tv3-gold)" strokeWidth="4" />
      <path d="M14 6 H50 V22 Q50 42 32 46 Q14 42 14 22 Z" fill="url(#tv3-gold)" stroke="#7a5200" strokeWidth="1.2" />
      <g clipPath="url(#tv3-cup)">
        <rect x={gx} y="-4" width="8" height="60" fill="#fff" opacity="0.55" transform="skewX(-20)" />
      </g>
      <rect x="28" y="46" width="8" height="12" fill="url(#tv3-gold)" stroke="#7a5200" />
      <rect x="18" y="58" width="28" height="6" fill="url(#tv3-gold)" stroke="#7a5200" />
      <rect x="14" y="64" width="36" height="12" fill="#3b2a12" stroke="#000" />
      <rect x="20" y="67" width="24" height="6" fill="#c8a24a" />
      <path d="M32 14 L34.5 20 L41 20.5 L36 24.5 L37.8 31 L32 27.4 L26.2 31 L28 24.5 L23 20.5 L29.5 20 Z" fill="#fff6c8" opacity="0.85" />
    </svg>
  );
}

/** Each award's emblem (original), drawn in a 64-unit box. */
export function AwardEmblem({ kind, size = "14vmin", className, style }: { kind: EmblemKind; size?: string; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`tv3-emblem${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="#1b1f5e" stroke="#ffd84d" strokeWidth="3" />
      {EMBLEMS[kind]}
    </svg>
  );
}

const EMBLEMS: Record<EmblemKind, ReactNode> = {
  shield: (
    <>
      <path d="M32 12 L48 18 V30 Q48 44 32 52 Q16 44 16 30 V18 Z" fill="#3ddc84" stroke="#0b4d2a" strokeWidth="2" />
      <path d="M24 31 L30 37 L41 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  beans: (
    <>
      {[
        [24, 28, -20],
        [38, 26, 25],
        [30, 40, 5],
        [42, 40, -35],
        [20, 41, 40],
      ].map(([x, y, r], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${r})`}>
          <ellipse rx="7" ry="4.6" fill="#8b3a1a" stroke="#3a1205" />
          <ellipse cx="-2" cy="-1.2" rx="2.4" ry="1" fill="#f3d9b0" opacity="0.5" />
        </g>
      ))}
    </>
  ),
  plane: (
    <>
      <path d="M12 36 L52 22 L56 26 L28 40 L24 50 L20 48 L22 41 L14 42 Z" fill="#e8f1ff" stroke="#2a3a6a" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M34 30 L28 18 L32 17 L42 27" fill="#9ec3ff" stroke="#2a3a6a" strokeWidth="1.4" />
    </>
  ),
  book: (
    <>
      <path d="M14 18 Q24 14 32 19 V50 Q24 45 14 49 Z" fill="#ffefb0" stroke="#5a3d00" strokeWidth="1.6" />
      <path d="M50 18 Q40 14 32 19 V50 Q40 45 50 49 Z" fill="#fff6d0" stroke="#5a3d00" strokeWidth="1.6" />
      {[25, 30, 35, 40].map((y) => (
        <g key={y}>
          <path d={`M18 ${y} Q24 ${y - 2} 29 ${y + 1}`} stroke="#b08a2a" fill="none" />
          <path d={`M35 ${y + 1} Q40 ${y - 2} 46 ${y}`} stroke="#b08a2a" fill="none" />
        </g>
      ))}
    </>
  ),
  coin: (
    <>
      <circle cx="32" cy="32" r="17" fill="#ffd23f" stroke="#8a6200" strokeWidth="2.5" />
      <circle cx="32" cy="32" r="12" fill="none" stroke="#c99a10" strokeWidth="1.5" />
      <path d="M27 24 H37 M32 24 V41" stroke="#8a6200" strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  mask: (
    <>
      <path d="M14 26 Q32 18 50 26 Q50 40 40 42 Q34 42 32 37 Q30 42 24 42 Q14 40 14 26 Z" fill="#c86bff" stroke="#3a0a5a" strokeWidth="2" />
      <ellipse cx="24" cy="31" rx="4.5" ry="3" fill="#1b1f5e" />
      <ellipse cx="40" cy="31" rx="4.5" ry="3" fill="#1b1f5e" />
      <path d="M32 36 L46 48" stroke="#ffb07a" strokeWidth="5" strokeLinecap="round" />
    </>
  ),
  duck: (
    <g transform="translate(10 12) scale(1.35)">
      <ellipse cx="17" cy="21" rx="11" ry="7" fill="#ffd23f" stroke="#8a6200" />
      <circle cx="10.5" cy="12" r="6" fill="#ffd23f" stroke="#8a6200" />
      <path d="M4 12.5 L0.5 14 L4.5 15.2 Z" fill="#ff8a00" stroke="#8a4000" />
      <circle cx="9.5" cy="10.8" r="1.2" fill="#000" />
    </g>
  ),
  scroll: (
    <>
      <rect x="18" y="16" width="28" height="34" fill="#fff6d0" stroke="#5a3d00" strokeWidth="1.6" />
      <rect x="15" y="13" width="34" height="5" rx="2.5" fill="#d9b25a" stroke="#5a3d00" />
      <rect x="15" y="48" width="34" height="5" rx="2.5" fill="#d9b25a" stroke="#5a3d00" />
      {[24, 31, 38].map((y) => (
        <path key={y} d={`M22 ${y} L25 ${y + 3} L30 ${y - 2} M33 ${y} H42`} stroke="#0b7a3a" strokeWidth="2" fill="none" />
      ))}
    </>
  ),
  palette: (
    <>
      <path d="M32 14 Q50 14 51 30 Q51 38 44 38 Q38 38 40 44 Q41 50 32 50 Q14 50 13 32 Q13 14 32 14 Z" fill="#f2d7a8" stroke="#5a3d00" strokeWidth="1.8" />
      <circle cx="24" cy="24" r="3.5" fill="#ff3b3b" />
      <circle cx="34" cy="21" r="3.5" fill="#ffd23f" />
      <circle cx="43" cy="27" r="3.5" fill="#3fa7ff" />
      <circle cx="21" cy="34" r="3.5" fill="#3ddc84" />
      <circle cx="28" cy="43" r="3.5" fill="#c86bff" />
    </>
  ),
  trophy: (
    <>
      <path d="M22 16 H42 V26 Q42 38 32 40 Q22 38 22 26 Z" fill="#ffd23f" stroke="#8a6200" strokeWidth="1.6" />
      <rect x="29" y="40" width="6" height="6" fill="#ffd23f" />
      <rect x="23" y="46" width="18" height="5" fill="#8a6200" />
    </>
  ),  lanyard: (
    <>
      <path d="M22 10 L32 30 L42 10" fill="none" stroke="#3fa7ff" strokeWidth="4" strokeLinejoin="round" />
      <rect x="20" y="28" width="24" height="26" rx="2" fill="#f4f8ff" stroke="#1060a0" strokeWidth="2" />
      <rect x="20" y="28" width="24" height="6" fill="#1060a0" />
      <circle cx="32" cy="41" r="4.5" fill="#c8d8f0" stroke="#1060a0" />
      <path d="M25 51 Q32 44 39 51" fill="#c8d8f0" stroke="#1060a0" />
      <path d="M36 37 l1.6 3.2 3.4 0.5 -2.5 2.4 0.6 3.4 -3.1 -1.6 -3.1 1.6 0.6 -3.4 -2.5 -2.4 3.4 -0.5 Z" transform="translate(4 -6) scale(0.7)" fill="#ffd23f" stroke="#8a6200" strokeWidth="0.8" />
    </>
  ),
  star: (
    <>
      <path d="M32 11 L38 25 L53 26 L41.5 36 L45 51 L32 43 L19 51 L22.5 36 L11 26 L26 25 Z" fill="#ffd23f" stroke="#8a6200" strokeWidth="2" strokeLinejoin="round" />
      <path d="M32 18 L36 27 L45 28" fill="none" stroke="#fff6c8" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  mole: (
    <>
      <path d="M14 26 Q32 18 50 26 L46 28 Q32 23 18 28 Z" fill="#2a2a2a" stroke="#000" />
      <path d="M20 26 Q32 6 44 26 Z" fill="#3a3a3a" stroke="#000" strokeWidth="1.4" />
      <rect x="20" y="22" width="24" height="3" fill="#8b3a1a" />
      <ellipse cx="32" cy="40" rx="14" ry="12" fill="#7a5a44" stroke="#3a2412" strokeWidth="1.6" />
      <rect x="19" y="33" width="11" height="6" rx="2" fill="#000" />
      <rect x="34" y="33" width="11" height="6" rx="2" fill="#000" />
      <path d="M30 35 H34" stroke="#000" strokeWidth="1.6" />
      <circle cx="32" cy="45" r="2.6" fill="#ff9aa8" stroke="#6a2030" strokeWidth="0.8" />
      <path d="M26 50 Q32 53 38 50" fill="none" stroke="#3a2412" strokeWidth="1.2" />
    </>
  ),
  // Wave 45: the Bathroom Report's toilet roll, a sheet hanging off it.
  roll: (
    <>
      <rect x="17" y="18" width="26" height="22" fill="#f4f1ea" stroke="#5a5640" strokeWidth="1.6" />
      <ellipse cx="17" cy="29" rx="5" ry="11" fill="#e4dfd2" stroke="#5a5640" strokeWidth="1.6" />
      <ellipse cx="17" cy="29" rx="2" ry="4.5" fill="#8a8470" />
      <ellipse cx="43" cy="29" rx="5" ry="11" fill="#f4f1ea" stroke="#5a5640" strokeWidth="1.6" />
      <path d="M43 40 H50 V52 Q46 50 43 52 Z" fill="#f4f1ea" stroke="#5a5640" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M44 46 H49" stroke="#c9c39a" strokeWidth="1" strokeDasharray="1.5 1.5" />
    </>
  ),
  // Wave 48: the Language Report's key (the Password Manager's) over a redaction bar.
  key: (
    <>
      <rect x="7" y="36" width="50" height="10" fill="#050505" stroke="#5a5040" strokeWidth="1" />
      {[16, 25, 34, 43].map((x) => (
        <path key={x} d={`M${x} 38.5 V43.5 M${x - 2.2} 39.8 L${x + 2.2} 42.2 M${x - 2.2} 42.2 L${x + 2.2} 39.8`} stroke="#8a8270" strokeWidth="1" strokeLinecap="round" />
      ))}
      <g transform="rotate(-24 32 30)">
        <circle cx="19" cy="28" r="8.5" fill="#ffd23f" stroke="#8a6200" strokeWidth="2" />
        <circle cx="19" cy="28" r="3.2" fill="#1b1f5e" stroke="#8a6200" strokeWidth="1.2" />
        <rect x="26.5" y="25.6" width="25" height="4.8" rx="1" fill="#ffd23f" stroke="#8a6200" strokeWidth="1.6" />
        <path d="M42 30.4 V35.5 H45.5 V30.4 M47.5 30.4 V37.5 H51 V30.4" fill="#ffd23f" stroke="#8a6200" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M14.5 24.5 Q17 22 20 22.4" fill="none" stroke="#fff6c8" strokeWidth="1.4" strokeLinecap="round" opacity="0.8" />
      </g>
    </>
  ),
};

/** Gerald, the golden duck (original): `gold` gilds him; `sad` droops his head; `egg` lays the golden egg beside him. */
export function GoldenDuck({ gold = true, sad = false, egg = 0, blinkOn = false, size = "34vmin", className, style }: { gold?: boolean; sad?: boolean; egg?: number; blinkOn?: boolean; size?: string; className?: string; style?: CSSProperties }) {
  const body = gold ? "#ffd23f" : "#c9c39a";
  const rim = gold ? "#8a6200" : "#5a5640";
  const bill = gold ? "#ff9a1a" : "#9a8a6a";
  return (
    <svg viewBox="0 0 120 100" width={size} height={size} className={`tv3-duck${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
      <ellipse cx="62" cy="68" rx="40" ry="22" fill={body} stroke={rim} strokeWidth="2" />
      <path d="M78 58 Q96 44 104 64 Q90 62 80 72 Z" fill={body} stroke={rim} strokeWidth="2" />
      <path d="M48 66 Q62 56 76 70" fill="none" stroke={rim} strokeWidth="2" />
      <g transform={sad ? "rotate(18 40 52)" : undefined}>
        <circle cx="38" cy="38" r="20" fill={body} stroke={rim} strokeWidth="2" />
        <path d="M18 40 L2 45 L19 50 Z" fill={bill} stroke={rim} strokeWidth="1.6" strokeLinejoin="round" />
        {blinkOn ? <path d="M30 34 H38" stroke="#000" strokeWidth="2.4" strokeLinecap="round" /> : <circle cx="33" cy="34" r="3.4" fill="#000" />}
        {!blinkOn && <circle cx="34.2" cy="32.8" r="1.1" fill="#fff" />}
        {sad && <path d="M28.8 34 A4.2 4.2 0 0 1 37.2 34 Z" fill={body} stroke={rim} strokeWidth="1.2" />}
      </g>
      {gold && <path d="M50 52 Q56 46 62 52" stroke="#fff6c8" strokeWidth="2.5" fill="none" opacity="0.8" />}
      {egg > 0 && (
        <g transform={`translate(${(96 + 16 * egg).toFixed(1)} ${(80 + 6 * egg).toFixed(1)}) scale(${(0.4 + 0.6 * egg).toFixed(3)})`}>
          <ellipse cx="0" cy="0" rx="9" ry="12" fill="#ffe066" stroke="#a87400" strokeWidth="1.5" />
          <ellipse cx="-3" cy="-5" rx="2.5" ry="4" fill="#fff8d0" opacity="0.8" />
        </g>
      )}
    </svg>
  );
}

/** A motorcycle with its rider (original), facing right; `wheel` turns the wheels. */
export function Motorcycle({ wheel = 0, size = "26vmin", heart = false, className, style }: { wheel?: number; size?: string; heart?: boolean; className?: string; style?: CSSProperties }) {
  const spoke = (cx: number) => (
    <g transform={`rotate(${wheel.toFixed(1)} ${cx} 58)`}>
      <circle cx={cx} cy="58" r="12" fill="#111" stroke="#555" strokeWidth="3" />
      <path d={`M${cx - 10} 58 H${cx + 10} M${cx} 48 V68`} stroke="#999" strokeWidth="1.5" />
    </g>
  );
  return (
    <svg viewBox="0 0 120 74" width={size} height={size} className={`tv3-moto${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
      {spoke(24)}
      {spoke(94)}
      <path d="M24 58 L44 40 H72 L94 58" fill="none" stroke="#c0c0c0" strokeWidth="4" />
      <path d="M40 40 Q58 28 78 38 L74 46 H44 Z" fill="#c0302a" stroke="#400" strokeWidth="1.5" />
      <path d="M78 38 L88 30 L92 32" stroke="#c0c0c0" strokeWidth="3" fill="none" />
      <rect x="2" y="50" width="12" height="4" fill="#808080" />
      <path d="M52 30 Q56 16 64 18 L70 32 Z" fill="#202060" stroke="#000" />
      <circle cx="62" cy="12" r="7" fill="#d0d0d0" stroke="#000" />
      <rect x="58" y="10" width="9" height="3" fill="#2a2a2a" />
      {heart && <path transform="translate(80 -4) scale(0.5)" d="M16 29 C6 21 1 15 1 9 C1 4 5 1 9 1 C12 1 14.5 3 16 5.5 C17.5 3 20 1 23 1 C27 1 31 4 31 9 C31 15 26 21 16 29 Z" fill="#ff4f9a" stroke="#600" />}
    </svg>
  );
}

/** A disco ball: a sphere of mirror tiles; the lit tiles chase round with `t`. */
export function DiscoBall({ t, size = "18vmin", reduced = false, className, style }: { t: number; size?: string; reduced?: boolean; className?: string; style?: CSSProperties }) {
  const shift = reduced ? 0 : Math.floor(t / 160);
  const tiles: ReactNode[] = [];
  for (let row = 0; row < 8; row++) {
    const y = -26 + row * 7;
    const half = Math.sqrt(Math.max(0, 30 * 30 - (y + 3.5) * (y + 3.5)));
    const n = Math.max(2, Math.round(half / 3.6));
    for (let c = 0; c < n * 2; c++) {
      const x = -half + c * ((half * 2) / (n * 2));
      const lit = (c + row * 3 + shift) % 7 === 0;
      tiles.push(<rect key={`${row}-${c}`} x={x.toFixed(1)} y={y} width={((half * 2) / (n * 2) - 0.8).toFixed(2)} height="6.2" fill={lit ? "#ffffff" : (c + row) % 2 === 0 ? "#9aa3b8" : "#6c7590"} />);
    }
  }
  return (
    <svg viewBox="-32 -40 64 72" width={size} height={size} className={`tv3-disco${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
      <path d="M0 -40 V-30" stroke="#ccc" strokeWidth="1" />
      <clipPath id="tv3-disco-clip">
        <circle cx="0" cy="0" r="30" />
      </clipPath>
      <g clipPath="url(#tv3-disco-clip)">
        <circle cx="0" cy="0" r="30" fill="#4b536a" />
        {tiles}
      </g>
      <circle cx="0" cy="0" r="30" fill="none" stroke="#2a2f40" strokeWidth="1.5" />
      <circle cx={-10} cy={-12} r={pulse(t, 1800) * 3 + 2} fill="#fff" opacity="0.7" />
    </svg>
  );
}

// --- windows --------------------------------------------------------------------------------

/** Notepad: menu bar, white page, the caret on its row, a scrollbar, `Ln / Col` in the status bar. */
export function Notepad({ title, rows, caretRow, caretOn, scroll, line, col, open = 1, reduced = false, className, style, x, y, center, width, height }: { title: string; rows: readonly string[]; caretRow: number | null; caretOn: boolean; scroll: number; line: number; col: number; open?: number; reduced?: boolean; className?: string; style?: CSSProperties; x?: number | string; y?: number | string; center?: boolean; width?: string; height?: string }) {
  return (
    <Win98Window title={title} icon="document" buttons={["min", "max", "close"]} open={open} reduced={reduced} x={x} y={y} center={center} width={width} height={height} className={`tv3-notepad${className ? ` ${className}` : ""}`} style={style} status={`Ln ${line + 1}, Col ${col + 1}`}>
      <div className="tv3-np-menu">
        <span>
          <u>F</u>ile
        </span>
        <span>
          <u>E</u>dit
        </span>
        <span>
          <u>S</u>earch
        </span>
        <span>
          <u>H</u>elp
        </span>
      </div>
      <div className="tv3-np-page">
        <pre className="tv3-np-text">
          {rows.map((r, i) => (
            <div key={i} className="tv3-np-row">
              {r}
              {caretRow === i && <span className="tv3-np-caret" style={{ opacity: caretOn ? 1 : 0 }} />}
              {r === "" && caretRow !== i ? " " : null}
            </div>
          ))}
        </pre>
        <div className="tv3-np-scroll">
          <span className="tv3-np-arrow">▲</span>
          <span className="tv3-np-track">
            <span className="tv3-np-thumb" style={{ top: `${(scroll * 80).toFixed(2)}%` }} />
          </span>
          <span className="tv3-np-arrow">▼</span>
        </div>
      </div>
    </Win98Window>
  );
}

/** A messenger window: a buddy line, the bubbles (his on the right, hers on the left), "… is typing". */
export function ChatWindow({ title, buddy, chat, names, t, open = 1, reduced = false, className, x, y, center, width }: { title: string; buddy: string; chat: ChatState; names: { him: string; her: string }; t: number; open?: number; reduced?: boolean; className?: string; x?: number | string; y?: number | string; center?: boolean; width?: string }) {
  return (
    <Win98Window title={title} icon="mail" buttons={["min", "close"]} open={open} reduced={reduced} x={x} y={y} center={center} width={width} className={`tv3-chat${className ? ` ${className}` : ""}`} status={chat.typing !== null ? `${names[chat.typing]} is typing…` : "Connected"}>
      <div className="tv3-chat-buddy">
        <span className="tv3-chat-dot" style={{ opacity: 0.55 + 0.45 * pulse(t, 1400) }} />
        <b>{buddy}</b>
        <span className="tv3-chat-status">(Online)</span>
      </div>
      <div className="tv3-chat-log">
        {chat.bubbles.map((b) => {
          const pop = reduced ? 1 : Math.min(1, b.age / 220);
          const text = b.line.from === "him" ? b.line.text.slice(0, Math.ceil(b.line.text.length * b.typed)) : b.line.text;
          return (
            <div key={b.n} className={`tv3-bubble tv3-bubble-${b.line.from}`} style={{ opacity: pop, transform: reduced ? undefined : `translateY(${((1 - pop) * 0.6).toFixed(3)}em) scale(${(0.9 + 0.1 * pop).toFixed(3)})` }}>
              <span className="tv3-bubble-name">{names[b.line.from]}</span>
              <span className="tv3-bubble-text">{text}</span>
            </div>
          );
        })}
        {chat.typing !== null && (
          <div className={`tv3-bubble tv3-bubble-${chat.typing} tv3-typing`}>
            {[0, 1, 2].map((i) => (
              <span key={i} className="tv3-dotty" style={{ opacity: 0.3 + 0.7 * (blink(t + i * 160, 720, 0.45) ? 1 : 0) }} />
            ))}
          </div>
        )}
      </div>
    </Win98Window>
  );
}

/** A Win98 icon that bobs on a loop (the banishment's victims, the floating programs). */
export function BobIcon({ kind, t, phase = 0, size = "6vmin" }: { kind: Parameters<typeof Win98Icon>[0]["kind"]; t: number; phase?: number; size?: string }) {
  const y = Math.sin(loop(t + phase, 2400) * 2 * Math.PI) * 6;
  return (
    <span className="tv3-bob" style={{ transform: `translateY(${y.toFixed(1)}%)` }}>
      <Win98Icon kind={kind} size={size} />
    </span>
  );
}
