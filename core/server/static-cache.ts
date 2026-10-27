//! The `cache-control` a built app's file is served with (`server.ts`
//! `serveAppFile`): play, the terminal and the reinstallation game.
//!
//! Vite names every bundle by its content (`assets/index-n38yYZk7.js`), so a
//! hashed asset never changes under its name: a phone may keep it a year
//! and never ask again (load test, wave 13: the 700 KB play bundle was
//! re-downloaded on every open, ~1.3 s on cellular). The HTML shell — and
//! anything not hashed (`favicon.ico`, the service worker, the manifest,
//! the terminal's `slides/*.png`) — must be revalidated, so a new build is
//! picked up on the next open.

/** `assets/<name>-<hash>.<ext>`: Vite's default `assetFileNames` /
 *  `chunkFileNames` / `entryFileNames` (an 8-character base64url hash). */
const HASHED_ASSET = /(?:^|\/)assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/u;

/** A year: the longest `max-age` caches honour. */
export const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * The `cache-control` for a file at `rel` (relative to its app's `dist/`):
 * `no-cache` for HTML or when the caller says so (`noCache`: the shell, the
 * PWA files), `IMMUTABLE` for a hashed asset, else none (the browser's own
 * heuristics; the server sends no validators, so it revalidates).
 */
export function appCacheControl(rel: string, noCache = false): string | null {
  if (noCache || rel.endsWith(".html")) return "no-cache";
  if (HASHED_ASSET.test(rel)) return IMMUTABLE;
  return null;
}

/** Files served by byte range (wave 33: the reinstallation intro video). A
 *  browser seeks a video with `Range`, and Safari plays none without it. */
export const RANGED_EXTENSIONS: ReadonlySet<string> = new Set([".mp4", ".mp3", ".ogg", ".wav", ".webm"]);

/**
 * A `Range` header against a file of `size` bytes: the one byte span asked
 * for (`bytes=a-b`, `bytes=a-`, `bytes=-n`), `"unsatisfiable"` (416) for a
 * span past the end, or null to send the whole file (no header, several
 * spans, another unit, junk).
 */
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (header === undefined) return null;
  const m = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (m === null) return null;
  const [, a, b] = m;
  if (a === "" && b === "") return null;
  if (a === "") {
    const n = Number(b);
    if (n === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (start >= size) return "unsatisfiable";
  const end = b === "" ? size - 1 : Math.min(size - 1, Number(b));
  if (end < start) return null;
  return { start, end };
}
