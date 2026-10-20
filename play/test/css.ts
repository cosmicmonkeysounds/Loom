//! The play stylesheet as the bundler sees it (wave 13): `styles.css` is
//! only `@import`s of the per-lane files under `src/css/`, which Vite
//! inlines in order (both the bundled CSS and `styles.css?inline`). Tests
//! that read the stylesheet read this, never one file.

import { readFileSync } from "node:fs";

const IMPORT = /^@import\s+"([^"]+)";\s*$/gmu;

/** `src/styles.css` with every `@import` inlined, recursively, from disk. */
export function readBundledCss(entry: URL = new URL("../src/styles.css", import.meta.url)): string {
  const text = readFileSync(entry, "utf8");
  return text.replace(IMPORT, (_line, path: string) => readBundledCss(new URL(path, entry)));
}

/** The `@import` paths `styles.css` lists, in order. */
export function stylesImports(): string[] {
  const text = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  return [...text.matchAll(IMPORT)].map((m) => m[1]!);
}
