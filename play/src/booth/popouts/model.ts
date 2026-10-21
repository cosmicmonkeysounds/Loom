//! The booth's pop-outs, decided (wave 18, BOOTH-SPEC §4): pure, so each
//! rule is pinned by a test. A pop-out here is a *draft*: its buttons name
//! what they do (`BoothDo`) and `use-booth-popouts.ts` binds them to the
//! session. Which programs are wanted, who is at the door, the objective's
//! target or picker, Clippy's cue: all read off the booth's view.

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
  /** Arm Clippy's cue on the bar. */
  | { kind: "cue"; id: string }
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

/** "seen now" / "seen 4 min ago" / "not seen since the server started" (§8). Undefined = unknown. */
export function boothSeen(lastSeen: number | null | undefined, now: number): string | null {
  if (lastSeen === undefined) return null;
  if (lastSeen === null) return "not seen since the server started";
  const m = Math.floor(Math.max(0, now - lastSeen) / 60_000);
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
  const seen = inBathroom(g) ? "🚻 In Bathroom Mode: wait outside, never go in." : boothSeen(w.lastSeen, ctx.now);
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
  const bursts = burstOf(fresh);
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
    out.push({ id: b.id, label: b.label, glyph: g, prompt: c.label, destructive: harm, preselect: out.length > 0 && !harm });
  }
  return out;
}

/** The greyed word on a tile an earlier step chose: "(bingo winner)". */
export function stepWord(first: Pick<WizardStep, "label"> | undefined): string {
  return first === undefined ? "" : `(${withoutGlyph(first.label).replace(/[:·].*$/u, "").trim().toLowerCase()})`;
}

/** What one PLAYER SELECT / Rows press came to, for the reply line. */
export function replyLine(name: string, r: { replies?: readonly string[]; said?: ReadonlyArray<{ text: string }>; staff?: readonly string[]; refused?: boolean } | null): string {
  if (r === null) return "";
  if (r.refused === true) return `Not done: ${(r.staff ?? []).find((s) => s.trim() !== "") ?? "the story took no action on this right now."}`;
  const said = (r.said ?? []).map((l) => l.text.trim()).find((t) => t !== "") ?? (r.replies ?? []).map((t) => t.trim()).find((t) => t !== "");
  return said !== undefined ? `→ ${name}'s phone: ${said}` : "→ Sent. The story said nothing back.";
}

/** The pick-ready pop-out (§4.6 auto-open), or `open` when this booth's own cue just fired. */
export function pickReadySpec(o: BoothObjective, layout: PickLayout, ownFireAt: number | null, now: number, firstLive: number): Draft | "open" | null {
  if (layout !== "steps" && layout !== "rows") return null;
  if (ownFireAt !== null && now - ownFireAt <= 10_000) return "open";
  const n = o.pick?.length ?? 0;
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

// --- Clippy's cue (§4.9) ----------------------------------------------------------

/** The countdown that ended within the last two minutes, if any ("Bingo time is up"). */
function justEnded(countdowns: readonly CountdownSummary[] | undefined, now: number): string | null {
  for (const c of countdowns ?? []) {
    const ended = now / 1000 - c.endsAt;
    if (ended >= 0 && ended <= 120) return c.label;
  }
  return null;
}

/** *Call it?* for each of Clippy's cues that just turned live (not live at the last look). */
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
