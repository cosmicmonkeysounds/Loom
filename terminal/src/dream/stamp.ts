//! A copy of what is on the screen for the mosh to drag (wave 50). A page
//! can't read its own pixels, so this redraws the top layers small onto a
//! canvas: boxes with a background, text, and any canvas or image in a scene.
//! It is a ghost, never shown as it is: a few hundred pixels wide, taken a
//! couple of times a second, capped at `STAMP_NODES` nodes, and skipping
//! whatever is hidden. SVG is left out (the mosh's blocks still cover it).

/** What the mosh drags: the slide or scene, an overlay, the banner, a glitch. */
const ROOTS = ".cutscene-stage, .screen-slide, .screen-overlay, .announce-banner, .screen-glitch";
/** The takeover drags the whole screen, the idle show too. */
const TAKE_ROOTS = `${ROOTS}, .idle-show[data-active="true"], .terminal.tv .tv-face`;
/** The most nodes one stamp reads (a getComputedStyle each). */
export const STAMP_NODES = 400;

const clearColour = (c: string): boolean => c === "" || c === "transparent" || /^rgba\(.*,\s*0\)$/u.test(c);

/** One line's share of a wrapped text node: the words cut by the widths of its boxes. */
export function lineSlices(text: string, widths: readonly number[]): string[] {
  const total = widths.reduce((a, b) => a + b, 0);
  if (widths.length <= 1 || total <= 0) return [text];
  const out: string[] = [];
  let at = 0;
  for (const w of widths) {
    const n = Math.round((w / total) * text.length);
    out.push(text.slice(at, at + n));
    at += n;
  }
  return out;
}

/** Redraw the top layers onto `ctx` (`w` × `h`, the small canvas). */
export function stampScene(ctx: CanvasRenderingContext2D, w: number, h: number, take: boolean): void {
  ctx.clearRect(0, 0, w, h);
  const sx = w / Math.max(1, window.innerWidth);
  const sy = h / Math.max(1, window.innerHeight);
  let budget = STAMP_NODES;
  const range = document.createRange();
  ctx.textBaseline = "top";

  const walk = (el: Element): void => {
    if (budget <= 0) return;
    budget -= 1;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return;
    const box = el.getBoundingClientRect();
    if (!clearColour(cs.backgroundColor) && box.width > 0 && box.height > 0) {
      ctx.fillStyle = cs.backgroundColor;
      ctx.fillRect(box.left * sx, box.top * sy, box.width * sx, box.height * sy);
    }
    if (el instanceof HTMLCanvasElement || el instanceof HTMLImageElement || el instanceof HTMLVideoElement) {
      try {
        ctx.drawImage(el, box.left * sx, box.top * sy, box.width * sx, box.height * sy);
      } catch {
        // An image still loading, a canvas with no size: nothing to copy yet.
      }
      return;
    }
    for (const child of Array.from(el.childNodes)) {
      if (budget <= 0) return;
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!(child instanceof SVGElement)) walk(child as Element);
      } else if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? "").replace(/\s+/gu, " ").trim();
        if (text === "") continue;
        budget -= 1;
        range.selectNodeContents(child);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
        const lines = lineSlices(text, rects.map((r) => r.width));
        ctx.fillStyle = cs.color;
        rects.forEach((r, i) => {
          // The box's own height, not the font's: a scene may be scaled.
          ctx.font = `${cs.fontWeight} ${Math.max(3, r.height * 0.8 * sy).toFixed(1)}px ${cs.fontFamily}`;
          ctx.fillText(lines[i] ?? "", r.left * sx, r.top * sy, r.width * sx);
        });
      }
    }
  };
  for (const root of Array.from(document.querySelectorAll(take ? TAKE_ROOTS : ROOTS))) walk(root);
}
