// Wave 48 (C5, docs/loom-w48-contract.md): the Password Manager's filter,
// decided. Pure, so each rule is pinned by a test (`test/w48-filter.test.ts`,
// `test/w48b-filter.test.ts`). The censor's booth (`PrimeView.filter`
// present) gets one 🔑 LANGUAGE pop-out at a time for a guest line with a
// swear stem in it, a tray counter `🔑 n` and a window listing every line
// still to judge. What this phone has seen and let go lives in host storage
// under `loom.booth.filter.<token>`; Let it go never reaches the server.
// Wave 48b (C7, C10, C11, C13): the strength (⊞ Start → 🔑 Filter strength,
// 0–100 in steps of 5, its bands), each highlight in its band's colour (a
// slur a `[slur]` chip), and the ⭐ mini-game: a line's worth, the heat's
// live multiplier, what ✂ pays now, the burst on the answer.
// Booth chunk only: nothing the guest entry imports reaches this file.

import type { ReactNode } from "react";
import type { StartItem } from "../../chrome/start-menu.tsx";
import type { SessionStorage } from "../../host.ts";
import type { PopQuotePart } from "../../moments/popout-model.ts";
import type { CensorResult, FilterCombo, FilterLine, FilterTier, FilterView, PrimeView } from "../../types.ts";
import type { Draft } from "../popouts/model.ts";

// DRAFT w48: every word the filter shows is here (SIGNOFF-w48.md); the
// wave 48b lines (✂ raises suspicion, no longer a mark) are DRAFT w48b.
export const FILTER_COPY = {
  glyph: "🔑",
  caption: "LANGUAGE",
  censor: "✂ Censor",
  /** DRAFT w48b: ✂ armed (the second tap censors). */
  censorArmed: "✂ Censor? It raises their suspicion.",
  letGo: "Let it go",
  all: (n: number) => `🔑 All flagged (${n})`,
  /** The pop-out's status line: what ✂ does (DRAFT w48b). */
  hint: "✂ Censor stars it out for everyone and raises their suspicion.",
  windowTitle: (n: number) => `Language (${n})`,
  head: (censored: number, flagged: number) => `Censored ${censored} of ${flagged} flagged word${flagged === 1 ? "" : "s"}`,
  empty: "Nothing to judge.",
  /** DRAFT w48b. */
  foot: "✂ Censor takes two taps and raises their suspicion. Let it go only clears it from this phone.",
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

// DRAFT w48b: the ⭐ mini-game's words (SIGNOFF-w48.md, the 48b section).
export const FILTER_GAME_COPY = {
  /** A line's base worth (before the multiplier). */
  worth: (n: number) => `⭐ ${n}`,
  worthTitle: (n: number) => `Worth ${n} before the multiplier`,
  /** What ✂ pays now, on its button. */
  pay: (n: number) => `+${n} ⭐`,
  /** The list's header: the ⭐ tonight. */
  stars: (n: number) => `⭐ ${n} tonight`,
  heat: "Heat",
  rested: "rested",
  /** The meter, still warm: when it is back to the best multiplier. */
  coolsIn: (best: string, s: number) => `${best} in ${s} s`,
  muted: (n: number) => `${n} waiting line${n === 1 ? "" : "s"} hidden at this strength`,
  burst: (stars: number, mult: string | null) => `+${stars} ⭐${mult !== null ? ` ${mult}` : ""}`,
  /** The burst's second line, by how hot the scissors were. */
  quip: {
    none: "Too hot to pay. Let the scissors cool.",
    best: "Clean cut!",
    good: "Snip!",
    warm: "Warm scissors.",
    hot: "Getting hot.",
    hotter: "Overheating…",
    fire: "Scissors on fire.",
  },
} as const;

// DRAFT w48b: the strength window (⊞ Start → 🔑 Filter strength).
export const FILTER_LEVEL_COPY = {
  start: "Filter strength",
  title: "Filter strength",
  label: "Filter strength",
  big: (n: number) => `${n}%`,
  catches: "Catches",
  /** The legend's slur row: it never names one. */
  slurs: "Slurs (never shown)",
  off: "off",
  less: "◀ Less",
  more: "More ▶",
  saving: "Saving…",
  /** The legend's ⭐ a word. */
  points: (n: number) => `${n} ⭐`,
  foot: "It decides what new lines get caught. Lines it no longer catches wait hidden until you raise it again.",
  stays: (why: string, level: number) => `${why} Still ${level}%.`,
  refused: {
    notCensor: "Not changed: this part isn't the censor tonight.",
    doors: "Not changed: the doors are closed.",
    bad: "Not changed: that strength isn't on the dial.",
    noAnswer: "No answer.",
    offline: "No connection.",
    other: (why: string) => `Not changed: ${why}.`,
  },
} as const;

/** C7: what stands for a slur, everywhere (`FilterLine.words`, the chip). */
export const UNSAID_WORD = "[slur]";

/** One band of the strength dial (C7): the lowest strength that catches
 *  it, its key, what it adds (never naming a slur) and its ⭐ a word. */
export interface FilterBand {
  tier: FilterTier;
  key: string;
  catches: string;
  points: number;
}

// DRAFT w48b: the bands' words. Between two tiers a strength catches what
// the lower one does (40% = 25%).
export const FILTER_BANDS: readonly FilterBand[] = [
  { tier: 0, key: "slur", catches: "Slurs only", points: 12 },
  { tier: 10, key: "worst", catches: "+ fuck, cunt", points: 8 },
  { tier: 25, key: "strong", catches: "+ shit, asshole, bitch…", points: 5 },
  { tier: 50, key: "mild", catches: "+ crap, balls, butt, ass…", points: 3 },
  { tier: 60, key: "soft", catches: "+ hell, heck, darn, fart…", points: 2 },
  { tier: 75, key: "buried", catches: "+ swears hiding inside words (Scunthorpe)", points: 2 },
  { tier: 90, key: "buried-mild", catches: "+ mild ones inside words (password, button)", points: 1 },
  { tier: 100, key: "paranoid", catches: "+ everything (hello, check, Password Manager)", points: 1 },
];

/** C7: the dial's step and where the night starts. */
export const FILTER_LEVEL_STEP = 5;
export const FILTER_LEVEL_START = 100;
/** C10: the server's defaults, for a combo that leaves one out. */
export const FILTER_MULTS: readonly number[] = [3, 2, 1.5, 1, 0.5, 0.25];
export const FILTER_COOL_MS = 20_000;

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

// --- the strength (C7, C13) ------------------------------------------------------------

/** A strength on the dial: 0–100 in steps of 5 (a bad number → 100). */
export function snapLevel(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return FILTER_LEVEL_START;
  return Math.min(100, Math.max(0, Math.round(n / FILTER_LEVEL_STEP) * FILTER_LEVEL_STEP));
}

/** The strength the view says (100 from an older server). */
export function levelOf(view: Pick<FilterView, "level"> | null | undefined): number {
  return snapLevel(view?.level ?? FILTER_LEVEL_START);
}

/** The band a strength is in: the highest tier at or under it (40% is 25%'s). */
export function bandAt(level: number): FilterBand {
  const at = snapLevel(level);
  let out = FILTER_BANDS[0]!;
  for (const b of FILTER_BANDS) if (b.tier <= at) out = b;
  return out;
}

/** Every band, and whether this strength catches it (the legend). */
export function bandsAt(level: number): Array<{ band: FilterBand; on: boolean }> {
  const at = snapLevel(level);
  return FILTER_BANDS.map((band) => ({ band, on: band.tier <= at }));
}

/** ◀ / ▶: the next band's tier below / above this strength (it stays at the ends). */
export function stepBand(level: number, dir: -1 | 1): number {
  const at = snapLevel(level);
  const tiers = FILTER_BANDS.map((b) => b.tier as number);
  if (dir < 0) return tiers.filter((t) => t < at).pop() ?? 0;
  return tiers.find((t) => t > at) ?? 100;
}

/** The ⊞ Start item that opens the strength window (the censor's booth only;
 *  nothing else points at it: she has to find it). */
export function filterStartItem(open: () => void): StartItem {
  return { id: "filter-strength", icon: FILTER_COPY.glyph, label: FILTER_LEVEL_COPY.start, onClick: open };
}

/** A failed strength POST, in plain words (the dial rolls back and says so). */
export function levelRefusal(e: unknown): string {
  const err = (typeof e === "object" && e !== null ? e : {}) as { status?: unknown; message?: unknown; name?: unknown };
  const status = typeof err.status === "number" ? err.status : null;
  const why = typeof err.message === "string" ? err.message : "";
  if (status === 409 && /doors/iu.test(why)) return FILTER_LEVEL_COPY.refused.doors;
  if (status === 403 && /censor/iu.test(why)) return FILTER_LEVEL_COPY.refused.notCensor;
  if (status === 400) return FILTER_LEVEL_COPY.refused.bad;
  if (err.name === "RequestTimeout") return FILTER_LEVEL_COPY.refused.noAnswer;
  if (status === null) return FILTER_LEVEL_COPY.refused.offline;
  return FILTER_LEVEL_COPY.refused.other(why !== "" ? why : `HTTP ${status}`);
}

/** "2 waiting lines hidden at this strength"; null when none are (C11 `muted`). */
export function mutedNote(muted: unknown): string | null {
  return typeof muted === "number" && Number.isFinite(muted) && muted >= 1 ? FILTER_GAME_COPY.muted(Math.floor(muted)) : null;
}

// --- the ⭐ mini-game (C10, C11) -------------------------------------------------------------

/** The view's combo, defensively; null from an older server (no game shown). */
export function comboOf(v: unknown): FilterCombo | null {
  if (typeof v !== "object" || v === null) return null;
  const c = v as { heat?: unknown; coolMs?: unknown; mults?: unknown };
  const heat = typeof c.heat === "number" && Number.isFinite(c.heat) ? Math.max(0, c.heat) : 0;
  const coolMs = typeof c.coolMs === "number" && Number.isFinite(c.coolMs) && c.coolMs > 0 ? c.coolMs : FILTER_COOL_MS;
  const ok = Array.isArray(c.mults) && c.mults.length > 0 && c.mults.every((m) => typeof m === "number" && Number.isFinite(m) && m >= 0);
  return { heat, coolMs, mults: ok ? (c.mults as number[]) : [...FILTER_MULTS] };
}

/** The heat `elapsed` ms after the view that carried `c`. */
export function heatAt(c: FilterCombo, elapsed: number): number {
  return Math.max(0, c.heat - Math.max(0, elapsed) / c.coolMs);
}

/** C10: the notch a ✂ would get now, `ceil(heat)` capped at the last. */
export function notchAt(c: FilterCombo, elapsed: number): number {
  return Math.min(c.mults.length - 1, Math.ceil(heatAt(c, elapsed)));
}

/** C11: the multiplier now, `mults[min(len - 1, ceil(max(0, heat - elapsed / coolMs)))]`. */
export function multAt(c: FilterCombo, elapsed: number): number {
  return c.mults[notchAt(c, elapsed)] ?? 1;
}

/** C10: what a ✂ pays, `floor(points × mult)`. */
export function payOf(points: number, mult: number): number {
  if (!Number.isFinite(points) || !Number.isFinite(mult)) return 0;
  return Math.max(0, Math.floor(points * mult + 1e-9));
}

/** Ms until the multiplier changes (the next notch down), else null (rested). */
export function nextNotchMs(c: FilterCombo, elapsed: number): number | null {
  const h = heatAt(c, elapsed);
  if (h <= 0) return null;
  const cap = c.mults.length - 1;
  const n = Math.ceil(h);
  const floor = n > cap ? cap : n - 1;
  return Math.max(0, (h - floor) * c.coolMs);
}

/** Ms until the heat is gone (the best multiplier again). */
export function restedInMs(c: FilterCombo, elapsed: number): number {
  return heatAt(c, elapsed) * c.coolMs;
}

/** The meter's fill, 0–1: the heat over the hottest notch. */
export function heatShare(c: FilterCombo, elapsed: number): number {
  return Math.min(1, heatAt(c, elapsed) / Math.max(1, c.mults.length - 1));
}

const FRACTIONS: Record<string, string> = { "0.25": "¼", "0.5": "½", "0.75": "¾" };

/** "×3", "×1½", "×½", "×¼". */
export function multText(m: number): string {
  if (!Number.isFinite(m)) return "×1";
  const whole = Math.floor(m);
  const frac = FRACTIONS[String(Math.round((m - whole) * 100) / 100)];
  if (frac !== undefined) return `×${whole > 0 ? whole : ""}${frac}`;
  return `×${Math.round(m * 100) / 100}`;
}

/** What one ✂ paid (the burst): from the censor's answer. */
export interface FilterBurstData {
  /** Unique per answer (a new burst replays the animation). */
  id: number;
  stars: number;
  mult: number | null;
  points: number | null;
}

/** "+6 ⭐ ×3". */
export function burstLine(b: Pick<FilterBurstData, "stars" | "mult">): string {
  return FILTER_GAME_COPY.burst(b.stars, b.mult !== null ? multText(b.mult) : null);
}

/** The burst's quip: a 0 ⭐ ✂ at ×¼ reads as a joke, not an error. */
export function burstQuip(b: Pick<FilterBurstData, "stars" | "mult">): string {
  const q = FILTER_GAME_COPY.quip;
  if (b.stars <= 0) return q.none;
  const m = b.mult ?? 1;
  if (m >= 3) return q.best;
  if (m >= 2) return q.good;
  if (m >= 1.5) return q.warm;
  if (m >= 1) return q.hot;
  if (m >= 0.5) return q.hotter;
  return q.fire;
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
 * (on screen, queued or quiet: `held` keys not in `opts.deferred`) and the
 * window is closed. Lines that arrive while one is (or the window is open)
 * only count: they are remembered as seen and never pop. Of several new
 * lines at once, the newest pops. One put off with Later (in 🔔 Waiting,
 * `opts.deferred`) never blocks a new one: the new one retires it (its line
 * stays on the 🔑 list), so Waiting holds one 🔑 at most. A held pop-out
 * whose line left the list retires; the open window retires them all.
 */
export function filterPlan(waiting: readonly FilterLine[], seen: readonly number[], held: readonly string[], opts: { windowOpen?: boolean; deferred?: ReadonlySet<string> } = {}): FilterPlan {
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
  const deferred = opts.deferred ?? new Set<string>();
  const busy = refresh.some((l) => !deferred.has(filterPopKey(l.seq))) || opts.windowOpen === true;
  const raise = busy || fresh.length === 0 ? null : fresh[fresh.length - 1]!;
  if (raise === null) return { raise, seen: fresh.map((l) => l.seq), retire, refresh };
  // The new one takes over from any put off with Later.
  const later = refresh.filter((l) => deferred.has(filterPopKey(l.seq)));
  return { raise, seen: fresh.map((l) => l.seq), retire: [...retire, ...later.map((l) => filterPopKey(l.seq))], refresh: refresh.filter((l) => !later.includes(l)) };
}

// --- the highlight ---------------------------------------------------------------------

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
/** Inside a surrogate pair? (A bad offset never splits an emoji.) */
const splits = (text: string, i: number) => i > 0 && i < text.length && isLow(text.charCodeAt(i)) && isHigh(text.charCodeAt(i - 1));

/** One marked run: its range and its band (null from an older server). */
export interface MarkRange {
  start: number;
  end: number;
  tier: number | null;
}

const lowerTier = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.min(a, b));

/** The valid ranges of `hits` in `text`: clamped, whole characters, in
 *  order; merged where they overlap (the lower tier wins, C7) or touch
 *  within one band. */
export function tierRanges(text: string, hits: unknown): MarkRange[] {
  const len = text.length;
  const ranges: MarkRange[] = [];
  for (const h of Array.isArray(hits) ? hits : []) {
    const x = h as { start?: unknown; end?: unknown; tier?: unknown } | null;
    if (typeof x?.start !== "number" || typeof x.end !== "number" || !Number.isFinite(x.start) || !Number.isFinite(x.end)) continue;
    let a = Math.min(len, Math.max(0, Math.floor(x.start)));
    let b = Math.min(len, Math.max(0, Math.ceil(x.end)));
    if (splits(text, a)) a -= 1;
    if (splits(text, b)) b += 1;
    if (b > a) ranges.push({ start: a, end: b, tier: typeof x.tier === "number" && Number.isFinite(x.tier) ? x.tier : null });
  }
  ranges.sort((p, q) => p.start - q.start || p.end - q.end);
  const out: MarkRange[] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last !== undefined && (r.start < last.end || (r.start === last.end && r.tier === last.tier))) {
      last.end = Math.max(last.end, r.end);
      last.tier = lowerTier(last.tier, r.tier);
    } else out.push({ ...r });
  }
  return out;
}

/** The line as runs, each stem (`hits`, UTF-16 offsets) marked with its
 *  band; a slur (tier 0) is the `[slur]` chip over its stars. Bad,
 *  out-of-range or overlapping offsets never throw and never lose text. */
export function markSegments(text: string, hits: unknown): PopQuotePart[] {
  const out: PopQuotePart[] = [];
  let at = 0;
  for (const r of tierRanges(text, hits)) {
    if (r.start > at) out.push({ text: text.slice(at, r.start) });
    out.push({ text: text.slice(r.start, r.end), mark: true, ...(r.tier !== null ? { tier: r.tier } : {}), ...(r.tier === 0 ? { chip: UNSAID_WORD } : {}) });
    at = r.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** A clipped line's hit (its band kept when it has one). */
export type ClipHit = { start: number; end: number; tier?: number };

/** A long line cut to `max` around its first stem ("…" where cut), its hits moved with it. */
export function clipLine(text: string, hits: unknown, max: number = FILTER_QUOTE_MAX): { text: string; hits: ClipHit[] } {
  const ranges = tierRanges(text, hits);
  const hit = (start: number, end: number, tier: number | null): ClipHit => ({ start, end, ...(tier !== null ? { tier } : {}) });
  if (text.length <= max) return { text, hits: ranges.map((r) => hit(r.start, r.end, r.tier)) };
  const first = ranges[0]?.start ?? 0;
  let to = Math.min(text.length, Math.max(0, first - 60) + max);
  let from = Math.max(0, to - max);
  if (splits(text, from)) from += 1;
  if (splits(text, to)) to -= 1;
  const pre = from > 0 ? "…" : "";
  const post = to < text.length ? "…" : "";
  const shift = pre.length - from;
  const moved: ClipHit[] = [];
  for (const r of ranges) {
    const a = Math.max(r.start, from);
    const b = Math.min(r.end, to);
    if (b > a) moved.push(hit(a + shift, b + shift, r.tier));
  }
  return { text: `${pre}${text.slice(from, to)}${post}`, hits: moved };
}

// --- the pop-out ------------------------------------------------------------------------

/** Wave 48b (C13): the pop-out's live parts, from `game.tsx`: the heat
 *  meter with the line's worth (under the quote) and what ✂ pays now (in
 *  its button). Live content is never stored. */
export interface FilterDraftGame {
  meter?: ReactNode;
  pay?: ReactNode;
}

/**
 * 🔑 LANGUAGE for one line: the program's picture and name, where they said
 * it, the line with each stem marked in its band's colour, the ⭐ game's
 * meter (`game`), ✂ Censor (arms: two taps; armed it says it raises their
 * suspicion), Let it go, 🔑 All flagged (n) when more wait (`waiting`
 * counts this line too), and the shell's Later. Info, below everything
 * else, and it gives way to any pop-out that outranks it (`yields`), so a
 * flood never holds back a mission. Its status line says what ✂ does, or
 * the last refusal. Nothing on it points at the strength dial.
 */
export function filterDraft(line: FilterLine, waiting: number, refusal: string | null = null, game: FilterDraftGame = {}): Draft {
  const clip = clipLine(line.text, line.hits, FILTER_QUOTE_MAX);
  const name = line.name.trim() !== "" ? line.name : line.guest;
  return {
    key: filterPopKey(line.seq),
    glyph: FILTER_COPY.glyph,
    title: FILTER_COPY.caption,
    body: [],
    quote: markSegments(clip.text, clip.hits),
    ...(game.meter !== undefined ? { extra: game.meter } : {}),
    guest: { id: line.guest, name, avatar: line.avatar ?? null, seen: whereLine(line.where) },
    actions: [
      { id: "censor", label: FILTER_COPY.censor, armedLabel: FILTER_COPY.censorArmed, kind: "primary", arm: true, ...(game.pay !== undefined ? { extra: game.pay } : {}), do: { kind: "censor", seq: line.seq } },
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

/** What a ✂ came to: `done` (200: the line leaves the list; wave 48b,
 *  with what it paid when the server says), `gone` (409 already censored,
 *  or the filter no longer catches it: it leaves quietly), or `refused`
 *  (said in place). */
export type CensorOutcome = { kind: "done"; points?: number; mult?: number; stars?: number } | { kind: "gone" } | { kind: "refused"; text: string };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A 200 from ✂, read defensively (an older server sends no score). */
export function censorDone(r: Partial<CensorResult> | null | undefined): CensorOutcome {
  return { kind: "done", ...(finite(r?.points) ? { points: r!.points } : {}), ...(finite(r?.mult) ? { mult: r!.mult } : {}), ...(finite(r?.stars) ? { stars: r!.stars } : {}) };
}

/** A failed ✂, read from the error the POST threw (an `ApiError`'s status
 *  and the server's reason, a timeout, no connection). */
export function censorRefusal(e: unknown): CensorOutcome {
  const err = (typeof e === "object" && e !== null ? e : {}) as { status?: unknown; message?: unknown; name?: unknown };
  const status = typeof err.status === "number" ? err.status : null;
  const why = typeof err.message === "string" ? err.message : "";
  if (status === 409 && /already censored|no longer catches/iu.test(why)) return { kind: "gone" };
  if (status === 409 && /doors/iu.test(why)) return { kind: "refused", text: FILTER_COPY.refused.doors };
  if (status === 404) return { kind: "refused", text: FILTER_COPY.refused.notFlagged };
  if (status === 403 && /censor/iu.test(why)) return { kind: "refused", text: FILTER_COPY.refused.notCensor };
  if (err.name === "RequestTimeout") return { kind: "refused", text: FILTER_COPY.refused.noAnswer };
  if (status === null) return { kind: "refused", text: FILTER_COPY.refused.offline };
  return { kind: "refused", text: FILTER_COPY.refused.other(why !== "" ? why : `HTTP ${status}`) };
}
