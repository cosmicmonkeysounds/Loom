// Wave 41 (docs/loom-w41-contract.md C2–C6): Trabolta's letters on the
// server — the letters book (pure), the email card's answer kept out of
// the journal, a performer's booth inbox, the writer's frames and the
// director's Send.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { EventRuntime } from "../server/event-runtime.ts";
import {
  emailOf,
  LETTER_SUBJECT_DEFAULT,
  LETTER_TIMEOUT_MS,
  LETTER_TRIES,
  LettersBook,
  letterFrom,
  letterTextOf,
  type LetterMail,
  type LettersMailer,
  type LettersView,
  type LetterWorker,
} from "../server/letters.ts";
import { lettersMailerOf } from "../server/letters-mail.ts";
import { Store } from "../server/store.ts";
import type { PrimeView } from "../server/views.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "loom-w41-"));
  dirs.push(d);
  return d;
};

// ───────────────────────── the book (pure) ─────────────────────────

function fakeWorkers() {
  const sent: Array<[string, string, unknown]> = [];
  let online: string[] = ["w1"];
  const workers = (_c: string, all?: boolean): LetterWorker[] => (all === true ? ["w1", "w2"] : online).map((id) => ({ id, send: (e, d) => sent.push([id, e, d]) }));
  return { sent, workers, setOnline: (ids: string[]) => (online = ids) };
}
const facts = () => ({ to: { kind: "guest" as const, name: "Calculator" }, facts: { program: { name: "Calculator" } } });

function mailer(fail: Set<string> = new Set()): LettersMailer & { out: LetterMail[] } {
  const out: LetterMail[] = [];
  return {
    from: "Jean Trabolta <webmaster@example.com>",
    replyTo: "webmaster@example.com",
    html: (t) => `<p>${t}</p>`,
    out,
    send: async (m) => {
      if (fail.has(m.to)) throw new Error("rejected");
      out.push(m);
      return `id-${out.length}`;
    },
  };
}

describe("wave 41: the letters book (C4, C6)", () => {
  it("validates addresses, texts and the From line", () => {
    expect(emailOf("  guest@example.com ")).toBe("guest@example.com");
    for (const bad of ["", "nope", "a@b", "a b@c.d", "<a@b.c>", 42, null, `${"x".repeat(250)}@example.com`]) expect(emailOf(bad), String(bad)).toBeNull();
    expect(letterTextOf("Dear X,\r\n\r\n\r\n\r\nYours.  ")).toBe("Dear X,\n\nYours.");
    expect(letterTextOf("   ")).toBeNull();
    expect(letterFrom("webmaster@example.com")).toBe("Jean Trabolta <webmaster@example.com>");
    expect(letterFrom("Maps and Ducks <webmaster@example.com>")).toBe("Jean Trabolta <webmaster@example.com>");
    expect(letterFrom("not an address")).toBeNull();
    expect(lettersMailerOf({ apiKey: "", from: "webmaster@example.com", replyTo: "" })).toBeNull();
    const m = lettersMailerOf({ apiKey: "k", from: "webmaster@example.com", replyTo: "" })!;
    expect(m.from).toBe("Jean Trabolta <webmaster@example.com>");
    expect(m.replyTo).toBe("webmaster@example.com");
  });

  it("writes one frame per worker, voice first, and keeps the draft", () => {
    const w = fakeWorkers();
    let ids = 0;
    const book = new LettersBook({ workers: w.workers, facts, newId: () => `f${++ids}` });
    book.set("guest", "g1", "one@example.com");
    book.set("guest", "g2", "two@example.com");
    expect(book.write("Trabolta")).toBe(2);
    // One out to the only free worker; the second waits.
    expect(w.sent.map(([, e]) => e)).toEqual(["letter"]);
    expect(book.view({ from: null, off: null, writer: null, nameOf: (e) => e.id }).rows.map((r) => r.state)).toEqual(["writing", "queued"]);
    const frame = w.sent[0]![2] as { id: string; to: unknown; facts: unknown };
    expect(JSON.stringify(frame)).not.toContain("example.com"); // never the address
    expect(book.reply(frame.id, { worker: "w2", text: "Hi" })).toBe("gone"); // not the worker it went to
    expect(book.reply(frame.id, { worker: "w1", text: "  " })).toBe("empty");
    expect(book.reply(frame.id, { worker: "w1", text: "Dear Calculator,\n\nThank you.\n\nJean Trabolta" })).toBe("ok");
    expect(book.get("g:g1")!.draft).toMatchObject({ subject: LETTER_SUBJECT_DEFAULT, by: "Trabolta" });
    // The next goes out at once; a second write asks for nothing new.
    expect(w.sent.filter(([, e]) => e === "letter")).toHaveLength(2);
    expect(book.write("Trabolta")).toBe(0);
    expect(book.reply(frame.id, { text: "again" })).toBe("gone");
  });

  it("re-queues a frame nobody answers, and gives up after the last try", () => {
    let now = 0;
    const w = fakeWorkers();
    const book = new LettersBook({ workers: w.workers, facts, now: () => now });
    book.set("guest", "g1", "one@example.com");
    book.write("Trabolta");
    for (let i = 0; i < LETTER_TRIES; i++) {
      now += LETTER_TIMEOUT_MS;
      book.tick();
    }
    expect(w.sent.filter(([, e]) => e === "letter")).toHaveLength(LETTER_TRIES);
    expect(w.sent.filter(([, e]) => e === "cancel")).toHaveLength(LETTER_TRIES);
    expect(book.pending()).toBe(0);
    const row = book.view({ from: null, off: null, writer: null, nameOf: () => "C" }).rows[0]!;
    expect(row.state).toBe("failed");
    expect(row.error).toBe("no draft");
    // A worker leaving puts its frame back; another takes it.
    const w2 = fakeWorkers();
    const b2 = new LettersBook({ workers: w2.workers, facts });
    b2.set("guest", "g1", "one@example.com");
    b2.write("Trabolta");
    w2.setOnline([]);
    b2.detach("w1");
    expect(b2.stateOf(b2.get("g:g1")!)).toBe("queued");
    w2.setOnline(["w2"]);
    b2.pump();
    expect(b2.stateOf(b2.get("g:g1")!)).toBe("writing");
  });

  it("sends each drafted letter once, records failures, and survives a reload", async () => {
    const d = tmp();
    const store = new Store(d);
    const opts = { load: () => store.loadLetters(), save: (doc: unknown) => store.saveLetters(doc), facts, sleep: async () => {} };
    const book = new LettersBook(opts);
    book.set("guest", "g1", "one@example.com");
    book.set("guest", "g2", "two@example.com");
    book.set("performer", "Clippy", "three@example.com");
    expect(book.draft("g:g1", { text: "Dear one" }, "Ada")).toBe("ok");
    expect(book.draft("g:g2", { subject: "Hello", text: "Dear two" }, "Ada")).toBe("ok");
    expect(book.draft("g:nope", { text: "x" }, "Ada")).toBe("missing");
    expect(book.sendable().map((e) => e.key)).toEqual(["g:g1", "g:g2"]);
    const m = mailer(new Set(["two@example.com"]));
    expect(await book.send(m)).toBe(1);
    expect(m.out).toEqual([{ from: m.from, to: "one@example.com", replyTo: m.replyTo, subject: LETTER_SUBJECT_DEFAULT, text: "Dear one", html: "<p>Dear one</p>" }]);
    expect(book.get("g:g1")!.sent).toMatchObject({ ok: true, providerId: "id-1" });
    expect(book.get("g:g2")!.sent).toMatchObject({ ok: false, error: "rejected" });
    expect(book.stateOf(book.get("g:g2")!)).toBe("failed");
    expect(book.draft("g:g1", { text: "changed" }, "Ada")).toBe("sent");
    // Reloaded from the state dir: a sent letter is never sent again.
    const again = new LettersBook(opts);
    expect(again.list()).toHaveLength(3);
    expect(again.sendable().map((e) => e.key)).toEqual(["g:g2"]);
    // A new address makes a sent letter unsent; the same one (any case) does not.
    again.set("guest", "g1", "ONE@example.com");
    expect(again.get("g:g1")!.sent?.ok).toBe(true);
    again.set("guest", "g1", "new@example.com");
    expect(again.get("g:g1")!.sent).toBeNull();
    again.clear((e) => e.kind === "guest");
    expect(again.list().map((e) => e.key)).toEqual(["p:Clippy"]);
  });
});

// ───────────────────────── the runtime ─────────────────────────

const CODES = { event: "EVT641", prime: "PRM641", mod: "MOD641" };
const STORY = `# Letters
start: Boot
judge: The Writer

LOCATION Lobby
  label: The Lobby

ROLE Program
  secret: inbox
  inbox: text = "none"
  when someone joins:
    -> Ask
  when email answered for program:
    if given:
      set program.inbox = "given"
    else:
      set program.inbox = "skipped"

CHARACTER The Writer
  listed: true
  mind: external

CHARACTER Clerk
  listed: true

== Boot
  setting: Lobby
Nothing yet.

== Ask
  setting: Lobby
show email "Your inbox, optional." to program with skip: "No thanks"
`;

function fakeReq(body: unknown) {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  const closers: Array<() => void> = [];
  const req = {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on(ev: string, fn: () => void) {
      if (ev === "close") closers.push(fn);
    },
    destroy() {},
  } as unknown as IncomingMessage;
  return { req, close: () => closers.forEach((f) => f()) };
}
function fakeRes() {
  let buf = "";
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write(chunk: string) {
      buf += chunk;
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
    frames(): Array<[string, unknown]> {
      return buf
        .split("\n\n")
        .map((block) => {
          const ev = /^event: (.*)$/mu.exec(block)?.[1];
          const data = /^data: (.*)$/mu.exec(block)?.[1];
          return ev !== undefined && data !== undefined ? ([ev, JSON.parse(data)] as [string, unknown]) : null;
        })
        .filter((f): f is [string, unknown] => f !== null);
    },
  };
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: unknown = {}, moderator = false) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  const { req, close } = fakeReq(body);
  await rt.handle(req, res, method, url.pathname, url, moderator ? { moderator: true, moderatorName: "Ada" } : {});
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    /* a stream */
  }
  return { status: res.statusCode, json, res, close };
}
const mod = (rt: EventRuntime, path: string, body: unknown = {}) => call(rt, "POST", path, body, true);
const letters = async (rt: EventRuntime) => (await call(rt, "GET", "/api/mod/letters", {}, true)).json as unknown as LettersView;

function runtime(m: LettersMailer | null): { rt: EventRuntime; d: string } {
  const d = tmp();
  const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "letters", scenarioSource: STORY, joinBase: () => "http://localhost", lettersMailer: m });
  rt.openDoors();
  return { rt, d };
}
async function guest(rt: EventRuntime, name: string) {
  const r = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event });
  expect(r.status).toBe(200);
  const g = { id: r.json.id as string, token: r.json.token as string };
  const card = rt.chatHistoryFor(g.id).find((x) => x.kind === "widget" && x.widget?.kind === "email")!;
  return { ...g, card: card.seq };
}
const journalText = (d: string) =>
  readdirSync(d)
    .filter((f) => f.includes("journal"))
    .map((f) => readFileSync(join(d, f), "utf8"))
    .join("\n");

describe("wave 41: the email card on the server (C2)", () => {
  it("keeps the address in the letters book, never the journal or the story", async () => {
    const { rt, d } = runtime(null);
    const g = await guest(rt, "Calculator");
    const bad = await call(rt, "POST", "/api/guest/widget", { token: g.token, seq: g.card, result: { email: "nope" } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("bad_email");
    const ok = await call(rt, "POST", "/api/guest/widget", { token: g.token, seq: g.card, result: { email: "calc@example.com" } });
    expect(ok.status).toBe(200);
    expect(journalText(d)).toContain("email answered");
    expect(journalText(d)).not.toContain("calc@example.com");
    expect(readFileSync(join(d, "letters.json"), "utf8")).toContain("calc@example.com");
    const view = await letters(rt);
    expect(view.rows).toEqual([expect.objectContaining({ key: `g:${g.id}`, kind: "guest", name: "Calculator", email: "calc@example.com", state: "waiting" })]);
    expect(view.off).toMatch(/LOOM_RESEND_API_KEY/u);
    expect(view.writer).toEqual({ character: "The Writer", online: false });
    // A guest never reads the letters.
    expect((await call(rt, "GET", `/api/mod/letters?token=${g.token}`)).status).toBe(403);
    // Answered once.
    expect((await call(rt, "POST", "/api/guest/widget", { token: g.token, seq: g.card, result: { skipped: true } })).status).toBe(409);
  });

  it("a skip reaches the story as skipped and files nothing", async () => {
    const { rt } = runtime(null);
    const g = await guest(rt, "Notepad");
    expect((await call(rt, "POST", "/api/guest/widget", { token: g.token, seq: g.card, result: { skipped: true } })).status).toBe(200);
    expect((await letters(rt)).rows).toEqual([]);
  });

  it("a story restart takes every guest's inbox off file", async () => {
    const { rt } = runtime(null);
    const g = await guest(rt, "Calculator");
    await call(rt, "POST", "/api/guest/widget", { token: g.token, seq: g.card, result: { email: "calc@example.com" } });
    rt.restart();
    expect((await letters(rt)).rows).toEqual([]);
  });
});

describe("wave 41: a performer's inbox (C3)", () => {
  it("is set, shown in the booth's view, and taken off file", async () => {
    const { rt } = runtime(mailer());
    const login = await call(rt, "POST", "/api/prime/login", { passcode: CODES.prime, character: "Clerk" });
    expect(login.status).toBe(200);
    const token = login.json.token as string;
    const view = async () => (await call(rt, "GET", `/api/state?role=prime&token=${token}`)).json as unknown as PrimeView;
    expect((await view()).letter).toEqual({ email: null, from: "Jean Trabolta <webmaster@example.com>" });
    expect((await call(rt, "POST", "/api/prime/letter", { token, email: "x" })).json.error).toBe("bad_email");
    expect((await call(rt, "POST", "/api/prime/letter", { token, email: "clerk@example.com" })).json).toEqual({ ok: true, email: "clerk@example.com" });
    expect((await view()).letter?.email).toBe("clerk@example.com");
    expect((await letters(rt)).rows).toEqual([expect.objectContaining({ key: "p:Clerk", kind: "performer", name: "Clerk" })]);
    expect((await call(rt, "POST", "/api/prime/letter", { token, email: null })).json).toEqual({ ok: true, email: null });
    expect((await letters(rt)).rows).toEqual([]);
    expect((await call(rt, "POST", "/api/prime/letter", { email: "a@example.com" })).status).toBe(403);
  });
});

describe("wave 41: writing and sending (C5, C6)", () => {
  it("asks the writer, takes its draft, lets a director edit, and sends once", async () => {
    const m = mailer();
    const { rt } = runtime(m);
    const g = await guest(rt, "Calculator");
    await call(rt, "POST", "/api/guest/widget", { token: g.token, seq: g.card, result: { email: "calc@example.com" } });

    const w = await call(rt, "GET", `/api/agent/stream?characters=${encodeURIComponent("The Writer")}&name=laptop`, {}, true);
    const hello = w.res.frames().find(([e]) => e === "hello")![1] as { worker: string };
    const write = await mod(rt, "/api/mod/letters/write");
    expect(write.json.queued).toBe(1);
    const frame = w.res.frames().find(([e]) => e === "letter")![1] as { id: string; character: string; to: unknown; facts: Record<string, unknown> };
    expect(frame.character).toBe("The Writer");
    expect(frame.to).toEqual({ kind: "guest", name: "Calculator" });
    expect(JSON.stringify(frame)).not.toContain("calc@example.com");
    expect((await letters(rt)).rows[0]!.state).toBe("writing");

    // The agent route is moderators only.
    expect((await call(rt, "POST", "/api/agent/letter", { token: g.token, id: frame.id, text: "x" })).status).toBe(403);
    expect((await mod(rt, "/api/agent/letter", { id: frame.id, worker: hello.worker, subject: "From my desk", text: "Dear Calculator,\n\nThank you for using my computer.\n\nJean Trabolta" })).status).toBe(200);
    expect((await mod(rt, "/api/agent/letter", { id: frame.id, text: "late" })).status).toBe(410);
    let row = (await letters(rt)).rows[0]!;
    expect(row.state).toBe("drafted");
    expect(row.draft).toMatchObject({ subject: "From my desk", by: "The Writer" });

    expect((await mod(rt, "/api/mod/letters/draft", { key: row.key, text: "" })).status).toBe(400);
    expect((await mod(rt, "/api/mod/letters/draft", { key: row.key, text: "Dear Calculator, edited." })).status).toBe(200);
    row = (await letters(rt)).rows[0]!;
    expect(row.draft).toMatchObject({ subject: "From my desk", text: "Dear Calculator, edited.", by: "Ada" });

    const send = await mod(rt, "/api/mod/letters/send");
    expect(send.status).toBe(202);
    expect(send.json.sending).toBe(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(m.out).toEqual([expect.objectContaining({ to: "calc@example.com", subject: "From my desk", text: "Dear Calculator, edited." })]);
    expect((await letters(rt)).rows[0]!.state).toBe("sent");
    expect((await mod(rt, "/api/mod/letters/send")).json.error).toBe("nothing_to_send");
    expect((await mod(rt, "/api/mod/letters/draft", { key: row.key, text: "again" })).status).toBe(409);
    w.close();
    rt.dispose();
  });

  it("mail off refuses Send; a forget takes a row off file", async () => {
    const { rt } = runtime(null);
    const g = await guest(rt, "Calculator");
    await call(rt, "POST", "/api/guest/widget", { token: g.token, seq: g.card, result: { email: "calc@example.com" } });
    await mod(rt, "/api/mod/letters/draft", { key: `g:${g.id}`, text: "Dear Calculator" });
    expect((await mod(rt, "/api/mod/letters/send")).json.error).toBe("mail_off");
    expect((await mod(rt, "/api/mod/letters/forget", { key: `g:${g.id}` })).status).toBe(200);
    expect((await letters(rt)).rows).toEqual([]);
    rt.dispose();
  });
});
