//! Outbound email for the control plane — today just collaboration invites.
//!
//! Three transports, chosen once from the environment (see `config.ts`):
//! SMTP via nodemailer, the Resend HTTP API via `fetch`, or a console
//! fallback that logs the message. The fallback is what keeps the invite
//! flow usable on a box with no mail provider: the API still mints the
//! invite link and the editor shows it to the owner to pass along by hand,
//! with `delivery: "none"` so the UI can say so honestly.
//!
//! Message *content* is built by pure functions (`inviteEmail`) so the copy
//! is unit-tested without a transport.

import nodemailer, { type Transporter } from "nodemailer";

import { MAIL_FROM, RESEND_API_KEY, SMTP_URL } from "./config.ts";

export interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** How a message went out: which transport, or `none` when only logged. */
export type Delivery = "smtp" | "resend" | "none";

export interface Mailer {
  readonly kind: Delivery;
  send(msg: Message): Promise<void>;
}

/** Escape text for interpolation into the HTML body. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface InviteEmailInput {
  /** The collaborator's address. */
  to: string;
  /** Display name (or email) of the author who shared the project. */
  inviterName: string;
  projectName: string;
  /** Deep link into the editor that accepts the invite (or just opens it). */
  url: string;
  /** True when the recipient already has an account and was added directly. */
  hasAccount: boolean;
}

/** The invite notification. Pure — same input, same message. */
export function inviteEmail(input: InviteEmailInput): Message {
  const { to, inviterName, projectName, url, hasAccount } = input;
  const subject = `${inviterName} shared “${projectName}” with you on Loom`;
  const action = hasAccount
    ? `Sign in and it's waiting under “Shared with you”.`
    : `Create a free author account with this email address and the project will be waiting for you.`;
  const text = [
    `${inviterName} invited you to collaborate on the Loom project “${projectName}”.`,
    ``,
    `You can edit the story and run its live events together. ${action}`,
    ``,
    `Open it here:`,
    url,
    ``,
    `If you weren't expecting this, you can ignore this email.`,
  ].join("\n");
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:32rem;line-height:1.5">`,
    `<p><strong>${escapeHtml(inviterName)}</strong> invited you to collaborate on the Loom project <strong>“${escapeHtml(projectName)}”</strong>.</p>`,
    `<p>You can edit the story and run its live events together. ${escapeHtml(action)}</p>`,
    `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:.6rem 1rem;border-radius:.5rem;text-decoration:none">Open “${escapeHtml(projectName)}”</a></p>`,
    `<p style="color:#71717a;font-size:.85em">Or paste this link into your browser:<br><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
    `<p style="color:#71717a;font-size:.85em">If you weren't expecting this, you can ignore this email.</p>`,
    `</div>`,
  ].join("");
  return { to, subject, text, html };
}

// --- transports -----------------------------------------------------------

class SmtpMailer implements Mailer {
  readonly kind = "smtp" as const;
  private readonly transport: Transporter;
  constructor(url: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(msg: Message): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
  }
}

/** Resend's REST API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendMailer implements Mailer {
  readonly kind = "resend" as const;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(msg: Message): Promise<void> {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`resend: HTTP ${res.status} ${detail}`.trim());
    }
  }
}

/** No provider configured: log the message so the link is still findable. */
export class ConsoleMailer implements Mailer {
  readonly kind = "none" as const;
  constructor(private readonly log: (line: string) => void = (l) => process.stdout.write(l)) {}
  async send(msg: Message): Promise<void> {
    this.log(`  ✉️  (no mail transport configured) would send to ${msg.to}: ${msg.subject}\n${indent(msg.text)}\n`);
  }
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `      ${l}`)
    .join("\n");
}

/** Build the transport the environment asks for. */
export function mailerFromEnv(env: { smtpUrl: string; resendApiKey: string; from: string }): Mailer {
  if (env.smtpUrl !== "") return new SmtpMailer(env.smtpUrl, env.from);
  if (env.resendApiKey !== "") return new ResendMailer(env.resendApiKey, env.from);
  return new ConsoleMailer();
}

let _mailer: Mailer | null = null;

/** The process-wide mailer (lazily built from `config.ts`). */
export function mailer(): Mailer {
  if (_mailer === null) _mailer = mailerFromEnv({ smtpUrl: SMTP_URL, resendApiKey: RESEND_API_KEY, from: MAIL_FROM });
  return _mailer;
}

/**
 * Send, but never let a mail failure break the API call that triggered it —
 * the membership/invite row is already committed; the owner just sees
 * `delivery: "none"` plus the link. Returns how it went out.
 */
export async function sendQuietly(msg: Message): Promise<Delivery> {
  const m = mailer();
  try {
    await m.send(msg);
    return m.kind;
  } catch (err) {
    console.error(`mail: failed to send to ${msg.to}:`, err);
    return "none";
  }
}
