//! Loom event server — the multi-tenant backbone that hosts live `Sim`
//! events and serves the role-based web client.
//!
//! Transport: Server-Sent Events for server→client push (state
//! snapshots, broadcasts, choice prompts) + JSON `fetch` POST for
//! client→server actions. No WebSocket dependency, so it works on any
//! phone browser on the wifi.
//!
//! Each live event is an `EventRuntime` (see `event-runtime.ts`). This file
//! owns the process: static app serving, the QR endpoint, restart-recovery,
//! and routing each request to the right runtime. During this first slice a
//! single default event is hosted at the root paths (identical to the old
//! single-event server); the `EventRegistry` + `/e/:eventId` namespacing land
//! next.
//!
//! Run: `pnpm --filter @loom/core serve` (or `npx tsx server/server.ts`).
//! Env: LOOM_PORT, LOOM_HOST, LOOM_EVENT_PASS, LOOM_MOD_PASS,
//! LOOM_PRIME_PASS (any passcode left unset is auto-generated and printed
//! at boot), LOOM_STATE_DIR (where restart-recovery state is kept),
//! LOOM_APP_DIST, LOOM_TERMINAL_DIST, LOOM_REINSTALL_DIST (the built web
//! reinstallation game, served at `/reinstall/`), LOOM_HOUSE (the fallback
//! house map for the reinstallation games; default: the example's
//! `house.json` — a project's own map files, snapshotted at launch, and a
//! director's save per event, kept as `spatial-house.json` in that event's
//! state dir, both override it; `server/house-maps.ts`), LOOM_FACTS (the
//! fallback facts key for the facts judge; default: `facts.json` beside the
//! house map — a project's own `facts.json`, snapshotted at launch,
//! overrides it; `server/facts.ts`).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import QRCode from "qrcode";

import { toNodeHandler } from "better-auth/node";

import { resolvePasscodes } from "./auth.ts";
import { Store } from "./store.ts";
import { scenarioSource } from "../examples/load.ts";
import { EventRuntime } from "./event-runtime.ts";
import { EventRegistry } from "./registry.ts";
import { WikiClient } from "./wiki.ts";
import { ImageCache } from "./avatars.ts";
import { join } from "node:path";
import { ipOf, readBody, sendJson, str, PayloadTooLarge } from "./http-util.ts";
import { RateLimiter, limiterFor, rateLimitsFromEnv } from "./rate-limit.ts";
import { auth, authUser, migrateAuth } from "./auth-server.ts";
import { dbReady, initSchema } from "./db/index.ts";
import { canModerateEvent, liveEvents } from "./db/queries.ts";
import {
  AUTH_SECRET,
  BASE_URL,
  DATABASE_URL,
  HAS_SECURE_SECRET,
  IS_LOCAL_BASE,
  RESEND_API_KEY,
  TRUSTED_ORIGINS,
  WEBMASTER_FROM,
  WEBMASTER_PASSWORD,
  WEBMASTER_REPLY_TO,
} from "./config.ts";
import { handleInvites, handleProjects } from "./projects.ts";
import { handleEvent, specFromRow } from "./events-api.ts";
import { handleCollab } from "./collab-api.ts";
import { mailer } from "./mail.ts";
import { WebmasterPortal, resendSender } from "./webmaster.ts";
import { HTML_CSP, PLAY_CSP, PLAY_PWA_FILES, REINSTALL_CSP, TERMINAL_CSP, appRelPath, pickJoinBase, subAppRoute, wantsModRead } from "./routing.ts";

const PORT = Number(process.env.LOOM_PORT ?? 7000);
const HOST = process.env.LOOM_HOST ?? "0.0.0.0";

// Restart-recovery state lives here; override with LOOM_STATE_DIR.
const STATE_DIR = process.env.LOOM_STATE_DIR ?? fileURLToPath(new URL("./.loom-state/", import.meta.url));
const store = new Store(STATE_DIR);

// Passcodes: env override → persisted (stable across restarts) → fresh.
const PASS = resolvePasscodes(process.env, store.loadCodes());
store.saveCodes(PASS);

// The default scenario is a multi-file project under `examples/`; the loader
// concatenates `main.loom` + the rest into one source (identical to bundling
// the files separately) so the journal-replay store keeps a single string.
const DEFAULT_SCENARIO = scenarioSource("trapped-in-the-internet");

// The built participant app (`loom-play`). Defaults to the sibling
// package's `dist/`; override with LOOM_APP_DIST (absolute path).
const APP_DIST = process.env.LOOM_APP_DIST
  ? pathToFileURL(process.env.LOOM_APP_DIST.replace(/\/?$/, "/"))
  : new URL("../../play/dist/", import.meta.url);

// The built wall-terminal app (`loom-terminal`), served under `/terminal/`.
// Defaults to the sibling package's `dist/`; override with LOOM_TERMINAL_DIST.
const TERMINAL_DIST = process.env.LOOM_TERMINAL_DIST
  ? pathToFileURL(process.env.LOOM_TERMINAL_DIST.replace(/\/?$/, "/"))
  : new URL("../../terminal/dist/", import.meta.url);

// The built reinstallation web game (`loom-reinstall`), served under
// `/reinstall/` (and its map page at `/reinstall/map`). Defaults to the
// sibling package's `dist/`; override with LOOM_REINSTALL_DIST.
const REINSTALL_DIST = process.env.LOOM_REINSTALL_DIST
  ? pathToFileURL(process.env.LOOM_REINSTALL_DIST.replace(/\/?$/, "/"))
  : new URL("../../reinstall/web/dist/", import.meta.url);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webmanifest": "application/manifest+json",
};

/** Serve a file from a built app dir; returns false if it isn't there. */
function serveAppFile(pathname: string, res: ServerResponse, dist: URL = APP_DIST, csp: string = HTML_CSP, noCache = false): boolean {
  const rel = appRelPath(pathname);
  if (rel === null) return false;
  try {
    const buf = readFileSync(new URL(rel, dist));
    const ext = rel.slice(rel.lastIndexOf("."));
    const headers: Record<string, string> = { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" };
    if (ext === ".html") headers["content-security-policy"] = csp;
    if (noCache) headers["cache-control"] = "no-cache";
    res.writeHead(200, headers);
    res.end(buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * Base URL for guest join QRs: `LOOM_BASE_URL` on a public deployment,
 * else the best LAN-reachable address. A QR built from the console's
 * `location.origin` is `http://localhost:…` when the operator opened the
 * console locally — useless to a phone (localhost is the phone itself).
 */
function joinBase(): string {
  return pickJoinBase(process.env.LOOM_BASE_URL, lanUrls(PORT));
}

// The program directory: Wikipedia, for the cast's profile pictures and
// the guests' "be any software" search. `LOOM_WIKI=off` keeps the server
// off the internet (pictures then come only from authored `avatar:` links).
const wiki = process.env.LOOM_WIKI === "off" ? null : new WikiClient();
// Profile pictures, kept on disk once fetched: the cast's hand-picked
// pictures download when a story loads and survive restarts + outages.
const images = new ImageCache({ dir: join(STATE_DIR, "pictures") });

// The webmaster outbox at `/webmaster/` — only with a password + a Resend key.
const webmaster =
  WEBMASTER_PASSWORD !== "" && RESEND_API_KEY !== ""
    ? new WebmasterPortal({
        password: WEBMASTER_PASSWORD,
        from: WEBMASTER_FROM,
        replyTo: WEBMASTER_REPLY_TO,
        secret: AUTH_SECRET,
        send: resendSender(RESEND_API_KEY),
        logPath: join(STATE_DIR, "webmaster-sent.json"),
        assetsDir: new URL("./webmaster/", import.meta.url),
        secure: BASE_URL.startsWith("https://"),
      })
    : null;

// The multi-tenant registry: one `EventRuntime` per live event, keyed by id.
const registry = new EventRegistry(STATE_DIR, joinBase, wiki, images);

// The default event journals to the state-dir root (not a sub-directory) so
// an existing single-event deployment recovers its `.loom-state/` in place.
// It's reachable both at the root paths (back-compat: the operator console +
// the current participant app) and at `/e/default`.
const defaultEvent = registry.register(
  new EventRuntime({
    eventId: "default",
    store,
    codes: PASS,
    scenarioName: "trapped-in-the-internet",
    scenarioSource: DEFAULT_SCENARIO,
    joinBase,
    wiki,
    images,
    ...(process.env.LOOM_FACTS !== undefined ? { factsFile: process.env.LOOM_FACTS } : {}),
  }),
);

// ---------------------------------------------------------------------
// Control plane (author accounts + projects + events) — needs a database.
// The event plane above runs without one; if the DB is unreachable the
// control plane stays disabled and its routes answer 503, so a LAN-only
// deployment is unaffected.
// ---------------------------------------------------------------------

const authHandler = toNodeHandler(auth);
let controlPlane = false;

async function initControlPlane(): Promise<void> {
  // Author sessions are signed with AUTH_SECRET. Booting real accounts on
  // the well-known dev secret would let anyone forge a session, so outside
  // a localhost dev setup the control plane refuses to start without one.
  if (!HAS_SECURE_SECRET && (!IS_LOCAL_BASE || process.env.NODE_ENV === "production")) {
    process.stderr.write(
      `  🛑 control plane disabled — refusing to run author accounts with the default dev auth secret.\n` +
        `     Set BETTER_AUTH_SECRET (e.g. \`openssl rand -base64 32\`) and restart. The event plane still runs.\n`,
    );
    return;
  }
  if (!(await dbReady())) {
    process.stderr.write(`  ⚠️  control plane disabled — database unreachable at ${DATABASE_URL}\n`);
    return;
  }
  if (!HAS_SECURE_SECRET) {
    process.stderr.write(`  ⚠️  using the default dev auth secret — set BETTER_AUTH_SECRET before deploying\n`);
  }
  await migrateAuth();
  await initSchema();
  controlPlane = true;
  const mail = mailer().kind;
  process.stdout.write(
    mail === "none"
      ? `  ✉️  no mail transport (set LOOM_SMTP_URL or LOOM_RESEND_API_KEY) — share invites are logged, not emailed\n`
      : `  ✉️  mail via ${mail}\n`,
  );
  process.stdout.write(
    webmaster !== null
      ? `  📮 webmaster outbox at /webmaster/ (from ${WEBMASTER_FROM})\n`
      : `  📮 webmaster outbox off (set LOOM_WEBMASTER_PASSWORD + LOOM_RESEND_API_KEY)\n`,
  );
  // Rehydrate every event that was live before this process started: replay
  // its journal and (for open ones) restart its clock — the multi-event
  // generalization of the default event's `restore()`.
  let rehydrated = 0;
  for (const row of await liveEvents()) {
    registry.ensure(specFromRow(row));
    rehydrated++;
  }
  if (rehydrated > 0) process.stdout.write(`  ↻ Rehydrated ${rehydrated} live event(s) from the database\n`);
}

// ---------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------

const server = createServer((req, res) => {
  void route(req, res).catch((err) => {
    if (err instanceof PayloadTooLarge) {
      if (!res.headersSent) sendJson(res, 413, { error: "request body too large" });
      return;
    }
    // Log the real error server-side; never echo internals to the client.
    console.error("request failed:", err);
    if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
  });
});

// Cross-origin callers must be on the trusted list (Vite dev servers +
// LOOM_TRUSTED_ORIGINS). Same-origin traffic — the served play app, QR join
// links, a reverse-proxied deployment — sends no Origin or its own, and
// needs no CORS at all.
const TRUSTED = new Set(TRUSTED_ORIGINS);

// Route-level throttles (per client IP): `/api/resolve-code` is a code
// oracle (any valid code → its event), `/api/qr` renders attacker-chosen
// content. Both are cheap to call and deserve a ceiling. The resolve
// ceiling is `LOOM_RL_RESOLVE` (house Wi-Fi = one shared IP at the door).
const resolveLimiter = limiterFor(rateLimitsFromEnv(process.env).resolve);
const qrLimiter = new RateLimiter(60, 60_000);

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // Baseline security headers on every response.
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  if (BASE_URL.startsWith("https://")) {
    res.setHeader("strict-transport-security", "max-age=31536000");
  }
  const origin = req.headers.origin;
  if (origin !== undefined && TRUSTED.has(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
  }

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-headers": "content-type, x-loom-token",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    });
    res.end();
    return;
  }

  // --- author auth plane (BetterAuth owns everything under /api/auth) ---
  if (path.startsWith("/api/auth")) {
    if (!controlPlane) return void sendJson(res, 503, { error: "authoring is offline (no database)" });
    await authHandler(req, res);
    return;
  }

  // --- collaboration invite links (landing data is readable signed-out) ---
  if (path.startsWith("/api/invites/")) {
    if (!controlPlane) return void sendJson(res, 503, { error: "authoring is offline (no database)" });
    if (await handleInvites(res, method, path, await authUser(req))) return;
    return void sendJson(res, 404, { error: "not found" });
  }

  // --- author control plane: projects + files + events (authors only) ---
  if (path === "/api/projects" || path.startsWith("/api/projects/")) {
    if (!controlPlane) return void sendJson(res, 503, { error: "authoring is offline (no database)" });
    const user = await authUser(req);
    if (user === null) return void sendJson(res, 401, { error: "sign in" });
    const segs = path.split("/").filter(Boolean); // ["api","projects",id,"event"|"collab",action?]
    if (segs.length >= 4 && segs[3] === "event") {
      if (await handleEvent(req, res, method, segs, user, { registry, joinBase })) return;
      return void sendJson(res, 404, { error: "not found" });
    }
    if (segs.length === 5 && segs[3] === "collab") {
      if (await handleCollab(req, res, method, segs, url, user)) return;
      return void sendJson(res, 404, { error: "not found" });
    }
    if (await handleProjects(req, res, method, path, user)) return;
    return void sendJson(res, 404, { error: "not found" });
  }

  // --- the webmaster outbox (password-gated; off unless configured) ---
  if (webmaster !== null && (await webmaster.handle(req, res, method, path, HTML_CSP))) return;

  // --- the built participant app (loom-play) at `/` + its static assets ---
  // Moderation now lives in the Loom editor's Run panel, not a standalone
  // console; guests + performers use this app.
  if (
    method === "GET" &&
    (path === "/" || path === "/index.html" || path.startsWith("/assets/") || path === "/favicon.ico" || PLAY_PWA_FILES.has(path))
  ) {
    // The HTML shell is no-cache too, so a phone picks up a new build (and
    // its service worker) on the next open.
    const shell = path === "/" || path === "/index.html";
    if (serveAppFile(path, res, APP_DIST, PLAY_CSP, shell || PLAY_PWA_FILES.has(path))) return;
    if (PLAY_PWA_FILES.has(path)) return void sendJson(res, 404, { error: "not found" });
    // Not built yet — a plain hint rather than a blank page.
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": HTML_CSP });
    res.end(
      `<!doctype html><meta charset=utf-8><title>Loom</title>` +
        `<body style="font:16px system-ui;background:#0b0d12;color:#e7ecf3;padding:2rem">` +
        `<h1>Loom event server</h1><p>The participant app isn't built yet. Run ` +
        `<code>pnpm --filter loom-play build</code> (or <code>cd ../play && pnpm dev</code> for live dev on :5174).</p>`,
    );
    return;
  }

  // --- the built wall-terminal app (loom-terminal) at `/terminal/` ---
  // Direct lines to an agent-voiced character on tablets mounted around the
  // house. Same event server, same threads: a terminal pilots a scanned
  // guest through `/api/mod/impersonate`, so what is said there is the
  // guest's own DM. Built with `--base=/terminal/`.
  const terminalRoute = method === "GET" ? subAppRoute(path, "/terminal", url.search) : null;
  if (terminalRoute !== null) {
    if ("redirect" in terminalRoute) {
      res.writeHead(302, { location: terminalRoute.redirect });
      res.end();
      return;
    }
    if (serveAppFile(terminalRoute.file, res, TERMINAL_DIST, TERMINAL_CSP)) return;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": HTML_CSP });
    res.end(
      `<!doctype html><meta charset=utf-8><title>Loom terminal</title>` +
        `<body style="font:16px system-ui;background:#0b0d12;color:#e7ecf3;padding:2rem">` +
        `<h1>Loom terminal</h1><p>The terminal app isn't built yet. Run ` +
        `<code>pnpm --filter loom-terminal build</code> (or <code>cd ../terminal && pnpm dev</code> for live dev on :5175).</p>`,
    );
    return;
  }

  // --- the built reinstallation web game (loom-reinstall) at `/reinstall/` ---
  // The tent tablet's game (a virtual copy of the house; find the golden
  // duck) and the directors' map page (`/reinstall/map`). Talks to the
  // event's `/api/spatial/*` + `/api/mod/spatial/*`. Built with
  // `--base=/reinstall/`.
  const reinstallRoute = method === "GET" ? subAppRoute(path, "/reinstall", url.search) : null;
  if (reinstallRoute !== null) {
    if ("redirect" in reinstallRoute) {
      res.writeHead(302, { location: reinstallRoute.redirect });
      res.end();
      return;
    }
    if (serveAppFile(reinstallRoute.file, res, REINSTALL_DIST, REINSTALL_CSP)) return;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": HTML_CSP });
    res.end(
      `<!doctype html><meta charset=utf-8><title>Loom reinstallation</title>` +
        `<body style="font:16px system-ui;background:#0b0d12;color:#e7ecf3;padding:2rem">` +
        `<h1>Reinstallation</h1><p>The web game isn't built yet. Run ` +
        `<code>pnpm --filter loom-reinstall build</code>.</p>`,
    );
    return;
  }

  // --- QR code for a join URL / guest pass ---
  if (method === "GET" && path === "/api/qr") {
    if (!qrLimiter.take(ipOf(req))) return void sendJson(res, 429, { error: "slow down" });
    const text = (url.searchParams.get("text") ?? "").slice(0, 300);
    const svg = await QRCode.toString(text || " ", { type: "svg", margin: 1, width: 240 });
    res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" });
    res.end(svg);
    return;
  }

  // --- the bare landing's branding (no code): the one open event's title +
  // theme, so `/` reads "Trapped in the Internet", not "Loom" ---
  if (method === "GET" && path === "/api/landing") {
    return void sendJson(res, 200, registry.landing() ?? { title: null, theme: null });
  }

  // --- public bootstrap: a short passcode → which event + role it grants ---
  // A guest/performer/moderator knows only their code; this tells the client
  // which `/e/:eventId` to talk to before it registers or signs in.
  // Throttled: this is the one endpoint that confirms a code is valid.
  if (method === "POST" && path === "/api/resolve-code") {
    if (!resolveLimiter.take(ipOf(req))) return void sendJson(res, 429, { error: "too many attempts — slow down" });
    const body = await readBody(req);
    const hit = registry.resolveCode(str(body, "code"));
    if (hit === null) return void sendJson(res, 404, { error: "no event with that code" });
    return void sendJson(res, 200, hit);
  }

  // --- event-scoped routes under /e/:eventId ---
  if (path.startsWith("/e/")) {
    const rest = path.slice(3);
    const slash = rest.indexOf("/");
    const eventId = slash === -1 ? rest : rest.slice(0, slash);
    const subPath = slash === -1 ? "/" : rest.slice(slash);
    const runtime = registry.get(eventId);
    if (runtime === undefined) return void sendJson(res, 404, { error: "unknown event" });
    // The writing team moderates via their sessions — no mod code needed:
    // the owning author AND every collaborator invited onto the project.
    // That covers the mod POST routes AND the gated mod reads (the SSE
    // stream, /api/state, /api/history), so the editor's Run/Deploy modes
    // work on the session cookie alone.
    let moderator = false;
    let moderatorName: string | undefined;
    // (The spatial map + stream also accept a game's session token; the
    // author session lets the editor read them too.)
    if (controlPlane && (subPath.startsWith("/api/mod/") || wantsModRead(subPath, url.searchParams))) {
      const user = await authUser(req);
      if (user !== null) {
        moderator = await canModerateEvent(eventId, user.id);
        if (moderator) moderatorName = user.name || user.email;
      }
    }
    if (await runtime.handle(req, res, method, subPath, url, { moderator, moderatorName })) return;
    return void sendJson(res, 404, { error: "not found" });
  }

  // --- back-compat: bare event routes target the default event ---
  if (await defaultEvent.handle(req, res, method, path, url)) return;

  sendJson(res, 404, { error: "not found" });
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

const restored = defaultEvent.restore();
void initControlPlane();

server.listen(PORT, HOST, () => {
  const urls = lanUrls(PORT);
  let appBuilt = true;
  try {
    readFileSync(new URL("index.html", APP_DIST));
  } catch {
    appBuilt = false;
  }
  process.stdout.write(`\n  Loom event server — "${defaultEvent.scenario}"  (phase: ${defaultEvent.currentPhase})\n\n`);
  process.stdout.write(`  Passcodes — share with the room:\n`);
  process.stdout.write(`    🎟️  Guest event code  : ${PASS.event}\n`);
  process.stdout.write(`    🎭  Performer passcode: ${PASS.prime}\n`);
  process.stdout.write(`    🛡️  Moderator passcode: ${PASS.mod}\n`);
  process.stdout.write(`    (moderate from the Loom editor's Run panel; also saved to ${STATE_DIR}/codes.json)\n\n`);
  if (restored) {
    process.stdout.write(
      `  ↻ Restored ${restored.guests} guest(s), ${restored.events} event(s), ${restored.sessions} live session(s) from ${STATE_DIR}\n\n`,
    );
  }
  for (const u of urls) process.stdout.write(`  → ${u}  (participant app)\n`);
  process.stdout.write(`\n`);
  if (appBuilt) {
    process.stdout.write(`  Guests + performers use the app at /. Authors moderate from the editor's Run panel (⌘2).\n\n`);
  } else {
    process.stdout.write(`  ⚠️  participant app not built — run \`pnpm --filter loom-play build\`\n`);
    process.stdout.write(`     (or for live dev: \`cd ../play && pnpm dev\` and use :5174).\n\n`);
  }
});

function lanUrls(port: number): string[] {
  const out = [`http://localhost:${port}`];
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) out.push(`http://${net.address}:${port}`);
    }
  }
  return out;
}
