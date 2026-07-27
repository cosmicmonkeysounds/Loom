#!/usr/bin/env node
// Generates the desktop app icon set: a woven-thread mark drawn in code
// (no binary assets checked in beyond the outputs), encoded as PNG via
// zlib, resized with `sips`, and packed to .icns with `iconutil`
// (both ship with macOS). Re-run with `pnpm --filter loom-desktop icons`.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(here, "..", "src-tauri", "icons");
mkdirSync(iconsDir, { recursive: true });

const SIZE = 1024;

// ---- draw ---------------------------------------------------------------
// RGBA canvas. Dark indigo field, rounded corners, and a weave: vertical
// warp threads with horizontal weft threads passing alternately over and
// under them — the loom.
const px = new Uint8Array(SIZE * SIZE * 4);

function put(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const na = a / 255;
  px[i] = Math.round(r * na + px[i] * (1 - na));
  px[i + 1] = Math.round(g * na + px[i + 1] * (1 - na));
  px[i + 2] = Math.round(b * na + px[i + 2] * (1 - na));
  px[i + 3] = Math.max(px[i + 3], a);
}

const CORNER = 180;
function insideRoundedRect(x, y) {
  const cx = Math.min(Math.max(x, CORNER), SIZE - CORNER);
  const cy = Math.min(Math.max(y, CORNER), SIZE - CORNER);
  return (x - cx) ** 2 + (y - cy) ** 2 <= CORNER ** 2;
}

// Field: vertical gradient #221c33 -> #14101f.
for (let y = 0; y < SIZE; y++) {
  const t = y / SIZE;
  const r = Math.round(0x22 + (0x14 - 0x22) * t);
  const g = Math.round(0x1c + (0x10 - 0x1c) * t);
  const b = Math.round(0x33 + (0x1f - 0x33) * t);
  for (let x = 0; x < SIZE; x++) {
    if (insideRoundedRect(x, y)) put(x, y, r, g, b, 255);
  }
}

const WARP = [300, 424, 548, 672]; // vertical thread centers
const WEFT = [340, 464, 588, 712]; // horizontal thread centers
const THICK = 46;
const warpColor = [122, 108, 214]; // indigo
const weftColor = [232, 168, 90]; // amber

function thread(x, y, base, highlight) {
  // Rounded-profile shading across the thread's thickness.
  const d = Math.abs(highlight);
  const shade = 1 - (d / (THICK / 2)) ** 2 * 0.55;
  put(x, y, base[0] * shade, base[1] * shade, base[2] * shade, 255);
}

// Weave order: weft row i passes OVER warp column j when (i + j) is even.
// Pass 1: warp verticals (full height of the mark area).
for (const wx of WARP) {
  for (let y = 240; y <= 812; y++) {
    for (let dx = -THICK / 2; dx <= THICK / 2; dx++) {
      thread(Math.round(wx + dx), y, warpColor, dx);
    }
  }
}
// Pass 2: weft horizontals, skipping the warp intersections they go under.
WEFT.forEach((wy, i) => {
  for (let x = 240; x <= 812; x++) {
    const j = WARP.findIndex((wx) => Math.abs(x - wx) <= THICK / 2 + 6);
    const underWarp = j >= 0 && (i + j) % 2 === 1;
    if (underWarp) continue;
    for (let dy = -THICK / 2; dy <= THICK / 2; dy++) {
      thread(x, Math.round(wy + dy), weftColor, dy);
    }
  }
});

// ---- encode PNG ---------------------------------------------------------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const master = join(iconsDir, "icon.png");
writeFileSync(master, png);
console.log(`wrote ${master}`);

// ---- resize + icns (macOS tools; skip gracefully elsewhere) --------------
function sips(size, dest) {
  execSync(`sips -z ${size} ${size} "${master}" --out "${dest}"`, { stdio: "pipe" });
  console.log(`wrote ${dest}`);
}

try {
  sips(32, join(iconsDir, "32x32.png"));
  sips(128, join(iconsDir, "128x128.png"));
  sips(256, join(iconsDir, "128x128@2x.png"));

  const iconset = join(iconsDir, "icon.iconset");
  mkdirSync(iconset, { recursive: true });
  for (const s of [16, 32, 128, 256, 512]) {
    sips(s, join(iconset, `icon_${s}x${s}.png`));
    sips(s * 2, join(iconset, `icon_${s}x${s}@2x.png`));
  }
  execSync(`iconutil -c icns "${iconset}" -o "${join(iconsDir, "icon.icns")}"`, { stdio: "pipe" });
  rmSync(iconset, { recursive: true });
  console.log(`wrote ${join(iconsDir, "icon.icns")}`);
} catch (err) {
  console.warn(`resize/icns step skipped: ${err.message}`);
}
