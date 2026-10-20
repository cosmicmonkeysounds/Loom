//! The Codex and the Quest Log as filing cabinets (wave 13): entries are
//! long, so each is a one-line row, collapsed by default, grouped by
//! category; quests put what is in progress first and fold what is over.
//! Pure — `codex-room.test.ts`, `quest-room.test.ts`.

import type { ChatMessage, CodexCard, QuestStatus } from "../types.ts";
import { questStatusOf, repliesFor } from "./runs.ts";

// --- the Codex ------------------------------------------------------------------

/** An entry's group: its authored `category:`, else by what it is about. */
export function codexCategory(card: Pick<CodexCard, "category" | "aboutKind">): string {
  const c = card.category?.trim();
  if (c) return c;
  if (card.aboutKind === "character") return "People";
  if (card.aboutKind === "location") return "Places";
  return "The story";
}

export interface CodexRow {
  /** The message (the newest copy of the entry). */
  msg: ChatMessage;
  card: CodexCard;
  category: string;
  /** When the entry was first learned (its oldest copy's seq). */
  first: number;
}

export interface CodexGroup {
  title: string;
  rows: CodexRow[];
}

/** One row per entry held (a re-share keeps the newest copy), newest first. */
export function codexRows(messages: readonly ChatMessage[]): CodexRow[] {
  const byEntry = new Map<string, ChatMessage>();
  const first = new Map<string, number>();
  for (const m of messages) {
    if (m.kind !== "codex" || m.codex === undefined || m.parentSeq != null) continue;
    const prev = byEntry.get(m.codex.entry);
    if (prev === undefined || prev.seq < m.seq) byEntry.set(m.codex.entry, m);
    first.set(m.codex.entry, Math.min(first.get(m.codex.entry) ?? Infinity, m.seq));
  }
  return [...byEntry.values()]
    .sort((a, b) => b.seq - a.seq)
    .map((msg) => ({ msg, card: msg.codex!, category: codexCategory(msg.codex!), first: first.get(msg.codex!.entry)! }));
}

/** Does a row match the filter box (title, subject, category, text; folded)? */
export function codexMatches(row: CodexRow, query: string): boolean {
  const q = fold(query);
  if (q === "") return true;
  return [row.card.title, row.card.about ?? "", row.category, row.msg.text, row.card.from ?? ""].some((s) => fold(s).includes(q));
}

function fold(s: string): string {
  return s.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

/** Rows grouped by category, groups in the order their first entry was
 *  learned (so the cabinet never reshuffles), rows newest first. */
export function codexGroups(rows: readonly CodexRow[], query = ""): CodexGroup[] {
  const firstSeq = new Map<string, number>();
  for (const r of rows) firstSeq.set(r.category, Math.min(firstSeq.get(r.category) ?? Infinity, r.first));
  const groups = new Map<string, CodexRow[]>();
  for (const r of rows) {
    if (!codexMatches(r, query)) continue;
    const g = groups.get(r.category) ?? [];
    g.push(r);
    groups.set(r.category, g);
  }
  return [...groups.entries()].sort((a, b) => firstSeq.get(a[0])! - firstSeq.get(b[0])!).map(([title, rs]) => ({ title, rows: rs }));
}

/** "Unlocked with a code" / "Learned tonight" / "Shared by Ada". */
export function codexVia(card: Pick<CodexCard, "via" | "from">): string {
  if (card.via === "share" && card.from) return `Shared by ${card.from.replace(/_/g, " ")}`;
  if (card.via === "code") return "Unlocked with a code";
  if (card.via === "story") return "Learned tonight";
  return "";
}

/** The rows' short tag line: "about Trabolta · Shared by Ada". */
export function codexSub(row: CodexRow): string {
  return [row.card.about ? `about ${row.card.about.replace(/_/g, " ")}` : "", codexVia(row.card)].filter(Boolean).join(" · ");
}

// --- "new" until opened (per device) ---------------------------------------------

/** Which entries are new: not opened yet. With no record (this device's
 *  first look), only the newest entry is new — the one you just learned. */
export function newEntries(rows: readonly CodexRow[], seen: ReadonlySet<string> | null): Set<string> {
  if (seen === null) return new Set(rows.length > 0 ? [rows[0]!.card.entry] : []);
  return new Set(rows.filter((r) => !seen.has(r.card.entry)).map((r) => r.card.entry));
}

/** The record to keep once `entry` is opened (or, first time, everything but the new). */
export function markSeen(rows: readonly CodexRow[], seen: ReadonlySet<string> | null, entry: string | null): string[] {
  const base = seen ?? new Set(rows.slice(1).map((r) => r.card.entry));
  const next = new Set(base);
  if (entry !== null) next.add(entry);
  return [...next];
}

// --- the Quest Log ---------------------------------------------------------------

export interface QuestRow {
  /** The quest's card (its thread root). */
  root: ChatMessage;
  status: QuestStatus;
  /** Its steps, oldest first. */
  steps: ChatMessage[];
  /** What the newest step says (the brief when nothing has happened yet). */
  latest: string;
}

export interface QuestSections {
  active: QuestRow[];
  done: QuestRow[];
  failed: QuestRow[];
}

const STEP_FALLBACK: Record<string, string> = { complete: "Quest complete.", fail: "Quest failed.", update: "", start: "" };

/** The quests in a log, by where they stand; active ones newest first. */
export function questSections(messages: readonly ChatMessage[]): QuestSections {
  const rows: QuestRow[] = messages
    .filter((m) => m.kind === "quest" && m.quest !== undefined && m.parentSeq == null)
    .map((root) => {
      const steps = repliesFor(messages as ChatMessage[], root.seq).filter((m) => m.quest !== undefined || m.text !== "");
      const last = steps[steps.length - 1];
      const latest = last !== undefined ? last.text || STEP_FALLBACK[last.quest?.action ?? ""] || "" : "";
      return { root, status: questStatusOf(messages as ChatMessage[], root.seq), steps, latest };
    });
  const newest = (a: QuestRow, b: QuestRow) => lastSeq(b) - lastSeq(a);
  return {
    active: rows.filter((r) => r.status === "active").sort(newest),
    done: rows.filter((r) => r.status === "done").sort(newest),
    failed: rows.filter((r) => r.status === "failed").sort(newest),
  };
}

function lastSeq(r: QuestRow): number {
  return r.steps.length > 0 ? r.steps[r.steps.length - 1]!.seq : r.root.seq;
}
