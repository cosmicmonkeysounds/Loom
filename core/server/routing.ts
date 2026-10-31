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

/** The play app (K-31a): its push-only service worker (`/sw.js`) and its
 *  manifest are same-origin; said explicitly rather than left to fall back. */
export const PLAY_CSP = `${HTML_CSP}; worker-src 'self'; manifest-src 'self'`;

/** Play-app files served `Cache-Control: no-cache`: a stale service worker
 *  or manifest would outlive a deploy (the browser re-checks `sw.js` on its
 *  own schedule; no-cache makes every check a real one). The touch icon
 *  (K-31b) rides along: iOS fetches it at the root by that name. */
export const PLAY_PWA_FILES: ReadonlySet<string> = new Set(["/sw.js", "/manifest.webmanifest", "/apple-touch-icon.png"]);

/** whisper.cpp on the server-room laptop, the terminal's `WHISPER_URL`:
 *  loopback, so a spoken answer stays on that laptop. */
export const WHISPER_ORIGIN = "http://127.0.0.1:8178";

/** The terminal plays synthesised speech from in-memory blobs, reads the
 *  tablet's camera and sends spoken answers to whisper.cpp. A browser ignores
 *  a repeated directive, so its connect-src replaces the base one. */
export const TERMINAL_CSP = `${HTML_CSP.replace("connect-src 'self'", `connect-src 'self' ${WHISPER_ORIGIN}`)}; media-src 'self' blob:`;

/** The reinstallation game: the terminal's media rule (the duck's quack,
 *  the camera) plus blob workers (three.js loaders may spin one up). */
export const REINSTALL_CSP = `${HTML_CSP}; media-src 'self' blob:; worker-src 'self' blob:`;

/**
 * The base URL guest-join QRs and `/api/mod/codes` links are built on.
 * Behind a public proxy the operator sets `LOOM_BASE_URL`
 * (`https://app.mapsandducks.com`) and that wins — the container's LAN IP
 * (`http://172.18.0.3:7000`) is unreachable from a phone on cellular.
 * Without it (a LAN box), the first non-localhost interface URL, since a
 * QR pointing at `localhost` is the phone itself.
 */
export function pickJoinBase(baseUrl: string | undefined, lanUrls: readonly string[]): string {
  const explicit = baseUrl?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  return lanUrls.find((u) => !u.includes("localhost")) ?? lanUrls[0]!;
}

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
 * reads (the event stream, state, history — as the mod role), the editor's
 * exact identity lens (`/api/state?role=guest|prime&as=…`, a moderator read
 * of one participant's own view: Run == admin), the wall terminals' screen
 * state, and the spatial plane's map + stream, which a game session token
 * also opens but the editor reads on the session cookie alone.
 */
export function wantsModRead(subPath: string, params: URLSearchParams): boolean {
  return (
    ((subPath === "/events" || subPath === "/api/state" || subPath === "/api/history") && (params.get("role") ?? "mod") === "mod") ||
    (subPath === "/api/state" && params.has("as")) ||
    subPath === "/api/screen/state" ||
    subPath === "/api/spatial/house" ||
    subPath === "/api/spatial/descent" ||
    subPath === "/api/spatial/stream" ||
    subPath === "/api/spatial/cams" ||
    subPath === "/api/spatial/cam" ||
    subPath === "/api/spatial/voice/stream"
  );
}
