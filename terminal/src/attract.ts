//! Attract mode, the pure parts (OCT31 K-16): what a wall terminal shows
//! while its character is hidden or asleep — a Mystify screensaver drawn on
//! a Canvas2D, alternating with fake-1999 ads. An ad is a PNG dropped into
//! `public/ads/<id>.png` (served at `/terminal/ads/<id>.png`); until the
//! art lands, or if one fails to load, the ad's own copy renders as a Win98
//! window instead, so a missing file is never a broken image.
//!
//! Nothing here may name the character: attract exists to keep him secret.

/** One ad. `title`/`body`/`button` are the text-card fallback. */
export interface Ad {
  id: string;
  title: string;
  body: string;
  button: string;
}

export const ADS: readonly Ad[] = [
  {
    id: "ad-maps-and-ducks",
    title: "MAPS AND DUCKS — RESTORE THE SIGN!",
    body: "Tonight's fundraiser keeps the billboard on Barrington Street glowing. Every program helps. mapsandducks.com",
    button: "DONATE NOW",
  },
  {
    id: "ad-protection-expired",
    title: "Your protection has expired",
    body: "Your computer may be at risk. Viruses, worms and other programs could be in this house right now. Renew today to stay protected.",
    button: "Renew now",
  },
  {
    id: "ad-geocities",
    title: "Build your FREE home page!",
    body: "15 MB of space, a hit counter and a guestbook. Move into the neighbourhood today — GeoCities.",
    button: "Join now",
  },
  {
    id: "ad-y2k",
    title: "Is your PC Y2K ready?",
    body: "Time is running out. Run the free Year 2000 checker before midnight on December 31, 1999.",
    button: "Check now",
  },
];

/** How long the screensaver runs between ads, and how long each ad holds (ms). */
export const SAVER_MS = 40_000;
export const AD_MS = 10_000;

export type AttractSlide = { kind: "saver" } | { kind: "ad"; index: number };

/** The slide `t` ms into attract: saver, ad 0, saver, ad 1, … (wrapping). */
export function attractSlide(t: number, adCount: number = ADS.length): AttractSlide {
  if (adCount <= 0) return { kind: "saver" };
  const period = SAVER_MS + AD_MS;
  const n = Math.floor(Math.max(0, t) / period);
  return t - n * period < SAVER_MS ? { kind: "saver" } : { kind: "ad", index: n % adCount };
}

// --- Mystify -------------------------------------------------------------------

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
