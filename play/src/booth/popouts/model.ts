//! The booth's pop-outs, decided (wave 18, BOOTH-SPEC §4): pure, so each
//! rule is pinned by a test. A pop-out here is a *draft*: its buttons name
//! what they do (`BoothDo`) and `use-booth-popouts.ts` binds them to the
//! session. Which programs are wanted, who is at the door, the objective's
//! target or picker, a caller's cue: all read off the booth's view.

import { destructive, armsFirst } from "../model.ts";
import type { ChatMessage, CountdownSummary, Interaction } from "../../types.ts";
import type { BoothGuest, BoothMessage, BoothObjective, CallsView, WantedEntry } from "../wire.ts";
import type { PopOutSpec, PopTone } from "./rung.ts";

/** What a pop-out's button does, for the hook to bind. */
export type BoothDo =
  /** Press a story button (`/api/prime/act`), on a guest or (C4) none. */
  | { kind: "act"; name: string; guest?: string }
  /** Open a guest's card (`confront`: in confront mode). */
  | { kind: "card"; guest: string; confront?: "rescan" }
  /** Open the scanner, captioned for this guest. */
  | { kind: "scan"; guest?: string; name?: string }
  | { kind: "board" }
  | { kind: "door" }
  /** The door claim (A4), then the scanner. */
  | { kind: "claimDoor"; guest: string; name: string }
  | { kind: "pick"; objective: string }
  /** Arm the caller's cue on the bar. */
  | { kind: "cue"; id: string }
  /** Wave 21 (P5): open the player's Mission window. */
  | { kind: "mission" }
  /** Later, as a button ("Not yet"). */
  | { kind: "later" }
  | { kind: "ok" };

export interface DraftAction {
  id: string;
  label: string;
  kind?: "primary" | "secondary";
  arm?: boolean;
  deadMs?: number;
  closes?: boolean;
  do: BoothDo;
}

export type Draft = Omit<PopOutSpec, "actions"> & { actions: DraftAction[] };

// --- glyphs, words ---------------------------------------------------------------

const GLYPH = /^\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic}️?)*/u;

/** A label's leading emoji ("🎱 Bingo winner" → "🎱"), else "". */
export function leadingGlyph(label: string): string {
  return GLYPH.exec(label.trim())?.[0] ?? "";
}

/** A label without its leading emoji. */
export function withoutGlyph(label: string): string {
  const g = leadingGlyph(label);
  return (g === "" ? label : label.trim().slice(g.length)).trim();
}

/** "seen now" / "seen 4 min ago" / "not seen since the server started" (§8). Undefined = unknown.
 *  `lastSeen` is the server's WALL-clock ms (the presence stamp), so `wall`
 *  is wall-clock ms too — never story ms (wave 18 fix: it read "seen now"
 *  all night). */
export function boothSeen(lastSeen: number | null | undefined, wall: number): string | null {
  if (lastSeen === undefined) return null;
  if (lastSeen === null) return "not seen since the server started";
  const m = Math.floor(Math.max(0, wall - lastSeen) / 60_000);
  return m < 1 ? "seen now" : `seen ${m} min ago`;
}

/** "1:40" for a wait. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Is the guest in Bathroom Mode (a true `watch:` flag)? */
export function inBathroom(g: Pick<BoothGuest, "flags"> | null | undefined): boolean {
  return (g?.flags ?? []).some((f) => f.on && /bathroom/iu.test(f.label));
}

/** Has the guest been cleared at the door (the `Cleared` watch flag on)? */
export function isCleared(g: Pick<BoothGuest, "flags"> | null | undefined): boolean {
  return (g?.flags ?? []).some((f) => f.on && /^cleared\b/iu.test(f.label.trim()));
}

/** Who has a guest at the door (A4's `At the door` watch flag), else null. */
export function doorClaimer(g: Pick<BoothGuest, "flags"> | null | undefined): string | null {
  const f = (g?.flags ?? []).find((x) => /^at the door$/iu.test(x.label.trim()));
  const v = f?.value.trim().replace(/^"(.*)"$/u, "$1") ?? "";
  return f !== undefined && f.on && v !== "" && v !== "false" && v !== "null" ? v : null;
}

// --- the Wanted pop-out (§4.1) ---------------------------------------------------

/** What this phone remembers of a wanted entry (`loom.booth.seen.<token>`). */
export interface SeenWanted {
  markedAt: number;
  /** raised: its own pop-out; burst: covered by a burst; skip: first seen claimed by someone else. */
  mode: "raised" | "burst" | "skip";
  /** The claim when last seen. */
  claimed: string | null;
  /** The claim dropped back to nobody since a claim (A2): the "again" rev. */
  again?: true;
}

export type SeenMap = Record<string, SeenWanted>;

export interface WantedCtx {
  me: string;
  /** Story ms now. */
  now: number;
  /** Wall-clock ms now (`lastSeen` is wall clock); default `Date.now()`. */
  wall?: number;
  placeTitle: (loc: string | null) => string | null;
  guestOf: (id: string) => BoothGuest | null;
  /** Ids this phone pressed 🙋 on: someone else's claim then reads "got there first". */
  tried: ReadonlySet<string>;
  /** The story ships `release_escort` (A2): "Hand it back". */
  canRelease: boolean;
}

/** Entries whose marks landed within `ms` of each other, in clusters of ≥ 2 (oldest first). */
export function burstOf(entries: readonly WantedEntry[], ms = 10_000): WantedEntry[][] {
  const sorted = [...entries].sort((a, b) => a.markedAt - b.markedAt);
  const out: WantedEntry[][] = [];
  let cur: WantedEntry[] = [];
  for (const e of sorted) {
    if (cur.length > 0 && e.markedAt - cur[cur.length - 1]!.markedAt > ms) {
      if (cur.length >= 2) out.push(cur);
      cur = [];
    }
    cur.push(e);
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

const place = (ctx: WantedCtx, loc: string | null) => ctx.placeTitle(loc) ?? "somewhere: not seen in a room";

function wantedGuest(w: WantedEntry, ctx: WantedCtx) {
  const g = ctx.guestOf(w.id);
  const seen = inBathroom(g) ? "🚻 In Bathroom Mode: wait outside, never go in." : boothSeen(w.lastSeen, ctx.wall ?? Date.now());
  return { id: w.id, name: w.name, avatar: w.avatar ?? null, location: ctx.placeTitle(w.location), seen };
}

function reasonLines(w: Pick<WantedEntry, "reason">): string[] {
  const r = w.reason?.trim() ?? "";
  return r !== "" ? ["Marked for reinstallation:", r] : ["Marked for reinstallation."];
}

/** The three variants of one entry's pop-out. */
export function wantedSpec(w: WantedEntry, variant: "open" | "mine" | "taken", ctx: WantedCtx, again = false): Draft {
  const key = `wanted:${w.id}`;
  const guest = wantedGuest(w, ctx);
  if (variant === "open") {
    return {
      key,
      rev: `open:${w.markedAt}${again ? ":again" : ""}`,
      glyph: "🚨",
      title: "WANTED",
      body: [...reasonLines(w), inBathroom(ctx.guestOf(w.id)) ? "" : "not hindered yet"],
      guest: { ...guest, location: place(ctx, w.location) },
      actions: [
        { id: "claim", label: "🙋 I'll get them", kind: "primary", closes: false, do: { kind: "act", name: "claim_escort", guest: w.id } },
        { id: "card", label: "🗂 Open card", do: { kind: "card", guest: w.id } },
      ],
      tone: "alarm",
      sticky: true,
      priority: 90,
      status: "Nobody is on it yet.",
      at: w.markedAt,
    };
  }
  if (variant === "mine") {
    return {
      key,
      rev: `mine:${w.markedAt}`,
      glyph: "🚨",
      title: "WANTED · YOURS",
      body: ["You're on it. Find them and scan their pass: the scan is the confrontation."],
      guest: { ...guest, location: place(ctx, w.location) },
      actions: [
        { id: "scan", label: "📷 Scan their pass", kind: "primary", do: { kind: "scan", guest: w.id, name: w.name } },
        ...(ctx.canRelease ? [{ id: "release", label: "Hand it back", do: { kind: "act" as const, name: "release_escort", guest: w.id } }] : []),
        { id: "ok", label: "OK", do: { kind: "ok" } },
      ],
      noLater: true,
      tone: "info",
      sticky: true,
      priority: 85,
      at: w.markedAt,
    };
  }
  const by = w.claimedBy ?? "";
  return {
    key,
    rev: `taken:${by}`,
    glyph: "🚨",
    title: "WANTED · TAKEN",
    body: [ctx.tried.has(w.id) ? `🙋 ${by} got there first.` : `🙋 ${by} is on ${w.name}.`],
    guest: { ...guest, location: place(ctx, w.location), seen: null },
    actions: [
      { id: "ok", label: "OK", kind: "primary", do: { kind: "ok" } },
      { id: "card", label: "🗂 Open card", do: { kind: "card", guest: w.id } },
    ],
    noLater: true,
    tone: "info",
    sticky: false,
    sound: false,
    priority: 30,
    autoRetireMs: 6000,
    at: w.markedAt,
  };
}

/** The burst pop-out: n programs marked together. */
export function burstSpec(group: readonly WantedEntry[], ctx: WantedCtx): Draft {
  const min = Math.min(...group.map((w) => w.markedAt));
  return {
    key: `wanted-burst:${min}`,
    // A burst that grows shows again (a handled one is `{key, rev}`).
    rev: String(group.length),
    glyph: "🚨",
    title: `${group.length} programs marked`,
    body: group.length > 4 ? [`+${group.length - 4} more on the board.`] : [],
    rows: group.slice(0, 4).map((w) => ({ id: w.id, name: w.name, avatar: w.avatar ?? null, location: ctx.placeTitle(w.location) })),
    actions: [{ id: "board", label: "🚨 Open the Wanted board", kind: "primary", do: { kind: "board" } }],
    tone: "alarm",
    sticky: true,
    priority: 90,
    at: min,
  };
}

/**
 * Every Wanted pop-out this snapshot asks for: `raise` (drafts), `retire`
 * (keys now moot: caught, gone, unmarked) and the phone's next memory.
 * Rules: a new unclaimed entry pops (a cluster of ≥ 2 within 10 s is one
 * burst); one first seen already claimed by someone else never pops; my
 * claim turns it YOURS; someone else's claim on one that popped turns it
 * TAKEN (it retires itself after 6 s); a claim dropped back pops "again".
 */
export function wantedSpecs(wanted: readonly WantedEntry[], seen: SeenMap, ctx: WantedCtx): { raise: Draft[]; retire: string[]; seen: SeenMap } {
  const raise: Draft[] = [];
  const retire: string[] = [];
  const next: SeenMap = {};
  const fresh = wanted.filter((w) => !w.captured && w.claimedBy === null && seen[w.id]?.markedAt !== w.markedAt);
  // A burst forms across snapshots too (BN-F9: marks a second apart came
  // as separate snapshots): every loose, unclaimed entry already popped
  // (single or burst) joins a fresh one marked within 10 s; a single that
  // joins folds into the burst.
  const freshIds = new Set(fresh.map((w) => w.id));
  const joinable = wanted.filter((w) => !w.captured && w.claimedBy === null && (freshIds.has(w.id) || (seen[w.id]?.markedAt === w.markedAt && (seen[w.id]!.mode === "raised" || seen[w.id]!.mode === "burst"))));
  const bursts = burstOf(joinable).filter((g) => g.some((w) => freshIds.has(w.id)));
  const inBurst = new Set(bursts.flat().map((w) => w.id));
  for (const g of bursts) raise.push(burstSpec(g, ctx));
  for (const w of wanted) {
    const key = `wanted:${w.id}`;
    const was = seen[w.id]?.markedAt === w.markedAt ? seen[w.id]! : undefined;
    if (w.captured) {
      retire.push(key);
      if (was !== undefined) next[w.id] = { ...was, claimed: w.claimedBy };
      continue;
    }
    if (was === undefined) {
      if (w.claimedBy !== null && w.claimedBy !== ctx.me) {
        next[w.id] = { markedAt: w.markedAt, mode: "skip", claimed: w.claimedBy };
        continue;
      }
      const mode = inBurst.has(w.id) ? "burst" : "raised";
      next[w.id] = { markedAt: w.markedAt, mode, claimed: w.claimedBy };
      if (w.claimedBy === ctx.me) raise.push(wantedSpec(w, "mine", ctx));
      else if (mode === "raised") raise.push(wantedSpec(w, "open", ctx));
      continue;
    }
    if (inBurst.has(w.id) && was.mode === "raised") {
      // Folded into a burst: its single goes.
      retire.push(key);
      next[w.id] = { ...was, mode: "burst", claimed: w.claimedBy };
      continue;
    }
    const again = was.again === true || (was.claimed !== null && w.claimedBy === null);
    next[w.id] = { ...was, claimed: w.claimedBy, ...(again ? { again: true as const } : {}) };
    if (w.claimedBy === ctx.me) raise.push(wantedSpec(w, "mine", ctx));
    else if (w.claimedBy !== null) {
      if (was.mode === "raised" || was.claimed === ctx.me) raise.push(wantedSpec(w, "taken", ctx));
    } else if (was.mode === "raised" || again) {
      if (again) next[w.id] = { ...next[w.id]!, mode: "raised" };
      raise.push(wantedSpec(w, "open", ctx, again));
    }
  }
  // Moot: the entry left the board.
  const now = new Set(wanted.map((w) => w.id));
  for (const id of Object.keys(seen)) if (!now.has(id)) retire.push(`wanted:${id}`);
  return { raise, retire, seen: next };
}

// --- what the store holds vs the night (fix round: BN-F4, NM-F7, NM-F8, NM-F13) ---

/** A pop-out the store holds: its spec (handlers or not) and whether it came back from storage without them. */
export interface HeldPopOut {
  spec: Pick<PopOutSpec, "key" | "title" | "glyph" | "body" | "tone" | "priority" | "at" | "sticky"> & Partial<Pick<PopOutSpec, "guest" | "rows" | "rev" | "status" | "noLater">>;
  restored?: boolean;
}

export interface ReconcileCtx {
  /** `PrimeView.wanted`, or null (no board for this booth / an older server). */
  wanted: readonly WantedEntry[] | null;
  /** The booth's live objectives (the NOW one first). */
  objectives: readonly BoothObjective[];
  calls: CallsView | null;
  guestOf: (id: string) => BoothGuest | null;
  wctx: WantedCtx;
}

function loose(ctx: ReconcileCtx, id: string): WantedEntry | null {
  return (ctx.wanted ?? []).find((w) => w.id === id && !w.captured) ?? null;
}

/**
 * The pop-outs the night has made moot (`retire`), and the ones restored
 * from storage without their buttons that are still true (`rebind`: drafts
 * with the same key, so a raise puts the buttons back in place):
 * - `pick:<objective>:…` — the objective ended (a stale list that opened
 *   nothing, NM-F7 / BN-F4);
 * - `target:…` — not the NOW objective's target any more (a restored one
 *   always goes: the driver raises the live one);
 * - `wanted:<id>` — off the board, or caught;
 * - `wanted-burst:…` — fewer than two of its programs still loose and
 *   unclaimed (its rows shrink to those that are);
 * - `confront:<seq>` — the program is caught, or no longer marked (NM-F8);
 * - `cue:<id>:<presses>` — the sheet moved on, or the cue stopped being live.
 */
export function reconcilePopOuts(held: readonly HeldPopOut[], ctx: ReconcileCtx): { retire: string[]; rebind: Draft[] } {
  const retire: string[] = [];
  const rebind: Draft[] = [];
  const base = (s: HeldPopOut["spec"]) => ({ ...s, body: s.body });
  for (const h of held) {
    const s = h.spec;
    const k = s.key;
    if (k.startsWith("pick:")) {
      const rest = k.slice(5);
      const obj = rest.slice(0, rest.lastIndexOf(":"));
      const o = ctx.objectives.find((x) => x.id === obj);
      if (o === undefined) retire.push(k);
      else {
        // The count follows the list ("6 programs" with 5 left, BN-F19).
        const n = o.pick?.length ?? 0;
        const body = [`${n} program${n === 1 ? "" : "s"}`];
        const stale = JSON.stringify(Array.isArray(s.body) ? s.body : [s.body]) !== JSON.stringify(body);
        if (h.restored === true || stale) rebind.push({ ...base(s), body, actions: [{ id: "open", label: s.glyph === "🎮" ? "🎮 Open" : "📋 Open the list", kind: "primary", do: { kind: "pick", objective: obj } }] });
      }
      continue;
    }
    if (k.startsWith("target:")) {
      if (h.restored === true || !ctx.objectives.slice(0, 1).some((o) => o.target != null && k.startsWith(`target:${o.id}:${o.target.id}:`))) retire.push(k);
      continue;
    }
    if (k.startsWith("wanted-burst:")) {
      if (ctx.wanted === null) continue;
      const members = (s.rows ?? []).map((r) => r.id).map((id) => loose(ctx, id)).filter((w): w is WantedEntry => w !== null && w.claimedBy === null);
      if (members.length < 2) retire.push(k);
      else if (h.restored === true || members.length !== (s.rows ?? []).length) rebind.push({ ...burstSpec(members, ctx.wctx), key: k });
      continue;
    }
    if (k.startsWith("wanted:")) {
      if (ctx.wanted === null) continue;
      const w = loose(ctx, k.slice(7));
      if (w === null) retire.push(k);
      else if (h.restored === true) {
        if (w.claimedBy !== null && w.claimedBy !== ctx.wctx.me) retire.push(k);
        else rebind.push(wantedSpec(w, w.claimedBy === ctx.wctx.me ? "mine" : "open", ctx.wctx));
      }
      continue;
    }
    if (k.startsWith("confront:")) {
      const id = s.guest?.id;
      if (id === undefined) continue;
      const g = ctx.guestOf(id);
      const caught = g?.captured === true || (ctx.wanted ?? []).some((w) => w.id === id && w.captured);
      const unmarked = ctx.wanted !== null && !ctx.wanted.some((w) => w.id === id);
      if (caught || unmarked) retire.push(k);
      else if (h.restored === true) rebind.push({ ...base(s), actions: [{ id: "open", label: "🛡 Open the confrontation", kind: "primary", do: { kind: "card", guest: id, confront: "rescan" } }] });
      continue;
    }
    if (k.startsWith("mission:")) {
      // Wave 21 (P5): moot once its objective has ended; a restored one gets its Go back.
      const id = k.slice("mission:".length);
      if (!ctx.objectives.some((o) => o.id === id)) retire.push(k);
      else if (h.restored === true) rebind.push({ ...base(s), actions: [{ id: "go", label: "▣ Go", kind: "primary", do: { kind: "mission" } }] });
      continue;
    }
    if (k.startsWith("cue:")) {
      const rest = k.slice(4);
      const at = rest.lastIndexOf(":");
      const id = rest.slice(0, at);
      const presses = Number(rest.slice(at + 1));
      const c = ctx.calls;
      if (c === null || c.presses !== presses || !c.rows.some((r) => r.id === id && r.live)) retire.push(k);
      else if (h.restored === true)
        rebind.push({
          ...base(s),
          actions: [
            { id: "call", label: "🎤 Call it", kind: "primary", do: { kind: "cue", id } },
            { id: "later", label: "Not yet", closes: false, do: { kind: "later" } },
          ],
        });
    }
  }
  return { retire, rebind };
}

// --- the Wanted board's order (§4.2) ----------------------------------------------

/** Board order: unclaimed (newest mark first), mine, others' (oldest claim first: by mark), captured last. */
export function boardOrder(wanted: readonly WantedEntry[], me: string): WantedEntry[] {
  const rank = (w: WantedEntry) => (w.captured ? 3 : w.claimedBy === null ? 0 : w.claimedBy === me ? 1 : 2);
  return [...wanted].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? b.markedAt - a.markedAt : a.markedAt - b.markedAt) || a.name.localeCompare(b.name));
}

export type BoardTab = "open" | "mine" | "everyone";

export function boardTab(w: WantedEntry, tab: BoardTab, me: string): boolean {
  if (tab === "everyone") return true;
  if (tab === "open") return !w.captured && w.claimedBy === null;
  return !w.captured && w.claimedBy === me;
}

/** The board's status bar: "3 marked · 2 claimed · 0 caught". */
export function boardStatus(wanted: readonly WantedEntry[]): string {
  const caught = wanted.filter((w) => w.captured).length;
  const loose = wanted.filter((w) => !w.captured);
  return `${loose.length} marked · ${loose.filter((w) => w.claimedBy !== null).length} claimed · ${caught} caught`;
}

/** A claim held this long reads "Still on it? 🙋 Take over" (A3). */
export const STALE_CLAIM_MS = 10 * 60_000;

// --- the confrontation (§4.3) ----------------------------------------------------

/** The shield button among the live ids: the first whose label starts with 🛡, else `send to the internet`. */
export function shieldId(liveIds: readonly string[], interactions: readonly Interaction[]): string | null {
  const byId = new Map(interactions.map((i) => [i.id, i]));
  for (const id of liveIds) if (byId.get(id)?.label.trim().startsWith("🛡")) return id;
  return liveIds.includes("send to the internet") ? "send to the internet" : null;
}

export interface Confront {
  guest: string;
  name: string;
  reason: string | null;
  shield: string;
  /** Two taps (a remote rescan) or one after a dead time (in person). */
  arm: boolean;
  deadMs: number;
  claimedBy: string | null;
}

/** The dead time before 🛡 takes a tap after an in-person scan. */
export const CONFRONT_DEAD_MS = 600;

/**
 * Is this scan the confrontation? Only a scan of a wanted, uncaptured
 * program whose card offers the shield button. In person (the scanner) it is
 * one tap after `CONFRONT_DEAD_MS`; a card's *Scan again* arms (two taps).
 */
export function confrontFor(result: { guest: { id: string; name?: string; captured?: boolean }; card?: { live: readonly string[] } | undefined }, wanted: readonly WantedEntry[] | null, interactions: readonly Interaction[], source: "scanner" | "rescan"): Confront | null {
  if (wanted === null || result.guest.captured === true) return null;
  const w = wanted.find((x) => x.id === result.guest.id);
  if (w === undefined || w.captured) return null;
  const live = result.card?.live;
  if (live === undefined) return null;
  const shield = shieldId(live, interactions);
  if (shield === null) return null;
  return { guest: w.id, name: w.name, reason: w.reason, shield, arm: source === "rescan", deadMs: source === "scanner" ? CONFRONT_DEAD_MS : 0, claimedBy: w.claimedBy };
}

/** The confrontation's status bar after "Scanned {time}". */
export function claimNote(claimedBy: string | null, me: string): string {
  return claimedBy === null ? "nobody had claimed them" : claimedBy === me ? "claimed by you" : `${claimedBy}'s claim`;
}

// --- pickers (§4.5–4.7) -----------------------------------------------------------

export type PickLayout = "target" | "steps" | "rows";

const RESERVED = new Set(["pass", "scan"]);

/** The objective's story buttons (never pass / scan), in written order, known to the view. */
export function objectiveButtons(o: Pick<BoothObjective, "buttons">, interactions: readonly Interaction[]): Interaction[] {
  const byId = new Map(interactions.map((i) => [i.id, i]));
  return o.buttons.filter((id) => !RESERVED.has(id) && byId.has(id)).map((id) => byId.get(id)!);
}

/**
 * The layout a NOW objective's picker takes, on the phone: `target` when it
 * names one; `steps` when it has a pick and ≥ 2 buttons whose leading glyphs
 * each open one of its to-do lines; `rows` for any other pick; else none.
 */
export function pickLayout(o: BoothObjective | undefined, interactions: readonly Interaction[]): PickLayout | null {
  if (o === undefined) return null;
  if (o.target !== undefined && o.target !== null) return "target";
  if (!Array.isArray(o.pick)) return null;
  const btns = objectiveButtons(o, interactions);
  const lineGlyphs = new Set(o.checklist.map((c) => leadingGlyph(c.label)).filter((g) => g !== ""));
  if (btns.length >= 2 && btns.every((b) => { const g = leadingGlyph(b.label); return g !== "" && lineGlyphs.has(g); })) return "steps";
  return "rows";
}

export interface WizardStep {
  id: string;
  label: string;
  glyph: string;
  /** The to-do line it answers ("🎱 Who shouted BINGO?"). */
  prompt: string;
  destructive: boolean;
  /** Pre-select the previous step's guest (a harmless follow-on). */
  preselect: boolean;
  /** Wave 26 (B1): its to-do line is already ticked (🎱 pressed from Check
   *  The Bingo before PLAYER SELECT opened). */
  satisfied?: boolean;
}

/** PLAYER SELECT's steps: the objective's buttons in checklist order, each with its prompt. */
export function wizardSteps(o: BoothObjective, interactions: readonly Interaction[]): WizardStep[] {
  const btns = objectiveButtons(o, interactions);
  const out: WizardStep[] = [];
  for (const c of o.checklist) {
    const g = leadingGlyph(c.label);
    if (g === "") continue;
    const b = btns.find((x) => leadingGlyph(x.label) === g && !out.some((s) => s.id === x.id));
    if (b === undefined) continue;
    const harm = armsFirst(b);
    out.push({ id: b.id, label: b.label, glyph: g, prompt: c.label, destructive: harm, preselect: out.length > 0 && !harm, ...(c.done === true ? { satisfied: true } : {}) });
  }
  return out;
}

/** The greyed word on a tile an earlier step chose: "(bingo winner)". */
export function stepWord(first: Pick<WizardStep, "label"> | undefined): string {
  return first === undefined ? "" : `(${withoutGlyph(first.label).replace(/[:·].*$/u, "").trim().toLowerCase()})`;
}

/** What one PLAYER SELECT / Rows press came to, for the reply line. */
export function replyLine(name: string, r: { replies?: readonly string[]; said?: ReadonlyArray<{ text: string }>; staff?: readonly string[]; toGuest?: readonly string[]; refused?: boolean } | null, opts: { player?: boolean } = {}): string {
  if (r === null) return "";
  // Wave 21 (D4): a player never reads the staff room's reason.
  if (r.refused === true && opts.player === true) return "Not now.";
  if (r.refused === true) return `Not done: ${(r.staff ?? []).find((s) => s.trim() !== "") ?? "the story took no action on this right now."}`;
  // What reached the guest's phone (BN-F13: their own lines first, then
  // what was said to them) is the only text labelled as their phone.
  const phone = (r.toGuest ?? []).map((t) => t.trim()).find((t) => t !== "") ?? (r.said ?? []).map((l) => l.text.trim()).find((t) => t !== "");
  if (phone !== undefined) return `→ ${name}'s phone: ${phone}`;
  // `replies` are the story's replies to this booth (🤐's "⭐ +5" to Clippy),
  // never the guest's: they read as the booth's own line.
  const mine = (r.replies ?? []).map((t) => t.trim()).find((t) => t !== "");
  return mine !== undefined ? `→ Sent · ${mine}` : "→ Sent. The story said nothing back.";
}

/** The pick-ready pop-out (§4.6 auto-open), or `open` when this booth's own cue just fired. */
export function pickReadySpec(o: BoothObjective, layout: PickLayout, ownFireAt: number | null, now: number, firstLive: number): Draft | "open" | null {
  if (layout !== "steps" && layout !== "rows") return null;
  if (ownFireAt !== null && now - ownFireAt <= 10_000) return "open";
  const n = o.pick?.length ?? 0;
  // Nobody to pick yet: no pop-out (it comes once the list fills).
  if (n === 0) return null;
  const steps = layout === "steps";
  return {
    key: `pick:${o.id}:${firstLive}`,
    glyph: steps ? "🎮" : "📋",
    title: steps ? "PLAYER SELECT is ready" : o.title,
    body: [`${n} program${n === 1 ? "" : "s"}`],
    actions: [{ id: "open", label: steps ? "🎮 Open" : "📋 Open the list", kind: "primary", do: { kind: "pick", objective: o.id } }],
    tone: "info",
    sticky: false,
    sound: steps,
    priority: 40,
    at: firstLive,
  };
}

/** The target pop-out (§4.8): the guest the objective names, its buttons live for them. */
export function targetSpec(o: BoothObjective, live: readonly string[] | null, interactions: readonly Interaction[], placeTitle: (loc: string | null) => string | null, firstSeen: number): Draft | null {
  const t = o.target;
  if (t === undefined || t === null) return null;
  const btns = objectiveButtons(o, interactions).filter((b) => live === null || live.includes(b.id)).slice(0, 3);
  const glyph = leadingGlyph(btns[0]?.label ?? "") || "🎯";
  return {
    key: `target:${o.id}:${t.id}:${firstSeen}`,
    glyph,
    title: o.title,
    body: ["LANDED ON"],
    guest: { id: t.id, name: t.name, avatar: t.avatar ?? null, location: placeTitle(t.location ?? null) },
    actions: [
      ...btns.map((b, n) => ({ id: b.id, label: armsFirst(b) ? `${b.label} · tap twice` : b.label, kind: n === 0 && !armsFirst(b) ? ("primary" as const) : ("secondary" as const), ...(armsFirst(b) ? { arm: true } : {}), do: { kind: "act" as const, name: b.id, guest: t.id } })),
      ...(btns.length < 4 ? [{ id: "card", label: "🗂 Open card", do: { kind: "card" as const, guest: t.id } }] : []),
    ],
    tone: "info",
    sticky: true,
    priority: 60,
    at: firstSeen,
  };
}

// --- the door queue (§4.4) --------------------------------------------------------

export interface DoorEntry {
  id: string;
  name: string;
  /** Story ms the door readout arrived. */
  since: number;
  claimedBy: string | null;
}

/** A `!!🚪` door readout (C12): its text opens with 🚪 and it names a guest. */
export function isDoorReadout(m: Pick<ChatMessage, "readout" | "about" | "text">): boolean {
  return m.readout === true && typeof m.about === "string" && m.text.trim().replace(/^!+/u, "").trim().startsWith("🚪");
}

/** Who waits at the door: one row per guest a door readout named, not yet cleared or caught, oldest first. */
export function doorQueue(messages: Iterable<BoothMessage>, guests: readonly BoothGuest[]): DoorEntry[] {
  const byId = new Map(guests.map((g) => [g.id, g]));
  const first = new Map<string, DoorEntry>();
  for (const m of messages) {
    if (m.hidden || !isDoorReadout(m)) continue;
    const id = m.about!;
    const g = byId.get(id);
    if (g === undefined || isCleared(g) || g.captured) continue;
    const prev = first.get(id);
    if (prev === undefined || m.ts < prev.since) first.set(id, { id, name: g.name ?? m.aboutName ?? id, since: m.ts, claimedBy: doorClaimer(g) });
  }
  return [...first.values()].sort((a, b) => a.since - b.since);
}

/** How long the oldest arrival waits unclaimed before the door pops during Door Duty. */
export const DOOR_WAIT_MS = 60_000;

/** The door pop-out (§4.4): at once after `Night.step ≥ 1`, else after a minute unclaimed. */
export function doorSpec(queue: readonly DoorEntry[], step: number | null | undefined, now: number, canClaim: boolean): Draft | null {
  const open = queue.filter((e) => e.claimedBy === null);
  const oldest = open[0];
  if (oldest === undefined) return null;
  const late = typeof step === "number" && step >= 1;
  if (!late && now - oldest.since < DOOR_WAIT_MS) return null;
  const more = queue.length - 1;
  return {
    key: "door",
    rev: oldest.id,
    glyph: "🚪",
    title: "At the door",
    body: [`${oldest.name} is waiting at the Optical Drive.`, `waiting ${mmss(now - oldest.since)}${more > 0 ? `   +${more} more` : ""}`],
    guest: { id: oldest.id, name: oldest.name },
    actions: [
      canClaim
        ? { id: "claim", label: `🙋 I've got ${oldest.name}`, kind: "primary", do: { kind: "claimDoor", guest: oldest.id, name: oldest.name } }
        : { id: "scan", label: `📷 Scan ${oldest.name}'s pass`, kind: "primary", do: { kind: "scan", guest: oldest.id, name: oldest.name } },
      { id: "queue", label: `🚪 Door queue (${queue.length})`, do: { kind: "door" } },
    ],
    tone: "info",
    sticky: false,
    priority: 50,
    at: oldest.since,
  };
}

// --- a caller's cue (§4.9) ----------------------------------------------------------

/** The countdown that ended within the last two minutes, if any ("Bingo time is up"). */
function justEnded(countdowns: readonly CountdownSummary[] | undefined, now: number): string | null {
  for (const c of countdowns ?? []) {
    const ended = now / 1000 - c.endsAt;
    if (ended >= 0 && ended <= 120) return c.label;
  }
  return null;
}

/** A countdown the booth has seen, and when it left the view (story ms). */
export interface CountdownMemo {
  c: CountdownSummary;
  goneAt: number | null;
}

/**
 * The countdowns the booth has seen in the last two minutes past their end
 * (BN2-FA): the server drops a countdown the moment it ends (and the story
 * stops it), so the view never carries an ended one and *Call it?* at the
 * end never popped. One that left the view near its end ran out; one taken
 * away early was stopped and is not "up". Mutates `memo`.
 */
export function rememberCountdowns(memo: Map<string, CountdownMemo>, current: readonly CountdownSummary[] | undefined, now: number): CountdownSummary[] {
  const shown = new Set<string>();
  for (const c of current ?? []) {
    memo.set(c.label, { c, goneAt: null });
    shown.add(c.label);
  }
  for (const [label, m] of memo) {
    if (!shown.has(label) && m.goneAt === null) m.goneAt = now;
    if (now / 1000 - m.c.endsAt > 120) memo.delete(label);
  }
  return [...memo.values()].filter((m) => m.goneAt === null || m.goneAt / 1000 >= m.c.endsAt - 15).map((m) => m.c);
}

/** *Call it?* for each of the caller's cues that just turned live (not live at the last look). */
export function cueSpecs(calls: CallsView, prevLive: ReadonlySet<string> | null, now: number, countdowns?: readonly CountdownSummary[]): Draft[] {
  if (prevLive === null) return [];
  const ended = justEnded(countdowns, now);
  return calls.rows
    .filter((r) => r.live && !prevLive.has(r.id))
    .map((r) => ({
      key: `cue:${r.id}:${calls.presses}`,
      glyph: "🎤",
      title: "Your cue",
      body: [`${r.code !== null ? `${r.code} ` : ""}${r.title}`, ended !== null ? `${ended} is up. Call it?` : "It's live now. Call it?", ...(r.description ? [`What it does: ${r.description}`] : [])],
      actions: [
        { id: "call", label: "🎤 Call it", kind: "primary" as const, do: { kind: "cue" as const, id: r.id } },
        { id: "later", label: "Not yet", closes: false, do: { kind: "later" as const } },
      ],
      noLater: true,
      tone: "info" as PopTone,
      sticky: true,
      priority: 70,
      at: now,
    }));
}

/**
 * Which countdown a cue that just turned live belongs to (BN-F3): one that
 * appeared with it (first seen within 5 s) — the cue is "auto at N min",
 * so *Call it?* waits until that countdown is up rather than popping as
 * the guests are told they have two minutes. Null: pop now.
 */
export function cueWaitsFor(countdowns: readonly CountdownSummary[] | undefined, firstSeen: ReadonlyMap<string, number>, now: number): string | null {
  for (const c of countdowns ?? []) {
    const at = firstSeen.get(c.label);
    if (at !== undefined && Math.abs(now - at) <= 5_000 && c.endsAt * 1000 > now) return c.label;
  }
  return null;
}

/** Is the countdown named `label` still running (not ended, still in the view)? */
export function countdownRunning(countdowns: readonly CountdownSummary[] | undefined, label: string, now: number): boolean {
  return (countdowns ?? []).some((c) => c.label === label && c.endsAt * 1000 > now);
}

/**
 * *Call it?* when a countdown just ended and the caller's own cue is the
 * sheet's NEXT (BN-F3: Bingo time is live from the doors, so no live flip
 * ever raised it): "Bingo ends is up. Call it?". Its rev names the
 * countdown, so it shows again after a *Not yet* on an earlier one.
 */
export function cueAtEnd(calls: CallsView, countdowns: readonly CountdownSummary[] | undefined, now: number): Draft | null {
  const ended = justEnded(countdowns, now);
  if (ended === null) return null;
  const row = calls.rows.find((r) => r.live && (r.next || r.id === calls.next));
  if (row === undefined) return null;
  const d = cueSpecs(calls, new Set(calls.rows.filter((r) => r.id !== row.id).map((r) => r.id)), now, countdowns).find((x) => x.key === `cue:${row.id}:${calls.presses}`);
  return d === undefined ? null : { ...d, rev: `end:${ended}` };
}

// --- what the booth's moments do with a message (§4.12) ---------------------------

export interface AdapterCtx {
  wanted: readonly WantedEntry[] | null;
  /** The guest whose scanner card / card window is open now, else null. */
  openGuest: () => string | null;
  guestName: (id: string) => string | null;
}

const bareText = (m: Pick<ChatMessage, "text">) => m.text.trim().replace(/^!+/u, "").trim();

/**
 * The adapter the moments lane calls for a booth `big` moment and every
 * `!` readout about a guest: a pop-out spec (the booth's own), `null`
 * (covered elsewhere: the Wanted pop-out, the door queue, the open
 * confrontation), or `"default"` (the rung's generic readout pop-out).
 */
export function adaptBoothMessage(m: BoothMessage, ctx: AdapterCtx): Draft | null | "default" {
  const text = bareText(m);
  const about = typeof m.about === "string" ? m.about : null;
  if (about !== null && isDoorReadout(m)) return null;
  if (about !== null && text.startsWith("🛡")) {
    if (ctx.openGuest() === about) return null;
    const name = m.aboutName ?? ctx.guestName(about) ?? about;
    return {
      key: `confront:${m.seq}`,
      glyph: "🛡",
      title: `Confrontation: ${name}`,
      body: [withoutGlyph(text)],
      guest: { id: about, name },
      actions: [{ id: "open", label: "🛡 Open the confrontation", kind: "primary", do: { kind: "card", guest: about, confront: "rescan" } }],
      tone: "alarm",
      sticky: true,
      priority: 80,
      at: m.ts,
    };
  }
  if (about !== null && (ctx.wanted ?? []).some((w) => w.id === about)) return null;
  return "default";
}

/** Is this booth message one the adapter takes (a `big` moment, or a `!` readout about a guest)? */
export function adapterTakes(m: BoothMessage): boolean {
  return (m.moment as string | undefined) === "big" || (m.alert === true && m.readout === true && typeof m.about === "string");
}

/** The booth's moments feed drops what the adapter covers another way (`null`): the readout stays in Readouts. */
export function coveredElsewhere(m: BoothMessage, ctx: AdapterCtx): boolean {
  return adapterTakes(m) && adaptBoothMessage(m, ctx) === null;
}

export { destructive };

/** §2.3's adapter, with the drafts bound to the booth's handlers. */
export function boothPopOutAdapter(ctx: AdapterCtx, bind: (d: Draft) => PopOutSpec): (m: ChatMessage) => PopOutSpec | null | "default" {
  return (m) => {
    const r = adaptBoothMessage(m as BoothMessage, ctx);
    return r === null || r === "default" ? r : bind(r);
  };
}
