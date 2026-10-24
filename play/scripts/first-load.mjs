#!/usr/bin/env node
// The guest's first load, gzipped: every script and stylesheet
// `dist/index.html` loads before the app can paint (the entry chunk, any
// modulepreload, the CSS). The JS entry is gated (GUEST-SPEC §13.4: target
// ≤ 144 kB, gate ≤ 148 kB gzip); the CSS is reported.
//
//   pnpm --filter loom-play build && node play/scripts/first-load.mjs [--max-kb 148]
//
// Exits 1 over the gate, 2 when there is no build.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const args = process.argv.slice(2);
const at = args.indexOf("--max-kb");
const maxKb = at >= 0 ? Number(args[at + 1]) : 148;

const html = join(dist, "index.html");
if (!existsSync(html)) {
  console.error("no play/dist/index.html — run `pnpm --filter loom-play build` first");
  process.exit(2);
}
const page = readFileSync(html, "utf8");
const refs = (re) => [...page.matchAll(re)].map((m) => m[1].replace(/^\//u, ""));
const js = [...new Set([...refs(/<script[^>]*\ssrc="([^"]+\.js)"/gu), ...refs(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+\.js)"/gu)])];
const css = refs(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+\.css)"/gu);
const kb = (f) => gzipSync(readFileSync(join(dist, f)), { level: 9 }).length / 1000;
let total = 0;
for (const f of js) {
  const k = kb(f);
  total += k;
  console.log(`${k.toFixed(2).padStart(8)} kB  ${f}`);
}
for (const f of css) console.log(`${kb(f).toFixed(2).padStart(8)} kB  ${f} (css, not gated)`);
console.log(`${total.toFixed(2).padStart(8)} kB  the guest's first load (JS, gzip -9); gate ${maxKb} kB`);
if (total > maxKb) {
  console.error(`over the gate by ${(total - maxKb).toFixed(2)} kB`);
  process.exit(1);
}
