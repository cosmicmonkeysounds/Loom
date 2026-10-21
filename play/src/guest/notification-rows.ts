//! The Notifications window's rows and exits (wave 18, GUEST-SPEC §4, §6.2):
//! `notificationsOf` (every moment, every personal `~` notice, the house
//! `~` notices folded), each row's exits (`exitsOf` — the moments lane's
//! `moments/exits.ts` when it is here, else the spec's local rule: never the
//! lobby), and the delete gags (`gagFor`, `clearGag` — `moments/delete-gags.ts`
//! when it is here). Pure; only the lazy Notifications chunk imports it in
//! the app (`test/guest-exits.test.ts`, `test/notifications-window.test.tsx`).

import { noticeKey } from "../../../core/src/delivery.ts";
import type { IconName } from "../chrome/icons.tsx";
import { momentOf, namedDm, type LiveCard } from "../moments/model.ts";
import { namesViewer } from "../stream/notices.ts";
import type { ChatMessage } from "../types.ts";
import { navKey, type Exit, type ExitContext, type ExitMoment, type Nav } from "./moments-bridge.ts";
import { goOf, type GoTarget } from "./wire.ts";

const PINNED: Record<string, Nav> = { codex: { to: "codex" }, quests: { to: "quests" }, wallet: { to: "wallet" } };

// --- local rules (the spec's, until the moments lane's module is here) -------

/** C2 `GoTarget` → `Nav` (null = drop it): never the lobby, never a room the
 *  guest doesn't list, an `act` only while live, `sides` only with sides. */
export function localNavOfTarget(t: GoTarget, ctx: Pick<ExitContext, "listed" | "actions" | "sides">): Nav | null {
  switch (t.kind) {
    case "room":
    case "dm":
      if (t.id === "lobby") return { to: "mission" };
      if (PINNED[t.id] !== undefined) return PINNED[t.id]!;
      return ctx.listed.has(t.id) ? { to: "room", id: t.id } : null;
    case "codex":
      return t.entry !== undefined && t.entry !== "" ? { to: "codex", entry: t.entry } : { to: "codex" };
    case "quests":
      return t.quest !== undefined && t.quest !== "" ? { to: "quests", quest: t.quest } : { to: "quests" };
    case "act":
      return ctx.actions.has(t.id) ? { to: "act", id: t.id } : null;
    case "sides":
      return ctx.sides ? { to: "sides" } : null;
    default:
      return { to: t.kind };
  }
}

/** A room's title without its "(living room)" gloss. */
function bare(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/u, "").trim();
}

/** The default words + icon for a nav (§6.2's table). */
export function exitLabel(n: Nav, ctx: Pick<ExitContext, "titles"> & { actionLabels?: ReadonlyMap<string, string>; codexTitle?: (entry: string) => string | null; cardGlyph?: string }): { label: string; icon: IconName | null } {
  switch (n.to) {
    case "mission":
      return { label: "What do I do?", icon: "mission" };
    case "chats":
      return { label: "Chats", icon: "reply" };
    case "notifications":
      return { label: "See all", icon: "bell" };
    case "me":
      return { label: "Me", icon: "people" };
    case "sides":
      return { label: "Choose a side", icon: "defect" };
    case "pass":
      return { label: "Show my pass", icon: "pass" };
    case "scan":
      return { label: "Scan", icon: "scan" };
    case "wallet":
      return { label: "Open my Wallet", icon: "coin" };
    case "codex": {
      const t = n.entry !== undefined ? ctx.codexTitle?.(n.entry) : null;
      return { label: t ? `Read "${t.length > 24 ? `${t.slice(0, 23)}…` : t}"` : "Open the Codex", icon: "codex" };
    }
    case "quests":
      return { label: n.quest !== undefined ? "See the quest" : "Open the Quest Log", icon: "quest" };
    case "act":
      return { label: ctx.actionLabels?.get(n.id) ?? n.id, icon: null };
    case "room": {
      if (n.focusSeq !== undefined) return { label: `${ctx.cardGlyph ?? ""} Answer ›`.trim(), icon: null };
      const title = ctx.titles.get(n.id) ?? n.id;
      if (n.id.startsWith("loc:")) return { label: `Go to ${bare(title)} ›`, icon: "pin" };
      return { label: `Open ${bare(title)} ›`, icon: "reply" };
    }
  }
}

/** §6.2 `exitsOf`: the moment's buttons, in order, deduplicated, never the
 *  lobby, never the room already open, cut to `max`. */
export function localExitsOf(m: ExitMoment, ctx: ExitContext, max: 1 | 2): Exit[] {
  const out: Exit[] = [];
  const seen = new Set<string>();
  const add = (nav: Nav | null, label?: string, glyph?: string) => {
    if (nav === null) return;
    if (nav.to === "room" && nav.id === ctx.open && nav.focusSeq === undefined) return;
    const key = navKey(nav);
    if (seen.has(key)) return;
    seen.add(key);
    const d = exitLabel(nav, { titles: ctx.titles, actionLabels: ctx.actionLabels, cardGlyph: glyph });
    out.push({ label: label !== undefined && label !== "" ? label : d.label, icon: d.icon, nav });
  };
  // 1. the story's own targets
  for (const t of m.go ?? []) add(localNavOfTarget(t, ctx), t.label);
  // 2. the moment's own card (inline on a big; elsewhere "Answer ›")
  const card = m.card ?? (m.kind === "card" && m.seq !== null && m.channel !== null ? { seq: m.seq, kind: "" } : null);
  if (card !== null && (m.severity as string) !== "big" && m.channel !== null && m.channel !== "lobby" && ctx.listed.has(m.channel)) {
    const glyph = ctx.cards.find((c) => c.seq === card.seq)?.glyph;
    add({ to: "room", id: m.channel, focusSeq: card.seq }, undefined, glyph);
  }
  // 3. a live card whose glyph leads the text
  const glyph = noticeKey(m.text);
  if (glyph !== "•") {
    let best: LiveCard | undefined;
    for (const c of ctx.cards) if (c.glyph === glyph && (best === undefined || c.seq > best.seq)) best = c;
    if (best !== undefined) add({ to: "room", id: best.channel, focusSeq: best.seq }, undefined, best.glyph);
  }
  // 4. its own channel (never the lobby)
  if (m.channel !== null && m.channel !== "lobby") {
    if (PINNED[m.channel] !== undefined) add(PINNED[m.channel]!);
    else if (ctx.listed.has(m.channel)) add({ to: "room", id: m.channel });
  }
  // 5. "check your messages"
  const dm = namedDm(m.text, ctx.dms);
  if (dm !== null) add({ to: "room", id: dm });
  // 6. what do I do?
  if (!(ctx.window === "mission" && ctx.open === null)) add({ to: "mission" });
  return out.slice(0, max);
}

// --- the moments lane's module, when it is here ------------------------------

interface ExitsModule {
  exitsOf: (m: ExitMoment, ctx: ExitContext, max: 1 | 2) => Exit[];
  navOfTarget: (t: GoTarget, ctx: ExitContext) => Nav | null;
}
const theirs = Object.values(import.meta.glob("../moments/exits.ts", { eager: true }))[0] as Partial<ExitsModule> | undefined;

export const exitsOf: ExitsModule["exitsOf"] = typeof theirs?.exitsOf === "function" ? theirs.exitsOf : localExitsOf;
export const navOfTarget: ExitsModule["navOfTarget"] = typeof theirs?.navOfTarget === "function" ? theirs.navOfTarget : localNavOfTarget;

// --- the delete gags (§4.2) ----------------------------------------------------

/** ✕ on a row asks first when `seq % 4 === 0`. */
export function localGagFor(seq: number): "ask" | "delete" {
  return Math.round(seq) % 4 === 0 ? "ask" : "delete";
}
/** Clear all's outcome: 0 all gone, 1 access denied, 2 full of beans. */
export function localClearGag(n: number, firstSeq: number): 0 | 1 | 2 {
  return (((Math.round(n + firstSeq) % 3) + 3) % 3) as 0 | 1 | 2;
}
interface GagsModule {
  gagFor: (seq: number) => unknown;
  clearGag: (n: number, firstSeq: number) => number;
}
const gags = Object.values(import.meta.glob("../moments/delete-gags.ts", { eager: true }))[0] as Partial<GagsModule> | undefined;
export const clearGag: (n: number, firstSeq: number) => 0 | 1 | 2 = typeof gags?.clearGag === "function" ? (n, f) => (gags.clearGag!(n, f) % 3) as 0 | 1 | 2 : localClearGag;
export const gagFor: (seq: number) => "ask" | "delete" =
  typeof gags?.gagFor === "function"
    ? (seq) => {
        const r = gags.gagFor!(seq);
        return r === true || r === "ask" || r === "confirm" ? "ask" : "delete";
      }
    : localGagFor;

// --- the Notifications rows (§4.1) ---------------------------------------------

/** One row of the Notifications window. */
export interface NotificationRow {
  /** `m:<seq>`, or `f:<glyph>:<phase>` for a folded run of house notices. */
  key: string;
  /** The newest message's seq (the gag rule, the order). */
  seq: number;
  glyph: string;
  title: string;
  caption: string;
  rest: string;
  /** Story time (ms) of the newest message. */
  at: number;
  big: boolean;
  /** The moment, for its exits (null for a folded house run). */
  moment: ExitMoment | null;
  /** n house notices folded into this row (else undefined). */
  folded?: number;
}

/** A row's title: the first sentence (to `. ! ?` + space, ≤ 90 chars). */
export function firstSentence(text: string): { head: string; rest: string } {
  const t = text.trim();
  const m = /^(.{1,90}?[.!?])(\s+)(.*)$/su.exec(t);
  if (m !== null) return { head: m[1]!, rest: m[3]!.trim() };
  if (t.length <= 90) return { head: t, rest: "" };
  return { head: `${t.slice(0, 89)}…`, rest: t };
}

/** The row's glyph: the text's own leading pictograph, else the kind's. */
function glyphOf(text: string, kind: string): string {
  const g = noticeKey(text);
  if (g !== "•") return g;
  if (kind === "card") return "🃏";
  if (kind === "quest") return "📜";
  if (kind === "readout") return "💬";
  return "📣";
}

function stripGlyph(text: string, glyph: string): string {
  const t = text.trim();
  return t.startsWith(glyph) ? t.slice(glyph.length).trim() : t;
}

/**
 * The Notifications window's rows (pure): every moment this guest's stream
 * made (big, major, minor), every personal `~` notice, and the house `~`
 * notices folded one row per glyph + phase. Newest first, capped at 200,
 * minus the deleted keys. `acked` = big moments acknowledged.
 */
export function notificationsOf(
  messages: Iterable<ChatMessage>,
  viewer: { id: string; name: string },
  phase: string | null,
  deleted: ReadonlySet<string> = new Set(),
  cap = 200,
): NotificationRow[] {
  const rows: NotificationRow[] = [];
  const folds = new Map<string, NotificationRow>();
  const v = { role: "guest" as const, me: viewer.id };
  for (const m of messages) {
    if (m.parentSeq != null || m.hidden || m.ambient === true) continue;
    if (m.notice !== undefined && m.moment === undefined && m.alert !== true) {
      const personal = (Array.isArray(m.audience) && m.audience.includes(viewer.id) && m.channel !== "lobby") || namesViewer(m.text, viewer.name);
      const glyph = glyphOf(m.text, "other");
      if (personal) {
        const { head, rest } = firstSentence(stripGlyph(m.text, glyph));
        const key = `m:${m.seq}`;
        if (!deleted.has(key)) rows.push({ key, seq: m.seq, glyph, title: head, caption: m.from.trim() !== "" && m.from !== "Narrator" ? m.from.trim() : "", rest, at: m.ts, big: false, moment: { channel: m.channel, text: m.text, kind: "other", severity: "minor", seq: m.seq } });
        continue;
      }
      const ph = typeof m.phase === "string" ? m.phase : (phase ?? "");
      const key = `f:${glyph}:${ph}`;
      const row = folds.get(key);
      if (row === undefined) {
        folds.set(key, { key, seq: m.seq, glyph, title: "", caption: "", rest: "", at: m.ts, big: false, moment: null, folded: 1 });
      } else {
        row.folded = (row.folded ?? 0) + 1;
        if (m.seq > row.seq) {
          row.seq = m.seq;
          row.at = m.ts;
        }
      }
      continue;
    }
    const mo = momentOf(m, v, phase);
    if (mo === null) continue;
    const key = `m:${m.seq}`;
    if (deleted.has(key)) continue;
    const glyph = glyphOf(mo.text, mo.kind);
    const { head, rest } = firstSentence(stripGlyph(mo.text, glyph));
    const big = (m.moment as string | undefined) === "big";
    rows.push({
      key,
      seq: m.seq,
      glyph,
      title: head,
      caption: mo.caption,
      rest,
      at: m.ts,
      big,
      moment: { channel: mo.channel, text: mo.text, kind: mo.kind, severity: mo.severity, seq: mo.seq, go: goOf(m), ...(m.widget !== undefined ? { card: { seq: m.seq, kind: m.widget.kind } } : {}) },
    });
  }
  for (const f of folds.values()) {
    if (deleted.has(f.key)) continue;
    const n = f.folded ?? 1;
    f.title = `${n} ${n === 1 ? "update" : "updates"} about others`;
    rows.push(f);
  }
  rows.sort((a, b) => b.seq - a.seq);
  return rows.slice(0, cap);
}

// --- the window's rules (§4.1–4.2) -------------------------------------------

/** A big moment's row stays "in use" this long (story time) unless read. */
export const BIG_IN_USE_MS = 15 * 60_000;

/** How many rows the bell counts: newer than the read mark. */
export function unreadCount(rows: readonly NotificationRow[], mark: number): number {
  return rows.filter((r) => r.seq > mark).length;
}

/** Is a row an unacknowledged big moment (✕ says "in use", Clear all skips it)? */
export function inUse(row: NotificationRow, mark: number, now: number): boolean {
  return row.big && row.seq > mark && now - row.at <= BIG_IN_USE_MS;
}

/** Clear all's plan (§4.2): the rows it may delete, the gag that ends it, and
 *  the rows that stay when the gag is *Access is denied*. */
export interface ClearPlan {
  targets: NotificationRow[];
  outcome: 0 | 1 | 2;
  /** Outcome 1: the most frequent caption among the targets — its rows stay. */
  caption: string | null;
  /** The keys removed at the end. */
  remove: string[];
}

export function clearPlan(rows: readonly NotificationRow[], used: (r: NotificationRow) => boolean): ClearPlan {
  const targets = rows.filter((r) => !used(r));
  const outcome = targets.length === 0 ? 0 : clearGag(targets.length, targets[0]!.seq);
  let caption: string | null = null;
  if (outcome === 1) {
    const count = new Map<string, number>();
    for (const r of targets) {
      const c = r.caption !== "" ? r.caption : r.title;
      count.set(c, (count.get(c) ?? 0) + 1);
    }
    let best = 0;
    for (const [c, n] of count) if (n > best) [caption, best] = [c, n];
  }
  const remove = targets.filter((r) => outcome !== 1 || (r.caption !== "" ? r.caption : r.title) !== caption).map((r) => r.key);
  return { targets, outcome, caption, remove };
}

/** `'{title}'` cut at 40 characters. */
export function gagTitle(t: string): string {
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
}

