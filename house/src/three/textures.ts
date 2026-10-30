//! Procedural textures — the late-90s Web 1.0 / Windows 98 look, drawn on
//! canvases at runtime (the apps' CSP forbids external assets, and there
//! are none to ship). Every maker returns `null` when there is no `document`
//! (node, a worker): callers fall back to the plain `PALETTE` colours, so the
//! builder constructs anywhere and only looks plainer.
//!
//! Tiles are small (≤ 256 px) and magnified with nearest filtering — crisp
//! pixels, cheap on a tablet. Wall / floor UVs are in metres (see
//! `projectUvs` in `scene.ts`), so a 64-px tile is one metre.

import { CanvasTexture, NearestFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace } from "three";

/** The plain colours used when a texture can't be drawn (and as tints). */
export const PALETTE = {
  /** Windows 98 desktop teal. */
  desktop: "#008080",
  desktopDark: "#006666",
  /** Button face grey. */
  face: "#c0c0c0",
  shadow: "#808080",
  dark: "#404040",
  highlight: "#ffffff",
  /** Title bar navy → blue. */
  title: "#000080",
  titleEnd: "#1084d0",
  night: "#000022",
  floor: "#d8d8d8",
  grass: "#4a9e4a",
  ramp: "#e0b040",
  stripeYellow: "#ffd700",
  stripeBlack: "#111111",
  edge: "#9ffcff",
  gold: "#ffc83d",
  screen: "#0a1a3a",
  watch: "#00ffcc",
} as const;

/** True when canvases can be made. */
export function hasDom(): boolean {
  return typeof document !== "undefined" && typeof document.createElement === "function";
}

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  if (!hasDom()) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  return g ? [c, g] : null;
}

/** A canvas texture from a draw function, sRGB, repeating, nearest-magnified. */
export function drawTexture(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  opts: { repeat?: boolean; nearest?: boolean } = {},
): CanvasTexture | null {
  const made = canvas2d(w, h);
  if (!made) return null;
  const [c, g] = made;
  draw(g, w, h);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  if (opts.repeat !== false) {
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
  }
  if (opts.nearest !== false) tex.magFilter = NearestFilter;
  return tex;
}

/** A small deterministic PRNG (mulberry32) so the stars never reshuffle. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Walls: the teal desktop, a dither and a faint 1-m bevel grid. */
export function desktopTexture(): CanvasTexture | null {
  return drawTexture(64, 64, (g, w, h) => {
    g.fillStyle = PALETTE.desktop;
    g.fillRect(0, 0, w, h);
    g.fillStyle = PALETTE.desktopDark;
    for (let y = 0; y < h; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < w; x += 4) g.fillRect(x, y, 1, 1);
    g.fillStyle = "#33a3a3";
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
    g.fillStyle = "#005c5c";
    g.fillRect(0, h - 1, w, 1);
    g.fillRect(w - 1, 0, 1, h);
  });
}

/** Floors: a white / grey checkerboard (tinted per room by vertex colour). */
export function checkerTexture(): CanvasTexture | null {
  return drawTexture(64, 64, (g, w, h) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#b4b4b4";
    g.fillRect(0, 0, w / 2, h / 2);
    g.fillRect(w / 2, h / 2, w / 2, h / 2);
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
  });
}

/** Ceilings: a navy starfield (deterministic). */
export function starfieldTexture(): CanvasTexture | null {
  return drawTexture(256, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#000018");
    grad.addColorStop(1, "#000040");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const rand = mulberry32(1998);
    for (let i = 0; i < 140; i++) {
      const x = Math.floor(rand() * w);
      const y = Math.floor(rand() * h);
      const b = 120 + Math.floor(rand() * 135);
      g.fillStyle = `rgb(${b},${b},${Math.min(255, b + 40)})`;
      g.fillRect(x, y, 1, 1);
    }
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(rand() * (w - 6)) + 3;
      const y = Math.floor(rand() * (h - 6)) + 3;
      g.fillStyle = i % 3 ? "#ffffff" : "#ffff66";
      g.fillRect(x - 2, y, 5, 1);
      g.fillRect(x, y - 2, 1, 5);
    }
  });
}

/** Rails (and the "under construction" look): yellow / black diagonal stripes. */
export function stripesTexture(): CanvasTexture | null {
  return drawTexture(64, 64, (g, w, h) => {
    g.fillStyle = PALETTE.stripeYellow;
    g.fillRect(0, 0, w, h);
    g.fillStyle = PALETTE.stripeBlack;
    for (let k = -h; k < w + h; k += 32) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + 16, 0);
      g.lineTo(k + 16 - h, h);
      g.lineTo(k - h, h);
      g.closePath();
      g.fill();
    }
  });
}

/** Lintels: a raised Windows 98 button face (white top-left, grey bottom-right). */
export function bevelTexture(): CanvasTexture | null {
  return drawTexture(64, 64, (g, w, h) => {
    g.fillStyle = PALETTE.face;
    g.fillRect(0, 0, w, h);
    g.fillStyle = PALETTE.highlight;
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, 0, 2, h);
    g.fillStyle = PALETTE.shadow;
    g.fillRect(0, h - 4, w, 2);
    g.fillRect(w - 4, 0, 2, h);
    g.fillStyle = PALETTE.dark;
    g.fillRect(0, h - 2, w, 2);
    g.fillRect(w - 2, 0, 2, h);
  });
}

/** Fences: grey pickets with see-through gaps (use with `alphaTest`). */
export function fenceTexture(): CanvasTexture | null {
  return drawTexture(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#d0d0d0";
    for (let x = 2; x < w; x += 16) g.fillRect(x, 0, 9, h);
    g.fillStyle = "#a8a8a8";
    g.fillRect(0, 10, w, 5);
    g.fillRect(0, h - 16, w, 5);
  });
}

/** A terminal's panel: a dark CRT with a cyan eye — someone is watching. */
export function watchingTexture(): CanvasTexture | null {
  return drawTexture(
    128,
    96,
    (g, w, h) => {
      g.fillStyle = PALETTE.screen;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = PALETTE.watch;
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(w / 2, h / 2 - 6, 34, 18, 0, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = PALETTE.watch;
      g.beginPath();
      g.arc(w / 2, h / 2 - 6, 10, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = PALETTE.screen;
      g.beginPath();
      g.arc(w / 2, h / 2 - 6, 4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#00ff66";
      g.font = "bold 11px 'Courier New', monospace";
      g.textAlign = "center";
      g.fillText("WATCHING_", w / 2, h - 12);
    },
    { repeat: false, nearest: false },
  );
}

/** CRT scanlines: faint horizontal lines and one bright band, scrolled over a screen. */
export function scanlineTexture(): CanvasTexture | null {
  return drawTexture(8, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.10)";
    for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
    const grad = g.createLinearGradient(0, 40, 0, 52);
    grad.addColorStop(0, "rgba(160,255,240,0)");
    grad.addColorStop(0.5, "rgba(160,255,240,0.45)");
    grad.addColorStop(1, "rgba(160,255,240,0)");
    g.fillStyle = grad;
    g.fillRect(0, 40, w, 12);
  });
}

/** A prop screen (a TV, a monitor): the desktop with one open window. */
export function desktopScreenTexture(): CanvasTexture | null {
  return drawTexture(
    128,
    96,
    (g, w, h) => {
      g.fillStyle = PALETTE.desktop;
      g.fillRect(0, 0, w, h);
      g.fillStyle = PALETTE.face;
      g.fillRect(24, 18, 80, 56);
      g.fillStyle = PALETTE.title;
      g.fillRect(27, 21, 74, 10);
      g.fillStyle = "#ffffff";
      g.fillRect(29, 34, 70, 37);
      g.fillStyle = PALETTE.face;
      g.fillRect(0, h - 10, w, 10);
      g.fillStyle = "#008000";
      g.fillRect(2, h - 8, 18, 6);
    },
    { repeat: false },
  );
}

/** A soft glow; with `cross` (default) a four-point sparkle over it, else a plain halo. */
export function glowTexture(cross = true): CanvasTexture | null {
  return drawTexture(
    32,
    32,
    (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.35, "rgba(255,240,180,0.6)");
      grad.addColorStop(1, "rgba(255,220,120,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      if (!cross) return;
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.fillRect(w / 2 - 0.5, 2, 1, h - 4);
      g.fillRect(2, h / 2 - 0.5, w - 4, 1);
    },
    { repeat: false, nearest: false },
  );
}

/** A sign (a `label` prop): bold text on a flat colour, drawn at `aspect` (w / h). */
export function signTexture(text: string, aspect: number, background: string): CanvasTexture | null {
  const h = 64;
  const w = Math.max(16, Math.min(1024, Math.round(h * Math.max(aspect, 0.25))));
  return drawTexture(
    w,
    h,
    (g) => {
      g.fillStyle = background;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(255,255,255,0.75)";
      g.lineWidth = 3;
      g.strokeRect(3, 3, w - 6, h - 6);
      g.fillStyle = "#ffffff";
      let size = 40;
      g.font = `bold ${size}px Tahoma, 'MS Sans Serif', Geneva, Verdana, sans-serif`;
      while (size > 8 && g.measureText(text).width > w - 16) {
        size -= 2;
        g.font = `bold ${size}px Tahoma, 'MS Sans Serif', Geneva, Verdana, sans-serif`;
      }
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, w / 2, h / 2 + 1);
    },
    { repeat: false, nearest: false },
  );
}

/** A prop screen showing a line of text in its window (the tent tablet's "SCAN YOUR PASS"). */
export function captionScreenTexture(text: string): CanvasTexture | null {
  return drawTexture(
    256,
    160,
    (g, w, h) => {
      g.fillStyle = PALETTE.desktop;
      g.fillRect(0, 0, w, h);
      g.fillStyle = PALETTE.face;
      g.fillRect(16, 24, w - 32, h - 52);
      g.fillStyle = PALETTE.title;
      g.fillRect(20, 28, w - 40, 18);
      g.fillStyle = "#000000";
      let size = 26;
      g.font = `bold ${size}px Tahoma, sans-serif`;
      while (size > 8 && g.measureText(text).width > w - 48) {
        size -= 2;
        g.font = `bold ${size}px Tahoma, sans-serif`;
      }
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, w / 2, 24 + 18 + (h - 52 - 18) / 2);
      g.fillStyle = PALETTE.face;
      g.fillRect(0, h - 18, w, 18);
      g.fillStyle = "#008000";
      g.fillRect(3, h - 15, 34, 12);
    },
    { repeat: false, nearest: false },
  );
}

/** Above this many hit points the bar is one red fill reading "n / max"
 *  (fifteen cells don't fit 160 px); at or below it, one cell per point. */
export const BAR_CELLS_MAX = 9;

/**
 * A boss's health bar as a Windows 98 window: a navy title bar with the
 * label, and under it a sunken track. Up to `BAR_CELLS_MAX` points it is
 * `max` cells, `hp` of them red (the rest grey), with "PAWNS ONLY" across
 * the track at 0; past that one red fill `hp / max` long with "n / max"
 * over it. Returns the texture and its width / height ratio; null without
 * a DOM.
 */
export function healthBarTexture(label: string, hp: number, max: number): { texture: CanvasTexture; aspect: number } | null {
  if (!hasDom()) return null;
  const top = Math.max(1, Math.round(max));
  const cells = Math.min(BAR_CELLS_MAX, top);
  const count = top > BAR_CELLS_MAX;
  const full = Math.max(0, Math.min(top, Math.round(hp)));
  const w = 160;
  const h = 56;
  const texture = drawTexture(
    w,
    h,
    (g) => {
      g.fillStyle = PALETTE.face;
      g.fillRect(0, 0, w, h);
      g.fillStyle = PALETTE.highlight;
      g.fillRect(0, 0, w, 1);
      g.fillRect(0, 0, 1, h);
      g.fillStyle = PALETTE.dark;
      g.fillRect(0, h - 1, w, 1);
      g.fillRect(w - 1, 0, 1, h);
      const grad = g.createLinearGradient(2, 0, w - 2, 0);
      grad.addColorStop(0, PALETTE.title);
      grad.addColorStop(1, PALETTE.titleEnd);
      g.fillStyle = grad;
      g.fillRect(2, 2, w - 4, 20);
      g.fillStyle = "#ffffff";
      g.font = "bold 14px Tahoma, 'MS Sans Serif', Geneva, Verdana, sans-serif";
      g.textBaseline = "middle";
      g.fillText(label, 7, 13);
      // The sunken track.
      g.fillStyle = PALETTE.shadow;
      g.fillRect(6, 27, w - 12, 23);
      g.fillStyle = "#ffffff";
      g.fillRect(7, 28, w - 14, 21);
      g.fillStyle = PALETTE.dark;
      g.fillRect(6, 27, w - 12, 1);
      g.fillRect(6, 27, 1, 23);
      const inner = w - 16;
      if (count) {
        g.fillStyle = "#d8d8d8";
        g.fillRect(8, 30, inner, 17);
        g.fillStyle = "#d00000";
        g.fillRect(8, 30, Math.round((inner * full) / top), 17);
        g.font = "bold 14px Tahoma, 'MS Sans Serif', Geneva, Verdana, sans-serif";
        g.textAlign = "center";
        g.lineWidth = 3;
        g.strokeStyle = "#ffffff";
        g.strokeText(`${full} / ${top}`, w / 2, 39);
        g.fillStyle = "#000000";
        g.fillText(`${full} / ${top}`, w / 2, 39);
        g.textAlign = "left";
        return;
      }
      const cw = (inner - (cells - 1) * 2) / cells;
      for (let i = 0; i < cells; i++) {
        g.fillStyle = i < full ? "#d00000" : "#d8d8d8";
        g.fillRect(8 + i * (cw + 2), 30, cw, 17);
      }
      if (full === 0) {
        g.fillStyle = "#000000";
        g.font = "bold 13px Tahoma, 'MS Sans Serif', Geneva, Verdana, sans-serif";
        g.textAlign = "center";
        g.fillText("PAWNS ONLY", w / 2, 39);
        g.textAlign = "left";
      }
    },
    { repeat: false, nearest: false },
  );
  return texture ? { texture, aspect: w / h } : null;
}

/**
 * A Windows 98 title bar with `text` (and an optional smaller second line
 * under it): navy → blue gradient, bold white text, the three window
 * buttons, and with `icon` a small square picture at the bar's left edge
 * (a window's icon). Returns the texture and its width / height ratio.
 */
export function titleBarTexture(
  text: string,
  sub?: string,
  opts: { buttons?: boolean; from?: string; to?: string; icon?: CanvasImageSource | null } = {},
): { texture: CanvasTexture; aspect: number } | null {
  if (!hasDom()) return null;
  const font = "bold 22px Tahoma, 'MS Sans Serif', Geneva, Verdana, sans-serif";
  const subFont = "16px Tahoma, 'MS Sans Serif', Geneva, Verdana, sans-serif";
  const probe = canvas2d(4, 4);
  if (!probe) return null;
  const [, pg] = probe;
  pg.font = font;
  const tw = pg.measureText(text).width;
  pg.font = subFont;
  const sw = sub ? pg.measureText(sub).width : 0;
  const buttons = opts.buttons !== false;
  const barH = 32;
  const icon = opts.icon ?? null;
  /** The icon's square side, and how far it pushes the title right. */
  const iconSide = barH - 6;
  const indent = icon !== null ? iconSide + 4 : 0;
  const w = Math.ceil(Math.max(tw + indent + (buttons ? 70 : 16), sw + 16, 64) + 8);
  const h = sub ? barH + 28 : barH + 4;
  const texture = drawTexture(
    w,
    h,
    (g) => {
      // The window frame.
      g.fillStyle = PALETTE.face;
      g.fillRect(0, 0, w, h);
      g.fillStyle = PALETTE.highlight;
      g.fillRect(0, 0, w, 1);
      g.fillRect(0, 0, 1, h);
      g.fillStyle = PALETTE.dark;
      g.fillRect(0, h - 1, w, 1);
      g.fillRect(w - 1, 0, 1, h);
      const grad = g.createLinearGradient(2, 0, w - 2, 0);
      grad.addColorStop(0, opts.from ?? PALETTE.title);
      grad.addColorStop(1, opts.to ?? PALETTE.titleEnd);
      g.fillStyle = grad;
      g.fillRect(2, 2, w - 4, barH);
      if (icon !== null) {
        try {
          g.drawImage(icon, 5, 5, iconSide, iconSide);
        } catch {
          /* an image that can't be drawn: the title alone */
        }
      }
      g.fillStyle = "#ffffff";
      g.font = font;
      g.textBaseline = "middle";
      g.fillText(text, 8 + indent, 2 + barH / 2 + 1);
      if (buttons) {
        const glyphs = ["_", "□", "×"];
        glyphs.forEach((glyph, i) => {
          const bx = w - 4 - (3 - i) * 20 + (i === 2 ? 2 : 0);
          g.fillStyle = PALETTE.face;
          g.fillRect(bx, 7, 18, 20);
          g.fillStyle = PALETTE.highlight;
          g.fillRect(bx, 7, 18, 1);
          g.fillRect(bx, 7, 1, 20);
          g.fillStyle = PALETTE.dark;
          g.fillRect(bx, 26, 18, 1);
          g.fillRect(bx + 17, 7, 1, 20);
          g.fillStyle = "#000000";
          g.font = "bold 14px Tahoma, sans-serif";
          g.textAlign = "center";
          g.fillText(glyph, bx + 9, 17);
          g.textAlign = "left";
        });
      }
      if (sub) {
        g.fillStyle = "#000000";
        g.font = subFont;
        g.fillText(sub, 8, barH + 16);
      }
    },
    { repeat: false, nearest: false },
  );
  return texture ? { texture, aspect: w / h } : null;
}

/** (wave 47) The games' haze: soft seamless white wisps on black (drawn
 *  additive, so black is clear), every blob drawn at its wrapped copies too. */
export function hazeTexture(seed = 47): CanvasTexture | null {
  const tex = drawTexture(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = "#000";
      g.fillRect(0, 0, w, h);
      const rand = mulberry32(seed);
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 46; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const r = 18 + rand() * 62;
        const a = 0.18 + rand() * 0.3;
        for (const dx of [-w, 0, w]) {
          for (const dy of [-h, 0, h]) {
            const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
            grad.addColorStop(0, `rgba(255,255,255,${a})`);
            grad.addColorStop(1, "rgba(255,255,255,0)");
            g.fillStyle = grad;
            g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
          }
        }
      }
    },
    { nearest: false },
  );
  // A mask, not a picture: kept linear, so the wisps aren't darkened.
  if (tex) tex.colorSpace = NoColorSpace;
  return tex;
}
