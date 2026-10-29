//! Trabolta's letters go out through Resend as the webmaster's address
//! (wave 41, `docs/loom-w41-contract.md` C6): `LOOM_RESEND_API_KEY` +
//! `LOOM_WEBMASTER_FROM` (webmaster@mapsandducks.com on the VPS), shown as
//! `Jean Trabolta <…>`, Reply-To `LOOM_WEBMASTER_REPLY_TO` else the From
//! address. No key or no usable address → null: Run's Send stays off.

import { RESEND_API_KEY, WEBMASTER_FROM, WEBMASTER_REPLY_TO } from "./config.ts";
import { emailOf, letterFrom, type LettersMailer } from "./letters.ts";
import { resendSender, textToHtml } from "./webmaster.ts";

export function lettersMailerOf(env: { apiKey: string; from: string; replyTo: string }, fetchImpl: typeof fetch = fetch): LettersMailer | null {
  if (env.apiKey === "") return null;
  const from = letterFrom(env.from);
  if (from === null) return null;
  const replyTo = emailOf(env.replyTo) ?? from.slice(from.indexOf("<") + 1, -1);
  const send = resendSender(env.apiKey, fetchImpl);
  return { from, replyTo, send: (msg) => send(msg), html: textToHtml };
}

/** The process environment's mailer (null when mail is off). */
export function lettersMailerFromEnv(): LettersMailer | null {
  return lettersMailerOf({ apiKey: RESEND_API_KEY, from: WEBMASTER_FROM, replyTo: WEBMASTER_REPLY_TO });
}
