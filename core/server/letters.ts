//! Trabolta's letters (wave 41, `docs/loom-w41-contract.md` C4–C6): the
//! inboxes guests leave at the upload (the `email` card) and performers in
//! their booth, the drafts the agent-voiced writer composes for each one at
//! the end of the night, and the director's Send.
//!
//! Never journaled: the addresses live here and in the event's state dir
//! (`letters.json`), never in the story, the chat or an agent's prompt. A
//! story restart clears the guests' (the runtime's `clear`); a process
//! restart keeps everything. Nothing is sent until a director presses Send.
//!
//! Writing goes through the agent stream like the facts judge's rulings: a
//! `letter` frame per entry, one out per worker, only to a worker with no
//! open voice request (the runtime's `workers` option decides), back in
//! the queue after `LETTER_TIMEOUT_MS` unanswered, given up after
//! `LETTER_TRIES`. Transport-free and clock-injected: the frames go out
//! through the workers' `send`, the mail through an injected `send`.

/** An entry's key: `g:<guest id>` or `p:<character>`. */
export type LetterKey = string;
export type LetterKind = "guest" | "performer";

export interface LetterDraft {
  subject: string;
  text: string;
  /** The writer character, or the director who edited it. */
  by: string;
  at: number;
}

export interface LetterSent {
  at: number;
  ok: boolean;
  error?: string;
  providerId?: string;
}

export interface LetterEntry {
  key: LetterKey;
  kind: LetterKind;
  /** Guest id or character name. */
  id: string;
  email: string;
  at: number;
  draft: LetterDraft | null;
  /** The last send attempt. */
  sent: LetterSent | null;
  /** Why the writer gave up on it (no draft after every try); cleared by a
   *  draft or a new ask. */
  error?: string;
}

export type LetterState = "waiting" | "queued" | "writing" | "drafted" | "sending" | "sent" | "failed";

export interface LetterRow {
  key: string;
  kind: LetterKind;
  name: string;
  email: string;
  state: LetterState;
  draft: LetterDraft | null;
  sent: { at: number; ok: boolean; error?: string } | null;
  /** (additive) Why writing failed, when it did. */
  error?: string;
}

export interface LettersView {
  /** The From line, or null when mail is off. */
  from: string | null;
  /** Why Send is off, or null. */
  off: string | null;
  writer: { character: string; online: boolean } | null;
  sending: boolean;
  rows: LetterRow[];
}

/** Who a letter is to, as the frame tells the writer. */
export interface LetterTo {
  kind: LetterKind;
  /** The program's name, or the part's. */
  name: string;
  /** A performer's part (the character), when it is one. */
  part?: string;
}

export interface LetterFrame {
  id: string;
  character: string;
  key: LetterKey;
  to: LetterTo;
  /** The night summary for this person (`letter-facts.ts`). */
  facts: unknown;
  at: number;
}

/** A message the mail transport delivers. */
export interface LetterMail {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
}

export interface LettersMailer {
  /** The From line (`Jean Trabolta <webmaster@…>`). */
  from: string;
  replyTo: string;
  /** Deliver one message; resolves to the provider's id. */
  send: (msg: LetterMail) => Promise<string | undefined>;
  /** Plain text → the HTML body. */
  html: (text: string) => string;
}

export interface LetterWorker {
  id: string;
  send: (event: string, data: unknown) => void;
}

export interface LettersOptions {
  /** The stored document (null when none yet). */
  load?: () => unknown;
  save?: (doc: LettersDoc) => void;
  /** The workers voicing `character` free to take a letter now (connected,
   *  answering, no open voice request); with `all`, every connected one
   *  (a cancel goes to a busy worker too). */
  workers?: (character: string, all?: boolean) => LetterWorker[];
  /** The frame's `to` + `facts` for an entry, read now; null = nothing to
   *  write about (the person is gone from the story). */
  facts?: (entry: LetterEntry) => { to: LetterTo; facts: unknown } | null;
  /** Something a view shows moved (a draft landed, a send finished). */
  changed?: () => void;
  now?: () => number;
  /** Waits between two sends (tests pass an instant one). */
  sleep?: (ms: number) => Promise<void>;
  /** Frame ids (tests pass a counter). */
  newId?: () => string;
}

export interface LettersDoc {
  version: 1;
  entries: LetterEntry[];
}

export const LETTERS_FILE = "letters.json";
/** A frame unanswered this long goes back in the queue. */
export const LETTER_TIMEOUT_MS = 180_000;
/** Sends of one frame before the entry reads `failed`. */
export const LETTER_TRIES = 3;
/** The gap between two sends (Resend allows 2 a second). */
export const LETTER_SEND_GAP_MS = 600;
export const LETTER_TEXT_MAX = 6000;
export const LETTER_SUBJECT_MAX = 120;
export const EMAIL_MAX = 254;
/** The subject when the writer gives none. DRAFT w41. */
export const LETTER_SUBJECT_DEFAULT = "A letter from Jean Trabolta";
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/u;

/** A plausible address, trimmed, or null. */
export function emailOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length <= EMAIL_MAX && EMAIL_RE.test(t) ? t : null;
}

export const guestKey = (id: string): LetterKey => `g:${id}`;
export const performerKey = (character: string): LetterKey => `p:${character}`;

/** A letter's text as stored: line endings normalised, trailing space and
 *  runs of blank lines trimmed. Null when empty or over the limit. */
export function letterTextOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/u, ""))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return t === "" || t.length > LETTER_TEXT_MAX ? null : t;
}

/** A subject line: one line, trimmed, capped; the default when blank. */
export function letterSubjectOf(raw: unknown): string {
  const t = typeof raw === "string" ? raw.replace(/\s+/gu, " ").trim().slice(0, LETTER_SUBJECT_MAX) : "";
  return t === "" ? LETTER_SUBJECT_DEFAULT : t;
}

interface OpenFrame {
  frame: LetterFrame;
  /** The worker it is with; null while queued. */
  worker: string | null;
  sentAt: number | null;
  tries: number;
}

function entryOf(raw: unknown): LetterEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const kind = r["kind"];
  const id = r["id"];
  const email = emailOf(r["email"]);
  if ((kind !== "guest" && kind !== "performer") || typeof id !== "string" || id === "" || email === null) return null;
  const key = kind === "guest" ? guestKey(id) : performerKey(id);
  const d = r["draft"] as Record<string, unknown> | null | undefined;
  const text = d == null ? null : letterTextOf(d["text"]);
  const draft: LetterDraft | null =
    d == null || text === null ? null : { subject: letterSubjectOf(d["subject"]), text, by: typeof d["by"] === "string" ? d["by"] : "", at: typeof d["at"] === "number" ? d["at"] : 0 };
  const s = r["sent"] as Record<string, unknown> | null | undefined;
  const sent: LetterSent | null =
    s == null || typeof s["ok"] !== "boolean"
      ? null
      : {
          at: typeof s["at"] === "number" ? s["at"] : 0,
          ok: s["ok"],
          ...(typeof s["error"] === "string" ? { error: s["error"] } : {}),
          ...(typeof s["providerId"] === "string" ? { providerId: s["providerId"] } : {}),
        };
  return { key, kind, id, email, at: typeof r["at"] === "number" ? r["at"] : 0, draft, sent, ...(typeof r["error"] === "string" ? { error: r["error"] } : {}) };
}

export class LettersBook {
  private readonly entries = new Map<LetterKey, LetterEntry>();
  private readonly frames = new Map<string, OpenFrame>();
  private sendingKeys = new Set<LetterKey>();
  private ids = 0;
  private readonly o: LettersOptions;

  constructor(o: LettersOptions = {}) {
    this.o = o;
    const doc = o.load?.() as { version?: unknown; entries?: unknown } | null | undefined;
    if (doc != null && doc.version === 1 && Array.isArray(doc.entries)) {
      for (const raw of doc.entries) {
        const e = entryOf(raw);
        if (e !== null) this.entries.set(e.key, e);
      }
    }
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private persist(): void {
    this.o.save?.({ version: 1, entries: [...this.entries.values()] });
    this.o.changed?.();
  }

  get(key: LetterKey): LetterEntry | null {
    return this.entries.get(key) ?? null;
  }

  list(): LetterEntry[] {
    return [...this.entries.values()];
  }

  /** Put an address on file (a new one, or a change). A changed address
   *  makes a sent letter unsent; the draft stays. */
  set(kind: LetterKind, id: string, email: string): LetterEntry {
    const key = kind === "guest" ? guestKey(id) : performerKey(id);
    const was = this.entries.get(key);
    const same = was !== undefined && was.email.toLowerCase() === email.toLowerCase();
    const e: LetterEntry = was === undefined ? { key, kind, id, email, at: this.now(), draft: null, sent: null } : { ...was, email, at: this.now(), sent: same ? was.sent : null };
    this.entries.set(key, e);
    this.persist();
    return e;
  }

  /** Take an entry off file (and any frame writing it). */
  remove(key: LetterKey): boolean {
    if (!this.entries.delete(key)) return false;
    this.dropFrames(key);
    this.persist();
    return true;
  }

  /** Take every entry `which` picks off file (a story restart: the guests). */
  clear(which: (e: LetterEntry) => boolean): void {
    let n = 0;
    for (const e of [...this.entries.values()]) {
      if (!which(e)) continue;
      this.entries.delete(e.key);
      this.dropFrames(e.key);
      n += 1;
    }
    if (n > 0) this.persist();
  }

  private dropFrames(key: LetterKey): void {
    for (const [id, f] of [...this.frames]) {
      if (f.frame.key !== key) continue;
      this.frames.delete(id);
      if (f.worker !== null) this.cancel(f, id);
    }
  }

  /** Tell the worker holding `f` to stop (a no-op once it has gone). */
  private cancel(f: OpenFrame, id: string): void {
    for (const w of this.o.workers?.(f.frame.character, true) ?? []) if (w.id === f.worker) w.send("cancel", { id });
  }

  private frameFor(key: LetterKey): OpenFrame | null {
    for (const f of this.frames.values()) if (f.frame.key === key) return f;
    return null;
  }

  // -- writing ----------------------------------------------------------------

  /**
   * Ask `character` to write every entry with no draft (or `keys`; `redo`
   * replaces a draft that was not sent). An entry already being written,
   * or sent, is skipped. Returns how many were queued.
   */
  write(character: string, keys?: readonly string[], redo = false): number {
    let n = 0;
    const pick = keys === undefined ? [...this.entries.values()] : keys.map((k) => this.entries.get(k)).filter((e): e is LetterEntry => e !== undefined);
    for (const e of pick) {
      if (this.frameFor(e.key) !== null) continue;
      if (e.sent?.ok === true) continue;
      if (e.draft !== null && !redo) continue;
      const made = this.o.facts?.(e) ?? null;
      if (made === null) continue;
      const id = this.o.newId?.() ?? `lt-${++this.ids}-${Math.random().toString(36).slice(2, 8)}`;
      this.frames.set(id, { frame: { id, character, key: e.key, to: made.to, facts: made.facts, at: Date.now() }, worker: null, sentAt: null, tries: 0 });
      if (e.error !== undefined) {
        const { error: _gone, ...rest } = e;
        this.entries.set(e.key, rest);
      }
      n += 1;
    }
    if (n > 0) {
      this.persist();
      this.pump();
    }
    return n;
  }

  /** Frames queued or out (for a timer: nothing to do at 0). */
  pending(): number {
    return this.frames.size;
  }

  /** Send queued frames to the free workers, one each, oldest first. */
  pump(): void {
    const busy = new Set<string>();
    for (const f of this.frames.values()) if (f.worker !== null) busy.add(f.worker);
    for (const f of this.frames.values()) {
      if (f.worker !== null) continue;
      const w = (this.o.workers?.(f.frame.character) ?? []).find((x) => !busy.has(x.id));
      if (w === undefined) continue;
      f.worker = w.id;
      f.sentAt = this.now();
      f.tries += 1;
      busy.add(w.id);
      w.send("letter", f.frame);
      this.o.changed?.();
    }
  }

  /** Expire frames out too long: back in the queue, or given up. */
  tick(): void {
    const now = this.now();
    let moved = false;
    for (const [id, f] of [...this.frames]) {
      if (f.worker === null || f.sentAt === null || now - f.sentAt < LETTER_TIMEOUT_MS) continue;
      this.cancel(f, id);
      moved = true;
      if (f.tries >= LETTER_TRIES) {
        this.frames.delete(id);
        const e = this.entries.get(f.frame.key);
        if (e !== undefined && e.draft === null) this.entries.set(e.key, { ...e, error: "no draft" });
        continue;
      }
      f.worker = null;
      f.sentAt = null;
    }
    if (moved) this.persist();
    this.pump();
  }

  /** A worker went away: its frames go back in the queue. */
  detach(workerId: string): void {
    for (const f of this.frames.values()) {
      if (f.worker !== workerId) continue;
      f.worker = null;
      f.sentAt = null;
    }
    this.pump();
  }

  /** A worker's draft (`POST /api/agent/letter`). "gone" when the frame is
   *  not open (answered, expired, forgotten, a restart). */
  reply(id: string, body: { worker?: string; subject?: unknown; text: unknown }): "ok" | "gone" | "empty" | "too_long" {
    const f = this.frames.get(id);
    if (f === undefined || f.worker === null || (body.worker !== undefined && body.worker !== "" && body.worker !== f.worker)) return "gone";
    const text = letterTextOf(body.text);
    if (text === null) return typeof body.text === "string" && body.text.trim() !== "" ? "too_long" : "empty";
    this.frames.delete(id);
    const e = this.entries.get(f.frame.key);
    if (e === undefined || e.sent?.ok === true) return "gone";
    const { error: _cleared, ...rest } = e;
    this.entries.set(e.key, { ...rest, draft: { subject: letterSubjectOf(body.subject), text, by: f.frame.character, at: this.now() } });
    this.persist();
    this.pump();
    return "ok";
  }

  /** A director's own edit. */
  draft(key: LetterKey, body: { subject?: unknown; text: unknown }, by: string): "ok" | "missing" | "sent" | "empty" | "too_long" {
    const e = this.entries.get(key);
    if (e === undefined) return "missing";
    if (e.sent?.ok === true) return "sent";
    const text = letterTextOf(body.text);
    if (text === null) return typeof body.text === "string" && body.text.trim() !== "" ? "too_long" : "empty";
    this.dropFrames(key);
    const { error: _cleared, ...rest } = e;
    this.entries.set(key, { ...rest, draft: { subject: letterSubjectOf(body.subject ?? e.draft?.subject), text, by, at: this.now() } });
    this.persist();
    return "ok";
  }

  // -- sending ----------------------------------------------------------------

  get sending(): boolean {
    return this.sendingKeys.size > 0;
  }

  /** The entries a Send would send: drafted, not sent (or `keys`). */
  sendable(keys?: readonly string[]): LetterEntry[] {
    const pick = keys === undefined ? [...this.entries.values()] : keys.map((k) => this.entries.get(k)).filter((e): e is LetterEntry => e !== undefined);
    return pick.filter((e) => e.draft !== null && e.sent?.ok !== true);
  }

  /**
   * Send every sendable entry (or `keys`) one at a time, `LETTER_SEND_GAP_MS`
   * apart. Resolves when the last is done; each result is on its entry.
   * "busy" while a send is running.
   */
  async send(mailer: LettersMailer, keys?: readonly string[]): Promise<number | "busy"> {
    if (this.sending) return "busy";
    const batch = this.sendable(keys);
    if (batch.length === 0) return 0;
    for (const e of batch) this.sendingKeys.add(e.key);
    this.o.changed?.();
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let n = 0;
    try {
      for (const [i, e] of batch.entries()) {
        if (i > 0) await sleep(LETTER_SEND_GAP_MS);
        const now = this.entries.get(e.key);
        this.sendingKeys.delete(e.key);
        if (now === undefined || now.draft === null || now.sent?.ok === true) continue;
        let sent: LetterSent;
        try {
          const providerId = await mailer.send({ from: mailer.from, to: now.email, replyTo: mailer.replyTo, subject: now.draft.subject, text: now.draft.text, html: mailer.html(now.draft.text) });
          sent = { at: this.now(), ok: true, ...(providerId !== undefined ? { providerId } : {}) };
          n += 1;
        } catch (err) {
          sent = { at: this.now(), ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 200) };
        }
        const after = this.entries.get(e.key);
        if (after !== undefined && after.email === now.email) this.entries.set(e.key, { ...after, sent });
        this.persist();
      }
    } finally {
      this.sendingKeys.clear();
      this.o.changed?.();
    }
    return n;
  }

  // -- the view ---------------------------------------------------------------

  stateOf(e: LetterEntry): LetterState {
    if (this.sendingKeys.has(e.key)) return "sending";
    if (e.sent?.ok === true) return "sent";
    const f = this.frameFor(e.key);
    if (f !== null) return f.worker === null ? "queued" : "writing";
    if (e.draft !== null) return e.sent !== null ? "failed" : "drafted";
    if (e.error !== undefined) return "failed";
    return "waiting";
  }

  /** Run's card (`GET /api/mod/letters`). `nameOf` reads the program's or
   *  part's name now. */
  view(o: { from: string | null; off: string | null; writer: LettersView["writer"]; nameOf: (e: LetterEntry) => string }): LettersView {
    const rows = [...this.entries.values()]
      .map((e): LetterRow => ({
        key: e.key,
        kind: e.kind,
        name: o.nameOf(e),
        email: e.email,
        state: this.stateOf(e),
        draft: e.draft,
        sent: e.sent === null ? null : { at: e.sent.at, ok: e.sent.ok, ...(e.sent.error !== undefined ? { error: e.sent.error } : {}) },
        ...(e.error !== undefined ? { error: e.error } : {}),
      }))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "guest" ? -1 : 1));
    return { from: o.from, off: o.off, writer: o.writer, sending: this.sending, rows };
  }
}

/** `Jean Trabolta <address>` from a configured From (`Name <a@b>` or bare). */
export function letterFrom(configured: string, name = "Jean Trabolta"): string | null {
  const addr = (configured.match(/<([^>]+)>\s*$/u)?.[1] ?? configured).trim();
  return emailOf(addr) === null ? null : `${name} <${addr}>`;
}
