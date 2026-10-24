//! The moderator session `showctl` talks to the event server with.
//!
//! The recipe (`core/server/server.ts` `/api/resolve-code`,
//! `event-runtime.ts` `/api/mod/login`): a MOD passcode resolves to an
//! event id (`POST /api/resolve-code`, no token, throttled per IP by
//! `LOOM_RL_RESOLVE`), then `POST /e/<id>/api/mod/login {passcode}` answers
//! a session token, sent from then on as the `x-loom-token` header — never
//! in a URL, where a proxy log would keep it.
//!
//! Both answers are cached per user, keyed by a hash of server + code (the
//! code itself is never written down), so a `doctor --watch` on show night
//! costs one resolve and one login for the whole night instead of one per
//! refresh. A login that sends the cached token **upgrades that session in
//! place** (`sessions.grant`) instead of minting a new one, so re-logins
//! never pile up sessions in the event's `sessions.json`. On a 403 the
//! client logs in again once (an event restart drops tokens); on a 404
//! `unknown event` it resolves the code again once (the event ended and the
//! code moved to a relaunch); on a 503 `starting` (the VPS still booting,
//! `boot.ts` `missEvent`) it waits the server's `retry-after` (≤ 5 s) and
//! asks once more. Any other 503 (`event failed to load`) goes to the
//! command as it is: waiting won't fix it.
//!
//! `fetch` is injectable: the tests drive the whole recipe on a fake.

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The slice of `fetch` this client uses (the real one fits; tests fake it). */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

/** An answer: the status and the parsed JSON body (null when not JSON). */
export interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T | null;
  /** The raw text (for `?format=text` and error messages). */
  text: string;
  /** The `retry-after` header in seconds, when the server sent one. */
  retryAfter?: number;
}

/** A failure a command should report rather than crash on. */
export class ShowError extends Error {
  /** What was being read when it failed (`POST /api/resolve-code`). */
  readonly read: string;
  constructor(message: string, read: string) {
    super(message);
    this.read = read;
  }
}

/** One cached session: which event the code resolved to, and its token. */
export interface CachedSession {
  eventId: string;
  token: string | null;
  /** The event's display title, for headers. */
  title?: string;
  /** When it was written (epoch ms). */
  at: number;
}

/** Where the per-user cache lives: `SHOWCTL_CACHE` if set, else
 *  `%APPDATA%\loom\showctl-sessions.json` on Windows,
 *  `$XDG_CONFIG_HOME/loom/…` or `~/.config/loom/…` elsewhere. */
export function defaultCachePath(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string {
  if (env["SHOWCTL_CACHE"]) return env["SHOWCTL_CACHE"];
  const base = platform === "win32" ? (env["APPDATA"] ?? join(homedir(), "AppData", "Roaming")) : (env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"));
  return join(base, "loom", "showctl-sessions.json");
}

/** The cache key: a hash of the server origin and the code, so the file
 *  never holds a passcode (only a token, which it must). */
export function cacheKey(server: string, code: string): string {
  return createHash("sha256").update(`${normalizeServer(server)}\n${code.trim()}`).digest("hex").slice(0, 32);
}

/** `https://app.example.com/` → `https://app.example.com` (no trailing slash). */
export function normalizeServer(server: string): string {
  return server.trim().replace(/\/+$/u, "");
}

/** Read the whole cache (a missing or broken file is an empty cache). */
export function readCache(path: string): Record<string, CachedSession> {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, CachedSession>) : {};
  } catch {
    return {};
  }
}

/** Write one entry (atomically; owner-only on POSIX). A cache that can't be
 *  written only costs a fresh login next time, so failures are swallowed. */
export function writeCacheEntry(path: string, key: string, entry: CachedSession | null): void {
  try {
    const all = readCache(path);
    if (entry === null) delete all[key];
    else all[key] = entry;
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, path);
    try {
      chmodSync(path, 0o600);
    } catch {
      /* Windows: ACLs, not modes */
    }
  } catch {
    /* best effort */
  }
}

export interface ClientOptions {
  server: string;
  /** The MOD passcode (`LOOM_MOD_CODE`); empty → only `/api/health` works. */
  code: string;
  fetch?: FetchLike;
  cachePath?: string;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
  now?: () => number;
  /** How to wait out a `retry-after` (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

/** A moderator session against one event server. */
export class ShowClient {
  readonly server: string;
  readonly code: string;
  private readonly fetchImpl: FetchLike;
  private readonly cachePath: string;
  private readonly key: string;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private session: CachedSession | null = null;
  /** How many resolve / login calls this run made (tests + `--json`). */
  readonly calls = { resolve: 0, login: 0 };

  constructor(opts: ClientOptions) {
    this.server = normalizeServer(opts.server);
    this.code = opts.code.trim();
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.cachePath = opts.cachePath ?? defaultCachePath();
    this.key = cacheKey(this.server, this.code);
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  }

  /** The resolved event id (after `connect`). */
  get eventId(): string | null {
    return this.session?.eventId ?? null;
  }

  /** The event's title (after `connect`). */
  get title(): string | null {
    return this.session?.title ?? null;
  }

  /** One raw request against the server (no auth handling). */
  async raw(method: string, path: string, body?: unknown, token?: string | null): Promise<Reply> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers["x-loom-token"] = token;
    let res;
    try {
      res = await this.fetchImpl(`${this.server}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const why = err instanceof Error ? (err.name === "TimeoutError" ? `no answer in ${this.timeoutMs / 1000} s` : (err.cause instanceof Error ? err.cause.message : err.message)) : String(err);
      throw new ShowError(`can't reach ${this.server}: ${why}`, `${method} ${path}`);
    }
    const text = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      const j = JSON.parse(text) as unknown;
      if (j !== null && typeof j === "object") parsed = j as Record<string, unknown>;
    } catch {
      /* not JSON (a text recap, a proxy's HTML error page) */
    }
    const ra = Number(res.headers.get("retry-after") ?? NaN);
    return { status: res.status, body: parsed, text, ...(Number.isFinite(ra) && ra >= 0 ? { retryAfter: ra } : {}) };
  }

  /** Resolve the code to its event (`POST /api/resolve-code`). */
  private async resolve(): Promise<{ eventId: string; title?: string }> {
    if (this.code === "") throw new ShowError("no moderator passcode: set LOOM_MOD_CODE (or pass --code)", "env LOOM_MOD_CODE");
    this.calls.resolve++;
    const r = await this.raw("POST", "/api/resolve-code", { code: this.code });
    const read = "POST /api/resolve-code";
    if (r.status === 429) throw new ShowError("the server is rate-limiting code lookups from this IP — wait a minute", read);
    if (r.status === 503) throw new ShowError(`the server is ${String(r.body?.["error"] ?? "starting")} — try again in a few seconds`, read);
    if (r.status === 404) throw new ShowError("no event has that code (wrong LOOM_MOD_CODE, or the event ended)", read);
    if (r.status !== 200 || r.body === null) throw new ShowError(`resolve-code answered ${r.status}`, read);
    if (r.body["role"] !== "mod") throw new ShowError(`that code is a ${String(r.body["role"])} code, not the moderator passcode`, read);
    const title = typeof r.body["title"] === "string" ? r.body["title"] : undefined;
    return { eventId: String(r.body["eventId"]), ...(title !== undefined ? { title } : {}) };
  }

  /** Log in, sending the cached token so the session is upgraded, not minted. */
  private async login(eventId: string, title: string | undefined, prior: string | null): Promise<CachedSession> {
    this.calls.login++;
    const path = `/e/${encodeURIComponent(eventId)}/api/mod/login`;
    const r = await this.raw("POST", path, { passcode: this.code }, prior);
    if (r.status === 403) throw new ShowError("the event refused the moderator passcode", `POST ${path}`);
    if (r.status === 429) throw new ShowError("too many logins from this IP — wait a minute", `POST ${path}`);
    if (r.status !== 200 || typeof r.body?.["token"] !== "string") throw new ShowError(`mod login answered ${r.status}`, `POST ${path}`);
    const s: CachedSession = { eventId, token: r.body["token"], at: this.now(), ...(title !== undefined ? { title } : {}) };
    writeCacheEntry(this.cachePath, this.key, s);
    return s;
  }

  /** Make sure we hold an event id and a token (cache first). */
  async connect(): Promise<void> {
    if (this.session?.token) return;
    const cached = readCache(this.cachePath)[this.key];
    if (cached !== undefined && typeof cached.eventId === "string" && cached.eventId !== "") {
      this.session = cached;
      if (cached.token) return;
    }
    const ev = this.session ?? (await this.resolve());
    this.session = await this.login(ev.eventId, ev.title, this.session?.token ?? null);
  }

  /** An event-scoped request (`/e/<id><path>`) with the token; re-logs in
   *  once on a 403, re-resolves once on a 404 `unknown event`, waits and
   *  asks again once on a 503 `starting`. */
  async request(method: string, path: string, body?: unknown): Promise<Reply> {
    await this.connect();
    const once = () => this.raw(method, `/e/${encodeURIComponent(this.session!.eventId)}${path}`, body, this.session!.token);
    let r = await once();
    if (r.status === 503 && r.body?.["error"] === "starting") {
      await this.sleep(Math.min(5, r.retryAfter ?? 1) * 1000);
      r = await once();
    }
    if (r.status === 403 && /moderators only/u.test(String(r.body?.["error"] ?? ""))) {
      this.session = await this.login(this.session!.eventId, this.session!.title, this.session!.token);
      r = await once();
    } else if (r.status === 404 && r.body?.["error"] === "unknown event") {
      writeCacheEntry(this.cachePath, this.key, null);
      const ev = await this.resolve();
      this.session = await this.login(ev.eventId, ev.title, null);
      r = await once();
    }
    return r;
  }

  get(path: string): Promise<Reply> {
    return this.request("GET", path);
  }

  post(path: string, body: unknown): Promise<Reply> {
    return this.request("POST", path, body);
  }
}
