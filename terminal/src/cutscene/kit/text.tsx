//! Words that move (wave 17): a typewriter, a marquee, a number that counts
//! up, a countdown — each drawn from `t`, so it is the same on every screen.

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { blink, countdownParts, countUp, ease, marqueeX, progress, typedCount, type Ease, type TypeOpts } from "./time.ts";

/** Text typed out at `cps` from `start`, with a blinking caret; `reserve`
 *  keeps the untyped rest's room so a centred line never reflows. */
export function Typewriter({ text, t, start = 0, cps = 30, pauses = true, caret = true, reserve = true, className, style }: { text: string; t: number } & TypeOpts & { caret?: boolean; reserve?: boolean; className?: string; style?: CSSProperties }) {
  const n = typedCount(text, t, { start, cps, pauses });
  const done = n >= text.length;
  // The caret is solid while typing, blinks (530 ms) once idle.
  const showCaret = caret && t >= start && (!done || blink(t, 1060));
  return (
    <span className={`kit-type${className ? ` ${className}` : ""}`} style={style}>
      {text.slice(0, n)}
      {caret && (
        <span className="kit-caret" style={{ opacity: showCaret ? 1 : 0 }}>
          ▌
        </span>
      )}
      {reserve && !done && (
        <span className="kit-type-rest" aria-hidden="true">
          {text.slice(n)}
        </span>
      )}
    </span>
  );
}

/** A strip scrolling left at `speed` px/s, seamless (two copies, `gap` px apart). */
export function Marquee({ t, speed = 120, gap = 80, className, style, children }: { t: number; speed?: number; gap?: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  const inner = useRef<HTMLSpanElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = inner.current;
    if (el === null) return;
    const measure = () => setW(el.offsetWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [children]);
  const x = marqueeX(t, speed, w + gap);
  return (
    <div className={`kit-marquee${className ? ` ${className}` : ""}`} style={style}>
      <div className="kit-marquee-track" style={{ transform: `translate3d(${-x}px, 0, 0)` }}>
        <span ref={inner} className="kit-marquee-item">
          {children}
        </span>
        <span className="kit-marquee-item" style={{ paddingLeft: gap }} aria-hidden="true">
          {children}
        </span>
      </div>
    </div>
  );
}

/** A number counting from `from` to `to` over `[start, start + dur]`, then a little pop as it lands. */
export function BigNumber({ t, from = 0, to, start = 0, dur = 1500, fn = ease.outCubic, format = (n: number) => Math.round(n).toLocaleString("en-US"), prefix, suffix, className, style }: { t: number; from?: number; to: number; start?: number; dur?: number; fn?: Ease; format?: (n: number) => string; prefix?: ReactNode; suffix?: ReactNode; className?: string; style?: CSSProperties }) {
  const v = countUp(t, from, to, start, dur, fn);
  const land = progress(t, start + dur, 320);
  const pop = land > 0 && land < 1 ? 1 + 0.14 * Math.sin(Math.PI * land) : 1;
  return (
    <span className={`kit-bignum${className ? ` ${className}` : ""}`} style={{ ...style, transform: `scale(${pop.toFixed(3)})` }}>
      {prefix}
      {format(v)}
      {suffix}
    </span>
  );
}

/**
 * A countdown readout for `ms` left: `lcd` (red segments on black) or
 * `tray` (the Win98 clock box). Under `warn` ms it turns hot and thumps on
 * every second.
 */
export function Countdown({ ms, variant = "lcd", warn = 10_000, label, reduced = false, className, style }: { ms: number; variant?: "lcd" | "tray"; warn?: number; label?: ReactNode; reduced?: boolean; className?: string; style?: CSSProperties }) {
  const p = countdownParts(ms);
  const hot = ms > 0 && ms <= warn;
  // A thump at the top of each second while hot: 1.12 → 1 over 250 ms.
  const into = 1000 - (Math.max(0, ms) % 1000);
  const thump = hot && !reduced ? 1 + 0.12 * (1 - ease.outCubic(progress(into, 0, 250))) : 1;
  return (
    <div className={`kit-countdown kit-countdown-${variant}${hot ? " hot" : ""}${ms <= 0 ? " zero" : ""}${className ? ` ${className}` : ""}`} style={style}>
      {label !== undefined && <div className="kit-countdown-label">{label}</div>}
      <div className="kit-countdown-digits" style={{ transform: `scale(${thump.toFixed(3)})` }}>
        {p.text}
      </div>
    </div>
  );
}
