//! The Language Report's breach on a canvas (wave 48b): the censored log in
//! its DOS window, the eye that opens in it, a piece of the pile, the TV's
//! tentacles. Plain functions of a 2D context and `t` (`lang-breach.ts`
//! decides where and when), so a test can record what they draw: every
//! word goes through `fillText`, a redaction bar only ever through
//! `fillRect`.

import { clamp01, ease, lerp, progress, typedCount } from "./time.ts";
import { eyeLook, eyeOpen, lineChars, printedBy, type BreachLine, type BreachSchedule, type BreachTimes, type Rect, type TideSlot } from "./lang-breach.ts";

/** The breach's one typeface (the terminal's own, bundled at boot). */
export const BREACH_FONT = "VT323, monospace";

/** A canvas font string at `px` pixels. */
export function fontPx(px: number): string {
  return `${Math.max(1, Math.round(px))}px ${BREACH_FONT}`;
}

/** VT323's advance in ems as this page draws it (a fallback font's, before it loads); 0.5 if it can't be measured. */
export function measureCharW(ctx: CanvasRenderingContext2D): number {
  ctx.font = fontPx(100);
  const w = ctx.measureText("MMMMMMMMMM").width / 1000;
  return w > 0.2 && w < 1 ? w : 0.5;
}

const HEAT: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [157, 255, 176]],
  [0.5, [255, 210, 63]],
  [1, [255, 74, 42]],
];

/** A line's colour by its heat: phosphor green for the once-censored, amber, red for the most. */
export function heatColor(h: number): string {
  const k = clamp01(h);
  for (let i = 1; i < HEAT.length; i++) {
    const [b, cb] = HEAT[i]!;
    if (k <= b) {
      const [a, ca] = HEAT[i - 1]!;
      const f = (k - a) / (b - a);
      return `rgb(${Math.round(lerp(ca[0], cb[0], f))},${Math.round(lerp(ca[1], cb[1], f))},${Math.round(lerp(ca[2], cb[2], f))})`;
    }
  }
  return "rgb(255,74,42)";
}

/**
 * One piece of the pile, centred on the origin, at `px`: a word in its heat
 * colour with a dark rim, "+ n more" in a dashed box, a bar as a black
 * redaction bar on a paper strip (two rects; a bar has no text to draw).
 */
export function drawPiece(ctx: CanvasRenderingContext2D, l: BreachLine, px: number, charW: number): void {
  if (l.kind === "bar") {
    const bw = l.chars * charW * px;
    const bh = px * 0.5;
    ctx.fillStyle = "#e9e3d0";
    ctx.fillRect(-bw / 2 - px * 0.24, -bh / 2 - px * 0.24, bw + px * 0.48, bh + px * 0.48);
    ctx.fillStyle = "#050505";
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    return;
  }
  ctx.font = fontPx(px);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (l.kind === "more") {
    const bw = (lineChars(l) + 0.8) * charW * px;
    ctx.strokeStyle = "#ffcf5a";
    ctx.lineWidth = Math.max(1, px * 0.06);
    ctx.setLineDash([px * 0.25, px * 0.18]);
    ctx.strokeRect(-bw / 2, -px * 0.5, bw, px);
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffcf5a";
    ctx.fillText(l.text, 0, px * 0.04);
    return;
  }
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, px * 0.16);
  ctx.strokeStyle = "rgba(8, 2, 14, 0.9)";
  ctx.strokeText(l.text, 0, px * 0.04);
  ctx.fillStyle = heatColor(l.heat);
  ctx.fillText(l.text, 0, px * 0.04);
}

/** A line at rest in its slot (`W` × `H` CSS pixels). */
export function drawSlot(ctx: CanvasRenderingContext2D, l: BreachLine, s: TideSlot, W: number, H: number, charW: number): void {
  ctx.save();
  ctx.translate(s.cx * W, s.cy * H);
  ctx.rotate(s.rot);
  drawPiece(ctx, l, s.fs * H, charW);
  ctx.restore();
}

// --- the log ---------------------------------------------------------------------------------

/** The log's own words (`LANG_COPY.log`). */
export interface LogCopy {
  /** The prompt, `C:\FILTER>`. */
  prompt: string;
  /** The command it types first. */
  cmd: string;
  /** Typed at the leak when the log has finished (a short night). */
  del: string;
  /** The answers to it, a line each. */
  denied: readonly string[];
}

export interface LogOpts {
  /** Text rows in the window. */
  rows: number;
  charW: number;
  /** Show each word's ×n (only when some word was censored more than once). */
  counts: boolean;
  /** Rows twitch sideways once it leaks (the TV). */
  jitter: boolean;
  copy: LogCopy;
}

type LogRow = { k: "prompt"; typed: string; at: number } | { k: "line"; i: number } | { k: "say"; text: string; hot: boolean };

/** The log's rows at `t`: the command, every printed line, then a fresh prompt (a short night types `del` at it and is refused). */
export function logRows(t: number, tm: BreachTimes, sched: BreachSchedule, copy: LogCopy): LogRow[] {
  const rows: LogRow[] = [{ k: "prompt", typed: copy.cmd, at: tm.flow - 1200 }];
  const printed = printedBy(t, sched.line);
  for (let i = 0; i < printed; i++) rows.push({ k: "line", i });
  if (printed < tm.n || t < tm.last + 400) return rows;
  const done = tm.last + 400 <= tm.leak - 600;
  if (!done) return rows;
  rows.push({ k: "prompt", typed: t >= tm.leak - 500 ? copy.del : "", at: tm.leak - 500 });
  copy.denied.forEach((text, k) => {
    if (t >= tm.leak + 300 + k * 700) rows.push({ k: "say", text, hot: k > 0 });
  });
  return rows;
}

/**
 * The censored log, as a DOS window shows it at `t`: black, light grey
 * VT323, the newest `rows` rows (it scrolls a whole row at a time, like a
 * terminal), a word's ×n at the right edge behind a dotted leader, a bar
 * as a bar. From the leak the text heats to red and (the TV) twitches.
 */
export function drawLog(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, tm: BreachTimes, sched: BreachSchedule, lines: readonly BreachLine[], o: LogOpts): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const lh = h / o.rows;
  const px = lh * 0.86;
  const pad = px * 0.6;
  const cw = o.charW * px;
  const all = logRows(t, tm, sched, o.copy);
  const first = Math.max(0, all.length + 1 - o.rows);
  const heat = progress(t, tm.leak, Math.max(1, tm.eye - tm.leak));
  const grey = `rgb(${Math.round(lerp(192, 255, heat))},${Math.round(lerp(192, 110, heat))},${Math.round(lerp(192, 96, heat))})`;
  ctx.font = fontPx(px);
  ctx.textBaseline = "middle";
  for (let r = first; r < all.length; r++) {
    const row = all[r]!;
    const y = (r - first + 0.5) * lh;
    const dx = o.jitter && heat > 0 ? (rowNoise(r, Math.floor(t / 90)) - 0.5) * px * 0.7 * heat : 0;
    ctx.textAlign = "left";
    ctx.fillStyle = grey;
    if (row.k === "prompt") {
      const n = typedCount(row.typed, t, { start: row.at, cps: 22 });
      ctx.fillText(`${o.copy.prompt}${row.typed.slice(0, n)}`, pad + dx, y);
      continue;
    }
    if (row.k === "say") {
      ctx.fillStyle = row.hot ? "#ff5a4a" : grey;
      ctx.fillText(row.text, pad + dx, y);
      continue;
    }
    const l = lines[row.i]!;
    if (l.kind === "bar") {
      ctx.fillStyle = "#e9e3d0";
      ctx.fillRect(pad + dx, y - px * 0.36, l.chars * cw + px * 0.3, px * 0.72);
      ctx.fillStyle = "#050505";
      ctx.fillRect(pad + dx + px * 0.15, y - px * 0.27, l.chars * cw, px * 0.54);
      continue;
    }
    if (l.kind === "more") {
      ctx.fillStyle = "#ffcf5a";
      ctx.fillText(l.text, pad + dx, y);
      continue;
    }
    ctx.fillText(l.text, pad + dx, y);
    if (!o.counts) continue;
    const tag = `×${l.count}`;
    ctx.textAlign = "right";
    ctx.fillStyle = l.heat > 0.5 ? "#ffd23f" : grey;
    ctx.fillText(tag, w - pad + dx, y);
    // The dotted leader between the word and its count.
    const from = pad + (lineChars(l) + 1) * cw + dx;
    const to = w - pad - (tag.length + 1) * cw + dx;
    ctx.fillStyle = "rgba(192, 192, 192, 0.35)";
    for (let x = from; x < to; x += cw) ctx.fillRect(x, y + px * 0.18, Math.max(1, px * 0.1), Math.max(1, px * 0.1));
  }
  // The cursor, on the row after the last: a block blinking at 530 ms.
  const cr = all.length - first;
  if (cr < o.rows && Math.floor(t / 530) % 2 === 0) {
    ctx.fillStyle = grey;
    ctx.fillRect(pad, (cr + 0.15) * lh, cw, lh * 0.7);
  }
}

function rowNoise(r: number, f: number): number {
  const x = Math.sin(r * 127.1 + f * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// --- the eye ----------------------------------------------------------------------------------

export interface EyeOpts {
  /** Rings of words in the iris (the TV 3, a wall 2). */
  rings: number;
  charW: number;
  /** The rings turn (not under reduced motion). */
  spin: boolean;
  /** The pupil darts about (not under reduced motion). */
  look: boolean;
}

/**
 * The eye that opens in the log's window: an almond of dark sclera over the
 * dimmed log, an iris of the most censored words in turning rings (bars when
 * only unsaid words were censored), a slit pupil that looks about.
 */
export function drawEye(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, tm: BreachTimes, ring: readonly BreachLine[], o: EyeOpts): void {
  const open = eyeOpen(t, tm);
  if (open <= 0) return;
  ctx.fillStyle = `rgba(0, 0, 0, ${(0.78 * clamp01(progress(t, tm.eye, 600))).toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const ew = Math.min(w * 0.94, h * 2.3);
  const full = Math.min(h * 0.96, ew * 0.56);
  const lid = full * open;
  const almond = () => {
    ctx.beginPath();
    ctx.moveTo(cx - ew / 2, cy);
    ctx.quadraticCurveTo(cx, cy - lid, cx + ew / 2, cy);
    ctx.quadraticCurveTo(cx, cy + lid, cx - ew / 2, cy);
    ctx.closePath();
  };
  ctx.save();
  almond();
  ctx.clip();
  const sclera = ctx.createRadialGradient(cx, cy, 0, cx, cy, ew / 2);
  sclera.addColorStop(0, "#3a0c18");
  sclera.addColorStop(1, "#070104");
  ctx.fillStyle = sclera;
  ctx.fillRect(0, 0, w, h);
  const look = o.look ? eyeLook(t, tm) : { x: 0, y: 0 };
  const R = Math.min(ew * 0.25, full * 0.46);
  const ix = cx + look.x * ew * 0.2;
  const iy = cy + look.y * full * 0.16;
  const iris = ctx.createRadialGradient(ix, iy, R * 0.1, ix, iy, R);
  iris.addColorStop(0, "#ff7a1a");
  iris.addColorStop(0.55, "#8a120e");
  iris.addColorStop(1, "#1a0204");
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.arc(ix, iy, R, 0, Math.PI * 2);
  ctx.fill();
  if (ring.length > 0) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let r = 0; r < o.rings; r++) {
      const rad = R * (0.86 - r * 0.24);
      const px = R * (0.15 - r * 0.028);
      if (rad <= px || px < 4) break;
      const dir = r % 2 === 0 ? 1 : -1;
      const a0 = o.spin ? dir * (t - tm.eye) * 0.00022 * (1 + r * 0.5) : r * 0.7;
      ctx.font = fontPx(px);
      ctx.fillStyle = r === 0 ? "#ffd23f" : r === 1 ? "#ff9a3c" : "#ff5a3c";
      const cw = o.charW * px;
      const round = Math.PI * 2 * rad;
      let arc = 0;
      for (let j = r * 3; arc < round; j++) {
        const l = ring[j % ring.length]!;
        const tw = lineChars(l) * cw;
        if (arc + tw > round - px * 0.5) break;
        const a = a0 + (arc + tw / 2) / rad;
        ctx.save();
        ctx.translate(ix + Math.cos(a) * rad, iy + Math.sin(a) * rad);
        ctx.rotate(a + Math.PI / 2);
        if (l.kind === "bar") {
          ctx.fillStyle = "#050505";
          ctx.fillRect(-tw / 2, -px * 0.3, tw, px * 0.6);
        } else ctx.fillText(l.text, 0, 0);
        ctx.restore();
        arc += tw + px * 0.7;
      }
    }
  }
  // The pupil: a slit that widens and narrows.
  const dilate = o.look ? 1 + 0.35 * (0.5 - 0.5 * Math.cos(((t - tm.eye) / 2300) * Math.PI * 2)) : 1;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(ix, iy, R * 0.13 * dilate, R * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 60, 40, 0.7)";
  ctx.lineWidth = Math.max(1, R * 0.02);
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 240, 220, 0.55)";
  ctx.beginPath();
  ctx.ellipse(ix - R * 0.34, iy - R * 0.38, R * 0.09, R * 0.06, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // The lids' rims, in the window's grey.
  almond();
  ctx.strokeStyle = "#c0c0c0";
  ctx.lineWidth = Math.max(2, h * 0.012);
  ctx.stroke();
}

// --- the tentacles (the TV) ------------------------------------------------------------------

/**
 * Four tentacles reaching from the window's corners for the screen's,
 * writhing from just after the eye opens until the cut: a dark ribbon,
 * thick at the root and thin at the tip, carrying the most censored words
 * along a travelling wave.
 */
export function drawTentacles(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, tm: BreachTimes, ring: readonly BreachLine[], win: Rect, charW: number): void {
  const grow = ease.outCubic(progress(t, tm.eye + 300, 1600));
  if (grow <= 0 || ring.length === 0) return;
  const thick = H * 0.075;
  const corners: ReadonlyArray<readonly [number, number, number, number]> = [
    [win.x, win.y, 0, 0],
    [win.x + win.w, win.y, 1, 0],
    [win.x + win.w, win.y + win.h, 1, 1],
    [win.x, win.y + win.h, 0, 1],
  ];
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  corners.forEach(([bx, by, sx, sy], k) => {
    const B = { x: bx * W, y: by * H };
    const dx = sx * W - B.x;
    const dy = sy * H - B.y;
    const reach = Math.hypot(dx, dy);
    const len = reach * 1.08 * grow;
    if (len < 4) return;
    const u = { x: dx / reach, y: dy / reach };
    const v = { x: -u.y, y: u.x };
    const at = (s: number) => {
      const wave = len * 0.17 * s ** 1.2 * Math.sin(2.6 * Math.PI * s - (t - tm.eye) / 260 + k * 1.7);
      return { x: B.x + u.x * len * s + v.x * wave, y: B.y + u.y * len * s + v.y * wave };
    };
    const half = (s: number) => (thick / 2) * lerp(1, 0.12, s);
    // The curve sampled, its normals, and its length so far at each sample.
    const N = 36;
    const pts = Array.from({ length: N + 1 }, (_, i) => at(i / N));
    const acc = [0];
    for (let i = 1; i <= N; i++) acc.push(acc[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
    const total = acc[N]!;
    const normal = (i: number) => {
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(N, i + 1)]!;
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: -(b.y - a.y) / d, y: (b.x - a.x) / d };
    };
    // The ribbon: one side out, the other back.
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const n = normal(i);
      const h = half(i / N);
      if (i === 0) ctx.moveTo(pts[i]!.x + n.x * h, pts[i]!.y + n.y * h);
      else ctx.lineTo(pts[i]!.x + n.x * h, pts[i]!.y + n.y * h);
    }
    for (let i = N; i >= 0; i--) {
      const n = normal(i);
      const h = half(i / N);
      ctx.lineTo(pts[i]!.x - n.x * h, pts[i]!.y - n.y * h);
    }
    ctx.closePath();
    ctx.fillStyle = "#2c0a3c";
    ctx.fill();
    ctx.strokeStyle = "#b44cff";
    ctx.lineWidth = Math.max(2, H * 0.004);
    ctx.stroke();
    const pointAt = (d: number) => {
      let i = 1;
      while (i < N && acc[i]! < d) i++;
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const f = clamp01((d - acc[i - 1]!) / Math.max(1e-6, acc[i]! - acc[i - 1]!));
      return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    let d = thick * 0.3;
    for (let j = k * 2; d < total; j++) {
      const s = d / total;
      const fpx = half(s) * 1.25;
      if (fpx < 7) break;
      const l = ring[j % ring.length]!;
      const tw = lineChars(l) * charW * fpx;
      if (d + tw > total) break;
      const p = pointAt(d + tw / 2);
      const flip = Math.cos(p.ang) < 0 ? Math.PI : 0;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.ang + flip);
      if (l.kind === "bar") {
        ctx.fillStyle = "#050505";
        ctx.fillRect(-tw / 2, -fpx * 0.3, tw, fpx * 0.6);
      } else {
        ctx.font = fontPx(fpx);
        ctx.fillStyle = s < 0.45 ? "#ff8ad8" : "#ffd23f";
        ctx.fillText(l.text, 0, fpx * 0.04);
      }
      ctx.restore();
      d += tw + fpx * 0.45;
    }
  });
}
