//! The host board (wave 13): the pure helpers a director's console and a
//! host booth share — the facts judge's rows and buttons, the agent queue
//! badge, the performer parts' presence, the unseen guests, held transfers,
//! the award suggestions, "Needs you" (`hostNeeds`) and the host view read
//! (`hostView`, the body of `GET /api/state?role=mod&host=1`). Moved from
//! the editor's `cockpit/{mind,wallet,parts,guests,award-suggest}.ts` and
//! `director/glance.ts` with the same names and behaviour, over structural
//! input types so the server's and the editor's real types both satisfy
//! them. Dependency-free (the play app imports it by path): nothing here
//! may reach `node:*`, `server/*` or the sim.

import { cueSheetView, type CueSheetView, type CueInteraction, type CueMarks, type WorldLine, type CuePerson } from "./cue-sheet.ts";
import type { AlertLevel } from "./delivery.ts";

// ---------------------------------------------------------------------------
// Structural inputs
// ---------------------------------------------------------------------------

/** A verdict the facts judge gives (`FactVerdict`). */
export type FactVerdictLike = "accurate" | "lie" | "uncertain";

/** One world row (`WorldEntry`). */
export interface WorldRow {
  path: string;
  value: string;
}

/** A filing (`FactsFiling`), structurally. */
export interface FilingLike {
  person: string;
  name: string;
  question: string;
  answer: string;
  confidence: number;
  verdict: FactVerdictLike;
  final: string | null;
  how?: FilingHow | null;
  by?: string | null;
  at: number;
  /** The sim log position of its newest step (`FactsFiling.logAt`): survives a restart, `at` doesn't. */
  logAt?: number;
  near?: { key: string } | null;
  ruling?: { by: string; same: boolean; why: string; at: number } | null;
  asking?: boolean;
}

/** The facts view (`FactsView`), structurally. */
export interface FactsLike {
  mode?: string;
  confirm?: Partial<Record<FactVerdictLike, string>> | null;
  questions: ReadonlyArray<{
    id: string;
    round: number | null;
    text: string;
    filings: readonly FilingLike[];
    tally?: { filed: number; accurate: number; lie: number; uncertain: number; consensus: boolean };
  }>;
  pending?: number;
  judge?: string;
  near?: number;
}

/** An agent's request line (`AgentQueue`, plus the editor's `receivedAt`). */
export interface QueueLike {
  depth: number;
  oldestMs: number | null;
  stalled: boolean;
  receivedAt?: number;
}

/** A cast row (`CastSummary`), structurally. */
export interface CastLike {
  id: string;
  online?: boolean;
  held?: boolean;
  agent?: boolean;
  part?: boolean;
  agentQueue?: QueueLike;
}

/** A roster row (`RosterRow`), structurally. */
export interface RosterLike {
  id: string;
  name: string;
  online?: boolean;
  lastSeen?: number | null;
  owner?: string | null;
}

/** One wallet transfer as the views carry it (`WalletTxView`). */
export interface WalletTxLike {
  id: string;
  state: string;
  fromName: string;
  toName: string;
  amount: number;
  settleAt: number | null;
}

/** The wallet's mod view (`WalletModView`), structurally. */
export interface WalletLike {
  open: { transfers: readonly WalletTxLike[] };
}

/** An agent mind summary (`AgentMindSummary`), structurally. */
export interface MindLike {
  character: string;
  agentQueue?: unknown;
}

// ---------------------------------------------------------------------------
// Judging (moved from cockpit/mind.ts)
// ---------------------------------------------------------------------------

export type JudgeMode = "auto" | "review";

/** The world path the mode is read from when the view names none. */
export const DEFAULT_JUDGE_MODE_VAR = "Night.judge_mode";

/** The judging mode: the view's own reading first, else the mode var on
 *  the world (`review` exactly), else `auto`. */
export function judgeModeOf(world: readonly WorldRow[], facts: FactsLike | null): JudgeMode {
  if (facts !== null) return facts.mode === "review" ? "review" : "auto";
  const path = DEFAULT_JUDGE_MODE_VAR;
  return world.find((w) => w.path === path)?.value === "review" ? "review" : "auto";
}

/** A `judge:` character's ruling on a near miss (wave 11b, contract J). */
export interface FilingRuling {
  by: string;
  same: boolean;
  why: string;
  at: number;
}

/** One filing awaiting a verdict (review mode, or a near miss in auto). */
export interface JudgingRow {
  person: string;
  name: string;
  question: string;
  answer: string;
  confidence: number;
  /** The judge's proposal. */
  proposed: FactVerdictLike;
  final: string | null;
  at: number;
  /** `FilingLike.logAt`, when the server sends it (orders a restarted night). */
  logAt?: number;
  /** The key answer it nearly matched, else null. */
  near: string | null;
  /** The story's `judge:` character is being asked to rule. */
  asking: boolean;
  /** Its ruling, once given. */
  ruling: FilingRuling | null;
}

/** A filing's ruling, else null. */
export function rulingOf(f: FilingLike): FilingRuling | null {
  const r = (f as FilingLike & { ruling?: unknown }).ruling;
  if (r === null || typeof r !== "object") return null;
  const { by, same, why, at } = r as unknown as Record<string, unknown>;
  if (typeof by !== "string" || typeof same !== "boolean") return null;
  return { by, same, why: typeof why === "string" ? why : "", at: typeof at === "number" ? at : 0 };
}

/** Is a ruling being asked for this filing right now? */
export function askingOf(f: FilingLike): boolean {
  return (f as FilingLike & { asking?: unknown }).asking === true;
}

/** "🤖 Trabolta: same — why". */
export function rulingText(r: FilingRuling): string {
  return `🤖 ${r.by}: ${r.same ? "same" : "not the same"}${r.why !== "" ? ` — ${r.why}` : ""}`;
}

/** "🤖 asking Trabolta…". */
export function askingText(facts: FactsLike): string {
  const judge = (facts as FactsLike & { judge?: unknown }).judge;
  return `🤖 asking ${typeof judge === "string" && judge !== "" ? judge : "the judge"}…`;
}

/** How a filing got its outcome. */
export type FilingHow = "auto" | "confirmed" | "overridden" | "settled" | "marked" | "pending" | "kept";

export interface FilingRow {
  person: string;
  name: string;
  answer: string;
  confidence: number;
  proposed: FactVerdictLike;
  final: string | null;
  how: FilingHow;
  by: string | null;
  at: number;
  /** `FilingLike.logAt`, when the server sends it. */
  logAt?: number;
  near: string | null;
  asking: boolean;
  ruling: FilingRuling | null;
}

/** Every filing a `judge:` character ruled on, newest first. */
export function ruledFilings(facts: FactsLike): Array<FilingRow & { question: string; ruling: FilingRuling }> {
  const out: Array<FilingRow & { question: string; ruling: FilingRuling }> = [];
  for (const q of facts.questions) {
    for (const row of questionFilings(facts, q.id)) if (row.ruling !== null) out.push({ ...row, question: q.id, ruling: row.ruling });
  }
  // By log position when both carry one (a restart re-stamps every
  // `ruling.at`), else by when this server saw the ruling.
  return out.sort((a, b) => (typeof a.logAt === "number" && typeof b.logAt === "number" ? b.logAt - a.logAt : b.ruling.at - a.ruling.at));
}

/** A filing's near-miss key, else null. */
export function nearKeyOf(f: FilingLike): string | null {
  const near = (f as FilingLike & { near?: unknown }).near;
  if (near === null || typeof near !== "object") return null;
  const key = (near as { key?: unknown }).key;
  return typeof key === "string" && key.trim() !== "" ? key : null;
}

/** Every filing with no `final` yet, oldest first. */
export function pendingFilings(facts: FactsLike): JudgingRow[] {
  const rows: JudgingRow[] = [];
  for (const q of facts.questions) {
    for (const f of q.filings) {
      if (f.final !== null) continue;
      rows.push({ person: f.person, name: f.name, question: f.question, answer: f.answer, confidence: f.confidence, proposed: f.verdict, final: f.final, at: f.at, ...(typeof f.logAt === "number" ? { logAt: f.logAt } : {}), near: nearKeyOf(f), asking: askingOf(f), ruling: rulingOf(f) });
    }
  }
  // Oldest first, by log position when both carry one: a restart re-stamps
  // every `at`, which would list a whole night in question order.
  return rows.sort((a, b) => (typeof a.logAt === "number" && typeof b.logAt === "number" ? a.logAt - b.logAt : a.at - b.at));
}

/** How many filings wait as near misses. */
export function nearCount(facts: FactsLike): number {
  const n = (facts as FactsLike & { near?: unknown }).near;
  if (typeof n === "number" && Number.isFinite(n) && n >= 0) return n;
  return pendingFilings(facts).filter((r) => r.near !== null).length;
}

/** One question's filings, oldest first. Empty for an unknown question. */
export function questionFilings(facts: FactsLike, id: string): FilingRow[] {
  const q = facts.questions.find((x) => x.id === id);
  if (q === undefined) return [];
  const howOf = (f: FilingLike): FilingHow => {
    if (f.final === null) return "pending";
    if (f.how != null) return f.how;
    if (f.final === "marked") return "marked";
    return f.final === f.verdict ? "kept" : "overridden";
  };
  return q.filings
    .map((f) => ({ person: f.person, name: f.name, answer: f.answer, confidence: f.confidence, proposed: f.verdict, final: f.final, how: howOf(f), by: f.by ?? null, at: f.at, ...(typeof f.logAt === "number" ? { logAt: f.logAt } : {}), near: nearKeyOf(f), asking: askingOf(f), ruling: rulingOf(f) }))
    .sort((a, b) => a.at - b.at);
}

/** The confirm event for `verdict`; null when the view names none. */
export function confirmEvent(facts: FactsLike, verdict: FactVerdictLike): string | null {
  const name = facts.confirm?.[verdict];
  return typeof name === "string" && name !== "" ? name : null;
}

/** The verdict buttons on a filing, in order, with their glyphs. */
export const VERDICT_BUTTONS: ReadonlyArray<{ verdict: FactVerdictLike; glyph: string; label: string }> = [
  { verdict: "accurate", glyph: "✅", label: "accurate" },
  { verdict: "lie", glyph: "😤", label: "confident lie" },
  { verdict: "uncertain", glyph: "🤷", label: "uncertain" },
];

/** One verdict button on a filing row. */
export interface FilingButton {
  verdict: FactVerdictLike;
  glyph: string;
  label: string;
  current: boolean;
  disabled: boolean;
  title: string;
}

/** The ✅ / 😤 / 🤷 buttons on one filing row. */
export function filingButtons(facts: FactsLike, row: Pick<FilingRow, "final" | "proposed" | "how">): FilingButton[] {
  if (row.how === "marked" || row.final === "marked") return [];
  const now = row.final ?? row.proposed;
  return VERDICT_BUTTONS.map((b) => {
    const current = b.verdict === now;
    const title =
      row.final === null
        ? `${b.verdict === row.proposed ? "Confirm" : "Override"}: ${b.label}`
        : current
          ? `Judged ${b.label} — already on record`
          : `Override: ${b.label} (judged ${row.final})`;
    return { ...b, current, disabled: confirmEvent(facts, b.verdict) === null, title };
  });
}

/** The story call a verdict button makes for one filing. */
export function verdictCall(
  facts: FactsLike,
  row: { person: string; question: string },
  verdict: FactVerdictLike,
): { event: string; person: string; args: { question: string } } | null {
  const event = confirmEvent(facts, verdict);
  if (event === null) return null;
  return { event, person: row.person, args: { question: row.question } };
}

// ---------------------------------------------------------------------------
// The agent queue (moved from cockpit/mind.ts)
// ---------------------------------------------------------------------------

/** A wait worth a director's eye: the story's busy line goes out at 40 s. */
export const QUEUE_SLOW_MS = 40_000;

/** A character's request queue (the cast row's, else the mind's); null on an older server. */
export function agentQueueOf(character: string, cast: readonly CastLike[], minds: readonly MindLike[], now?: number): QueueLike | null {
  const c = cast.find((x) => x.id === character)?.agentQueue;
  if (isQueue(c)) return aged(c, now);
  const m = minds.find((x) => x.character === character)?.agentQueue;
  return isQueue(m) ? aged(m, now) : null;
}

const isQueue = (v: unknown): v is QueueLike =>
  v !== null &&
  typeof v === "object" &&
  typeof (v as QueueLike).depth === "number" &&
  ((v as QueueLike).oldestMs === null || typeof (v as QueueLike).oldestMs === "number") &&
  typeof (v as QueueLike).stalled === "boolean";

/** A waiting queue's `oldestMs` aged by the time since it arrived. */
function aged(q: QueueLike, now: number | undefined): QueueLike {
  if (now === undefined || q.receivedAt === undefined || q.oldestMs === null || q.depth === 0) return q;
  return { ...q, oldestMs: q.oldestMs + Math.max(0, now - q.receivedAt) };
}

/** `1:20` — a wait in minutes and seconds. */
export function waitText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const QueueTone = { Idle: "idle", Waiting: "waiting", Slow: "slow", Stalled: "stalled" } as const;
export type QueueTone = (typeof QueueTone)[keyof typeof QueueTone];

/** The queue badge. */
export function queueBadge(q: QueueLike): { text: string; tone: QueueTone; title: string } {
  const oldest = q.oldestMs !== null && q.oldestMs > 0 ? ` · oldest ${waitText(q.oldestMs)}` : "";
  if (q.stalled) {
    return {
      text: `⛔ stalled · ${q.depth} waiting${oldest}`,
      tone: QueueTone.Stalled,
      title:
        "The worker stopped answering (a request unanswered over a minute). Nothing new is sent to it; every waiting guest got the hold line once. It clears on its next reply or a reconnect — restart the worker, or answer from the performer lens.",
    };
  }
  if (q.depth === 0) return { text: "queue empty", tone: QueueTone.Idle, title: "No conversation is waiting for a reply." };
  const slow = q.oldestMs !== null && q.oldestMs >= QUEUE_SLOW_MS;
  return {
    text: `${slow ? "⚠ " : ""}${q.depth} waiting${oldest}`,
    tone: slow ? QueueTone.Slow : QueueTone.Waiting,
    title: slow ? "A guest has waited past the busy line (40 s): the worker is behind." : "Conversations waiting for the worker, oldest first.",
  };
}

// ---------------------------------------------------------------------------
// Wallet (moved from cockpit/wallet.ts)
// ---------------------------------------------------------------------------

/** Held transfers, oldest first — what "Approve all held" clears. */
export function heldTransfers<T extends { state: string }>(view: { open: { transfers: readonly T[] } } | null): T[] {
  return (view?.open.transfers ?? []).filter((t) => t.state === "held");
}

// ---------------------------------------------------------------------------
// Parts (moved from cockpit/parts.ts)
// ---------------------------------------------------------------------------

/** The rows a performer can sign in to. */
export function performerParts<T extends Pick<CastLike, "part" | "agent">>(cast: readonly T[]): T[] {
  if (cast.some((c) => c.part !== undefined)) return cast.filter((c) => c.part === true);
  return cast.filter((c) => c.agent !== true);
}

export const PartPresence = {
  Online: "online",
  PhoneOffline: "phone-offline",
  Free: "free",
  Voiced: "voiced",
  Unvoiced: "unvoiced",
  Unknown: "unknown",
} as const;
export type PartPresence = (typeof PartPresence)[keyof typeof PartPresence];

export function partPresence(c: Pick<CastLike, "online" | "held">): PartPresence {
  if (c.online === true) return PartPresence.Online;
  if (c.held === true) return PartPresence.PhoneOffline;
  if (c.online === false || c.held === false) return PartPresence.Free;
  return PartPresence.Unknown;
}

/** Any cast row's dot: a part's performer presence, an agent's worker, nothing for the rest. */
export function castPresence(c: Pick<CastLike, "online" | "held" | "agent">, isPart: boolean): PartPresence {
  if (c.agent === true) return c.online === true ? PartPresence.Voiced : c.online === false ? PartPresence.Unvoiced : PartPresence.Unknown;
  return isPart ? partPresence(c) : PartPresence.Unknown;
}

/** Is someone signed in (held, phone online or not)? */
export function isSignedIn(p: PartPresence): boolean {
  return p === PartPresence.Online || p === PartPresence.PhoneOffline;
}

// ---------------------------------------------------------------------------
// Guests (moved from cockpit/guests.ts)
// ---------------------------------------------------------------------------

/** A boolean `watch:` flag whose *false* is the exception a performer must
 *  see: the gates a guest passes on the way in ("Not cleared", "Not checked
 *  in"). The server keeps a false one in a snapshot (`views.ts`
 *  `snapshotFlags`, contract C3) and drops every other false boolean; the
 *  booth card (`play/src/booth/model.ts` `factChips`) reads it the same way. */
export const GATE_FLAG = /^(cleared|checked[\s-]?in|uploaded|registered|verified|scanned|approved|signed[\s-]?in|joined|arrived|present)\b/iu;

/** Is a flag's label one of the entry gates (`GATE_FLAG`)? */
export function isGateFlag(label: string): boolean {
  return GATE_FLAG.test(label.trim());
}

/** How long without a sign of a guest before Needs you asks about them. */
export const UNSEEN_MS = 30 * 60_000;

/** The director marked this guest as gone home (`<id>.gone` is true). */
export function isGone(world: readonly WorldRow[] | ReadonlyMap<string, string>, id: string): boolean {
  return truthy(valueOf(world, `${id}.gone`));
}

const truthy = (v: string | undefined): boolean => v !== undefined && v.replace(/^"(.*)"$/su, "$1").trim() === "true";

function valueOf(world: readonly WorldRow[] | ReadonlyMap<string, string>, path: string): string | undefined {
  return world instanceof Map ? world.get(path) : (world as readonly WorldRow[]).find((w) => w.path === path)?.value;
}

/** A mod-spawned persona id (`/api/mod/persona`, or the local sim) starts
 *  with `p`; a guest who registered through the play app is `g-…`. */
function isPersonaId(id: string): boolean {
  return id.startsWith("p");
}

/** A Run persona, not a real guest: its `<id>.persona` var, an owner, or a persona id (`p…`). */
export function isPersonaRow(row: Pick<RosterLike, "id" | "owner">, world: readonly WorldRow[] | ReadonlyMap<string, string>): boolean {
  return isPersonaId(row.id) || (row.owner !== undefined && row.owner !== null) || truthy(valueOf(world, `${row.id}.persona`));
}

/** Real guests nobody has seen for `ms` (not streaming, not marked gone, not
 *  a persona), longest-unseen first. A row with no `lastSeen` is never asked
 *  about: no evidence is not absence. */
export function unseenGuests(
  roster: readonly RosterLike[],
  world: readonly WorldRow[],
  now: number,
  ms: number = UNSEEN_MS,
): Array<{ id: string; name: string; lastSeen: number }> {
  const byPath = new Map(world.map((w) => [w.path, w.value]));
  const out: Array<{ id: string; name: string; lastSeen: number }> = [];
  for (const r of roster) {
    if (typeof r.lastSeen !== "number" || r.online === true) continue;
    if (now - r.lastSeen < ms) continue;
    if (isGone(byPath, r.id) || isPersonaRow(r, byPath)) continue;
    out.push({ id: r.id, name: r.name, lastSeen: r.lastSeen });
  }
  return out.sort((a, b) => a.lastSeen - b.lastSeen || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Needs you (moved from director/glance.ts; `hostNeeds` is new)
// ---------------------------------------------------------------------------

export const NeedKind = {
  Refused: "refused",
  Filings: "filings",
  Held: "held",
  PhoneOffline: "phone-offline",
  Free: "free",
  NoWorker: "no-worker",
  NearMiss: "near",
  AgentQueue: "agent-queue",
  Unseen: "unseen",
  /** Wave 13: silent wall terminals (target "more"). */
  Terminals: "terminals",
} as const;
export type NeedKind = (typeof NeedKind)[keyof typeof NeedKind];

/** How long a refused press stays under Needs you. */
export const REFUSED_NEEDS_MS = 60_000;

/** How long a refusal waits for its staff-room line before saying none came. */
export const REASON_WAIT_MS = 3000;

/** Where a host acts on a need: the drawer tab (play) or the editor's link.
 *  staff → the staff room (`# hosts`), judge → Judge tab, wallet / more → More tab,
 *  agent → More › Trabolta, part / people → People tab. */
export type NeedTarget = "staff" | "judge" | "wallet" | "agent" | "part" | "people" | "more";

export interface HostNeed {
  /** Never "refused" from the server: a refused press is per-console. */
  kind: NeedKind;
  key: string;
  /** Same copy as the editor's needsYou rows. */
  text: string;
  detail?: string;
  target: NeedTarget;
  /** Part / agent rows. */
  character?: string;
  /** Unseen. */
  guests?: Array<{ id: string; name: string; lastSeen: number }>;
}

export interface NeedsInputLike {
  now: number;
  world: readonly WorldRow[];
  facts: FactsLike | null;
  wallet: WalletLike | null;
  cast: readonly CastLike[];
  doorsOpen: boolean;
  roster?: readonly RosterLike[];
  minds?: readonly MindLike[];
  /** Silent terminals (`ago > silentMs`), by name — adds one need
   *  "📟 N terminal(s) silent" (kind "terminals", target "more", detail = the names). */
  silentTerminals?: readonly string[];
}

/** The editor's `needsYou` minus the refused press, with targets instead of
 *  links, plus silent terminals. Row order and copy match `needsYou`. */
export function hostNeeds(input: NeedsInputLike): HostNeed[] {
  const out: HostNeed[] = [];
  const { now } = input;
  if (input.facts !== null) {
    const near = nearCount(input.facts);
    const nearText = near > 0 ? ` (⚠ ${near} near miss${near === 1 ? "" : "es"})` : "";
    if (judgeModeOf(input.world, input.facts) === "review") {
      const n = pendingFilings(input.facts).length;
      if (n > 0) out.push({ kind: NeedKind.Filings, key: "filings", text: `📝 ${n} filing${n === 1 ? "" : "s"} to review${nearText}`, target: "judge" });
    } else if (near > 0) {
      out.push({ kind: NeedKind.NearMiss, key: "near", text: `⚠ ${near} near miss${near === 1 ? "" : "es"} to judge`, target: "judge" });
    }
  }
  const held = heldTransfers(input.wallet).length;
  if (held > 0) out.push({ kind: NeedKind.Held, key: "held", text: `💰 ${held} held transfer${held === 1 ? "" : "s"}`, target: "wallet" });
  const parts = new Set(performerParts(input.cast).map((c) => c.id));
  for (const c of input.cast) {
    const p = castPresence(c, parts.has(c.id));
    if (p === PartPresence.Unvoiced) {
      out.push({ kind: NeedKind.NoWorker, key: `agent:${c.id}`, text: `🤖 ${c.id}: no worker`, target: "agent", character: c.id });
    } else if (c.agent === true) {
      const q = agentQueueOf(c.id, input.cast, input.minds ?? [], now);
      if (q !== null) {
        const b = queueBadge(q);
        if (b.tone === QueueTone.Stalled || b.tone === QueueTone.Slow) {
          out.push({ kind: NeedKind.AgentQueue, key: `queue:${c.id}`, text: `🤖 ${c.id}: ${b.text}`, target: "agent", character: c.id });
        }
      }
    } else if (input.doorsOpen && p === PartPresence.PhoneOffline) {
      out.push({ kind: NeedKind.PhoneOffline, key: `part:${c.id}`, text: `📱 ${c.id}: phone offline`, target: "part", character: c.id });
    } else if (input.doorsOpen && p === PartPresence.Free) {
      out.push({ kind: NeedKind.Free, key: `part:${c.id}`, text: `🎭 ${c.id}: nobody signed in`, target: "part", character: c.id });
    }
  }
  const unseen = unseenGuests(input.roster ?? [], input.world, now);
  if (unseen.length > 0) {
    out.push({
      kind: NeedKind.Unseen,
      key: "unseen",
      text: `👋 ${unseen.length} guest${unseen.length === 1 ? "" : "s"} unseen ${Math.round(UNSEEN_MS / 60_000)} min — mark gone?`,
      target: "people",
      guests: unseen,
    });
  }
  const silent = input.silentTerminals ?? [];
  if (silent.length > 0) {
    out.push({ kind: NeedKind.Terminals, key: "terminals", text: `📟 ${silent.length} terminal${silent.length === 1 ? "" : "s"} silent`, detail: silent.join(", "), target: "more" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Award suggestions (moved from cockpit/award-suggest.ts)
// ---------------------------------------------------------------------------

/** The slice of the recap (`core/server/recap.ts` `Recap`) the sheet reads. */
export interface RecapRowWire {
  id: string;
  name: string;
  value: number;
  persona: boolean;
}

export interface RecapDuckRowWire {
  id: string;
  name: string;
  ms: number;
  time: string;
  persona: boolean;
}

export type RecapListName = "trust" | "truths" | "lies" | "internetVisits" | "codex" | "quests" | "truthcoin";

export interface RecapWire {
  ending: string | null;
  lists: Partial<Record<RecapListName, RecapRowWire[]>>;
  duck?: RecapDuckRowWire[];
  text: string;
}

/** Which end of a list wins, and whether 0 can win at all. */
interface AwardSource {
  list: RecapListName | "duck";
  end: "top" | "bottom";
  /** A count (lies, trips, entries…): nobody wins with 0. */
  count: boolean;
}

/** Each award cue (`main.loom` `INTERACTION award_*`) and its recap list. */
export const AWARD_SOURCES: Readonly<Record<string, AwardSource>> = {
  award_most_trusted: { list: "trust", end: "top", count: false },
  award_least_trusted: { list: "trust", end: "bottom", count: false },
  award_frequent_flyer: { list: "internetVisits", end: "top", count: true },
  award_lore_hoarder: { list: "codex", end: "top", count: true },
  award_truthcoin_tycoon: { list: "truthcoin", end: "top", count: true },
  award_best_liar: { list: "lies", end: "top", count: true },
  award_duck_speedrun: { list: "duck", end: "top", count: false },
  award_quest_completionist: { list: "quests", end: "top", count: true },
};

export interface AwardSuggestion {
  id: string;
  name: string;
  value: string;
  ties: Array<{ id: string; name: string }>;
  /** The story lets only this program take the award (`HostView.awardOnly`). */
  only?: true;
}

/** The suggestion for one award cue, or null. `only`: the one program the
 *  story's gate lets take it (`HostView.awardOnly[cueId]`) — offered first
 *  whatever the recap says, with no value (the story reads its own). */
export function awardSuggestion(cueId: string, recap: RecapWire | null, only?: { id: string; name: string } | null): AwardSuggestion | null {
  if (only !== undefined && only !== null) return { id: only.id, name: only.name, value: "", ties: [], only: true };
  const src = AWARD_SOURCES[cueId];
  if (src === undefined || recap === null) return null;
  if (src.list === "duck") {
    // The duck board is fastest first; ties share the same ms.
    const rows = (recap.duck ?? []).filter((r) => !r.persona);
    const best = rows[0];
    if (best === undefined) return null;
    const tied = rows.filter((r) => r.ms === best.ms);
    return { id: best.id, name: best.name, value: best.time, ties: tied.slice(1).map(({ id, name }) => ({ id, name })) };
  }
  // Lists are high → low (ties by name); re-rank without the personas.
  const rows = (recap.lists[src.list] ?? []).filter((r) => !r.persona);
  if (rows.length === 0) return null;
  const edge = src.end === "top" ? rows[0]!.value : rows[rows.length - 1]!.value;
  if (src.count && edge <= 0) return null;
  const tied = rows.filter((r) => r.value === edge);
  const [first, ...rest] = tied;
  return { id: first!.id, name: first!.name, value: String(first!.value), ties: rest.map(({ id, name }) => ({ id, name })) };
}

/** `suggested: Ada (82) · tied: Bob, Cy` — the row's hint. */
export function suggestionHint(s: AwardSuggestion): string {
  if (s.only === true) return `only ${s.name} can take this`;
  const tie = s.ties.length > 0 ? ` · tied: ${s.ties.map((t) => t.name).join(", ")}` : "";
  return `suggested: ${s.name} (${s.value})${tie}`;
}

export interface AwardFields {
  winners: Record<string, string>;
  values: Record<string, string>;
  auto: Record<string, { winner: string; value: string }>;
}

/** Fill each award row from its suggestion where the field is empty or still the sheet's own guess. */
export function fillAwards(fields: AwardFields, suggestions: Record<string, AwardSuggestion | null>, roster: ReadonlySet<string>): AwardFields {
  const winners = { ...fields.winners };
  const values = { ...fields.values };
  const auto = { ...fields.auto };
  for (const [cue, s] of Object.entries(suggestions)) {
    if (s === null || !roster.has(s.id)) continue;
    const was = auto[cue];
    const w = winners[cue] ?? "";
    const v = values[cue] ?? "";
    const winnerOurs = w === "" || (was !== undefined && w === was.winner);
    if (!winnerOurs) continue;
    const valueOurs = v === "" || (was !== undefined && v === was.value);
    winners[cue] = s.id;
    if (valueOurs) values[cue] = s.value;
    auto[cue] = { winner: s.id, value: valueOurs ? s.value : (was?.value ?? "") };
  }
  return { winners, values, auto };
}

/** The director picks a winner: the row is theirs from now on (`auto`
 *  dropped), and a value box still holding the sheet's suggested number is
 *  cleared — that number was the suggested winner's, not this person's. */
export function pickWinner(fields: AwardFields, cue: string, winner: string): AwardFields {
  const winners = { ...fields.winners, [cue]: winner };
  const values = { ...fields.values };
  const auto = { ...fields.auto };
  const was = auto[cue];
  if (was !== undefined) {
    if (winner !== was.winner && (values[cue] ?? "") === was.value) delete values[cue];
    if (winner !== was.winner) delete auto[cue];
  }
  return { winners, values, auto };
}

/** The story's `Night.ended` is true (the sheet then fetches the recap). */
export function nightEnded(world: ReadonlyArray<{ path: string; value: string }>): boolean {
  return world.find((w) => w.path === "Night.ended")?.value.trim() === "true";
}

// ---------------------------------------------------------------------------
// The host view (`GET /api/state?role=mod&host=1`)
// ---------------------------------------------------------------------------

export interface HostPerson {
  id: string;
  name: string;
  location: string | null;
  online?: boolean;
  lastSeen?: number | null;
  gone?: true;
  persona?: true;
  restricted: boolean;
  captured: boolean;
  flags?: Array<{ label: string; path: string; value: string; on: boolean }>;
}

export interface HostJudging {
  mode: JudgeMode;
  /** The story's `judge:` character, if any. */
  judge: string | null;
  /** `FactsView.confirm` (verdict → event name), null when facts.json names none. */
  confirm: Partial<Record<"accurate" | "lie" | "uncertain", string>> | null;
  /** `pendingFilings(facts)` — review-mode pending + every near miss, oldest first. */
  pending: JudgingRow[];
  near: number;
  /** Every filing with `final !== null` or a `ruling`, newest
   *  `max(at, ruling.at)` first, at most 10, each with its `filingButtons`. */
  recent: Array<FilingRow & { question: string; buttons: FilingButton[] }>;
}

export interface HostView extends CueSheetView {
  /** `ModView.phase`. */
  runtime: "idle" | "open" | "paused";
  needs: HostNeed[];
  /** Null when the event has no facts.json. */
  judging: HostJudging | null;
  /** `ModView.wallet` trimmed to what the panel shows; null when the story has no currency. */
  wallet: {
    name: string;
    held: Array<{ id: string; fromName: string; toName: string; amount: number; settleAt: number | null }>;
    frozen: Array<{ who: string; name: string; until: number }>;
    stimulus: { uses: number; limit: number };
  } | null;
  king: { hp: number; max: number; fallen: boolean } | null;
  terminals: { voiceMuted: boolean; silentMs: number; rows: Array<{ name: string; agoMs: number; room?: string; view: string }> } | null;
  agents: Array<{
    id: string;
    online: boolean;
    queue: { depth: number; oldestMs: number | null; stalled: boolean } | null;
    /** Guests waiting on this character, oldest first, at most 10. The host
     *  answers with `say {channel: "guest:<guest>", …}`. */
    waiting: Array<{ guest: string; name: string; since: number; text: string }>;
  }>;
  /** Performer parts and their presence (`performerParts` + `castPresence`). */
  parts: Array<{ id: string; presence: PartPresence }>;
  /** Every guest (not personas unless owned), roster order. */
  people: HostPerson[];
  alerts: { path: string; level: AlertLevel };
  staffRooms: string[];
  /** An award cue only one program can take (its story gate names them —
   *  G10 is MS Paint's), by cue id: the picker offers them first
   *  (`awardSuggestion`'s third argument). Absent when none. */
  awardOnly?: Record<string, { id: string; name: string }>;
}

/** A `ModView`-shaped snapshot (the runtime's `modViewNow()`), structurally. */
export interface ModLike {
  title?: string;
  theme?: string;
  interactions?: readonly CueInteraction[];
  cues?: CueMarks;
  world?: readonly WorldLine[];
  roster?: ReadonlyArray<
    CuePerson &
      RosterLike & {
        restricted?: boolean;
        captured?: boolean;
        gone?: true;
        persona?: true;
      }
  >;
  clock?: number;
  phase?: string;
  doorsClosed?: true;
  watch?: ReadonlyArray<{ label: string; path: string | null; scope: string; secret?: true; gated?: true }>;
  countdowns?: readonly { label: string; endsAt: number }[];
  facts?: FactsLike | null;
  wallet?:
    | (WalletLike & {
        name: string;
        stimulus: { uses: number; limit: number };
        frozen?: ReadonlyArray<{ target: string; targetName: string; until: number }>;
      })
    | null;
  cast?: readonly CastLike[];
  minds?: readonly MindLike[];
  alerts?: { path: string; level: AlertLevel };
}

export interface HostViewInput {
  /** A ModView-shaped snapshot (the runtime's `modViewNow()`). Structural. */
  mod: ModLike;
  /** The AgentHub's open guest requests, by character. */
  waiting: ReadonlyMap<string, ReadonlyArray<{ guest: string; name: string; since: number; text: string }>>;
  king: { hp: number; max: number; fallen: boolean } | null;
  terminals: {
    now: number;
    silentMs: number;
    voiceMuted: boolean;
    terminals: Array<{ name: string; ago: number; room?: string; view: string }>;
  } | null;
  /** Per-guest flags (`guestFlags`), by guest id. */
  flags: ReadonlyMap<string, Array<{ label: string; path: string; value: string; on: boolean }>>;
  staffRooms: string[];
  /** Award cues whose story gate names one program (`awardOnly` in
   *  `views.ts`): the one guest who can take it, by cue id. */
  awardOnly?: Readonly<Record<string, { id: string; name: string }>>;
  /** Wall ms. */
  now: number;
}

/** Newest step first: by log position when both rows carry one (a restart
 *  re-stamps every `at` to the replay's moment, which would sort a whole
 *  night in question order), else by when this server saw it. */
export function newestFilingFirst(a: Pick<FilingRow, "at" | "logAt" | "ruling">, b: Pick<FilingRow, "at" | "logAt" | "ruling">): number {
  if (typeof a.logAt === "number" && typeof b.logAt === "number") return b.logAt - a.logAt;
  const when = (r: Pick<FilingRow, "at" | "ruling">): number => Math.max(r.at, r.ruling?.at ?? 0);
  return when(b) - when(a);
}

/** Pure; builds on `cueSheetView(input.mod)`. */
export function hostView(input: HostViewInput): HostView {
  const { mod, now } = input;
  const world = mod.world ?? [];
  // One lookup table per build: the people list asks two paths per row,
  // and a late-night world has thousands of rows.
  const byPath = new Map(world.map((w) => [w.path, w.value]));
  const facts = mod.facts ?? null;
  const cast = mod.cast ?? [];
  const minds = mod.minds ?? [];
  const roster = mod.roster ?? [];
  const runtime: HostView["runtime"] = mod.phase === "open" || mod.phase === "paused" ? mod.phase : "idle";
  const terminals = input.terminals;
  const silentTerminals = terminals === null ? [] : terminals.terminals.filter((t) => t.ago > terminals.silentMs).map((t) => t.name);
  const needs = hostNeeds({ now, world, facts, wallet: mod.wallet ?? null, cast, doorsOpen: runtime === "open", roster, minds, silentTerminals });
  let judging: HostJudging | null = null;
  if (facts !== null) {
    const recent: HostJudging["recent"] = [];
    for (const q of facts.questions) {
      for (const row of questionFilings(facts, q.id)) {
        if (row.final === null && row.ruling === null) continue;
        recent.push({ ...row, question: q.id, buttons: filingButtons(facts, row) });
      }
    }
    recent.sort(newestFilingFirst);
    judging = {
      mode: judgeModeOf(world, facts),
      judge: typeof facts.judge === "string" && facts.judge !== "" ? facts.judge : null,
      confirm: facts.confirm ?? null,
      pending: pendingFilings(facts),
      near: nearCount(facts),
      recent: recent.slice(0, 10),
    };
  }
  const w = mod.wallet ?? null;
  const wallet: HostView["wallet"] =
    w === null
      ? null
      : {
          name: w.name,
          held: heldTransfers(w).map((t) => ({ id: t.id, fromName: t.fromName, toName: t.toName, amount: t.amount, settleAt: t.settleAt })),
          frozen: (w.frozen ?? []).map((f) => ({ who: f.target, name: f.targetName, until: f.until })),
          stimulus: { uses: w.stimulus.uses, limit: w.stimulus.limit },
        };
  const agents: HostView["agents"] = cast
    .filter((c) => c.agent === true)
    .map((c) => {
      const q = agentQueueOf(c.id, cast, minds, now);
      const waiting = [...(input.waiting.get(c.id) ?? [])].sort((a, b) => a.since - b.since).slice(0, 10).map((x) => ({ ...x, text: x.text.slice(0, 200) }));
      return { id: c.id, online: c.online === true, queue: q === null ? null : { depth: q.depth, oldestMs: q.oldestMs, stalled: q.stalled }, waiting };
    });
  const parts = performerParts(cast).map((c) => ({ id: c.id, presence: castPresence(c, true) }));
  const people: HostPerson[] = [];
  for (const r of roster) {
    // A Run persona only while a director drives it (it has an owner).
    if (isPersonaRow(r, byPath) && (r.owner === undefined || r.owner === null)) continue;
    const flags = input.flags.get(r.id);
    people.push({
      id: r.id,
      name: r.name,
      location: r.location,
      ...(r.online !== undefined ? { online: r.online } : {}),
      ...(r.lastSeen !== undefined ? { lastSeen: r.lastSeen } : {}),
      ...(r.gone === true || isGone(byPath, r.id) ? { gone: true as const } : {}),
      ...(r.persona === true || isPersonaRow(r, byPath) ? { persona: true as const } : {}),
      restricted: r.restricted === true,
      captured: r.captured === true,
      ...(flags !== undefined && flags.length > 0 ? { flags: flags.map((f) => ({ ...f })) } : {}),
    });
  }
  return {
    ...cueSheetView(mod),
    runtime,
    needs,
    judging,
    wallet,
    king: input.king === null ? null : { hp: input.king.hp, max: input.king.max, fallen: input.king.fallen },
    terminals: terminals === null ? null : { voiceMuted: terminals.voiceMuted, silentMs: terminals.silentMs, rows: terminals.terminals.map((t) => ({ name: t.name, agoMs: t.ago, ...(t.room !== undefined ? { room: t.room } : {}), view: t.view })) },
    agents,
    parts,
    people,
    alerts: mod.alerts ?? { path: "Night.alerts", level: "sticky" },
    staffRooms: [...input.staffRooms],
    ...(input.awardOnly !== undefined && Object.keys(input.awardOnly).length > 0 ? { awardOnly: Object.fromEntries(Object.entries(input.awardOnly).map(([k, v]) => [k, { id: v.id, name: v.name }])) } : {}),
  };
}
