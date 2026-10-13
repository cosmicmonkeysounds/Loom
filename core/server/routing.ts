//! Pure routing decisions `server.ts` makes before touching a file or a
//! runtime — split out so they are testable without booting the process
//! (`server.ts` listens, reads the state dir and the DB at import).

/** Content-Security-Policy for served HTML. The Vite build is external
 *  scripts + hashed assets, all same-origin; inline styles are React's. */
export const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** The terminal plays synthesised speech from in-memory blobs and reads
 *  the tablet's camera; only the media source differs from the play app. */
export const TERMINAL_CSP = `${HTML_CSP}; media-src 'self' blob:`;

/** The reinstallation game: the terminal's media rule (the duck's quack,
 *  the camera) plus blob workers (three.js loaders may spin one up). */
export const REINSTALL_CSP = `${HTML_CSP}; media-src 'self' blob:; worker-src 'self' blob:`;

/** A request path → the file to read from a built app's `dist/` (no
 *  leading slash; `/` is `index.html`). Null for anything climbing out. */
export function appRelPath(pathname: string): string | null {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  return rel.includes("..") ? null : rel;
}

/** What a GET under a sub-app mounted at `prefix` (e.g. `/reinstall`) serves. */
export type SubAppRoute = { redirect: string } | { file: string };

/**
 * A sub-app's route: the bare prefix redirects to `prefix/` (keeping the
 * query — a `?code=` link must survive), a path with no extension is the
 * SPA's own route (→ `/index.html`), anything else is the asset itself.
 * Null when `path` is not under `prefix`.
 */
export function subAppRoute(path: string, prefix: string, search: string): SubAppRoute | null {
  if (path === prefix) return { redirect: `${prefix}/${search}` };
  if (!path.startsWith(`${prefix}/`)) return null;
  const rel = path.slice(prefix.length);
  return { file: rel === "/" || rel === "/index.html" || !rel.includes(".") ? "/index.html" : rel };
}

/**
 * Does an `/e/:eventId` read need the author session resolved? The mod
 * reads (the event stream, state, history — as the mod role) and the
 * spatial plane's map + stream, which a game session token also opens but
 * the editor reads on the session cookie alone.
 */
export function wantsModRead(subPath: string, params: URLSearchParams): boolean {
  return (
    ((subPath === "/events" || subPath === "/api/state" || subPath === "/api/history") && (params.get("role") ?? "mod") === "mod") ||
    subPath === "/api/spatial/house" ||
    subPath === "/api/spatial/stream"
  );
}
