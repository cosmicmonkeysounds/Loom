//! The host panel's pure rules (wave 13): which drawer tabs show and what
//! they count, the NEXT bar's second line, a refused press and its
//! `# hosts` reason, people search, a guest's agent thread, the alert dial.
//! No React here, so every rule is tested on plain values.

import type { AlertLevel } from "../../../core/src/delivery.ts";
import { AWARD_SOURCES, PartPresence, REASON_WAIT_MS, REFUSED_NEEDS_MS, type NeedTarget } from "../../../core/src/host-board.ts";
import type { CueRow } from "../../../core/src/cue-sheet.ts";
import type { ChatMessage, HostNeed, HostPerson, HostView } from "../types.ts";
import { STOPPED, actHandle, clockRuns, formatLeft, soonestCountdown, URGENT_S, type SheetLayout } from "../director.tsx";

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

/** Which More section a need opens (the drawer scrolls to it): an agent's
 *  need opens that agent's own section, not the first agent's. */
export function needSection(n: Pick<HostNeed, "target" | "character">): MoreFocus | null {
  if (n.target === "wallet") return "wallet";
  if (n.target === "agent") return n.character !== undefined ? agentSection(n.character) : "agents";
  if (n.target === "more") return "terminals";
  return null;
}

export type MoreSection = "announce" | "alerts" | "wallet" | "king" | "terminals" | "codes" | "parts" | "agents";

/** Where More scrolls to: a section, or one agent-voiced character's. */
export type MoreFocus = MoreSection | `agents-${string}`;

/** One agent-voiced character's section key (`agents-trabolta`): unique per
 *  character, safe in an element id. */
export function agentSection(character: string): `agents-${string}` {
  return `agents-${character.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "")}`;
}

/** The More tab's sections in order, each only when the event has it. */
export function moreSections(view: Pick<HostView, "wallet" | "king" | "terminals" | "parts" | "agents">): MoreSection[] {
  const out: MoreSection[] = ["announce", "alerts"];
  if (view.wallet !== null) out.push("wallet");
  if (view.king !== null) out.push("king");
  if (view.terminals !== null) out.push("terminals");
  out.push("codes");
  if (view.parts.length > 0) out.push("parts");
  if (view.agents.length > 0) out.push("agents");
  return out;
}

// --- the NEXT bar's second line --------------------------------------------------

export interface HostStripItem {
  text: string;
  tone?: "urgent" | "needs";
}

/** The strip: act · `Night.phase` · ⏸ / 🚪 · the soonest countdown · ⚠ n
 *  (what waits on a host). */
export function hostStrip(view: HostView | null, layout: SheetLayout, nowMs: number | null, needs: number): HostStripItem[] {
  const out: HostStripItem[] = [];
  if (layout.kind === "acts" && layout.focus >= 0) out.push({ text: actHandle(layout.acts[layout.focus]!) });
  const phase = view?.world.find((w) => w.path === "Night.phase")?.value.trim().replace(/^"(.*)"$/u, "$1") ?? "";
  if (phase !== "" && phase !== "null") out.push({ text: phase });
  if (view !== null && !clockRuns({ phase: view.runtime, ...(view.paused === true ? { paused: true as const } : {}) })) out.push({ text: view.doorsClosed === true ? "🚪 doors closed" : STOPPED });
  const soon = soonestCountdown(view?.countdowns, nowMs);
  if (soon !== null) out.push({ text: `⏳ ${soon.label} ${formatLeft(soon.left)}`, ...(soon.left < URGENT_S ? { tone: "urgent" as const } : {}) });
  if (needs > 0) out.push({ text: `⚠ ${needs}`, tone: "needs" });
  return out;
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

/** What the NEXT bar's second line shows, first match wins: a fresh toast,
 *  a stale view, the armed prompt, the reason a press was just refused, the
 *  strip. */
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
}): BarLine {
  if (s.toast !== null) return { kind: "toast", text: s.toast };
  if (!s.connected) return { kind: "stale", text: staleText(s.error, s.receivedAt, s.now) };
  if (s.armed) return { kind: "armed", text: s.subjectName !== null ? `Tap FIRE to fire → ${s.subjectName}` : "Tap FIRE within 4 s to fire" };
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
