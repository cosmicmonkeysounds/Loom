//! The host panel's pure rules (wave 13): which drawer tabs show and what
//! they count, the NEXT bar's second line, a refused press and its
//! `# hosts` reason, people search, a guest's agent thread, the alert dial.
//! No React here, so every rule is tested on plain values.

import type { AlertLevel } from "../../../core/src/delivery.ts";
import { AWARD_SOURCES, PartPresence, REASON_WAIT_MS, REFUSED_NEEDS_MS, type NeedTarget } from "../../../core/src/host-board.ts";
import type { CueRow } from "../../../core/src/cue-sheet.ts";
import type { ChatMessage, HostNeed, HostPerson, HostView } from "../types.ts";
import { onDeck } from "../../../core/src/cue-sheet.ts";
import { STOPPED, actHandle, clockRuns, formatLeft, formatWatchValue, soonestCountdown, URGENT_S, type SheetLayout } from "../director.tsx";

// --- the drawer's tabs ----------------------------------------------------------

export type HostTab = "cues" | "needs" | "judge" | "people" | "more";

export interface HostTabInfo {
  id: HostTab;
  label: string;
  /** Shown as `Needs (3)`; absent when the tab counts nothing. */
  count?: number;
}

/** The drawer's tabs in order. Judge only when the event has facts; the
 *  counts are what waits on a host (needs + a refused press; pending
 *  filings). */
export function hostTabs(view: Pick<HostView, "needs" | "judging"> | null, refused: number): HostTabInfo[] {
  const out: HostTabInfo[] = [{ id: "cues", label: "Cues" }];
  out.push({ id: "needs", label: "Needs", count: groupNeeds(view?.needs ?? []).length + refused });
  if (view?.judging != null) out.push({ id: "judge", label: "Judge", count: view.judging.pending.length });
  out.push({ id: "people", label: "People" }, { id: "more", label: "More" });
  return out;
}

/** `Needs (3)`, `Cues`. */
export function tabLabel(t: HostTabInfo): string {
  return t.count !== undefined ? `${t.label} (${t.count})` : t.label;
}

/** The needs as the drawer lists them: two or more parts in the same state
 *  ("nobody signed in", "phone offline") fold into one row naming them, so
 *  ten empty booths before the doors are one line, not ten. Order kept (the
 *  folded row sits where its first member was). */
export function groupNeeds(needs: readonly HostNeed[]): HostNeed[] {
  const out: HostNeed[] = [];
  const folded = new Map<string, HostNeed[]>();
  for (const n of needs) if (n.kind === "free" || n.kind === "phone-offline") folded.set(n.kind, [...(folded.get(n.kind) ?? []), n]);
  for (const n of needs) {
    const group = folded.get(n.kind);
    if (group === undefined || group.length < 2) {
      out.push(n);
      continue;
    }
    if (group[0] !== n) continue;
    const names = group.map((g) => g.character ?? g.key);
    const text = n.kind === "free" ? `🎭 ${group.length} parts: nobody signed in` : `📱 ${group.length} parts: phone offline`;
    out.push({ kind: n.kind, key: `parts:${n.kind}`, text, detail: names.join(", "), target: "part" });
  }
  return out;
}

/** Where a need's row takes the host: a tab, or the staff room itself. */
export function needTab(target: NeedTarget): HostTab | "staff" {
  switch (target) {
    case "judge":
      return "judge";
    case "part":
    case "people":
      return "people";
    case "staff":
      return "staff";
    default:
      return "more";
  }
}

/** Which More tab a section lives on (wave 18 §5.6). */
export type MoreTabId = "night" | "house" | "setup";

export const MORE_TABS: ReadonlyArray<{ id: MoreTabId; label: string }> = [
  { id: "night", label: "Night" },
  { id: "house", label: "House" },
  { id: "setup", label: "Setup" },
];

/** A section's More tab: the night (doors, clock, announce, the alert
 *  dial), the house (wallet, the King, terminals, Trabolta), setup (codes,
 *  parts). */
export function moreTabOf(section: MoreFocus): MoreTabId {
  if (section === "codes" || section === "parts") return "setup";
  if (section === "wallet" || section === "king" || section === "terminals" || section.startsWith("agents")) return "house";
  return "night";
}

/** More, split in three (wave 18 §5.6): each tab's sections in order, only
 *  those the event has. A tab with none is still listed (empty). */
export function moreGroups(view: Pick<HostView, "wallet" | "king" | "terminals" | "parts" | "agents">): Record<MoreTabId, MoreSection[]> {
  const out: Record<MoreTabId, MoreSection[]> = { night: [], house: [], setup: [] };
  for (const s of moreSections(view)) out[moreTabOf(s)].push(s);
  return out;
}

/** The More tab a host lands on: Setup while the doors are closed (codes,
 *  parts), Night once they open; a deep link's section wins. */
export function moreDefaultTab(doorsClosed: boolean, focus: MoreFocus | null): MoreTabId {
  if (focus !== null) return moreTabOf(focus);
  return doorsClosed ? "setup" : "night";
}

// --- escorts waiting (wave 18 §5.5) -------------------------------------------

/** One `hostView.wanted` entry (CONTRACTS C6), as the Needs row reads it. */
export interface WantedLike {
  id: string;
  name: string;
  avatar?: string | null;
  reason: string | null;
  location: string | null;
  lastSeen: number | null;
  markedAt: number;
  claimedBy: string | null;
  captured: boolean;
}

/** The host view's wanted list, feature-detected (absent until the core
 *  lane merges, and on a story with no `wanted:` line). Malformed rows are
 *  dropped. */
export function hostWanted(view: unknown): WantedLike[] {
  const w = view !== null && typeof view === "object" ? (view as { wanted?: unknown }).wanted : undefined;
  if (!Array.isArray(w)) return [];
  return w.filter((x): x is WantedLike => x !== null && typeof x === "object" && typeof (x as WantedLike).id === "string" && typeof (x as WantedLike).name === "string");
}

/** Needs' first row: `🚨 3 marked · 1 nobody on it`; null when nobody is
 *  loose (every marked program caught, or none marked). */
export function wantedNeed(wanted: readonly WantedLike[]): { loose: number; nobody: number; text: string } | null {
  const loose = wanted.filter((w) => !w.captured);
  if (loose.length === 0) return null;
  const nobody = loose.filter((w) => w.claimedBy === null || w.claimedBy === "").length;
  return { loose: loose.length, nobody, text: `🚨 ${loose.length} marked · ${nobody} nobody on it` };
}

/** A wanted program's line in the read-only list: place · who has them. */
export function wantedLine(w: WantedLike, now: number): string {
  const bits = [w.location !== null && w.location !== "" ? `📍 ${w.location}` : "📍 somewhere: not seen in a room"];
  const seen = seenText(w.lastSeen, now);
  if (seen !== null) bits.push(seen);
  bits.push(w.claimedBy !== null && w.claimedBy !== "" ? `🙋 ${w.claimedBy}` : "🙋 Nobody yet");
  return bits.join(" · ");
}

// --- the Cues tab's NEXT / LAST boxes (wave 18 §5.2) --------------------------

/** What the view says a cue does: its row's `description` (the host view
 *  sends it for NEXT and the next 3 on deck), else a `cues.rows` entry's
 *  (the contract's other spelling), else nothing. */
export function cueDescription(row: Pick<CueRow, "id" | "description">, cues: unknown): string | null {
  const own = typeof row.description === "string" ? row.description.trim() : "";
  if (own !== "") return own;
  const rows = cues !== null && typeof cues === "object" ? (cues as { rows?: unknown }).rows : undefined;
  if (!Array.isArray(rows)) return null;
  const hit = rows.find((r) => r !== null && typeof r === "object" && (r as { id?: unknown }).id === row.id) as { description?: unknown } | undefined;
  return typeof hit?.description === "string" && hit.description.trim() !== "" ? hit.description.trim() : null;
}

/** The cue on deck after NEXT (`then:`): the server's `cues.then` when it
 *  sends one (null = none), else core's `onDeck` over the rows. */
export function cueThen(rows: readonly CueRow[], cues: unknown): CueRow | null {
  const then = cues !== null && typeof cues === "object" && "then" in cues ? (cues as { then?: unknown }).then : undefined;
  if (then === null) return null;
  if (typeof then === "string") return rows.find((r) => r.id === then) ?? null;
  return onDeck([...rows]);
}

/** This console's own last press and what it did (`/api/mod/signal`'s
 *  `said` / `staff`, kept per console for the LAST box). */
export interface OwnPress {
  id: string;
  said: string[];
  staff: string[];
  at: number;
}

/** `did:` — what this console's last press did, or null (nothing came
 *  back, or LAST has moved on to another cue). Staff lines first (they say
 *  what the house did), then what was said; one line, the box clamps it. */
export function didText(press: OwnPress | null, lastId: string | null): string | null {
  if (press === null || press.id !== lastId) return null;
  const lines = [...press.staff, ...press.said].map((l) => l.trim()).filter((l) => l !== "");
  return lines.length === 0 ? null : lines.join(" · ");
}

/** Which More section a need opens (the drawer scrolls to it): an agent's
 *  need opens that agent's own section, not the first agent's. */
export function needSection(n: Pick<HostNeed, "target" | "character">): MoreFocus | null {
  if (n.target === "wallet") return "wallet";
  if (n.target === "agent") return n.character !== undefined ? agentSection(n.character) : "agents";
  if (n.target === "more") return "terminals";
  return null;
}

export type MoreSection = "show" | "clock" | "announce" | "alerts" | "wallet" | "king" | "terminals" | "codes" | "parts" | "agents";

/** Where More scrolls to: a section, or one agent-voiced character's. */
export type MoreFocus = MoreSection | `agents-${string}`;

/** One agent-voiced character's section key (`agents-trabolta`): unique per
 *  character, safe in an element id. */
export function agentSection(character: string): `agents-${string}` {
  return `agents-${character.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "")}`;
}

/** The More tab's sections in order, each only when the event has it. */
export function moreSections(view: Pick<HostView, "wallet" | "king" | "terminals" | "parts" | "agents">): MoreSection[] {
  const out: MoreSection[] = ["show", "clock", "announce", "alerts"];
  if (view.wallet !== null) out.push("wallet");
  if (view.king !== null) out.push("king");
  if (view.terminals !== null) out.push("terminals");
  out.push("codes");
  if (view.parts.length > 0) out.push("parts");
  if (view.agents.length > 0) out.push("agents");
  return out;
}

/** The show's one lifecycle control a host has (C2): open the doors before
 *  they open, pause a running night, resume a paused one. Never restart,
 *  push, go live or end (D5): those stay in Run. */
export interface ShowControl {
  id: "doors" | "pause" | "resume";
  /** The button. */
  label: string;
  /** Where the night stands, beside the section's title. */
  state: string;
  /** What it does, under the button. */
  note: string;
  /** The feedback line once it went through. */
  done: string;
}

export function showControl(view: Pick<HostView, "runtime" | "doorsClosed">): ShowControl {
  if (view.runtime === "open") {
    return { id: "pause", label: "⏸ Pause the show", state: "▶ running", note: "Stops the story clock on every phone and booth: countdowns hold, cues wait. Nothing is lost.", done: "⏸ Paused" };
  }
  if (view.runtime === "idle" || view.doorsClosed === true) {
    return { id: "doors", label: "🚪 Open the doors", state: "🚪 doors closed", note: "Guests can join, and the story's opening beat plays on every phone.", done: "🚪 The doors are open" };
  }
  return { id: "resume", label: "▶ Resume the show", state: "⏸ paused", note: "The story clock runs again from where it stopped.", done: "▶ Resumed" };
}

// --- the NEXT bar's second line --------------------------------------------------

export interface HostStripItem {
  text: string;
  tone?: "urgent" | "needs";
  /** What the item is (a phone drops the phase first). */
  kind?: "caller" | "act" | "phase" | "clock" | "watch" | "countdown" | "needs";
  /** Dropped first on a phone (the phase, when a countdown is on; a third
   *  watch value, which only a wide bar shows). */
  optional?: true;
  /** Dropped next on a narrower phone (wave 18 §5.1): 2 = the second watch
   *  value (≤ 400 px), 3 = the countdown (≤ 360 px). */
  drop?: 2 | 3;
}

/** The strip (wave 18 §5.1): 📣 caller · act · `Night.phase` · ⏸ / 🚪 ·
 *  the watch values (two on a phone, three wide; never a secret one, the
 *  server sends none) · the soonest countdown · ⚠ n (what waits on a host).
 *  `caller` is the chip's text (`callerText`), null when the server has no
 *  callers. */
export function hostStrip(view: HostView | null, layout: SheetLayout, nowMs: number | null, needs: number, barCountdown = false, caller: string | null = null): HostStripItem[] {
  const out: HostStripItem[] = [];
  if (caller !== null) out.push({ text: caller, kind: "caller" });
  if (layout.kind === "acts" && layout.focus >= 0) out.push({ text: actHandle(layout.acts[layout.focus]!), kind: "act" });
  const phase = view?.world.find((w) => w.path === "Night.phase")?.value.trim().replace(/^"(.*)"$/u, "$1") ?? "";
  if (phase !== "" && phase !== "null") out.push({ text: phaseLabel(phase), kind: "phase" });
  if (view !== null && !clockRuns({ phase: view.runtime, ...(view.paused === true ? { paused: true as const } : {}) })) out.push({ text: view.doorsClosed === true ? "🚪 doors closed" : STOPPED, kind: "clock" });
  (view?.watch ?? [])
    .filter((w) => typeof w.value === "string")
    .slice(0, 3)
    .forEach((w, k) => out.push({ text: `${w.label} ${formatWatchValue(w.value)}`, kind: "watch", ...(k === 1 ? { drop: 2 as const } : k === 2 ? { optional: true as const } : {}) }));
  const soon = soonestCountdown(view?.countdowns, nowMs);
  if (soon !== null) out.push({ text: countdownLeft(soon.label, soon.left), kind: "countdown", drop: 3, ...(soon.left < URGENT_S ? { tone: "urgent" as const } : {}) });
  if (needs > 0) out.push({ text: `⚠ ${needs}`, tone: "needs", kind: "needs" });
  // `barCountdown`: the bar's first line already reads that countdown
  // ("nothing to press … ⏱ Midnight in 59:28"), so a phone drops the
  // strip's copy and keeps the phase. Otherwise a phone's one line drops
  // the phase first, and only when a countdown needs the room.
  if (soon !== null) for (const it of out) if (it.kind === (barCountdown ? "countdown" : "phase")) it.optional = true;
  return out;
}

/** A story phase id as the strip reads it: `hunt_1` → "Hunt 1",
 *  `truth_pong` → "Truth Pong", `y2k` → "Y2K" (a word mixing letters and
 *  digits is a code: capitals). The story names no labels for its phases,
 *  so the id is the label, made readable. */
export function phaseLabel(id: string): string {
  return id
    .trim()
    .split(/[_\s-]+/u)
    .filter((w) => w !== "")
    .map((w) => (/\d/u.test(w) && /\p{L}/u.test(w) ? w.toUpperCase() : `${w.charAt(0).toUpperCase()}${w.slice(1)}`))
    .join(" ");
}

/** A countdown as time left, never a time of day: "⏳ Hunt 1 ends, 4:59 left". */
export function countdownLeft(label: string, leftSec: number): string {
  return `⏳ ${label}, ${formatLeft(leftSec)} left`;
}

// --- a refused press -----------------------------------------------------------

/** A press the story turned down (out of turn): kept under Needs for a
 *  minute with the `# hosts` line that says why. */
export interface RefusedPress {
  id: string;
  /** The cue's code, else its title. */
  what: string;
  /** Wall ms of the refusal. */
  at: number;
  /** The newest message seq the booth held when the answer landed: the
   *  reason is the first staff-room line after it. */
  afterSeq: number;
}

/** The newest seq in a message map (0 when empty). */
export function newestSeq(messages: ReadonlyMap<number, ChatMessage>): number {
  let max = 0;
  for (const seq of messages.keys()) if (seq > max) max = seq;
  return max;
}

/** The staff-room line after `afterSeq` that says why — the oldest one
 *  after the press (the story posts it as it refuses). Null until it lands. */
export function refusalReason(messages: ReadonlyMap<number, ChatMessage>, staffRooms: readonly string[], afterSeq: number): string | null {
  let best: ChatMessage | null = null;
  for (const m of messages.values()) {
    if (m.seq <= afterSeq || !staffRooms.includes(m.channel) || m.hidden) continue;
    if (best === null || m.seq < best.seq) best = m;
  }
  return best === null ? null : best.text;
}

/** The refused press's row text, with its reason once it has come (or a
 *  note that none came after `REASON_WAIT_MS`). */
export function refusedText(p: RefusedPress, reason: string | null, now: number): string {
  const head = `✕ ${p.what} not taken`;
  if (reason !== null) return `${head} — ${reason}`;
  return now - p.at >= REASON_WAIT_MS ? `${head} (no reason in # hosts)` : `${head}…`;
}

/** Is the refused press still worth a Needs row? */
export function refusedLive(p: RefusedPress, now: number): boolean {
  return now - p.at < REFUSED_NEEDS_MS;
}

/** How long the NEXT bar's second line keeps a refused press's reason (it
 *  stays under Needs for the minute). */
export const REFUSED_BAR_MS = 20_000;

/** "⚠ Last update 12 s ago · Can't reach the server": the bar's second
 *  line while polls fail, so the host never decides off an old screen. The
 *  age leads: a phone's one line cuts the end off. */
export function staleText(error: string | null, receivedAt: number, now: number): string {
  return `⚠ Last update ${agoText(now - receivedAt)} · ${error ?? "Reconnecting…"}`;
}

/** What the NEXT bar's second line shows, first match wins: the armed
 *  prompt (on a live view), a fresh toast, a stale view, the reason a press
 *  was just refused, the strip. */
export type BarLine = { kind: "toast" | "stale" | "armed" | "refused"; text: string } | { kind: "strip" };

export function barLine(s: {
  toast: string | null;
  connected: boolean;
  error: string | null;
  receivedAt: number;
  now: number;
  armed: boolean;
  subjectName: string | null;
  /** The refused press when it was this booth's latest press, else null. */
  refused: RefusedPress | null;
  reason: string | null;
  /** The armed cue's description (wave 18 §5.1): what FIRE is about to do,
   *  read in the 4 s window. A subject cue keeps "→ who" instead. */
  description?: string | null;
}): BarLine {
  // A live arm outranks a toast: the "Cues moved — tap again" toast asked
  // for exactly this new arm, and must not hide its 4 s window.
  const what = typeof s.description === "string" && s.description.trim() !== "" ? s.description.trim() : null;
  const armed = { kind: "armed" as const, text: s.subjectName !== null ? `Tap FIRE to fire → ${s.subjectName}` : what ?? "Tap FIRE within 4 s to fire" };
  if (s.armed && s.connected) return armed;
  if (s.toast !== null) return { kind: "toast", text: s.toast };
  if (!s.connected) return { kind: "stale", text: staleText(s.error, s.receivedAt, s.now) };
  if (s.armed) return armed;
  if (s.refused !== null && s.now - s.refused.at < REFUSED_BAR_MS) return { kind: "refused", text: refusedText(s.refused, s.reason, s.now) };
  return { kind: "strip" };
}

// --- awards ------------------------------------------------------------------

/** Are the award cues near (one is NEXT, or in the focus act's rows)? Then
 *  the panel reads the recap for their suggested winners. */
export function awardsNear(rows: readonly CueRow[], layout: SheetLayout): boolean {
  if (rows.some((r) => r.next && AWARD_SOURCES[r.id] !== undefined)) return true;
  if (layout.kind !== "acts" || layout.focus < 0) return false;
  return layout.acts[layout.focus]!.rows.some((r) => AWARD_SOURCES[r.id] !== undefined);
}

// --- people --------------------------------------------------------------------

/** Rows whose name or room contain every word of `query` (case-folded). */
export function filterPeople(people: readonly HostPerson[], query: string): HostPerson[] {
  const words = query.toLowerCase().split(/\s+/u).filter((w) => w !== "");
  if (words.length === 0) return [...people];
  return people.filter((p) => {
    const hay = `${p.name} ${p.location ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Is this flag Bathroom Mode (`Program.afk`, or a label naming it)? */
export function isBathroomFlag(f: { label: string; path: string }): boolean {
  return /(^|\.)afk$/iu.test(f.path.trim()) || /bathroom/iu.test(f.label);
}

/** Is this guest in Bathroom Mode right now (an `on` Bathroom flag)? */
export function inBathroom(p: Pick<HostPerson, "flags">): boolean {
  return (p.flags ?? []).some((f) => f.on && isBathroomFlag(f));
}

/** "seen 12 m ago" / "seen just now" / "not seen since the server started". */
export function seenText(lastSeen: number | null | undefined, now: number): string | null {
  if (lastSeen === undefined) return null;
  if (lastSeen === null) return "not seen since the server started";
  const m = Math.floor(Math.max(0, now - lastSeen) / 60_000);
  if (m < 1) return "seen just now";
  if (m < 60) return `seen ${m} m ago`;
  return `seen ${Math.floor(m / 60)} h ${m % 60} m ago`;
}

/** The one-line facts under a person's name: room · flags that are on · state. */
export function personLine(p: HostPerson): string {
  const bits: string[] = [];
  if (p.location !== null && p.location !== "") bits.push(p.location);
  if (p.captured) bits.push("captured");
  for (const f of p.flags ?? []) if (f.on) bits.push(f.value === "true" ? f.label : `${f.label} ${f.value}`);
  if (p.gone === true) bits.push("went home");
  return bits.join(" · ");
}

// --- the agent's waiting guests -------------------------------------------------

/** One guest's thread with an agent-voiced character (`dm:<agent>`
 *  addressed to that guest), oldest first, from the host's own stream. */
export function agentThread(messages: ReadonlyMap<number, ChatMessage>, agent: string, guest: string): ChatMessage[] {
  const channel = `dm:${agent}`;
  const out: ChatMessage[] = [];
  for (const m of messages.values()) {
    if (m.channel !== channel || m.hidden) continue;
    if (m.audience !== "all" && !m.audience.includes(guest)) continue;
    out.push(m);
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/** One line of an agent thread as the answer sheet labels it, by who
 *  really sent it: the agent, the guest (or whoever typed it), or the story
 *  (a card it dealt, narration, a notice) — a fact card is never shown as
 *  the guest's own words. */
export interface ThreadLine {
  who: string;
  text: string;
  tone: "them" | "guest" | "story";
}

export function threadLine(m: Pick<ChatMessage, "from" | "kind" | "text" | "widget">, agent: string, guestName: string): ThreadLine {
  if (m.kind === "widget" || m.kind === "codex" || m.kind === "quest" || m.kind === "wallet") {
    const text = (m.widget?.text ?? "").trim() || m.text.trim() || m.widget?.kind || m.kind;
    return { who: "card", text, tone: "story" };
  }
  const from = m.from.trim();
  if (from !== "" && from === agent) return { who: agent, text: m.text, tone: "them" };
  if (m.kind === "line" && from !== "") return { who: from, text: m.text, tone: from === guestName ? "guest" : "story" };
  return { who: "story", text: m.text, tone: "story" };
}

/** An agent's queue as the More tab reads it: the oldest wait comes off the
 *  same clock as each guest's own "waiting 1:42" (the rows' `since`), so the
 *  two numbers in one card never disagree. With no guest row the server's
 *  own `oldestMs` stands. */
export function agentQueue(a: Pick<HostView["agents"][number], "queue" | "waiting">, now: number): { depth: number; oldestMs: number | null; stalled: boolean } | null {
  if (a.queue === null && a.waiting.length === 0) return null;
  let oldest: number | null = null;
  for (const w of a.waiting) if (oldest === null || w.since < oldest) oldest = w.since;
  return {
    depth: Math.max(a.queue?.depth ?? 0, a.waiting.length),
    // Whole seconds, floored like `waitingFor`, so both read the same digit.
    oldestMs: oldest !== null ? Math.floor(Math.max(0, now - oldest) / 1000) * 1000 : a.queue?.oldestMs ?? null,
    stalled: a.queue?.stalled ?? false,
  };
}

/** "waiting 1:42". */
export function waitingFor(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `waiting ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// --- parts ---------------------------------------------------------------------

export function presenceText(p: PartPresence): string {
  switch (p) {
    case PartPresence.Online:
      return "● on";
    case PartPresence.PhoneOffline:
      return "◐ phone offline";
    case PartPresence.Free:
      return "○ nobody signed in";
    case PartPresence.Voiced:
      return "● worker on";
    case PartPresence.Unvoiced:
      return "○ no worker";
    default:
      return "";
  }
}

/** Can this part be released (someone holds it)? */
export function releasable(p: PartPresence): boolean {
  return p === PartPresence.Online || p === PartPresence.PhoneOffline;
}

// --- the alert dial -------------------------------------------------------------

export const ALERT_LADDER: ReadonlyArray<{ level: AlertLevel; label: string; hint: string }> = [
  { level: "balloon", label: "Balloon", hint: "a tip by the taskbar that times out" },
  { level: "sticky", label: "Sticky", hint: "a banner that stays until tapped" },
  { level: "dialog", label: "Dialog", hint: "a full-screen box with OK, one at a time" },
  { level: "bsod", label: "Blue screen", hint: "every beat to a guest takes the screen" },
];

export function levelLabel(level: AlertLevel): string {
  return ALERT_LADDER.find((l) => l.level === level)?.label ?? level;
}

// --- the King --------------------------------------------------------------------

/** A King hp typed into the Set… box, or null when it isn't 0–max. */
export function kingHpInput(text: string, max: number): number | null {
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

/** A stimulus amount typed, or null (a whole number ≥ 1). */
export function stimulusInput(text: string): number | null {
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** "12 s ago" / "3 m ago" for a terminal's last poll. */
export function agoText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 90 ? `${s} s ago` : `${Math.round(s / 60)} m ago`;
}

// --- a toggle that reads back on the next poll ------------------------------------

/** A toggle this host just flipped (the TV voice): what it shows until the
 *  view agrees, so the label turns with the toast, not 3 s later on the
 *  next poll. */
export interface Optimistic<T> {
  value: T;
  /** Wall ms of the write. */
  at: number;
}

/** How long a flipped toggle trusts itself over a view that disagrees. */
export const OPTIMISTIC_MS = 10_000;

/** The value a toggle shows: the flip while it is fresh, else the view. */
export function optimisticValue<T>(server: T, local: Optimistic<T> | null, now: number): T {
  if (local === null || now - local.at > OPTIMISTIC_MS) return server;
  return local.value;
}

/** The TV-voice toggle's label: what it is, and what a tap does. */
export function tvVoiceLabel(muted: boolean): string {
  return muted ? "🔇 TV voice muted: unmute" : "🔊 Mute the TV voice";
}
