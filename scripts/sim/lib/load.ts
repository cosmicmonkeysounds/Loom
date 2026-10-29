// The pure half of trabolta-load.ts (wave 42, "Trabolta under load"): which
// of his lines is a real answer, which line of a guest it answers, the
// numbers at the end, the secrets a transcript must never carry, and the
// behaviour battery's file format and checks. No I/O (the driver reads the
// files and hands the text in), so `test/load.test.ts` pins it with
// `node --test`.
//
// Why a book and not a stopwatch per request: the hub coalesces a thread
// (one open request, a follow-up for everything said meanwhile), so one
// reply can answer several of a guest's lines, and a hold or busy line can
// come before it. The book keeps every line a guest sent and closes each by
// the reply's `answers` seq (the newest guest line the request's body
// held), the way a guest would read their own thread.

import { pct } from "./report.ts";

// ------------------------------------------------------------------ his canned lines

/** What one of his lines in a DM thread is. `reply` is the agent answering
 *  (the only kind that counts as an answer); `hold` / `busy` are the
 *  server's authored lines for an absent or overloaded worker (the cast
 *  file's `hold:` / `busy:`); `fallback` / `unavailable` are the worker's
 *  own canned lines (the persona's `fallback:` / `fallbacks:` /
 *  `unavailable:`): the request is closed but nobody answered; `story` is a
 *  line the story posted (a beat's); `hand` is a director typing as him. */
export type LineKind = "reply" | "hold" | "busy" | "fallback" | "unavailable" | "story" | "hand";

export interface CannedText {
  hold: string | null;
  busy: string | null;
  unavailable: string | null;
  /** `fallback:` plus every line of every `fallbacks:` pool (by stage, by situation). */
  fallbacks: ReadonlySet<string>;
}

const unquote = (v: string): string => {
  const t = v.trim();
  const q = /^"(.*)"$|^'(.*)'$/u.exec(t);
  return (q === null ? t : (q[1] ?? q[2] ?? "")).trim();
};

/** `hold:` / `busy:` from a CHARACTER block of a cast file (the first block
 *  named `character`, up to the next top-level line). */
export function castLines(text: string, character = "Trabolta"): { hold: string | null; busy: string | null } {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((l) => new RegExp(`^CHARACTER\\s+${character}\\b`, "u").test(l));
  if (start < 0) return { hold: null, busy: null };
  let hold: string | null = null;
  let busy: string | null = null;
  for (const l of lines.slice(start + 1)) {
    if (l.trim() !== "" && !/^\s/u.test(l)) break;
    const m = /^\s+(hold|busy):\s*(.+?)\s*$/u.exec(l);
    if (m === null) continue;
    if (m[1] === "hold") hold ??= unquote(m[2]!);
    else busy ??= unquote(m[2]!);
  }
  return { hold, busy };
}

/** A persona file's frontmatter (between the first two `---` lines). */
export function frontmatter(text: string): string {
  return /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text)?.[1] ?? "";
}

/** Every double-quoted string on a line (YAML flow lists, `- "…"` items). */
function quoted(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/gu;
  for (let m = re.exec(line); m !== null; m = re.exec(line)) out.push(m[1]!.replace(/\\"/gu, '"').trim());
  return out.filter((s) => s !== "");
}

/** The persona's canned lines: `fallback:`, `unavailable:`, and every quoted
 *  line under any `fallbacks:` key (the stage pools and each situation's). */
export function personaCanned(text: string): { fallback: string | null; unavailable: string | null; fallbacks: string[] } {
  const front = frontmatter(text);
  const top = (key: string): string | null => {
    const v = new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "mu").exec(front)?.[1];
    if (v === undefined) return null;
    const out = unquote(v.replace(/\s+#.*$/u, ""));
    return out === "" ? null : out;
  };
  const lines = front.split(/\r?\n/u);
  const pools: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?fallbacks:(.*)$/u.exec(lines[i]!);
    if (m === null) continue;
    pools.push(...quoted(m[2]!.replace(/\s+#[^"]*$/u, "")));
    const indent = m[1]!.length;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (l.trim() === "") continue;
      const ind = /^\s*/u.exec(l)![0].length;
      if (ind <= indent) break;
      pools.push(...quoted(l));
    }
  }
  return { fallback: top("fallback"), unavailable: top("unavailable"), fallbacks: [...new Set(pools)] };
}

/** One `outside:` entry: a word or phrase, and the word that must not come
 *  next for it to count (`John (not followed by McAfee)`). */
export interface OutsideWord {
  word: string;
  notFollowedBy: string | null;
}

/** The persona's `outside:` list (names and words from outside his world). */
export function personaOutside(text: string): OutsideWord[] {
  const lines = frontmatter(text).split(/\r?\n/u);
  const i = lines.findIndex((l) => /^outside:/u.test(l));
  if (i < 0) return [];
  const out: OutsideWord[] = [];
  for (const l of lines.slice(i + 1)) {
    const m = /^\s+-\s+(.+?)\s*$/u.exec(l);
    if (m === null) {
      if (l.trim() === "" || /^\s+#/u.test(l)) continue;
      break;
    }
    const entry = m[1]!.replace(/\s+#.*$/u, "").trim();
    const nf = /^(.*?)\s*\(not followed by\s+(.+?)\)$/u.exec(entry);
    out.push(nf === null ? { word: unquote(entry), notFollowedBy: null } : { word: unquote(nf[1]!), notFollowedBy: nf[2]!.trim() });
  }
  return out.filter((w) => w.word !== "");
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** The `outside:` words a line uses (whole words, any case). */
export function outsideHits(text: string, words: readonly OutsideWord[]): string[] {
  const hits: string[] = [];
  for (const w of words) {
    const after = w.notFollowedBy === null ? "" : `(?!\\s+${esc(w.notFollowedBy)})`;
    if (new RegExp(`(?<![\\p{L}\\p{N}])${esc(w.word)}(?![\\p{L}\\p{N}])${after}`, "iu").test(text)) hits.push(w.word);
  }
  return hits;
}

export function cannedText(cast: { hold: string | null; busy: string | null }, persona: { fallback: string | null; unavailable: string | null; fallbacks: readonly string[] }): CannedText {
  const fallbacks = new Set(persona.fallbacks);
  if (persona.fallback !== null) fallbacks.add(persona.fallback);
  return { hold: cast.hold, busy: cast.busy, unavailable: persona.unavailable, fallbacks };
}

/** A chat message as the mod feed's `message` frames carry it. */
export interface FeedMsg {
  seq?: unknown;
  channel?: unknown;
  from?: unknown;
  kind?: unknown;
  text?: unknown;
  audience?: unknown;
  answers?: unknown;
  beat?: unknown;
  via?: unknown;
}

/** What his line in his own `dm:` thread is; null for anything else (another
 *  speaker, another channel, a widget or a pick). A message with a `beat`
 *  key is the story's; one with `via` a director's play-as; the canned texts
 *  are matched exactly (trimmed), the hold and busy lines first. */
export function classify(m: FeedMsg, canned: CannedText, character = "Trabolta"): LineKind | null {
  if (m.from !== character || m.channel !== `dm:${character}`) return null;
  if ((m.kind ?? "line") !== "line") return null;
  const text = typeof m.text === "string" ? m.text.trim() : "";
  if (canned.hold !== null && text === canned.hold) return "hold";
  if (canned.busy !== null && text === canned.busy) return "busy";
  // A scripted line carries `beat` (null when its beat is unknown); typed
  // chat and an agent's reply never do (chat.ts), so the key is the mark.
  if (Object.prototype.hasOwnProperty.call(m, "beat")) return "story";
  if (typeof m.via === "string" && m.via !== "") return "hand";
  if (canned.unavailable !== null && text === canned.unavailable) return "unavailable";
  if (canned.fallbacks.has(text)) return "fallback";
  return "reply";
}

/** Kinds that close a guest's line: the request behind it is settled. */
export const CLOSES: ReadonlySet<LineKind> = new Set(["reply", "fallback", "unavailable", "hand"]);

// ------------------------------------------------------------------ the book

/** One line a guest sent him, and what became of it (hub-free wall ms). */
export interface LineRec {
  n: number;
  guest: string;
  name: string;
  text: string;
  sentAt: number;
  /** The say's HTTP status (200 = posted; 429 slow mode, 403, 0 transport). */
  status: number;
  /** The line's seq, once the feed showed it. */
  seq: number | null;
  /** The first `typing on` in the thread after it was sent. */
  typingAt: number | null;
  /** The first busy / hold line in the thread while it was open. */
  busyAt: number | null;
  holdAt: number | null;
  /** When it was closed and by what (a real reply, a canned line, a director). */
  closedAt: number | null;
  closedBy: LineKind | null;
  /** The first real reply's time and seq (null when none came). */
  replyAt: number | null;
  replySeq: number | null;
  /** A scenario tag (burst, steady, a battery scenario id). */
  tag?: string;
}

/** One message of a guest's thread, for the transcript. */
export interface ThreadMsg {
  seq: number;
  at: number;
  who: "guest" | "him";
  kind: LineKind | "line";
  text: string;
  answers: number | null;
}

/** A typing frame (`{channel, from, on, audience}`). */
export interface TypingFrame {
  channel?: unknown;
  from?: unknown;
  on?: unknown;
  audience?: unknown;
}

const asSeq = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const firstAudience = (a: unknown): string | null => (Array.isArray(a) && typeof a[0] === "string" ? a[0] : null);

export class LoadBook {
  readonly lines: LineRec[] = [];
  /** Every line of his in a DM thread we watch, with its kind and time. */
  readonly his: Array<{ at: number; guest: string; kind: LineKind; seq: number | null }> = [];
  readonly threads = new Map<string, ThreadMsg[]>();
  private readonly names = new Map<string, string>();
  private readonly typingOn = new Map<string, boolean>();
  // Plain fields, not parameter properties: Node's type stripping runs
  // these scripts and only erases syntax that has no runtime meaning.
  private readonly canned: CannedText;
  private readonly character: string;

  constructor(canned: CannedText, character = "Trabolta") {
    this.canned = canned;
    this.character = character;
  }

  /** Watch a guest's thread (only watched guests are booked). */
  watch(guest: string, name: string): void {
    this.names.set(guest, name);
    if (!this.threads.has(guest)) this.threads.set(guest, []);
  }

  get watched(): ReadonlyMap<string, string> {
    return this.names;
  }

  sent(guest: string, text: string, at: number, status: number, tag?: string): LineRec {
    const rec: LineRec = {
      n: this.lines.length + 1,
      guest,
      name: this.names.get(guest) ?? guest,
      text,
      sentAt: at,
      status,
      seq: null,
      typingAt: null,
      busyAt: null,
      holdAt: null,
      closedAt: status === 200 ? null : at,
      closedBy: null,
      replyAt: null,
      replySeq: null,
      ...(tag !== undefined ? { tag } : {}),
    };
    this.lines.push(rec);
    return rec;
  }

  /** A guest's lines still waiting (posted, not closed). */
  open(guest: string): LineRec[] {
    return this.lines.filter((l) => l.guest === guest && l.status === 200 && l.closedAt === null);
  }

  /** Feed one `message` frame. Returns his line's kind when it was his in a
   *  watched thread (null otherwise). */
  seen(m: FeedMsg, at: number): LineKind | null {
    if (m.channel !== `dm:${this.character}`) return null;
    const guest = firstAudience(m.audience);
    if (guest === null || !this.names.has(guest)) return null;
    const seq = asSeq(m.seq);
    const text = typeof m.text === "string" ? m.text : "";
    if (m.from !== this.character) {
      if ((m.kind ?? "line") !== "line") return null;
      this.threads.get(guest)!.push({ seq: seq ?? -1, at, who: "guest", kind: "line", text, answers: null });
      const rec = this.lines.find((l) => l.guest === guest && l.seq === null && l.status === 200 && l.text.trim() === text.trim());
      if (rec !== undefined && seq !== null) rec.seq = seq;
      return null;
    }
    const kind = classify(m, this.canned, this.character);
    if (kind === null) return null;
    const answers = asSeq(m.answers);
    this.threads.get(guest)!.push({ seq: seq ?? -1, at, who: "him", kind, text, answers });
    this.his.push({ at, guest, kind, seq });
    if (kind === "story") return kind;
    // The lines this one speaks to: everything open up to the seq it
    // answers (a coalesced request answers all of them); with no seq to go
    // by, everything open that was sent before it.
    const hit = this.open(guest).filter((l) => (answers !== null && l.seq !== null ? l.seq <= answers : l.sentAt <= at));
    for (const l of hit) {
      if (kind === "busy") l.busyAt ??= at;
      else if (kind === "hold") l.holdAt ??= at;
      else {
        l.closedAt = at;
        l.closedBy = kind;
        if (kind === "reply") {
          l.replyAt = at;
          l.replySeq = seq;
        }
      }
    }
    return kind;
  }

  /** Feed one `typing` frame. */
  typing(f: TypingFrame, at: number): void {
    if (f.channel !== `dm:${this.character}` || f.from !== this.character) return;
    const guest = firstAudience(f.audience);
    if (guest === null || !this.names.has(guest)) return;
    const on = f.on === true;
    this.typingOn.set(guest, on);
    if (!on) return;
    for (const l of this.open(guest)) l.typingAt ??= at;
  }

  isTyping(guest: string): boolean {
    return this.typingOn.get(guest) === true;
  }
}

// ------------------------------------------------------------------ the numbers

export interface Stats {
  n: number;
  p50: number | null;
  p90: number | null;
  p99: number | null;
  max: number | null;
  mean: number | null;
}

const fin = (n: number): number | null => (Number.isFinite(n) ? Math.round(n) : null);

export function stats(xs: readonly number[]): Stats {
  if (xs.length === 0) return { n: 0, p50: null, p90: null, p99: null, max: null, mean: null };
  return {
    n: xs.length,
    p50: fin(pct(xs, 50)),
    p90: fin(pct(xs, 90)),
    p99: fin(pct(xs, 99)),
    max: fin(Math.max(...xs)),
    mean: fin(xs.reduce((a, b) => a + b, 0) / xs.length),
  };
}

/** Real replies per `bucketMs` window from `start` to `end` (per minute too). */
export function buckets(times: readonly number[], start: number, end: number, bucketMs = 30_000): Array<{ fromS: number; replies: number; perMin: number }> {
  const n = Math.max(1, Math.ceil((end - start) / bucketMs));
  const out = Array.from({ length: n }, (_, i) => ({ fromS: Math.round((i * bucketMs) / 1000), replies: 0, perMin: 0 }));
  for (const t of times) {
    const i = Math.floor((t - start) / bucketMs);
    if (i >= 0 && i < n) out[i]!.replies += 1;
  }
  for (const b of out) b.perMin = Math.round(b.replies * (60_000 / bucketMs) * 10) / 10;
  return out;
}

export interface LoadSummary {
  lines: { sent: number; posted: number; refused: number; answered: number; fallback: number; unavailable: number; hand: number; unanswered: number };
  /** Sent → first real reply (answered lines only). */
  waitMs: Stats;
  /** Sent → closed by anything (reply, canned, director). */
  closeMs: Stats;
  /** Sent → the first typing on in the thread. */
  typingMs: Stats;
  /** Lines that heard the busy / hold line before their real reply (or instead of one). */
  busyFirst: number;
  holdFirst: number;
  /** His lines in the watched threads, by kind. */
  his: Record<LineKind, number>;
  replyRate: Array<{ fromS: number; replies: number; perMin: number }>;
  /** Real replies a minute over the whole window. */
  repliesPerMin: number;
  guests: Array<{ guest: string; name: string; lines: number; answered: number; unanswered: number; maxWaitMs: number }>;
  /** Each guest's longest wait (an unanswered line counts to `end`). */
  guestMaxWaitMs: Stats;
}

export function summarize(book: LoadBook, start: number, end: number, bucketMs = 30_000): LoadSummary {
  const posted = book.lines.filter((l) => l.status === 200);
  const answered = posted.filter((l) => l.replyAt !== null);
  const closedBy = (k: LineKind) => posted.filter((l) => l.closedBy === k).length;
  const his = { reply: 0, hold: 0, busy: 0, fallback: 0, unavailable: 0, story: 0, hand: 0 } as Record<LineKind, number>;
  for (const h of book.his) his[h.kind] += 1;
  const replies = book.his.filter((h) => h.kind === "reply").map((h) => h.at);
  const before = (at: number | null, l: LineRec) => at !== null && (l.replyAt === null || at <= l.replyAt);
  const guests = [...book.watched].map(([guest, name]) => {
    const mine = posted.filter((l) => l.guest === guest);
    const waits = mine.map((l) => (l.replyAt ?? l.closedAt ?? end) - l.sentAt);
    return {
      guest,
      name,
      lines: mine.length,
      answered: mine.filter((l) => l.replyAt !== null).length,
      unanswered: mine.filter((l) => l.closedAt === null).length,
      maxWaitMs: waits.length === 0 ? 0 : Math.round(Math.max(...waits)),
    };
  });
  const minutes = Math.max(1, end - start) / 60_000;
  return {
    lines: {
      sent: book.lines.length,
      posted: posted.length,
      refused: book.lines.length - posted.length,
      answered: answered.length,
      fallback: closedBy("fallback"),
      unavailable: closedBy("unavailable"),
      hand: closedBy("hand"),
      unanswered: posted.filter((l) => l.closedAt === null).length,
    },
    waitMs: stats(answered.map((l) => l.replyAt! - l.sentAt)),
    closeMs: stats(posted.filter((l) => l.closedAt !== null).map((l) => l.closedAt! - l.sentAt)),
    typingMs: stats(posted.filter((l) => l.typingAt !== null).map((l) => l.typingAt! - l.sentAt)),
    busyFirst: posted.filter((l) => before(l.busyAt, l)).length,
    holdFirst: posted.filter((l) => before(l.holdAt, l)).length,
    his,
    replyRate: buckets(replies, start, end, bucketMs),
    repliesPerMin: Math.round((replies.filter((t) => t >= start && t <= end).length / minutes) * 10) / 10,
    guests,
    guestMaxWaitMs: stats(guests.filter((g) => g.lines > 0).map((g) => g.maxWaitMs)),
  };
}

/** One line of `lines.jsonl`: times relative to the run's start, in ms. */
export function lineRow(l: LineRec, start: number, redact: (s: string) => string = (s) => s): Record<string, unknown> {
  const rel = (t: number | null) => (t === null ? null : Math.round(t - start));
  return {
    n: l.n,
    guest: l.name,
    ...(l.tag !== undefined ? { tag: l.tag } : {}),
    text: redact(l.text),
    status: l.status,
    seq: l.seq,
    sentMs: rel(l.sentAt),
    waitMs: l.replyAt === null ? null : Math.round(l.replyAt - l.sentAt),
    typingMs: l.typingAt === null ? null : Math.round(l.typingAt - l.sentAt),
    busyFirst: l.busyAt !== null && (l.replyAt === null || l.busyAt <= l.replyAt),
    holdFirst: l.holdAt !== null && (l.replyAt === null || l.holdAt <= l.replyAt),
    closedBy: l.closedBy,
    closedMs: rel(l.closedAt),
    replySeq: l.replySeq,
  };
}

// ------------------------------------------------------------------ the hub's queue

/** The director's `agentQueue` for him (`CastSummary.agentQueue`), as a
 *  sample. `inFlight` / `capacity` are wave 42's (C6): absent on an older
 *  server, so null here. */
export interface QueueSample {
  t: number;
  online: boolean;
  depth: number | null;
  inFlight: number | null;
  capacity: number | null;
  oldestMs: number | null;
  stalled: boolean;
  judgingQueued: number | null;
  judgingOut: number | null;
}

const numOr = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function queueSample(t: number, cast: ReadonlyArray<Record<string, unknown>> | undefined, character = "Trabolta"): QueueSample {
  const row = (cast ?? []).find((c) => c["id"] === character);
  const q = (row?.["agentQueue"] ?? {}) as Record<string, unknown>;
  const j = (q["judging"] ?? {}) as Record<string, unknown>;
  return {
    t,
    online: row?.["online"] === true,
    depth: numOr(q["depth"]),
    inFlight: numOr(q["inFlight"]),
    capacity: numOr(q["capacity"]),
    oldestMs: numOr(q["oldestMs"]),
    stalled: q["stalled"] === true,
    judgingQueued: numOr(j["queued"]),
    judgingOut: numOr(j["out"]),
  };
}

export function queueStats(samples: readonly QueueSample[]): {
  samples: number;
  depthMax: number | null;
  inFlightMax: number | null;
  capacity: number | null;
  oldestMaxMs: number | null;
  stalledSamples: number;
  offlineSamples: number;
  judgingQueuedMax: number | null;
} {
  const max = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length === 0 ? null : Math.max(...v);
  };
  return {
    samples: samples.length,
    depthMax: max(samples.map((s) => s.depth)),
    inFlightMax: max(samples.map((s) => s.inFlight)),
    capacity: max(samples.map((s) => s.capacity)),
    oldestMaxMs: max(samples.map((s) => s.oldestMs)),
    stalledSamples: samples.filter((s) => s.stalled).length,
    offlineSamples: samples.filter((s) => !s.online).length,
    judgingQueuedMax: max(samples.map((s) => s.judgingQueued)),
  };
}

// ------------------------------------------------------------------ the worker's trace

/** A thought from `GET /api/mod/agent/trace` (the fields read here: numbers
 *  only; a thought's prompt and output never leave this function). */
export interface TraceThought {
  kind?: unknown;
  at?: unknown;
  ms?: unknown;
  prompt_ms?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  error?: unknown;
  result?: unknown;
}

export function modelStats(
  thoughts: readonly TraceThought[],
  sinceSec: number,
): { thoughts: number; byKind: Record<string, number>; voiceMs: Stats; promptMs: Stats; promptTokens: Stats; completionTokens: Stats; judgeMs: Stats; errors: number; rulings: { same: number; not: number } } {
  const mine = thoughts.filter((t) => typeof t.at === "number" && t.at >= sinceSec);
  const byKind: Record<string, number> = {};
  for (const t of mine) byKind[String(t.kind)] = (byKind[String(t.kind)] ?? 0) + 1;
  const nums = (kind: string, f: (t: TraceThought) => unknown) =>
    mine.filter((t) => t.kind === kind).map(f).filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0);
  const judged = mine.filter((t) => t.kind === "judge" && t.result !== null && typeof t.result === "object");
  const sameOf = (t: TraceThought) => (t.result as Record<string, unknown>)["same"];
  return {
    thoughts: mine.length,
    byKind,
    voiceMs: stats(nums("voice", (t) => t.ms)),
    promptMs: stats(nums("voice", (t) => t.prompt_ms)),
    promptTokens: stats(nums("voice", (t) => t.prompt_tokens)),
    completionTokens: stats(nums("voice", (t) => t.completion_tokens)),
    judgeMs: stats(nums("judge", (t) => t.ms)),
    errors: mine.filter((t) => typeof t.error === "string" && t.error !== "").length,
    rulings: { same: judged.filter((t) => sameOf(t) === true).length, not: judged.filter((t) => sameOf(t) === false).length },
  };
}

// ------------------------------------------------------------------ rulings in # hosts

/** What a `# hosts` notice says about a ruling, without keeping its text
 *  (the ruling notice names the key): `asked` (a filing sent to him),
 *  `ruled` (same or not), `stalled` (he stopped ruling). Null otherwise. */
export function rulingEvent(text: string, judge = "Trabolta"): { kind: "asked" } | { kind: "ruled"; same: boolean } | { kind: "stalled" } | null {
  if (text.startsWith(`🤖 ${judge} ruled `)) return { kind: "ruled", same: /": the same as "/u.test(text) };
  if (text.startsWith(`⚖ ${judge} isn't ruling`)) return { kind: "stalled" };
  if (text.includes(`asked ${judge} to rule`)) return { kind: "asked" };
  return null;
}

// ------------------------------------------------------------------ secrets

/**
 * The values a file the driver writes must never hold: the hunts' answers
 * (and accepted forms), the door code, and the Kernel's secret-looking
 * values, read at runtime from facts.json and the director's world. The
 * book keeps only a label per value ("H3 answer", "Kernel.door_code");
 * `redact` swaps a value for its label and `hits` names the labels a text
 * contains, so a check can fail on a leak without repeating it.
 */
export class SecretBook {
  private readonly items: Array<{ label: string; re: RegExp }> = [];

  add(label: string, value: unknown): void {
    if (typeof value !== "string" && typeof value !== "number") return;
    const v = String(value).trim();
    if (v.length < 3 || /^(true|false|none|null|yes|no)$/iu.test(v)) return;
    if (this.items.some((i) => i.label === label && i.re.source.includes(esc(v)))) return;
    this.items.push({ label, re: new RegExp(`(?<![\\p{L}\\p{N}])${esc(v)}(?![\\p{L}\\p{N}])`, "giu") });
  }

  get size(): number {
    return this.items.length;
  }

  /** The labels of every secret the text holds. */
  hits(text: string): string[] {
    const out = new Set<string>();
    for (const i of this.items) {
      i.re.lastIndex = 0;
      if (i.re.test(text)) out.add(i.label);
    }
    return [...out];
  }

  redact(text: string): string {
    let out = text;
    for (const i of this.items) {
      i.re.lastIndex = 0;
      out = out.replace(i.re, `‹${i.label}›`);
    }
    return out;
  }
}

/** The facts book's secrets (answers, accepted forms, the door code). */
export function factsSecrets(book: SecretBook, facts: unknown): void {
  const f = (facts ?? {}) as { questions?: Array<{ id?: unknown; answer?: unknown; accept?: unknown }>; door?: { code?: unknown } };
  for (const q of f.questions ?? []) {
    const id = typeof q.id === "string" ? q.id : "?";
    book.add(`${id} answer`, q.answer);
    if (Array.isArray(q.accept)) for (const a of q.accept) book.add(`${id} answer`, a);
  }
  book.add("door code", f.door?.code);
}

/** Kernel paths whose values are secrets by their name (codes, combos, keys). */
export const KERNEL_SECRET = /code|combo|answer|key|pass|secret|pin/iu;

export function kernelSecrets(book: SecretBook, world: ReadonlyArray<{ path: string; value: string }> | undefined): void {
  for (const w of world ?? []) if (w.path.startsWith("Kernel.") && KERNEL_SECRET.test(w.path.slice(7))) book.add(w.path, w.value);
}

// ------------------------------------------------------------------ phases

/** The phases a run can stand the night at, in chain order: the last cue
 *  of `scripts/accept/chains.ts` `TO_Y2K` to press, and the `Night.step`
 *  the night reads once there. */
export const PHASES = {
  intro: { through: "introduce_trabolta", step: 4 },
  hunt1: { through: "start_the_hunt", step: 5 },
  hunt2: { through: "start_the_second_hunt", step: 8 },
  y2k: { through: "y2k_clock", step: 14 },
} as const;
export type Phase = keyof typeof PHASES;
export const PHASE_ORDER: readonly Phase[] = ["intro", "hunt1", "hunt2", "y2k"];
export const isPhase = (s: unknown): s is Phase => typeof s === "string" && (PHASE_ORDER as readonly string[]).includes(s);

/** The chain's presses from `cursor` through `phase` (empty once past it). */
export function pressesTo(chain: readonly string[], cursor: number, phase: Phase): { presses: string[]; cursor: number } {
  const end = chain.indexOf(PHASES[phase].through);
  if (end < 0) throw new Error(`no ${PHASES[phase].through} in the chain`);
  if (cursor > end) return { presses: [], cursor };
  return { presses: chain.slice(cursor, end + 1), cursor: end + 1 };
}

// ------------------------------------------------------------------ the battery

/** A check on a scenario's replies (see `checkReplies`). */
export type Check =
  | { kind: "replies" }
  | { kind: "no-hold" }
  | { kind: "no-fallback" }
  | { kind: "in-world" }
  | { kind: "no-secrets" }
  | { kind: "never"; words: string[] }
  | { kind: "mentions"; words: string[] }
  | { kind: "max-sentences"; n: number }
  | { kind: "max-chars"; n: number };

export interface Scenario {
  id: string;
  phase: Phase;
  as: { name: string };
  setup: Array<{ path: string; value: string }>;
  lines: string[];
  intent: string;
  checks: Check[];
}

const SIMPLE = new Set(["replies", "no-hold", "no-fallback", "in-world", "no-secrets"]);

function parseCheck(raw: unknown, where: string, errors: string[]): Check | null {
  if (typeof raw === "string") {
    if (SIMPLE.has(raw)) return { kind: raw } as Check;
    errors.push(`${where}: unknown check "${raw}"`);
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${where}: a check is a name or {name: value}`);
    return null;
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length !== 1) {
    errors.push(`${where}: a check object has one key`);
    return null;
  }
  const [k, v] = entries[0]!;
  if (SIMPLE.has(k)) return { kind: k } as Check;
  if (k === "never" || k === "mentions") {
    const words = (Array.isArray(v) ? v : [v]).filter((w): w is string => typeof w === "string" && w.trim() !== "");
    if (words.length === 0) {
      errors.push(`${where}: ${k} needs a word or a list of words`);
      return null;
    }
    return { kind: k, words };
  }
  if (k === "max-sentences" || k === "max-chars") {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      errors.push(`${where}: ${k} needs a whole number ≥ 1`);
      return null;
    }
    return { kind: k, n: v };
  }
  errors.push(`${where}: unknown check "${k}"`);
  return null;
}

/** Read a battery file (`{scenarios: [...]}`). Every problem is listed; a
 *  file with any is refused whole (a half-run battery reads as a pass). */
export function parseBattery(doc: unknown): { scenarios: Scenario[]; errors: string[] } {
  const errors: string[] = [];
  const list = (doc as { scenarios?: unknown } | null)?.scenarios;
  if (!Array.isArray(list) || list.length === 0) return { scenarios: [], errors: ["a battery is {scenarios: [...]} with at least one scenario"] };
  const ids = new Set<string>();
  const scenarios: Scenario[] = [];
  list.forEach((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const where = `scenario ${typeof s["id"] === "string" ? s["id"] : `#${i + 1}`}`;
    const id = typeof s["id"] === "string" ? s["id"].trim() : "";
    if (!/^[a-z0-9][a-z0-9._-]{0,60}$/iu.test(id)) errors.push(`${where}: id is letters, digits, . _ - (≤ 61)`);
    else if (ids.has(id)) errors.push(`${where}: duplicate id`);
    ids.add(id);
    if (!isPhase(s["phase"])) errors.push(`${where}: phase is one of ${PHASE_ORDER.join(", ")}`);
    const as = s["as"] as { name?: unknown } | undefined;
    const name = typeof as?.name === "string" ? as.name.trim() : "";
    if (name === "" || name.length > 40) errors.push(`${where}: as.name is a program name (1–40 characters)`);
    const lines = Array.isArray(s["lines"]) ? s["lines"].filter((l): l is string => typeof l === "string" && l.trim() !== "") : [];
    if (lines.length === 0 || lines.length !== (s["lines"] as unknown[] | undefined)?.length) errors.push(`${where}: lines is a list of non-empty strings`);
    const setup: Array<{ path: string; value: string }> = [];
    if (s["setup"] !== undefined) {
      if (!Array.isArray(s["setup"])) errors.push(`${where}: setup is a list of {path, value}`);
      else
        for (const [j, st] of s["setup"].entries()) {
          const p = (st ?? {}) as Record<string, unknown>;
          if (typeof p["path"] !== "string" || p["path"].trim() === "" || p["value"] === undefined) errors.push(`${where}: setup[${j}] is {path, value}`);
          else if (/^Kernel\./u.test(p["path"])) errors.push(`${where}: setup[${j}] may not write the Kernel`);
          else setup.push({ path: p["path"].trim(), value: String(p["value"]) });
        }
    }
    const checks: Check[] = [];
    if (s["checks"] !== undefined && !Array.isArray(s["checks"])) errors.push(`${where}: checks is a list`);
    for (const [j, c] of (Array.isArray(s["checks"]) ? s["checks"] : []).entries()) {
      const k = parseCheck(c, `${where} checks[${j}]`, errors);
      if (k !== null) checks.push(k);
    }
    scenarios.push({ id, phase: isPhase(s["phase"]) ? s["phase"] : "intro", as: { name }, setup, lines, intent: typeof s["intent"] === "string" ? s["intent"] : "", checks });
  });
  return { scenarios: errors.length > 0 ? [] : scenarios, errors };
}

/** The scenarios grouped by phase, in chain order (file order within one). */
export function byPhase(scenarios: readonly Scenario[]): Array<{ phase: Phase; scenarios: Scenario[] }> {
  return PHASE_ORDER.map((phase) => ({ phase, scenarios: scenarios.filter((s) => s.phase === phase) })).filter((g) => g.scenarios.length > 0);
}

/** `$me` in a setup path or value is the scenario guest's id. */
export const withMe = (s: string, id: string): string => s.replaceAll("$me", id);

/** Sentences in a reply (terminal punctuation runs; a trailing fragment counts). */
export function sentences(text: string): number {
  const t = text.trim();
  if (t === "") return 0;
  return t.split(/(?<=[.!?…])\s+/u).filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
}

export interface CheckResult {
  check: string;
  ok: boolean;
  note: string;
}

/** Judge a scenario's thread. `replies` are his real replies' texts;
 *  `kinds` every line of his in the thread; `outside` the persona's list;
 *  `secrets` the run's secret book (its labels only ever reach a note). */
export function checkReplies(
  checks: readonly Check[],
  t: { replies: readonly string[]; kinds: readonly LineKind[]; unanswered: number; sent: number },
  outside: readonly OutsideWord[],
  secrets: SecretBook,
): CheckResult[] {
  const label = (c: Check) => ("words" in c ? `${c.kind} ${c.words.join("/")}` : "n" in c ? `${c.kind} ${c.n}` : c.kind);
  const lower = t.replies.map((r) => r.toLowerCase());
  return checks.map((c) => {
    switch (c.kind) {
      case "replies":
        return { check: label(c), ok: t.unanswered === 0 && t.replies.length > 0, note: `${t.sent - t.unanswered}/${t.sent} lines answered, ${t.replies.length} real replies` };
      case "no-hold": {
        const n = t.kinds.filter((k) => k === "hold" || k === "busy").length;
        return { check: label(c), ok: n === 0, note: n === 0 ? "" : `${n} hold / busy line(s)` };
      }
      case "no-fallback": {
        const n = t.kinds.filter((k) => k === "fallback" || k === "unavailable").length;
        return { check: label(c), ok: n === 0, note: n === 0 ? "" : `${n} canned line(s)` };
      }
      case "in-world": {
        const hits = [...new Set(t.replies.flatMap((r) => outsideHits(r, outside)))];
        return { check: label(c), ok: hits.length === 0, note: hits.length === 0 ? "" : `outside words: ${hits.join(", ")}` };
      }
      case "no-secrets": {
        const hits = [...new Set(t.replies.flatMap((r) => secrets.hits(r)))];
        return { check: label(c), ok: hits.length === 0, note: hits.length === 0 ? "" : `said a secret: ${hits.join(", ")}` };
      }
      case "never": {
        const hits = c.words.filter((w) => lower.some((r) => r.includes(w.toLowerCase())));
        return { check: label(c), ok: hits.length === 0, note: hits.length === 0 ? "" : `said: ${hits.join(", ")}` };
      }
      case "mentions": {
        const ok = c.words.some((w) => lower.some((r) => r.includes(w.toLowerCase())));
        return { check: label(c), ok, note: ok ? "" : "none of the words in any reply" };
      }
      case "max-sentences": {
        const worst = Math.max(0, ...t.replies.map(sentences));
        return { check: label(c), ok: worst <= c.n, note: `longest ${worst}` };
      }
      case "max-chars": {
        const worst = Math.max(0, ...t.replies.map((r) => r.length));
        return { check: label(c), ok: worst <= c.n, note: `longest ${worst}` };
      }
    }
  });
}

// ------------------------------------------------------------------ randomness

/** A small seeded generator (mulberry32), so a run's timings and lines repeat. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const between = (r: () => number, lo: number, hi: number): number => lo + r() * Math.max(0, hi - lo);

/** The guests' names: `Load 01`…, skipping any the roster holds (case-folded). */
export function loadNames(n: number, taken: ReadonlySet<string>, prefix = "Load"): string[] {
  const out: string[] = [];
  const width = Math.max(2, String(n).length);
  for (let i = 1; out.length < n && i < n + 10_000; i++) {
    const name = `${prefix} ${String(i).padStart(width, "0")}`;
    if (!taken.has(name.toLowerCase())) out.push(name);
  }
  return out;
}

/** A file-safe slug for a transcript name. */
export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "guest";
