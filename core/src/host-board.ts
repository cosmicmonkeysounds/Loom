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

import type { CueSheetView, CueInteraction, CueMarks, WorldLine, CuePerson } from "./cue-sheet.ts";
import type { AlertLevel } from "./delivery.ts";

const notYet = (): never => {
  throw new Error("w13: not yet");
};

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
export function judgeModeOf(_world: readonly WorldRow[], _facts: FactsLike | null): JudgeMode {
  return notYet();
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
  /** The key answer it nearly matched, else null. */
  near: string | null;
  /** The story's `judge:` character is being asked to rule. */
  asking: boolean;
  /** Its ruling, once given. */
  ruling: FilingRuling | null;
}

/** A filing's ruling, else null. */
export function rulingOf(_f: FilingLike): FilingRuling | null {
  return notYet();
}

/** Is a ruling being asked for this filing right now? */
export function askingOf(_f: FilingLike): boolean {
  return notYet();
}

/** "🤖 Trabolta: same — why". */
export function rulingText(_r: FilingRuling): string {
  return notYet();
}

/** "🤖 asking Trabolta…". */
export function askingText(_facts: FactsLike): string {
  return notYet();
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
  near: string | null;
  asking: boolean;
  ruling: FilingRuling | null;
}

/** Every filing a `judge:` character ruled on, newest first. */
export function ruledFilings(_facts: FactsLike): Array<FilingRow & { question: string; ruling: FilingRuling }> {
  return notYet();
}

/** A filing's near-miss key, else null. */
export function nearKeyOf(_f: FilingLike): string | null {
  return notYet();
}

/** Every filing with no `final` yet, oldest first. */
export function pendingFilings(_facts: FactsLike): JudgingRow[] {
  return notYet();
}

/** How many filings wait as near misses. */
export function nearCount(_facts: FactsLike): number {
  return notYet();
}

/** One question's filings, oldest first. Empty for an unknown question. */
export function questionFilings(_facts: FactsLike, _id: string): FilingRow[] {
  return notYet();
}

/** The confirm event for `verdict`; null when the view names none. */
export function confirmEvent(_facts: FactsLike, _verdict: FactVerdictLike): string | null {
  return notYet();
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
export function filingButtons(_facts: FactsLike, _row: Pick<FilingRow, "final" | "proposed" | "how">): FilingButton[] {
  return notYet();
}

/** The story call a verdict button makes for one filing. */
export function verdictCall(
  _facts: FactsLike,
  _row: { person: string; question: string },
  _verdict: FactVerdictLike,
): { event: string; person: string; args: { question: string } } | null {
  return notYet();
}

// ---------------------------------------------------------------------------
// The agent queue (moved from cockpit/mind.ts)
// ---------------------------------------------------------------------------

/** A wait worth a director's eye: the story's busy line goes out at 40 s. */
export const QUEUE_SLOW_MS = 40_000;

/** A character's request queue (the cast row's, else the mind's); null on an older server. */
export function agentQueueOf(_character: string, _cast: readonly CastLike[], _minds: readonly MindLike[], _now?: number): QueueLike | null {
  return notYet();
}

/** `1:20` — a wait in minutes and seconds. */
export function waitText(_ms: number): string {
  return notYet();
}

export const QueueTone = { Idle: "idle", Waiting: "waiting", Slow: "slow", Stalled: "stalled" } as const;
export type QueueTone = (typeof QueueTone)[keyof typeof QueueTone];

/** The queue badge. */
export function queueBadge(_q: QueueLike): { text: string; tone: QueueTone; title: string } {
  return notYet();
}

// ---------------------------------------------------------------------------
// Wallet (moved from cockpit/wallet.ts)
// ---------------------------------------------------------------------------

/** Held transfers, oldest first — what "Approve all held" clears. */
export function heldTransfers<T extends { state: string }>(_view: { open: { transfers: readonly T[] } } | null): T[] {
  return [];
}

// ---------------------------------------------------------------------------
// Parts (moved from cockpit/parts.ts)
// ---------------------------------------------------------------------------

/** The rows a performer can sign in to. */
export function performerParts<T extends Pick<CastLike, "part" | "agent">>(_cast: readonly T[]): T[] {
  return [];
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

export function partPresence(_c: Pick<CastLike, "online" | "held">): PartPresence {
  return notYet();
}

/** Any cast row's dot. */
export function castPresence(_c: Pick<CastLike, "online" | "held" | "agent">, _isPart: boolean): PartPresence {
  return notYet();
}

/** Is someone signed in (held, phone online or not)? */
export function isSignedIn(_p: PartPresence): boolean {
  return notYet();
}

// ---------------------------------------------------------------------------
// Guests (moved from cockpit/guests.ts)
// ---------------------------------------------------------------------------

/** How long without a sign of a guest before Needs you asks about them. */
export const UNSEEN_MS = 30 * 60_000;

/** The director marked this guest as gone home (`<id>.gone` is true). */
export function isGone(_world: readonly WorldRow[] | ReadonlyMap<string, string>, _id: string): boolean {
  return notYet();
}

/** A Run persona, not a real guest. */
export function isPersonaRow(_row: Pick<RosterLike, "id" | "owner">, _world: readonly WorldRow[] | ReadonlyMap<string, string>): boolean {
  return notYet();
}

/** Real guests nobody has seen for `ms`, longest-unseen first. */
export function unseenGuests(
  _roster: readonly RosterLike[],
  _world: readonly WorldRow[],
  _now: number,
  _ms: number = UNSEEN_MS,
): Array<{ id: string; name: string; lastSeen: number }> {
  return [];
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
export function hostNeeds(_input: NeedsInputLike): HostNeed[] {
  return [];
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
}

/** The suggestion for one award cue, or null. */
export function awardSuggestion(_cueId: string, _recap: RecapWire | null): AwardSuggestion | null {
  return notYet();
}

/** `suggested: Ada (82) · tied: Bob, Cy` — the row's hint. */
export function suggestionHint(_s: AwardSuggestion): string {
  return notYet();
}

export interface AwardFields {
  winners: Record<string, string>;
  values: Record<string, string>;
  auto: Record<string, { winner: string; value: string }>;
}

/** Fill each award row from its suggestion where the field is empty or still the sheet's own guess. */
export function fillAwards(_fields: AwardFields, _suggestions: Record<string, AwardSuggestion | null>, _roster: ReadonlySet<string>): AwardFields {
  return notYet();
}

/** The director picks a winner: the row is theirs from now on. */
export function pickWinner(_fields: AwardFields, _cue: string, _winner: string): AwardFields {
  return notYet();
}

/** The story's `Night.ended` is true. */
export function nightEnded(_world: ReadonlyArray<{ path: string; value: string }>): boolean {
  return notYet();
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
  /** Wall ms. */
  now: number;
}

/** Pure; builds on `cueSheetView(input.mod)`. */
export function hostView(_input: HostViewInput): HostView {
  return notYet();
}
