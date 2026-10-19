//! Profile pictures as textures — a ghost's head (`avatar.ts`) and the icon
//! in its title-bar tag. `loadPicture(url)` fetches an image the browser can
//! decode (the event's same-origin `/e/<id>/api/avatar/<key>`, so the canvas
//! is never tainted) and draws it, contain-fit, on a fixed-size canvas framed
//! as a raised Windows 98 tile. The draw size is fixed, never the image's
//! own: an SVG with no intrinsic size reports `naturalWidth` 0 in Firefox and
//! Safari and would otherwise draw nothing.
//!
//! One texture per URL for the page's lifetime (a module-level cache): twenty
//! ghosts wearing the same picture decode it once, and an avatar's
//! `dispose()` never frees it (that would blank every other ghost wearing
//! it). A night's worth is ≤ ~50 tiles of 64 KB. A failed load (a 404, an
//! image the browser can't decode) resolves null and is remembered for
//! `PICTURE_RETRY_MS`, so nothing retries in a loop — but it expires: the
//! server's 404 is often transient (an upstream fetch still running, a
//! restart), and the terminals run all night without a reload, so the next
//! ask after a minute tries once more. A ghost with no picture keeps its
//! plain capsule meanwhile.

import { CanvasTexture, SRGBColorSpace } from "three";
import type { Texture } from "three";
import { hasDom, PALETTE } from "./textures.ts";

/** The tile's side in canvas pixels. */
export const PICTURE_PX = 128;
/** The bevel + the white margin round the picture. */
const INSET = 10;

/** How long a failed load is remembered before the next ask tries it again. */
export const PICTURE_RETRY_MS = 60_000;

const cache = new Map<string, Promise<Texture | null>>();
/** When each URL's last load failed (wall clock, ms); absent = loaded or in flight. */
const failedAt = new Map<string, number>();

/** The picture at `url` as a framed tile texture; null without a DOM or when it won't load. */
export function loadPicture(url: string): Promise<Texture | null> {
  const hit = cache.get(url);
  if (hit !== undefined) {
    const failed = failedAt.get(url);
    if (failed === undefined || Date.now() - failed < PICTURE_RETRY_MS) return hit;
    // A failure that has expired: forget it and ask once more.
    cache.delete(url);
    failedAt.delete(url);
  }
  const made = (hasDom() && typeof Image === "function" ? decode(url) : Promise.resolve(null)).then((tex) => {
    if (tex === null && cache.get(url) === made) failedAt.set(url, Date.now());
    return tex;
  });
  cache.set(url, made);
  return made;
}

/** Forget every cached picture (tests only — live textures are never freed). */
export function clearPictureCache(): void {
  cache.clear();
  failedAt.clear();
}

function decode(url: string): Promise<Texture | null> {
  return new Promise<Texture | null>((resolve) => {
    let img: HTMLImageElement;
    try {
      img = new Image();
    } catch {
      resolve(null);
      return;
    }
    img.decoding = "async";
    img.onload = () => resolve(tile(img));
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Draw the tile: a raised grey bevel, a white well, the picture contain-fit in it. */
export function tile(img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number }): Texture | null {
  if (!hasDom()) return null;
  const c = document.createElement("canvas");
  c.width = PICTURE_PX;
  c.height = PICTURE_PX;
  const g = c.getContext("2d");
  if (!g) return null;
  const s = PICTURE_PX;
  g.fillStyle = PALETTE.face;
  g.fillRect(0, 0, s, s);
  g.fillStyle = PALETTE.highlight;
  g.fillRect(0, 0, s, 3);
  g.fillRect(0, 0, 3, s);
  g.fillStyle = PALETTE.shadow;
  g.fillRect(0, s - 6, s, 3);
  g.fillRect(s - 6, 0, 3, s);
  g.fillStyle = PALETTE.dark;
  g.fillRect(0, s - 3, s, 3);
  g.fillRect(s - 3, 0, 3, s);
  g.fillStyle = "#ffffff";
  g.fillRect(INSET - 3, INSET - 3, s - 2 * INSET + 6, s - 2 * INSET + 6);
  const box = s - 2 * INSET;
  // The image's own aspect when it has one; a square otherwise (an SVG with no size).
  const iw = img.naturalWidth !== undefined && img.naturalWidth > 0 ? img.naturalWidth : box;
  const ih = img.naturalHeight !== undefined && img.naturalHeight > 0 ? img.naturalHeight : box;
  const k = Math.min(box / iw, box / ih);
  const dw = iw * k;
  const dh = ih * k;
  try {
    g.drawImage(img, INSET + (box - dw) / 2, INSET + (box - dh) / 2, dw, dh);
  } catch {
    return null;
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
