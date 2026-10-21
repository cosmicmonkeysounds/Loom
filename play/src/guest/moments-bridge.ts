//! The guest lane's bridge to the moments lane (wave 18, GUEST-SPEC §4, §6).
//! The moments lane writes `moments/exits.ts` (`exitsOf`, `navOfTarget`,
//! `navFromSearch`) and `moments/delete-gags.ts` (`gagFor`, `clearGag`) in
//! parallel; their names and signatures are the spec's (§6.1, §4.2). This
//! file feature-detects those modules (`import.meta.glob` finds nothing when
//! a file isn't there yet) and falls back to a local copy of the same rules,
//! so the guest app builds and is tested on either side of the merge. The
//! spec's types (`Nav`, `Exit`, `ExitContext`) are declared here verbatim.
//!
//! `notificationsOf` (the rows of the Notifications window, §4.1) lives here
//! too: the guest window is its only reader, and the row shape is the
//! window's own.

import { noticeKey } from "../../../core/src/delivery.ts";
import type { IconName } from "../chrome/icons.tsx";
import { momentOf, namedDm, type DmRoom, type LiveCard, type Moment } from "../moments/model.ts";
import { namesViewer } from "../stream/notices.ts";
import type { ChatMessage } from "../types.ts";
import { goOf, type GoTarget } from "./wire.ts";

// --- the shared types (§6.1) -------------------------------------------------

export type Nav =
  | { to: "mission" }
  | { to: "chats" }
  | { to: "notifications" }
  | { to: "me" }
  | { to: "sides" }
  | { to: "room"; id: string; focusSeq?: number }
  | { to: "pass" }
  | { to: "scan" }
  | { to: "codex"; entry?: string }
  | { to: "quests"; quest?: string }
  | { to: "wallet" }
  | { to: "act"; id: string };

export interface Exit {
  label: string;
  icon: IconName | null;
  nav: Nav;
}

export type GuestWindowId = "mission" | "chats" | "notifications";

export interface ExitContext {
  /** Room ids the guest lists. */
  listed: ReadonlySet<string>;
  /** Room id → title. */
  titles: ReadonlyMap<string, string>;
  /** The room on screen (null when none). */
  open: string | null;
  window: GuestWindowId;
  cards: readonly LiveCard[];
  dms: readonly DmRoom[];
  /** Live guest INTERACTION ids. */
  actions: ReadonlySet<string>;
  /** `GuestView.sides` is non-empty. */
  sides: boolean;
  /** Interaction id → its label (for an `act` exit's words). */
  actionLabels?: ReadonlyMap<string, string>;
}

/** A moment as the exits read it: the moments lane's `Moment`, plus the
 *  wave 18 fields it may carry. */
export type ExitMoment = Pick<Moment, "channel" | "text" | "kind" | "severity" | "seq"> & {
  go?: readonly GoTarget[];
  card?: { seq: number; kind: string } | null;
};

/** A stable key for a nav (dedupe). */
export function navKey(n: Nav): string {
  switch (n.to) {
    case "room":
      return `room:${n.id}${n.focusSeq !== undefined ? `#${n.focusSeq}` : ""}`;
    case "codex":
      return `codex:${n.entry ?? ""}`;
    case "quests":
      return `quests:${n.quest ?? ""}`;
    case "act":
      return `act:${n.id}`;
    default:
      return n.to;
  }
}

// --- local rules (the spec's, until the moments lane's module is here) -------

const PINNED: Record<string, Nav> = { codex: { to: "codex" }, quests: { to: "quests" }, wallet: { to: "wallet" } };

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

/** A push link's `?room=` (§6.4): the lobby → Mission, a pinned room → it, a
 *  listed room → it, an unlisted one → Mission; no `room` → null. */
export function localNavFromSearch(search: string, listed: readonly string[]): Nav | null {
  let room: string | null = null;
  try {
    const v = new URLSearchParams(search).get("room");
    room = v !== null && v.trim() !== "" ? v.trim() : null;
  } catch {
    room = null;
  }
  if (room === null) return null;
  if (room === "lobby") return { to: "mission" };
  if (PINNED[room] !== undefined) return PINNED[room]!;
  return listed.includes(room) ? { to: "room", id: room } : { to: "mission" };
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
  navFromSearch: (search: string, listed: readonly string[]) => Nav | null;
}
const theirs = Object.values(import.meta.glob("../moments/exits.ts", { eager: true }))[0] as Partial<ExitsModule> | undefined;

export const exitsOf: ExitsModule["exitsOf"] = typeof theirs?.exitsOf === "function" ? theirs.exitsOf : localExitsOf;
export const navOfTarget: ExitsModule["navOfTarget"] = typeof theirs?.navOfTarget === "function" ? theirs.navOfTarget : localNavOfTarget;
export const navFromSearch: ExitsModule["navFromSearch"] = typeof theirs?.navFromSearch === "function" ? theirs.navFromSearch : localNavFromSearch;

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
