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
//! image the browser can't decode) resolves null — cached too, so nothing
//! retries in a loop; a ghost with no picture keeps its plain capsule.

import { CanvasTexture, SRGBColorSpace } from "three";
import type { Texture } from "three";
import { hasDom, PALETTE } from "./textures.ts";

/** The tile's side in canvas pixels. */
export const PICTURE_PX = 128;
/** The bevel + the white margin round the picture. */
const INSET = 10;

const cache = new Map<string, Promise<Texture | null>>();

/** The picture at `url` as a framed tile texture; null without a DOM or when it won't load. */
export function loadPicture(url: string): Promise<Texture | null> {
  const hit = cache.get(url);
  if (hit !== undefined) return hit;
  const made = hasDom() && typeof Image === "function" ? decode(url) : Promise.resolve(null);
  cache.set(url, made);
  return made;
}

/** Forget every cached picture (tests only — live textures are never freed). */
export function clearPictureCache(): void {
  cache.clear();
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
