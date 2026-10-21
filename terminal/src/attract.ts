//! Mystify, the pure parts (OCT31 K-16): the first screensaver a terminal
//! ever showed — two four-cornered shapes bouncing round the screen with
//! eight fading echoes each. Since wave 17 it is one of the idle show's
//! savers (`idle-show/savers/classic.ts`); the ads, the popups and the
//! rotation live in `idle-show/` too.

export interface Point {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export interface MystifyShape {
  hue: number;
  points: Point[];
  /** Past outlines, newest first, one every `MYSTIFY_GAP` frames. */
  trail: Array<Array<{ x: number; y: number }>>;
  frame: number;
}

export const MYSTIFY_TRAIL = 8;
/** Frames between echoes: spaced outlines, not a solid ribbon. */
export const MYSTIFY_GAP = 5;

/** Two four-cornered shapes at random, moving 1–3 px a frame. */
export function mystifyInit(w: number, h: number, rand: () => number = Math.random): MystifyShape[] {
  const speed = () => (1 + rand() * 2) * (rand() < 0.5 ? -1 : 1);
  return [0, 1].map((i) => ({
    hue: i === 0 ? 190 : 310,
    points: Array.from({ length: 4 }, () => ({ x: rand() * w, y: rand() * h, dx: speed(), dy: speed() })),
    trail: [],
    frame: 0,
  }));
}

/** One frame: move every corner, bounce off the edges, slowly shift hue. */
export function mystifyStep(shapes: MystifyShape[], w: number, h: number): void {
  for (const s of shapes) {
    if (s.frame++ % MYSTIFY_GAP === 0) {
      s.trail.unshift(s.points.map((p) => ({ x: p.x, y: p.y })));
      if (s.trail.length > MYSTIFY_TRAIL) s.trail.length = MYSTIFY_TRAIL;
    }
    for (const p of s.points) {
      p.x += p.dx;
      p.y += p.dy;
      if (p.x < 0 || p.x > w) {
        p.dx = -p.dx;
        p.x = Math.min(w, Math.max(0, p.x));
      }
      if (p.y < 0 || p.y > h) {
        p.dy = -p.dy;
        p.y = Math.min(h, Math.max(0, p.y));
      }
    }
    s.hue = (s.hue + 0.2) % 360;
  }
}
