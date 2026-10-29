//! Wave 41 (`docs/loom-w41-contract.md` C3, C5, C6): the letters routes,
//! split out of `EventRuntime` (which checks the caller first).
//!
//! - `GET /api/mod/letters` and `POST /api/mod/letters/{write,draft,send,forget}`:
//!   directors only, never on the host allowlist.
//! - `POST /api/agent/letter`: the writer's draft (moderators, like
//!   `/api/agent/judge`).
//! - `POST /api/prime/letter`: a performer's own inbox (their booth).

import type { ServerResponse } from "node:http";
import { str, sendJson } from "../http-util.ts";
import { emailOf, type LetterEntry, type LettersBook, type LettersMailer, type LettersView } from "../letters.ts";

export const LETTERS_ROUTES = ["/api/mod/letters", "/api/mod/letters/write", "/api/mod/letters/draft", "/api/mod/letters/send", "/api/mod/letters/forget"] as const;

export interface LettersContext {
  book: LettersBook;
  mailer: LettersMailer | null;
  /** The writer character and whether a worker voicing it is online. */
  writer: () => { character: string; online: boolean } | null;
  /** A row's name now (the program's or the part's). */
  nameOf: (e: LetterEntry) => string;
}

/** Why Send is off, or null. */
export function lettersOff(mailer: LettersMailer | null): string | null {
  return mailer === null ? "Mail is off on this server: set LOOM_RESEND_API_KEY and LOOM_WEBMASTER_FROM." : null;
}

export function lettersView(ctx: LettersContext): LettersView {
  return ctx.book.view({ from: ctx.mailer?.from ?? null, off: lettersOff(ctx.mailer), writer: ctx.writer(), nameOf: ctx.nameOf });
}

function keysOf(body: Record<string, unknown>): string[] | undefined | null {
  const k = body["keys"];
  if (k === undefined || k === null) return undefined;
  if (!Array.isArray(k) || k.length > 500 || !k.every((x) => typeof x === "string")) return null;
  return k as string[];
}

/** A director's letters POST. False = not a letters route. */
export function handleLettersPost(ctx: LettersContext, path: string, body: Record<string, unknown>, res: ServerResponse, by: string): boolean {
  if (!path.startsWith("/api/mod/letters/")) return false;
  const keys = keysOf(body);
  if (keys === null) {
    sendJson(res, 400, { error: "keys" });
    return true;
  }
  switch (path) {
    case "/api/mod/letters/write": {
      const writer = ctx.writer();
      if (writer === null) {
        sendJson(res, 409, { error: "no_writer" });
        return true;
      }
      const queued = ctx.book.write(writer.character, keys, body["redo"] === true);
      sendJson(res, 200, { queued, letters: lettersView(ctx) });
      return true;
    }
    case "/api/mod/letters/draft": {
      const r = ctx.book.draft(str(body, "key"), { subject: body["subject"], text: body["text"] }, by);
      if (r === "missing") sendJson(res, 404, { error: "no_such_letter" });
      else if (r === "sent") sendJson(res, 409, { error: "already_sent" });
      else if (r !== "ok") sendJson(res, 400, { error: r });
      else sendJson(res, 200, { ok: true, letters: lettersView(ctx) });
      return true;
    }
    case "/api/mod/letters/send": {
      const mailer = ctx.mailer;
      if (mailer === null) {
        sendJson(res, 409, { error: "mail_off", why: lettersOff(null) });
        return true;
      }
      if (ctx.book.sending) {
        sendJson(res, 409, { error: "busy" });
        return true;
      }
      const n = ctx.book.sendable(keys).length;
      if (n === 0) {
        sendJson(res, 409, { error: "nothing_to_send" });
        return true;
      }
      // In the background: Resend's 2/s means a minute for a full house.
      void ctx.book.send(mailer, keys).catch((err: unknown) => console.error("letters: send failed:", err));
      sendJson(res, 202, { sending: n, letters: lettersView(ctx) });
      return true;
    }
    case "/api/mod/letters/forget": {
      if (!ctx.book.remove(str(body, "key"))) sendJson(res, 404, { error: "no_such_letter" });
      else sendJson(res, 200, { ok: true, letters: lettersView(ctx) });
      return true;
    }
    default:
      sendJson(res, 404, { error: "no such letters route" });
      return true;
  }
}

/** `POST /api/agent/letter {id, worker?, subject?, text}`. */
export function handleAgentLetter(book: LettersBook, body: Record<string, unknown>, res: ServerResponse): void {
  const r = book.reply(str(body, "id"), { worker: str(body, "worker"), subject: body["subject"], text: body["text"] });
  if (r === "gone") sendJson(res, 410, { error: "no such open letter (written already, expired, forgotten, or the run restarted)" });
  else if (r !== "ok") sendJson(res, 400, { error: r });
  else sendJson(res, 200, { ok: true });
}

/** `POST /api/prime/letter {email: string | null}` for `character`. */
export function handlePrimeLetter(book: LettersBook, character: string, body: Record<string, unknown>, res: ServerResponse): void {
  const raw = body["email"];
  if (raw === null) {
    book.remove(`p:${character}`);
    sendJson(res, 200, { ok: true, email: null });
    return;
  }
  const email = emailOf(raw);
  if (email === null) {
    sendJson(res, 400, { error: "bad_email" });
    return;
  }
  book.set("performer", character, email);
  sendJson(res, 200, { ok: true, email });
}
