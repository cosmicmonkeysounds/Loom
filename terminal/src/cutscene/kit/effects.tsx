//! Screen effects (wave 17): a glitch over anything, TV static, a
//! spotlight, the hourglass, the blue screen. Each a picture of `t`.
//! Photosensitivity: no full-field flashing above 3 Hz and never a full red
//! field — the glitch tears a few slices, the static stays dim.

import { useRef, type CSSProperties, type ReactNode } from "react";
import { useCanvas } from "./canvas.ts";
import { blink, clamp01, hourglass, keyframes, noise1, rng, typedCount } from "./time.ts";

/**
 * Tears its children: on some frames (`intensity` 0..1 of them, 14 a
 * second) the whole thing jumps, the colour channels split and two slices
 * slide sideways. Wrap a title, not a whole scene (the slices are copies).
 * Under reduced motion it never moves.
 */
export function Glitch({ t, intensity = 0.5, seed = 1, reduced = false, className, style, children }: { t: number; intensity?: number; seed?: number; reduced?: boolean; className?: string; style?: CSSProperties; children: ReactNode }) {
  const bucket = Math.floor(t / 70);
  const on = !reduced && intensity > 0 && noise1(seed, bucket) < clamp01(intensity);
  if (!on) {
    return (
      <div className={`kit-glitch${className ? ` ${className}` : ""}`} style={style}>
        {children}
      </div>
    );
  }
  const r = rng((seed * 7919 + bucket) >>> 0);
  const k = clamp01(intensity);
  const dx = (r() - 0.5) * 26 * k;
  const dy = (r() - 0.5) * 6 * k;
  const skew = (r() - 0.5) * 8 * k;
  const split = 2 + r() * 5 * k;
  const slice = (j: number) => {
    const top = Math.floor(r() * 80);
    const h = 4 + Math.floor(r() * 18);
    return (
      <div key={j} className="kit-glitch-slice" aria-hidden="true" style={{ clipPath: `inset(${top}% 0 ${Math.max(0, 100 - top - h)}% 0)`, WebkitClipPath: `inset(${top}% 0 ${Math.max(0, 100 - top - h)}% 0)`, transform: `translate3d(${(r() - 0.5) * 60 * k}px, 0, 0)` }}>
        {children}
      </div>
    );
  };
  return (
    <div
      className={`kit-glitch on${className ? ` ${className}` : ""}`}
      style={{ ...style, transform: `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) skewX(${skew.toFixed(2)}deg)`, filter: `drop-shadow(${-split}px 0 0 rgba(255, 0, 72, 0.75)) drop-shadow(${split}px 0 0 rgba(0, 230, 255, 0.75))` }}
    >
      {children}
      {slice(0)}
      {slice(1)}
    </div>
  );
}

/**
 * TV static: grey noise at a quarter of the resolution (cheap, chunky), a
 * new grain 20 times a second, with a bright roll bar. `alpha` keeps it a
 * veil over something, or 1 for a dead channel. Fills its parent. Under
 * reduced motion the grain holds still.
 */
/** One grain into an RGBA buffer (alpha left as it is): grey levels off the grain's seed. */
export function fillGrain(d: Uint8ClampedArray, grain: number): void {
  const r = rng(grain * 2654435761);
  for (let i = 0; i < d.length; i += 4) {
    const v = (r() * 255) | 0;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
}

export function Noise({ t, alpha = 0.35, roll: rollWanted = true, reduced = false, className, style }: { t: number; alpha?: number; roll?: boolean; reduced?: boolean; className?: string; style?: CSSProperties }) {
  // Reduced motion: one still grain, no roll bar.
  const grain = reduced ? 0 : Math.floor(t / 50);
  const roll = rollWanted && !reduced;
  // One ImageData per size, refilled only when the grain moves (the roll
  // bar alone redraws over the same grain): no 0.5 MB of garbage a frame (OB-8).
  const buf = useRef<{ img: ImageData; grain: number } | null>(null);
  const ref = useCanvas(
    (ctx, { w, h, dpr }) => {
      const cw = Math.max(1, Math.round(w * dpr));
      const ch = Math.max(1, Math.round(h * dpr));
      let b = buf.current;
      if (b === null || b.img.width !== cw || b.img.height !== ch) {
        b = buf.current = { img: ctx.createImageData(cw, ch), grain: Number.NaN };
        const d = b.img.data;
        for (let i = 3; i < d.length; i += 4) d[i] = 255;
      }
      if (b.grain !== grain) {
        b.grain = grain;
        fillGrain(b.img.data, grain);
      }
      ctx.putImageData(b.img, 0, 0);
      if (roll) {
        const y = ((t / 2600) % 1) * h;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const g = ctx.createLinearGradient(0, y - h * 0.08, 0, y + h * 0.08);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, "rgba(255,255,255,0.28)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, y - h * 0.08, w, h * 0.16);
      }
    },
    [grain, roll ? Math.floor(t / 66) : 0],
    0.25,
  );
  return <canvas ref={ref} className={`kit-fill kit-noise${className ? ` ${className}` : ""}`} style={{ ...style, opacity: alpha }} aria-hidden="true" />;
}

export interface SpotFrame {
  t: number;
  /** Centre, % of the parent. */
  x: number;
  y: number;
  /** Radius, % of the parent's shorter side. */
  r: number;
}

/** The room goes dark but for a circle — still, or moving along `frames` (eased between them). */
export function Spotlight({ t, x = 50, y = 50, r = 22, frames, dim = 0.86, className, style, children }: { t: number; x?: number; y?: number; r?: number; frames?: readonly SpotFrame[]; dim?: number; className?: string; style?: CSSProperties; children?: ReactNode }) {
  const at = frames !== undefined && frames.length > 0 ? keyframes(t, frames) : { x, y, r };
  const edge = Math.max(1, at.r);
  return (
    <div className={`kit-fill kit-spotlight${className ? ` ${className}` : ""}`} style={{ ...style, background: `radial-gradient(circle at ${at.x}% ${at.y}%, rgba(0,0,0,0) 0, rgba(0,0,0,0) ${(edge * 0.82).toFixed(2)}vmin, rgba(0,0,0,${dim}) ${edge.toFixed(2)}vmin)` }}>
      {children}
    </div>
  );
}

/** The Win98 wait cursor, blown up: the sand runs down, and it turns over. */
export function Hourglass({ t, period = 2400, size = "12vmin", className, style }: { t: number; period?: number; size?: string; className?: string; style?: CSSProperties }) {
  const { sand, angle } = hourglass(t, period);
  // Glass: two bowls meeting at the neck (y 24); the top one 13 wide at y 6, 1.5 at the neck.
  const topY = 24 - 15 * sand; // the sand's surface in the top bowl
  const topW = 13 - ((topY - 6) / 18) * 11.5;
  const pile = 42 - 14 * (1 - sand); // the heap's peak in the bottom bowl
  const flowing = sand > 0.01 && angle === 0;
  return (
    <svg className={`kit-hourglass${className ? ` ${className}` : ""}`} viewBox="0 0 32 48" width={size} height={size} style={{ ...style, transform: `rotate(${angle}deg)` }} aria-hidden="true" shapeRendering="geometricPrecision">
      <rect x="2" y="1" width="28" height="4" fill="#c0c0c0" stroke="#000" />
      <rect x="2" y="43" width="28" height="4" fill="#c0c0c0" stroke="#000" />
      <path d="M3 5 L29 5 L17.5 24 L29 43 L3 43 L14.5 24 Z" fill="rgba(200,230,255,0.22)" stroke="#000" strokeWidth="1.2" />
      {sand > 0.01 && <path d={`M${16 - topW} ${topY} L${16 + topW} ${topY} L16 24 Z`} fill="#ffcc33" />}
      {sand < 0.99 && <path d={`M4.5 42.6 L27.5 42.6 L16 ${pile} Z`} fill="#ffcc33" />}
      {flowing && <rect x="15.6" y="24" width="0.8" height={Math.max(0, pile - 24)} fill="#ffcc33" opacity={blink(t, 120) ? 1 : 0.6} />}
    </svg>
  );
}

/**
 * The blue screen: the grey "Windows" tag, the lines typed out, then
 * "Press any key to continue" with the cursor blinking. A full-size stage.
 */
export function Bsod({ t, start = 0, title = "Windows", lines, cps = 55, footer = "Press any key to continue _", className, style }: { t: number; start?: number; title?: string; lines: readonly string[]; cps?: number; footer?: string; className?: string; style?: CSSProperties }) {
  const body = lines.join("\n");
  const n = typedCount(body, t, { start: start + 400, cps, pauses: false });
  const done = n >= body.length;
  const foot = footer.endsWith("_") ? footer.slice(0, -1) : footer;
  return (
    <div className={`kit-fill kit-bsod${className ? ` ${className}` : ""}`} style={style}>
      <div className="kit-bsod-inner">
        <div className="kit-bsod-title">
          <span>{title}</span>
        </div>
        <pre className="kit-bsod-body">{body.slice(0, n)}</pre>
        {done && (
          <div className="kit-bsod-foot">
            {foot}
            <span style={{ opacity: blink(t, 1000) ? 1 : 0 }}>_</span>
          </div>
        )}
      </div>
    </div>
  );
}
