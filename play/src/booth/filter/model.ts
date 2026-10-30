// Wave 48 (C5, docs/loom-w48-contract.md): the Password Manager's filter,
// decided. Pure, so each rule is pinned by a test (`test/w48-filter.test.ts`).
// The censor's booth (`PrimeView.filter` present) gets one 🔑 LANGUAGE
// pop-out at a time for a guest line with a swear stem in it, a tray
// counter `🔑 n` and a window listing every line still to judge. What this
// phone has seen and let go lives in host storage under
// `loom.booth.filter.<token>`; Let it go never reaches the server.
// Booth chunk only: nothing the guest entry imports reaches this file.

import type { SessionStorage } from "../../host.ts";
import type { PopQuotePart } from "../../moments/popout-model.ts";
import type { FilterLine, FilterView, PrimeView } from "../../types.ts";
import type { Draft } from "../popouts/model.ts";

// DRAFT w48: every word the filter shows is here (SIGNOFF-w48.md).
export const FILTER_COPY = {
  glyph: "🔑",
  caption: "LANGUAGE",
  censor: "✂ Censor",
  letGo: "Let it go",
  all: (n: number) => `🔑 All flagged (${n})`,
  /** The pop-out's status line: what ✂ does. */
  hint: "✂ Censor stars it out for everyone and marks them for reinstallation.",
  windowTitle: (n: number) => `Language (${n})`,
  head: (censored: number, flagged: number) => `Censored ${censored} of ${flagged} flagged word${flagged === 1 ? "" : "s"}`,
  empty: "Nothing to judge.",
  foot: "✂ Censor takes two taps. Let it go only clears it from this phone.",
  trayTitle: (n: number) => `${n} flagged line${n === 1 ? "" : "s"} to judge`,
  justNow: "just now",
  ago: (min: number) => `${min} min ago`,
  refused: {
    notCensor: "Not censored: this part isn't the censor tonight.",
    notFlagged: "Not censored: that line isn't flagged any more.",
    doors: "Not censored: the doors are closed.",
    noAnswer: "No answer. Try again.",
    offline: "No connection. Try again.",
    other: (why: string) => `Not censored: ${why}`,
  },
} as const;

/** The server's view keeps the newest this many lines (C2 `FILTER_VIEW_MAX`). */
export const FILTER_VIEW_MAX = 40;
/** How many seqs each remembered set keeps (newest kept). */
export const FILTER_MEMORY_MAX = 400;
/** Below the door (50), PLAYER SELECT (40), the target (60) and a game (55). */
export const FILTER_PRIORITY = 35;
/** The pop-out quotes at most this much of a line (a window around its first stem). */
export const FILTER_QUOTE_MAX = 240;
/** The window shows at most this much of a line. */
export const FILTER_LINE_MAX = 480;

/** Where this sign-in's memory lives (host storage). */
export function filterStoreKey(token: string): string {
  return `loom.booth.filter.${token}`;
}

/** A line's pop-out key. */
export function filterPopKey(seq: number): string {
  return `filter:${seq}`;
}

/** The seq a filter pop-out key names, else null (not a filter pop-out). */
export function filterPopSeq(key: string): number | null {
  if (!key.startsWith("filter:")) return null;
  const n = Number(key.slice("filter:".length));
  return Number.isInteger(n) ? n : null;
}

// --- the phone's memory -------------------------------------------------------------

/** What this sign-in remembers: lines it has seen (a pop-out or a count) and lines it let go. */
export interface FilterMemory {
  seen: number[];
  let: number[];
}

export const EMPTY_FILTER_MEMORY: FilterMemory = { seen: [], let: [] };

/** Unique, the newest added kept, at most `max`. */
export function capSeqs(list: readonly number[], max: number = FILTER_MEMORY_MAX): number[] {
  const out: number[] = [];
  const have = new Set<number>();
  for (let i = list.length - 1; i >= 0 && out.length < max; i--) {
    const n = list[i]!;
    if (have.has(n)) continue;
    have.add(n);
    out.push(n);
  }
  return out.reverse();
}

function seqList(v: unknown): number[] {
  return Array.isArray(v) ? capSeqs(v.filter((n): n is number => typeof n === "number" && Number.isInteger(n))) : [];
}

/** Stored memory, defensively (a hand-edited or older shape → empty sets). */
export function parseFilterMemory(v: unknown): FilterMemory {
  if (typeof v !== "object" || v === null) return EMPTY_FILTER_MEMORY;
  const o = v as { seen?: unknown; let?: unknown };
  return { seen: seqList(o.seen), let: seqList(o.let) };
}

export function loadFilterMemory(storage: SessionStorage, token: string): FilterMemory {
  try {
    return parseFilterMemory(storage.load<unknown>(filterStoreKey(token)));
  } catch {
    return EMPTY_FILTER_MEMORY;
  }
}

export function saveFilterMemory(storage: SessionStorage, token: string, m: FilterMemory): void {
  try {
    storage.save(filterStoreKey(token), m);
  } catch {
    /* kept in memory */
  }
}

/** `m` with `seqs` added to one set (capped); the same object when nothing is new. */
export function remember(m: FilterMemory, set: "seen" | "let", seqs: readonly number[]): FilterMemory {
  const have = new Set(m[set]);
  const add = seqs.filter((n) => !have.has(n));
  if (add.length === 0) return m;
  return { ...m, [set]: capSeqs([...m[set], ...add]) };
}

// --- the view ------------------------------------------------------------------------

/** `PrimeView.filter`, or null (not the censor, an older server, a broken shape). */
export function filterOf(view: PrimeView | null | undefined): FilterView | null {
  const f = view?.filter;
  if (f === undefined || f === null || typeof f !== "object" || !Array.isArray(f.lines)) return null;
  return f;
}

/** The lines still to judge on this phone, oldest first: not let go here,
 *  not censored by this phone while the view catches up (`dropped`). */
export function waitingLines(view: FilterView | null, memory: FilterMemory, dropped: ReadonlySet<number> = new Set()): FilterLine[] {
  if (view === null) return [];
  const gone = new Set(memory.let);
  const have = new Set<number>();
  const out: FilterLine[] = [];
  for (const l of view.lines) {
    if (typeof l?.seq !== "number" || gone.has(l.seq) || dropped.has(l.seq) || have.has(l.seq)) continue;
    have.add(l.seq);
    out.push(l);
  }
  return out.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || a.seq - b.seq);
}

/** Forget the local drops the view has caught up with (their lines left it). Mutates `dropped`. */
export function pruneDropped(dropped: Set<number>, lines: readonly FilterLine[]): void {
  if (dropped.size === 0) return;
  const shown = new Set(lines.map((l) => l.seq));
  for (const seq of [...dropped]) if (!shown.has(seq)) dropped.delete(seq);
}

/** The window's header: "Censored 3 of 12 flagged words". */
export function filterHeader(view: Pick<FilterView, "flagged" | "censored"> | null): string {
  return FILTER_COPY.head(view?.censored ?? 0, view?.flagged ?? 0);
}

/** "in # lobby", "DM to Trabolta", "to Microsoft Excel"; null when the view says nowhere. */
export function whereLine(where: string | null | undefined): string | null {
  const w = (where ?? "").trim();
  if (w === "") return null;
  return /^(?:dm )?to\s/iu.test(w) ? w : `in ${w}`;
}

/** "just now" / "4 min ago" (story ms). */
export function agoText(ts: number, now: number): string {
  const min = Math.floor(Math.max(0, now - ts) / 60_000);
  return min < 1 ? FILTER_COPY.justNow : FILTER_COPY.ago(min);
}

// --- what pops ------------------------------------------------------------------------

export interface FilterPlan {
  /** The one line to pop now, else null. */
  raise: FilterLine | null;
  /** Lines to remember as seen (they popped or only counted). */
  seen: number[];
  /** Filter pop-outs whose line is no longer waiting (censored, let go,
   *  hidden), or that the open window now owns. */
  retire: string[];
  /** Filter pop-outs still held whose line still waits: raise again (the
   *  count on 🔑 All flagged, a refusal, buttons back after a reload). */
  refresh: FilterLine[];
}

/**
 * C5's rules for one snapshot: a line in `waiting` not seen before on this
 * sign-in pops, one pop-out at a time, only while no filter pop-out is up
 * or held (on screen, queued, quiet or in 🔔 Waiting: `held` keys) and the
 * window is closed. Lines that arrive while one is (or the window is open)
 * only count: they are remembered as seen and never pop. Of several new
 * lines at once, the newest pops. A held pop-out whose line left the list
 * retires; the open window retires them all.
 */
export function filterPlan(waiting: readonly FilterLine[], seen: readonly number[], held: readonly string[], opts: { windowOpen?: boolean } = {}): FilterPlan {
  const bySeq = new Map(waiting.map((l) => [l.seq, l]));
  const retire: string[] = [];
  const refresh: FilterLine[] = [];
  for (const k of held) {
    const seq = filterPopSeq(k);
    if (seq === null) continue;
    const line = bySeq.get(seq);
    if (line === undefined || opts.windowOpen === true) retire.push(k);
    else refresh.push(line);
  }
  const known = new Set(seen);
  const fresh = waiting.filter((l) => !known.has(l.seq));
  const busy = refresh.length > 0 || opts.windowOpen === true;
  return { raise: busy || fresh.length === 0 ? null : fresh[fresh.length - 1]!, seen: fresh.map((l) => l.seq), retire, refresh };
}

// --- the highlight ---------------------------------------------------------------------

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
/** Inside a surrogate pair? (A bad offset never splits an emoji.) */
const splits = (text: string, i: number) => i > 0 && i < text.length && isLow(text.charCodeAt(i)) && isHigh(text.charCodeAt(i - 1));

/** The valid ranges of `hits` in `text`: clamped, whole characters, merged where they overlap or touch, in order. */
export function hitRanges(text: string, hits: unknown): Array<[number, number]> {
  const len = text.length;
  const ranges: Array<[number, number]> = [];
  for (const h of Array.isArray(hits) ? hits : []) {
    const x = h as { start?: unknown; end?: unknown } | null;
    if (typeof x?.start !== "number" || typeof x.end !== "number" || !Number.isFinite(x.start) || !Number.isFinite(x.end)) continue;
    let a = Math.min(len, Math.max(0, Math.floor(x.start)));
    let b = Math.min(len, Math.max(0, Math.ceil(x.end)));
    if (splits(text, a)) a -= 1;
    if (splits(text, b)) b += 1;
    if (b > a) ranges.push([a, b]);
  }
  ranges.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const out: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last !== undefined && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** The line as runs, each stem (`hits`, UTF-16 offsets) marked. Bad,
 *  out-of-range or overlapping offsets never throw and never lose text. */
export function markSegments(text: string, hits: unknown): PopQuotePart[] {
  const out: PopQuotePart[] = [];
  let at = 0;
  for (const [a, b] of hitRanges(text, hits)) {
    if (a > at) out.push({ text: text.slice(at, a) });
    out.push({ text: text.slice(a, b), mark: true });
    at = b;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** A long line cut to `max` around its first stem ("…" where cut), its hits moved with it. */
export function clipLine(text: string, hits: unknown, max: number = FILTER_QUOTE_MAX): { text: string; hits: Array<{ start: number; end: number }> } {
  const ranges = hitRanges(text, hits);
  if (text.length <= max) return { text, hits: ranges.map(([start, end]) => ({ start, end })) };
  const first = ranges[0]?.[0] ?? 0;
  let to = Math.min(text.length, Math.max(0, first - 60) + max);
  let from = Math.max(0, to - max);
  if (splits(text, from)) from += 1;
  if (splits(text, to)) to -= 1;
  const pre = from > 0 ? "…" : "";
  const post = to < text.length ? "…" : "";
  const shift = pre.length - from;
  const moved: Array<{ start: number; end: number }> = [];
  for (const [a, b] of ranges) {
    const s = Math.max(a, from);
    const e = Math.min(b, to);
    if (e > s) moved.push({ start: s + shift, end: e + shift });
  }
  return { text: `${pre}${text.slice(from, to)}${post}`, hits: moved };
}

// --- the pop-out ------------------------------------------------------------------------

/**
 * 🔑 LANGUAGE for one line: the program's picture and name, where they said
 * it, the line with each stem marked, ✂ Censor (arms: two taps), Let it go,
 * 🔑 All flagged (n) when more wait (`waiting` counts this line too), and
 * the shell's Later. Info, below everything else, and it gives way to any
 * pop-out that outranks it (`yields`), so a flood never holds back a
 * mission. Its status line says what ✂ does, or the last refusal.
 */
export function filterDraft(line: FilterLine, waiting: number, refusal: string | null = null): Draft {
  const clip = clipLine(line.text, line.hits, FILTER_QUOTE_MAX);
  const name = line.name.trim() !== "" ? line.name : line.guest;
  return {
    key: filterPopKey(line.seq),
    glyph: FILTER_COPY.glyph,
    title: FILTER_COPY.caption,
    body: [],
    quote: markSegments(clip.text, clip.hits),
    guest: { id: line.guest, name, avatar: line.avatar ?? null, seen: whereLine(line.where) },
    actions: [
      { id: "censor", label: FILTER_COPY.censor, kind: "primary", arm: true, do: { kind: "censor", seq: line.seq } },
      { id: "let", label: FILTER_COPY.letGo, do: { kind: "letGo", seq: line.seq } },
      ...(waiting > 1 ? [{ id: "all", label: FILTER_COPY.all(waiting), do: { kind: "filter" as const } }] : []),
    ],
    tone: "info",
    yields: true,
    sticky: false,
    priority: FILTER_PRIORITY,
    status: refusal ?? FILTER_COPY.hint,
    at: typeof line.ts === "number" ? line.ts : 0,
  };
}

// --- ✂ ------------------------------------------------------------------------------------

/** What a ✂ came to: `done` (200: the line leaves the list), `gone` (409
 *  already censored: it leaves quietly), or `refused` (said in place). */
export type CensorOutcome = { kind: "done" } | { kind: "gone" } | { kind: "refused"; text: string };

/** A failed ✂, read from the error the POST threw (an `ApiError`'s status
 *  and the server's reason, a timeout, no connection). */
export function censorRefusal(e: unknown): CensorOutcome {
  const err = (typeof e === "object" && e !== null ? e : {}) as { status?: unknown; message?: unknown; name?: unknown };
  const status = typeof err.status === "number" ? err.status : null;
  const why = typeof err.message === "string" ? err.message : "";
  if (status === 409 && /already censored/iu.test(why)) return { kind: "gone" };
  if (status === 409 && /doors/iu.test(why)) return { kind: "refused", text: FILTER_COPY.refused.doors };
  if (status === 404) return { kind: "refused", text: FILTER_COPY.refused.notFlagged };
  if (status === 403 && /censor/iu.test(why)) return { kind: "refused", text: FILTER_COPY.refused.notCensor };
  if (err.name === "RequestTimeout") return { kind: "refused", text: FILTER_COPY.refused.noAnswer };
  if (status === null) return { kind: "refused", text: FILTER_COPY.refused.offline };
  return { kind: "refused", text: FILTER_COPY.refused.other(why !== "" ? why : `HTTP ${status}`) };
}
