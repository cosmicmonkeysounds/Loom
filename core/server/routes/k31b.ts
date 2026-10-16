//! K-31b — iPhone Home Screen push. An iPhone only gets Web Push inside a
//! Home Screen app (iOS 16.4+), and that app has its own storage: opened at
//! the static manifest's `start_url` ("/") it is signed out, and a guest who
//! joins again there becomes a second program. So, **behind
//! `LOOM_HOMESCREEN=on` (default off)**:
//!
//! - `POST /e/:id/api/guest/homescreen` (a guest token) mints a **single-use
//!   nonce** for the caller's own Person — `Pairing.homescreen` in `n02.ts`,
//!   the same pending table a director's re-pair code lives in, so the Home
//!   Screen app spends it at the existing `/api/guest/resume {pair}`. It adds
//!   a token and never revokes the Safari one; it lives `HOMESCREEN_TTL_MS`
//!   (12 h), the newest three per guest stay good, and every restart clears
//!   them.
//! - `GET /manifest.webmanifest?code=&pair=[&name=]` is the play app's
//!   manifest with `start_url` = `/?code=…&pair=…&home=1` (no-cache). Without
//!   those params — every Android phone — it is the static file, unchanged.
//!   The play app swaps its `<link rel=manifest>` to this before the guest
//!   taps Share → Add to Home Screen.
//!
//! Booths take no nonce (instruction-only: "☰ → Sign out, then sign in
//! from the Home Screen icon"; Sign out frees the part at
//! `/api/prime/logout`). The flag also rides `GET /api/push/config` as
//! `homescreen`, so the play card and the editor's door poster can word
//! themselves.

import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";

export const HOMESCREEN_ROUTE = "/api/guest/homescreen";
/** How long a Home Screen nonce waits for the icon's first open. */
export const HOMESCREEN_TTL_MS = 12 * 60 * 60_000;

/** Is K-31b switched on? `LOOM_HOMESCREEN=on` (or 1 / true / yes). */
export function homescreenEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(on|1|true|yes)$/iu.test((env.LOOM_HOMESCREEN ?? "").trim());
}

/** The Home Screen app's first URL: the event code + the nonce, marked
 *  `home=1` so a relaunch with a stored session ignores the spent nonce. */
export function homescreenStartUrl(code: string, pair: string): string {
  return `/?code=${encodeURIComponent(code)}&pair=${encodeURIComponent(pair)}&home=1`;
}

/** Where the play app points its `<link rel=manifest>` for one nonce. */
export function homescreenManifestPath(code: string, pair: string): string {
  return `/manifest.webmanifest?code=${encodeURIComponent(code)}&pair=${encodeURIComponent(pair)}`;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/u;

/** The manifest for `search` (`?code=&pair=[&name=]`), built on the static
 *  one; null when the params aren't a well-formed nonce link (→ serve the
 *  static file). The server doesn't check the nonce here — the resume route
 *  does, once, when the icon is first opened. */
export function homescreenManifest(base: Record<string, unknown>, search: string): Record<string, unknown> | null {
  const p = new URLSearchParams(search);
  const code = (p.get("code") ?? "").trim();
  const pair = (p.get("pair") ?? "").trim();
  if (!TOKEN_RE.test(code) || !TOKEN_RE.test(pair)) return null;
  // The icon's label: the event's title, as the page knew it.
  const name = (p.get("name") ?? "").replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, 60);
  return { ...base, ...(name !== "" ? { name, short_name: name } : {}), start_url: homescreenStartUrl(code, pair) };
}

/** What the static manifest says when the build has none (dev without a
 *  `play/dist`). Kept in step with `play/public/manifest.webmanifest`. */
const FALLBACK_MANIFEST: Record<string, unknown> = {
  name: "Loom",
  short_name: "Loom",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#0b0d12",
  theme_color: "#3b3a5c",
  icons: [{ src: "/apple-touch-icon.png", sizes: "192x192", type: "image/png" }],
};

/** `GET /manifest.webmanifest` with a nonce link while K-31b is on; false
 *  (→ the static file) otherwise. */
export function serveHomescreenManifest(search: string, dist: URL, res: ServerResponse, enabled = homescreenEnabled()): boolean {
  if (!enabled) return false;
  let base = FALLBACK_MANIFEST;
  try {
    base = JSON.parse(readFileSync(new URL("manifest.webmanifest", dist), "utf8")) as Record<string, unknown>;
  } catch {
    /* not built — the fallback */
  }
  const manifest = homescreenManifest(base, search);
  if (manifest === null) return false;
  res.writeHead(200, { "content-type": "application/manifest+json", "cache-control": "no-cache" });
  res.end(JSON.stringify(manifest));
  return true;
}
