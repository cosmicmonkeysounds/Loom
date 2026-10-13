//! The webmaster's outbox — a tiny password-gated page at `/webmaster/`
//! for sending mail as `LOOM_WEBMASTER_FROM` (e.g. webmaster@mapsandducks.com)
//! through Resend. Not part of the author control plane: no database, no
//! account, one shared password (`LOOM_WEBMASTER_PASSWORD`). Unset password
//! or API key → the whole surface 404s.
//!
//! Sign-in mints an HMAC'd, expiring cookie scoped to `/webmaster` (HttpOnly,
//! SameSite=Strict); the key folds in the password, so changing it signs
//! everyone out. Failed sign-ins are throttled per IP. Each recipient gets
//! their own copy (nobody sees the guest list), and every send is appended
//! to a small JSON log in the state dir that the page lists.
//!
//! Transport-free and clock-injectable: `handle` takes plain node req/res,
//! `send` is injected (Resend's REST API by default), so it is unit-tested
//! without a network.

import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname } from "node:path";

import { ipOf, readBody, sendJson, str } from "./http-util.ts";
import { escapeHtml } from "./mail.ts";
import { RateLimiter } from "./rate-limit.ts";

export const WEBMASTER_PREFIX = "/webmaster";
const COOKIE = "wm_session";
const SESSION_MS = 12 * 60 * 60_000;
const MAX_RECIPIENTS = 100;
const MAX_LOG = 300;
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** One outgoing message, already rendered. */
export interface Outgoing {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
}

export interface SentEntry {
  at: number;
  to: string;
  subject: string;
  ok: boolean;
  error?: string;
  id?: string;
}

export interface WebmasterConfig {
  password: string;
  from: string;
  /** Default reply-to (the from address when blank). */
  replyTo?: string;
  /** Server secret folded into the cookie HMAC. */
  secret: string;
  /** Delivers one message; resolves to the provider's id. */
  send: (msg: Outgoing) => Promise<string | undefined>;
  /** Where the sent log lives; null keeps it in memory only. */
  logPath: string | null;
  /** Static page files (index.html / app.js / style.css). */
  assetsDir: URL;
  secure: boolean;
  now?: () => number;
}

/** Resend's REST API (https://resend.com/docs/api-reference/emails/send-email). */
export function resendSender(apiKey: string, fetchImpl: typeof fetch = fetch): WebmasterConfig["send"] {
  return async (msg) => {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: msg.from,
        to: [msg.to],
        reply_to: msg.replyTo,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
    return body.id;
  };
}

/** Split a pasted recipient list (commas, semicolons, newlines, `Name <a@b>`). */
export function parseRecipients(raw: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\n]+/)) {
    const t = part.trim();
    if (t === "") continue;
    const addr = (t.match(/<([^>]+)>\s*$/)?.[1] ?? t).trim();
    if (!EMAIL_RE.test(addr)) {
      invalid.push(t);
      continue;
    }
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(addr);
  }
  return { valid, invalid };
}

/** Plain text → simple HTML: paragraphs, line breaks, clickable links. */
export function textToHtml(text: string): string {
  const linkify = (s: string): string =>
    s.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)"']/g, (url) => `<a href="${url}">${url}</a>`);
  const paras = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => `<p>${linkify(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`);
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:36rem;line-height:1.5">${paras.join("")}</div>`;
}

export class WebmasterPortal {
  private readonly failures = new RateLimiter(10, 15 * 60_000);
  private readonly sends = new RateLimiter(500, 60 * 60_000);
  private readonly now: () => number;
  private log: SentEntry[] = [];

  constructor(private readonly cfg: WebmasterConfig) {
    this.now = cfg.now ?? Date.now;
    if (cfg.logPath !== null && existsSync(cfg.logPath)) {
      try {
        const parsed = JSON.parse(readFileSync(cfg.logPath, "utf8")) as unknown;
        if (Array.isArray(parsed)) this.log = parsed as SentEntry[];
      } catch {
        // A torn log is not worth refusing to boot over.
      }
    }
  }

  /** The sent log, newest first. */
  sent(): readonly SentEntry[] {
    return this.log;
  }

  // --- the session cookie ------------------------------------------------

  private sign(exp: number): string {
    return createHmac("sha256", `${this.cfg.secret}\0${this.cfg.password}`).update(`webmaster:${exp}`).digest("base64url");
  }

  /** A fresh cookie value. */
  mintSession(): string {
    const exp = this.now() + SESSION_MS;
    return `${exp}.${this.sign(exp)}`;
  }

  /** Is this cookie value a live session? */
  validSession(value: string | undefined): boolean {
    if (value === undefined) return false;
    const [expRaw, mac] = value.split(".");
    const exp = Number(expRaw);
    if (!Number.isFinite(exp) || exp < this.now() || mac === undefined) return false;
    const want = Buffer.from(this.sign(exp));
    const got = Buffer.from(mac);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  private passwordMatches(guess: string): boolean {
    const h = (s: string) => createHmac("sha256", "webmaster-password").update(s).digest();
    return timingSafeEqual(h(guess), h(this.cfg.password));
  }

  private cookie(value: string, maxAgeS: number): string {
    return [
      `${COOKIE}=${value}`,
      `Path=${WEBMASTER_PREFIX}`,
      `Max-Age=${maxAgeS}`,
      "HttpOnly",
      "SameSite=Strict",
      ...(this.cfg.secure ? ["Secure"] : []),
    ].join("; ");
  }

  // --- sending -----------------------------------------------------------

  /** Send one copy per recipient; returns a per-recipient report. */
  async sendAll(input: { to: string; subject: string; body: string; replyTo?: string }): Promise<{
    results: SentEntry[];
    invalid: string[];
  }> {
    const { valid, invalid } = parseRecipients(input.to);
    const replyTo = input.replyTo?.trim() || this.cfg.replyTo || this.cfg.from;
    const html = textToHtml(input.body);
    const results: SentEntry[] = [];
    for (const to of valid) {
      const entry: SentEntry = { at: this.now(), to, subject: input.subject, ok: false };
      try {
        entry.id = await this.cfg.send({ from: this.cfg.from, to, replyTo, subject: input.subject, text: input.body, html });
        entry.ok = true;
      } catch (err) {
        entry.error = err instanceof Error ? err.message : String(err);
      }
      results.push(entry);
    }
    this.log = [...results.slice().reverse(), ...this.log].slice(0, MAX_LOG);
    this.persist();
    return { results, invalid };
  }

  private persist(): void {
    if (this.cfg.logPath === null) return;
    try {
      mkdirSync(dirname(this.cfg.logPath), { recursive: true });
      writeFileSync(this.cfg.logPath, JSON.stringify(this.log));
    } catch (err) {
      console.error("webmaster: could not write the sent log:", err);
    }
  }

  // --- routing -------------------------------------------------------------

  /** Handle a request under `/webmaster`; false when the path isn't ours. */
  async handle(req: IncomingMessage, res: ServerResponse, method: string, path: string, csp: string): Promise<boolean> {
    if (path !== WEBMASTER_PREFIX && !path.startsWith(`${WEBMASTER_PREFIX}/`)) return false;
    const sub = path.slice(WEBMASTER_PREFIX.length) || "/";

    if (method === "GET" && sub === "/" && path === WEBMASTER_PREFIX) {
      res.writeHead(302, { location: `${WEBMASTER_PREFIX}/` });
      res.end();
      return true;
    }
    if (method === "GET" && (sub === "/" || sub === "/app.js" || sub === "/style.css")) {
      const file = sub === "/" ? "index.html" : sub.slice(1);
      const type = file.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : file.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "text/html; charset=utf-8";
      const headers: Record<string, string> = { "content-type": type, "cache-control": "no-cache" };
      if (file === "index.html") headers["content-security-policy"] = csp;
      res.writeHead(200, headers);
      res.end(readFileSync(new URL(file, this.cfg.assetsDir)));
      return true;
    }

    const session = cookieOf(req, COOKIE);
    const authed = this.validSession(session);

    if (sub === "/api/me" && method === "GET") {
      sendJson(res, 200, { signedIn: authed, from: this.cfg.from, replyTo: this.cfg.replyTo || this.cfg.from });
      return true;
    }
    if (sub === "/api/login" && method === "POST") {
      const ip = ipOf(req);
      if (!this.failures.allowed(ip, this.now())) {
        sendJson(res, 429, { error: "Too many wrong passwords. Try again in a few minutes." });
        return true;
      }
      const body = await readBody(req, 4096);
      if (!this.passwordMatches(str(body, "password"))) {
        this.failures.record(ip, this.now());
        sendJson(res, 401, { error: "Wrong password." });
        return true;
      }
      res.setHeader("set-cookie", this.cookie(this.mintSession(), SESSION_MS / 1000));
      sendJson(res, 200, { signedIn: true });
      return true;
    }
    if (sub === "/api/logout" && method === "POST") {
      res.setHeader("set-cookie", this.cookie("", 0));
      sendJson(res, 200, { signedIn: false });
      return true;
    }

    if (!authed) {
      sendJson(res, 401, { error: "Sign in first." });
      return true;
    }
    if (sub === "/api/sent" && method === "GET") {
      sendJson(res, 200, { sent: this.log });
      return true;
    }
    if (sub === "/api/send" && method === "POST") {
      const body = await readBody(req, 256 * 1024);
      const to = str(body, "to");
      const subject = str(body, "subject").trim();
      const text = str(body, "body");
      const { valid, invalid } = parseRecipients(to);
      if (valid.length === 0) return reply(res, 400, { error: "Add at least one valid address.", invalid });
      if (invalid.length > 0) return reply(res, 400, { error: `Not an email address: ${invalid.join(", ")}`, invalid });
      if (valid.length > MAX_RECIPIENTS) return reply(res, 400, { error: `At most ${MAX_RECIPIENTS} recipients at a time.` });
      if (subject === "") return reply(res, 400, { error: "Add a subject." });
      if (text.trim() === "") return reply(res, 400, { error: "The message is empty." });
      const replyTo = str(body, "replyTo").trim();
      if (replyTo !== "" && !EMAIL_RE.test(replyTo)) return reply(res, 400, { error: "The reply-to isn't an email address." });
      if (!this.sends.allowed("all", this.now())) return reply(res, 429, { error: "Sending limit reached for this hour." });
      for (let i = 0; i < valid.length; i++) this.sends.record("all", this.now());
      const out = await this.sendAll({ to, subject, body: text, replyTo });
      sendJson(res, 200, out);
      return true;
    }
    sendJson(res, 404, { error: "not found" });
    return true;
  }
}

/** `sendJson`, then true — for `return reply(…)` inside `handle`. */
function reply(res: ServerResponse, status: number, body: unknown): true {
  sendJson(res, status, body);
  return true;
}

/** One cookie's value off the request, or undefined. */
export function cookieOf(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (raw === undefined) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
