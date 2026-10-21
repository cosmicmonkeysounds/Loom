//! The wallet book — the story's currency in flight.
//!
//! A story opts in with one header line (`currency: score as Truthcoin`);
//! the balance stays the engine's per-person slot (`<id>.score`), so every
//! `set program.score`, `scoreOf`, roster column and recap keeps working.
//! What this module owns is the *in-flight* state the engine has no word
//! for: pending transfers inside their deny window, the approver's held
//! queue (every Nth transfer), open requests, escrowed codex offers, the
//! minter's stimulus + grant counts, and the freezes she imposed.
//!
//! Every state change is one `WalletOp`, applied by `WalletBook.apply`, which
//! is the **only** mutation. It reads nothing but the op and the seam (the
//! slice of the `Sim` it touches, unjournaled calls: balances, codex grants,
//! story signals), so the runtime journals the op as a single `wallet` line
//! and a restart replaying the same ops lands on identical balances, cards
//! and story reactions. The timers (the settle window, a held transfer's
//! `HOLD_MS`, request / offer expiry, a freeze's thaw) run on the story clock: the ticker asks `due(now)` and commits
//! each `settle` / `expire` / `unfreeze` as its own journal line, so replay never depends
//! on tick coalescing.
//!
//! Cards for the people involved are `wallet` events addressed to one viewer
//! (a person id, or `@<Character>` for a performer's booth): a root opens
//! the card's thread in the viewer's pinned Wallet room, a step replies to
//! it. The approver and the minter are characters the story names with a
//! `wallet:` property — core only knows the two roles.

import type { CurrencyDef } from "../src/runtime/sim/model.ts";
import type { SimEvent, WalletCard, WalletCardKind, WalletEvent, WalletStep, WalletTxState } from "../src/runtime/sim/event.ts";
import type { Sim } from "../src/runtime/sim/sim.ts";
import { asNumber } from "../src/runtime/expr.ts";
import { foldName } from "../src/parser/names.ts";
import { isSpecial } from "./identity.ts";
import { CASINO_INFO, CASINO_MAX_STAKE, CASINO_MIN_STAKE, isCasinoGame, isPick, pickLabel, rollText, validRoll, type CasinoGame } from "../src/casino.ts";

// --- the card ---------------------------------------------------------------------

// The card + event shapes live in `event.ts` (the `wallet` SimEvent) so
// chat, the views and the play mirror agree; re-exported here for callers.
export type { WalletCard, WalletCardKind, WalletEvent, WalletStep, WalletTxState };

/** What `apply` returns: the seam's story events plus the book's own cards. */
export type WalletBookEvent = SimEvent;

// --- ops (the journal line) ----------------------------------------------

export type WalletOp =
  | { op: "send"; id: string; from: string; to: string; amount: number; at: number; via: "send" | "request"; request?: string }
  | { op: "settle"; id: string }
  | { op: "approve"; id: string; by: string }
  | { op: "deny"; id: string; by: string }
  | { op: "cancel"; id: string; by: string }
  | { op: "request"; id: string; from: string; to: string; amount: number; at: number }
  | { op: "respond"; id: string; accept: boolean; tx?: string; at: number }
  | { op: "expire"; id: string }
  | { op: "offer"; id: string; from: string; to: string; side: "buy" | "sell"; entry: string; amount: number; at: number }
  | { op: "accept"; id: string; at: number }
  | { op: "decline"; id: string }
  | { op: "stimulus"; id: string; by: string; amount: number; at: number }
  // The minter's reserve: coin minted into one account (never debited).
  | { op: "grant"; id: string; by: string; to: string; amount: number; at: number }
  // A freeze on one account's outgoing coin until `until` (story ms);
  // `unfreeze` thaws it — from the clock, or a director's early lift (`by`).
  | { op: "freeze"; id: string; by: string; target: string; until: number; at: number }
  | { op: "unfreeze"; id: string; by?: string }
  // One bet at the casino terminal (`src/casino.ts`): the roll the server
  // threw and what it paid back (stake included) are both journaled, so a
  // replay never rolls again. `visit` = the card thread (the id of the
  // sitting's first bet). The journal line's `by` names the terminal.
  | { op: "bet"; id: string; visit: string; who: string; game: CasinoGame; pick: string; stake: number; roll: number[]; payout: number; at: number };

/** The director acting through a mod route — `by` on approvals / cancels. */
export const DIRECTOR = "Director";

// --- the seam ----------------------------------------------------------------

/** The slice of the Sim + model the book touches (every call unjournaled —
 *  the op that triggers them is the journal line). */
export interface WalletSeam {
  /** Story-clock ms. */
  elapsed(): number;
  /** The balance (the currency slot), 0 when unset. */
  scoreOf(id: string): number;
  /** Has the slot ever been set — "has a balance" (a person in the story). */
  hasBalance(id: string): boolean;
  setBalance(id: string, n: number): SimEvent[];
  /** Mirror the coin `id` has in flight (pending / held sends, open buy-offer
   *  escrow) into the story as `<id>.escrowed`. */
  setEscrowed(id: string, n: number): SimEvent[];
  share(from: string, to: string, entry: string): SimEvent[];
  signal(name: string, subject: string, args: Record<string, string | number | boolean>): SimEvent[];
  persons(): Iterable<{ id: string; name: string }>;
  nameOf(id: string): string;
  holdsCodex(id: string, entry: string): boolean;
  codexIdOf(entry: string): string | null;
  codexTitle(id: string): string;
  /** `Sim.holds(cond, person, person)` — a throwing condition reads false. */
  holds(cond: string, person: string): boolean;
  /** Is this character a performer's part (`identity.ts` isSpecial)? */
  isPart(character: string): boolean;
  /** The guest whose program this character is, if any (folded-name match). */
  personNamed(character: string): string | null;
}

/** Build the seam from a live Sim. `setBalance` goes through `setScore` for
 *  the `score` slot (so the roster / recap hooks run) and `setVar` otherwise. */
export function walletSeam(sim: Sim, currency: CurrencyDef): WalletSeam {
  const slot = currency.slot;
  const key = (id: string): string => `${id}.${slot}`;
  // Folded display title → id, built once per model: the phone sends what
  // it shows (a title), and ~half the show's entries have a `title:` that
  // isn't their id. The first entry with a title wins; an id always beats
  // a title (resolved before this map is read).
  let titled: { model: Sim["model"]; byTitle: Map<string, string> } | null = null;
  const idByTitle = (entry: string): string | null => {
    if (titled === null || titled.model !== sim.model) {
      const byTitle = new Map<string, string>();
      for (const e of sim.model.codex.values()) {
        const k = foldName(e.title);
        if (!byTitle.has(k)) byTitle.set(k, e.id);
      }
      titled = { model: sim.model, byTitle };
    }
    return titled.byTitle.get(foldName(entry)) ?? null;
  };
  return {
    elapsed: () => sim.elapsed(),
    scoreOf: (id) => (slot === "score" ? sim.scoreOf(id) : (asNumber(sim.world.get(key(id))) ?? 0)),
    hasBalance: (id) => sim.world.peek(key(id)) !== null,
    setBalance: (id, n) => (slot === "score" ? sim.setScore(id, n) : sim.setVar(key(id), String(n))),
    setEscrowed: (id, n) => sim.setVar(`${id}.escrowed`, String(n)),
    share: (from, to, entry) => sim.share(from, to, entry),
    signal: (name, subject, args) => sim.signal(name, subject, args),
    persons: () => [...sim.persons.values()].map((p) => ({ id: p.id, name: p.name })),
    nameOf: (id) => sim.persons.get(id)?.name ?? id,
    holdsCodex: (id, entry) => sim.holdsCodex(id, entry),
    codexIdOf: (entry) => {
      const t = entry.trim();
      if (sim.model.codex.has(t)) return t;
      return sim.model.codexIndex.get(t) ?? idByTitle(t);
    },
    codexTitle: (id) => sim.model.codex.get(id)?.title ?? id,
    holds: (cond, person) => sim.holds(cond, person, person),
    isPart: (character) => isSpecial(sim.model, character),
    personNamed: (character) => {
      const want = foldName(character);
      for (const p of sim.persons.values()) if (foldName(p.name) === want) return p.id;
      return null;
    },
  };
}

// --- state + views -------------------------------------------------------------

export type WalletRequestState = "open" | "paying" | "paid" | "declined" | "expired" | "cancelled";
export type WalletOfferState = "open" | "accepted" | "declined" | "failed" | "expired" | "cancelled";

interface Transfer {
  id: string;
  from: string;
  to: string;
  amount: number;
  at: number;
  via: "send" | "request";
  request: string | null;
  state: WalletTxState;
  settleAt: number | null;
  by?: string;
  /** Wave 18b: the approver's audit held it (its recipient has a flagged thread). */
  held?: true;
}
interface Request {
  id: string;
  from: string; // the asker
  to: string; // the payer
  amount: number;
  at: number;
  expiresAt: number;
  state: WalletRequestState;
  tx?: string;
}
interface Freeze {
  id: string;
  by: string;
  target: string;
  at: number;
  until: number;
  state: "frozen" | "thawed";
}
interface Offer {
  id: string;
  from: string; // the maker
  to: string; // the counterparty
  side: "buy" | "sell";
  entry: string;
  amount: number;
  at: number;
  expiresAt: number;
  state: WalletOfferState;
  /** Coin held from the maker (buy side only). */
  escrow: number;
}

export interface WalletTxView {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
  state: WalletTxState;
  settleAt: number | null;
  via: "send" | "request";
  at: number;
  by?: string;
}
export interface WalletRequestView {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
  state: WalletRequestState;
  expiresAt: number;
  at: number;
  tx?: string;
}
export interface WalletOfferView {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  side: "buy" | "sell";
  entry: string;
  entryTitle: string;
  amount: number;
  state: WalletOfferState;
  expiresAt: number;
  at: number;
}
/** A guest's wallet (`GuestView.wallet`). */
export interface WalletView {
  name: string;
  balance: number;
  /** Coin out of the balance but not yet the other side's: pending / held
   *  transfers + open buy offers. */
  escrowed: number;
  maxTransfer: number;
  /** Mine (either side), open first, newest 20. */
  transfers: WalletTxView[];
  /** Open requests, in + out. */
  requests: WalletRequestView[];
  /** Open offers, in + out. */
  offers: WalletOfferView[];
  /** When the viewer's coin is frozen: story ms it thaws at. Send, pay a
   *  request, a buy offer and accepting a sell offer are refused until then
   *  (receiving, declining and cancelling still work). */
  frozenUntil?: number;
  /** When the viewer is the minter's program. `uses` / `limit` = the
   *  stimulus; `grants` = the reserve's per-person grants; `freezeMs` = one
   *  freeze's length; `frozen` = the freezes in force (any imposer). */
  minter?: { uses: number; limit: number; grants: { uses: number; limit: number }; freezeMs: number; frozen: WalletFreezeView[] };
  /** When the viewer IS the approver (the approver declared as a guest program). */
  approver?: { queue: WalletTxView[] };
}
/** A freeze in force (`WalletView.minter.frozen`, `WalletModView.frozen`). */
export interface WalletFreezeView {
  id: string;
  target: string;
  targetName: string;
  by: string;
  until: number;
  at: number;
}
/** The approver's booth (`PrimeView.wallet`). */
export interface WalletQueueView {
  name: string;
  queue: WalletTxView[];
  every: number;
  windowMs: number;
}
/** The director's mirror (`ModView.wallet`). */
export interface WalletModView {
  name: string;
  slot: string;
  approver: string | null;
  minter: string | null;
  minterPerson: string | null;
  counter: number;
  stimulus: { uses: number; limit: number };
  grants: { uses: number; limit: number };
  frozen: WalletFreezeView[];
  open: { transfers: WalletTxView[]; requests: WalletRequestView[]; offers: WalletOfferView[] };
  /** The casino terminal's night: bets taken, coin staked, coin paid back
   *  (the house is up `staked − paid`). */
  casino?: { bets: number; staked: number; paid: number };
}

/** A route refusal: HTTP status + the message the phone shows. */
export interface WalletRefusal {
  status: 400 | 403 | 404 | 409;
  error: string;
}

const MAX_OPEN_OUTGOING = 5;

/** How long a held transfer waits for the approver before it settles on its
 *  own (step `timed_out`, no `transfer_approved`) — so an unstaffed booth
 *  never strands every Nth send. */
export const HOLD_MS = 5 * 60_000;

/** One casino bet per guest per this long (wall ms, the route's). */
export const CASINO_BET_GAP_MS = 700;

/** A casino sitting: bets this close together (story ms) share one card thread. */
export const CASINO_VISIT_MS = 10 * 60_000;

/** The minter's grants when the role names no `grants N`. */
export const DEFAULT_GRANTS = 3;
/** One freeze's length when the role names no `freeze <dur>`. */
export const DEFAULT_FREEZE_MS = 10 * 60_000;

/** "4 min" / "35 s" — a countdown from story ms. */
function leftText(until: number | undefined, now: number | undefined, fallback: string): string {
  if (until === undefined || now === undefined) return fallback;
  const left = Math.max(0, until - now);
  return left > 90_000 ? `${Math.ceil(left / 60_000)} min` : `${Math.ceil(left / 1000)} s`;
}

function idNumber(id: string): number {
  const m = /(\d+)$/u.exec(id);
  return m === null ? 0 : Number(m[1]);
}
function byId<T extends { id: string }>(a: T, b: T): number {
  return idNumber(a.id) - idNumber(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** "DraftKings'" / "Winamp's" — a name's possessive (a name ending in s
 *  takes the apostrophe alone). */
export function possessive(name: string): string {
  return /s$/iu.test(name) ? `${name}'` : `${name}'s`;
}

/** The plain one-line summary of a card — the sidebar preview, the thread
 *  text, an old client's fallback. Perspective is the card's `kind` + `step`;
 *  `now` (story ms, the compose-time clock) turns `settleAt` into "60 s".
 *  `viewer` (the card's recipient: a person id or `@<Character>`) words a
 *  request's denied / cancelled payment for the payer, who gets the same
 *  card as the asker ("your payment", "You cancelled …"). */
export function walletLine(c: WalletCard, now?: number, viewer?: string): string {
  const amt = `${c.amount} ${c.unit}`;
  const audit = c.approver ?? "the auditor";
  // Wave 18b (R13): what the approver's hold is called (`audit "a CRA audit"`).
  const flaggedFor = c.audit ?? "an audit";
  // A transfer card's recipient (the flagged thread's owner), not its sender.
  const mine = viewer !== undefined && viewer === c.to && viewer !== c.from;
  const windowText = (): string =>
    c.settleAt !== undefined && now !== undefined ? `${Math.max(0, Math.ceil((c.settleAt - now) / 1000))} s` : "a moment";
  // A held transfer's auto-approval, in minutes once it's more than 90 s off.
  const holdText = (): string => leftText(c.settleAt, now, "a few minutes");
  switch (c.kind) {
    case "transfer":
      switch (c.step) {
        case "pending":
          return `💸 You sent ${amt} to ${c.toName} — settles in ${windowText()} unless ${audit} denies it.`;
        case "held":
          return `🚩 Flagged for ${flaggedFor}: ${amt} to ${c.toName} must be approved by ${audit} — it goes through on its own in ${holdText()}.`;
        case "flagged":
          return `🚩 Flagged for ${flaggedFor}: ${c.fromName} is sending you ${amt}. It must be approved by ${audit} first — it goes through on its own in ${holdText()}.`;
        case "settled":
          return `✅ ${amt} to ${c.toName} settled.`;
        case "received":
          return c.by !== undefined ? `✅ Approved by ${c.by}: ${c.fromName} sent you ${amt}.` : `💰 ${c.fromName} sent you ${amt}.`;
        case "approved":
          return `✅ Approved by ${c.by ?? audit}: ${amt} to ${c.toName}.`;
        case "timed_out":
          return `✅ Approved automatically: ${amt} to ${c.toName}.`;
        case "denied":
          if (mine) return `⛔ Denied by ${c.by ?? audit}: ${possessive(c.fromName)} ${amt} never reached you.`;
          return `⛔ Denied by ${c.by ?? audit}: ${amt} to ${c.toName}. Refunded.`;
        case "cancelled":
          if (mine) return c.by === undefined || c.by === c.fromName ? `↩️ ${c.fromName} cancelled the ${amt}. It never reached you.` : `↩️ ${c.by} cancelled ${possessive(c.fromName)} ${amt}. It never reached you.`;
          return `↩️ Cancelled: ${amt} to ${c.toName}. Refunded.`;
        default:
          return `💸 ${amt} to ${c.toName}.`;
      }
    case "approval":
      switch (c.step) {
        case "pending":
          return `🧾 ${c.fromName} → ${c.toName}: ${amt}. Settles in ${windowText()} unless you deny it.`;
        case "held":
          return `🚩 Flagged for ${flaggedFor}: ${c.fromName} → ${c.toName}: ${amt}. Waiting for your approval — it goes through on its own in ${holdText()}.`;
        case "settled":
          return `✅ Settled: ${c.fromName} → ${c.toName}, ${amt}.`;
        case "approved":
          return `✅ Approved${c.by ? ` by ${c.by}` : ""}: ${c.fromName} → ${c.toName}, ${amt}.`;
        case "timed_out":
          return `⌛ Timed out — approved automatically: ${c.fromName} → ${c.toName}, ${amt}.`;
        case "denied":
          return `⛔ Denied${c.by ? ` by ${c.by}` : ""}: ${c.fromName} → ${c.toName}, ${amt}. Refunded.`;
        case "cancelled":
          return `↩️ Cancelled: ${c.fromName} → ${c.toName}, ${amt}.`;
        default:
          return `🧾 ${c.fromName} → ${c.toName}: ${amt}.`;
      }
    case "request":
      switch (c.step) {
        case "asked":
          return `🙏 ${c.fromName} asks you for ${amt}.`;
        case "sent":
          return `🙏 You asked ${c.toName} for ${amt}.`;
        case "accepted":
          return `💸 You agreed to pay ${c.fromName} ${amt}.`;
        case "paid":
          // Both parties get this step (T5-07), so it names them both.
          return `✅ Paid: ${c.toName} sent ${c.fromName} ${amt}.`;
        case "declined":
          // With `by`: the auditor / director denied the payment (C6).
          if (c.by !== undefined) return viewer === c.to ? `⛔ ${c.by} denied your payment of ${amt}; refunded.` : `⛔ ${c.by} denied ${possessive(c.toName)} payment of ${amt}; refunded.`;
          return viewer === c.to ? `⛔ You declined ${possessive(c.fromName)} request for ${amt}.` : `⛔ Declined: ${amt} from ${c.toName}.`;
        case "expired":
          return `⌛ Expired: ${possessive(c.fromName)} request for ${amt}.`;
        case "cancelled":
          // With `by`: the payment was cancelled (by the payer or a director).
          // With `closedBy`: someone else (a director) closed the open request.
          if (c.by !== undefined) {
            const payerDid = c.by === c.toName;
            if (viewer === c.to) return payerDid ? `↩️ You cancelled the payment of ${amt}.` : `↩️ ${c.by} cancelled your payment of ${amt}.`;
            return payerDid ? `↩️ ${c.toName} cancelled the payment of ${amt}.` : `↩️ ${c.by} cancelled ${possessive(c.toName)} payment of ${amt}.`;
          }
          return c.closedBy !== undefined ? `↩️ ${c.closedBy} cancelled ${possessive(c.fromName)} request for ${amt}.` : `↩️ ${c.fromName} withdrew the request for ${amt}.`;
        default:
          return `🙏 ${c.fromName} → ${c.toName}: ${amt}.`;
      }
    case "offer": {
      const title = `“${c.entryTitle ?? c.entry ?? "a fact"}”`;
      const deal = c.side === "buy" ? `${amt} for ${title}` : `${title} for ${amt}`;
      switch (c.step) {
        case "offered":
          return `💱 ${c.fromName} offers you ${deal}.`;
        case "sent":
          return `💱 You offered ${c.toName} ${deal}.`;
        case "accepted":
          return `✅ Done: ${deal}.`;
        case "failed":
          return `⛔ Could not settle ${deal} — refunded.`;
        case "declined":
          return `⛔ Declined: ${deal}.`;
        case "expired":
          return `⌛ Expired: ${deal}.`;
        case "cancelled":
          return `↩️ Withdrawn: ${deal}.`;
        default:
          return `💱 ${deal}.`;
      }
    }
    case "stimulus":
      return c.step === "minted" ? `💰 Stimulus: every eligible program received ${amt}.` : `💰 Stimulus from ${c.fromName}: ${amt}.`;
    case "grant":
      return c.step === "granted" ? `🎁 You granted ${c.toName} ${amt} from the reserve.` : `🎁 ${c.fromName} granted you ${amt} from the reserve.`;
    case "freeze":
      switch (c.step) {
        case "frozen":
          return `🧊 ${c.fromName} froze your ${c.unit} — you can't send, pay or buy until it thaws in ${leftText(c.settleAt, now, "a few minutes")}.`;
        case "imposed":
          return `🧊 You froze ${possessive(c.toName)} ${c.unit} — it thaws in ${leftText(c.settleAt, now, "a few minutes")}.`;
        case "thawed":
          return c.by !== undefined ? `☀️ ${c.by} lifted the freeze — your ${c.unit} moves again.` : `☀️ Your ${c.unit} thawed — it moves again.`;
        case "expired":
          return `☀️ The freeze on ${c.toName} is over.`;
        case "cancelled":
          return `↩️ ${c.by ?? DIRECTOR} lifted the freeze on ${c.toName}.`;
        default:
          return `🧊 ${possessive(c.toName)} ${c.unit} is frozen.`;
      }
    case "casino": {
      const bet = `${c.game ?? "The casino"}: ${amt} on ${c.pick ?? "a pick"} — ${c.roll ?? "?"}.`;
      if (c.step === "won") return `🎰 ${bet} Won ${c.payout ?? 0} ${c.unit}.`;
      if (c.step === "push") return `🎰 ${bet} Your stake back.`;
      return `🎰 ${bet} Lost.`;
    }
    default:
      return `💰 ${amt}`;
  }
}

// --- the book ---------------------------------------------------------------------

export class WalletBook {
  private readonly transfers = new Map<string, Transfer>();
  private readonly requests = new Map<string, Request>();
  private readonly offers = new Map<string, Offer>();
  /** Transfers seen by the approver rule (every Nth is held). */
  private counter = 0;
  private stimulusUses = 0;
  private grantUses = 0;
  /** The casino: each person's current sitting (its thread id + last bet), and the night's totals. */
  private readonly casinoVisits = new Map<string, { id: string; at: number }>();
  private casinoBets = 0;
  private casinoStaked = 0;
  private casinoPaid = 0;
  private readonly freezes = new Map<string, Freeze>();
  private seq = 0;
  /** What the story was last told each person has in flight (`<id>.escrowed`). */
  private readonly mirrored = new Map<string, number>();

  readonly currency: CurrencyDef;
  private readonly seam: WalletSeam;

  constructor(currency: CurrencyDef, seam: WalletSeam) {
    this.currency = currency;
    this.seam = seam;
  }

  // --- ids -------------------------------------------------------------------

  /** Mint the next id for a route (`t12`); `apply` raises `seq` past any id
   *  it sees, so a replay re-mints nothing twice. */
  nextId(prefix: "t" | "r" | "o" | "s" | "g" | "f" | "c"): string {
    return `${prefix}${++this.seq}`;
  }
  private noteId(id: string): void {
    const n = idNumber(id);
    if (n > this.seq) this.seq = n;
  }

  // --- roles -------------------------------------------------------------------

  /** The guest whose program is the minter, if any. */
  minterPerson(): string | null {
    const m = this.currency.minter;
    return m === null ? null : this.seam.personNamed(m.id);
  }
  /** The person id or `@<Character>` the approver's cards are addressed to. */
  approverAudience(): string | null {
    const a = this.currency.approver;
    if (a === null) return null;
    if (this.seam.isPart(a.id)) return `@${a.id}`;
    return this.seam.personNamed(a.id) ?? `@${a.id}`;
  }
  /** Is `who` (a person id or a character id) the approver? */
  isApprover(who: string): boolean {
    const a = this.currency.approver;
    if (a === null) return false;
    return who === a.id || (!this.seam.isPart(a.id) && this.seam.personNamed(a.id) === who);
  }
  /** Resolve a codex entry (title / id / loose spelling) to its id. */
  entryIdOf(entry: string): string | null {
    return this.seam.codexIdOf(entry);
  }

  private isPerson(id: string): boolean {
    for (const p of this.seam.persons()) if (p.id === id) return true;
    return false;
  }

  // --- route checks (pure; the route replies with status + error) ------------------

  private checkAmount(amount: number): WalletRefusal | null {
    const max = this.currency.maxTransfer;
    if (!Number.isInteger(amount) || amount < 1 || amount > max) {
      return { status: 400, error: `amount must be a whole number from 1 to ${max}` };
    }
    return null;
  }

  /** The freeze on `who`'s outgoing coin, as a refusal — null when free. */
  private checkFrozen(who: string): WalletRefusal | null {
    const until = this.frozenUntil(who);
    if (until === null) return null;
    return { status: 409, error: `your ${this.currency.name} is frozen — it thaws in ${leftText(until, this.seam.elapsed(), "a few minutes")}` };
  }

  checkSend(from: string, to: string, amount: number): WalletRefusal | null {
    const bad = this.checkAmount(amount);
    if (bad !== null) return bad;
    const frozen = this.checkFrozen(from);
    if (frozen !== null) return frozen;
    if (!this.isPerson(to)) return { status: 404, error: "unknown recipient" };
    if (to === from) return { status: 409, error: "you can't send to yourself" };
    if (this.seam.scoreOf(from) < amount) return { status: 409, error: "insufficient funds" };
    return null;
  }

  checkRequest(from: string, to: string, amount: number): WalletRefusal | null {
    const bad = this.checkAmount(amount);
    if (bad !== null) return bad;
    if (!this.isPerson(to)) return { status: 404, error: "unknown recipient" };
    if (to === from) return { status: 409, error: "you can't ask yourself" };
    let open = 0;
    for (const r of this.requests.values()) if (r.from === from && r.state === "open") open++;
    if (open >= MAX_OPEN_OUTGOING) return { status: 409, error: "too many open requests" };
    return null;
  }

  checkOffer(from: string, to: string, side: "buy" | "sell", entry: string, amount: number): WalletRefusal | null {
    const bad = this.checkAmount(amount);
    if (bad !== null) return bad;
    if (!this.isPerson(to)) return { status: 404, error: "unknown recipient" };
    if (to === from) return { status: 409, error: "you can't trade with yourself" };
    // A sell: unknown and not-held read the same, so it can't probe which
    // entries (secret ones included) exist. A buy never tests what the
    // seller holds (that would let anyone read another guest's secret
    // entries, unseen); accept re-checks the holdings. The route charges a
    // refused offer to the rate limiter, so guessing titles stays slow.
    const id = this.seam.codexIdOf(entry);
    if (side === "sell" && (id === null || !this.seam.holdsCodex(from, id))) return { status: 404, error: "you don't hold that entry" };
    if (side === "buy" && id === null) return { status: 409, error: "they don't have that to sell" };
    if (side === "buy") {
      const frozen = this.checkFrozen(from);
      if (frozen !== null) return frozen;
    }
    if (side === "buy" && this.seam.scoreOf(from) < amount) return { status: 409, error: "insufficient funds" };
    let open = 0;
    for (const o of this.offers.values()) if (o.from === from && o.state === "open") open++;
    if (open >= MAX_OPEN_OUTGOING) return { status: 409, error: "too many open offers" };
    return null;
  }

  /** A request asked of `who`; accepting also needs the funds for the send. */
  checkRespond(id: string, who: string, accept: boolean): WalletRefusal | null {
    const r = this.requests.get(id);
    if (r === undefined || r.to !== who) return { status: 404, error: "no such request for you" };
    if (r.state !== "open") return { status: 409, error: "already settled" };
    if (accept) return this.checkSend(who, r.from, r.amount);
    return null;
  }

  /** Accepting a sell offer pays the maker — refused while frozen. */
  checkAccept(id: string, who: string): WalletRefusal | null {
    const bad = this.checkOfferSide(id, who);
    if (bad !== null) return bad;
    return this.offers.get(id)!.side === "sell" ? this.checkFrozen(who) : null;
  }
  checkDecline(id: string, who: string): WalletRefusal | null {
    return this.checkOfferSide(id, who);
  }
  private checkOfferSide(id: string, who: string): WalletRefusal | null {
    const o = this.offers.get(id);
    if (o === undefined || o.to !== who) return { status: 404, error: "no such offer for you" };
    if (o.state !== "open") return { status: 409, error: "already settled" };
    return null;
  }

  /** My held transfer, my open request, my open offer — or anything, for a director. */
  checkCancel(id: string, who: string, director = false): WalletRefusal | null {
    const t = this.transfers.get(id);
    if (t !== undefined) {
      if (t.from !== who && !director) return { status: 404, error: "no such transfer for you" };
      if (t.state !== "held" && !(director && t.state === "pending")) return { status: 409, error: "already settled" };
      return null;
    }
    const r = this.requests.get(id);
    if (r !== undefined) {
      if (r.from !== who && !director) return { status: 404, error: "no such request for you" };
      if (r.state !== "open") return { status: 409, error: "already settled" };
      return null;
    }
    const o = this.offers.get(id);
    if (o !== undefined) {
      if (o.from !== who && !director) return { status: 404, error: "no such offer for you" };
      if (o.state !== "open") return { status: 409, error: "already settled" };
      return null;
    }
    return { status: 404, error: "nothing to cancel" };
  }

  checkApprove(id: string): WalletRefusal | null {
    const t = this.transfers.get(id);
    if (t === undefined) return { status: 404, error: "no such transfer" };
    if (t.state !== "held") return { status: 409, error: t.state === "pending" ? "not waiting for approval — it settles on its own" : "too late — already settled" };
    return null;
  }
  checkDeny(id: string): WalletRefusal | null {
    const t = this.transfers.get(id);
    if (t === undefined) return { status: 404, error: "no such transfer" };
    if (t.state !== "held" && t.state !== "pending") return { status: 409, error: "too late — already settled" };
    return null;
  }

  /** `who` is the minter's program, or a director. */
  checkStimulus(who: string, amount: number, director = false): WalletRefusal | null {
    const m = this.currency.minter;
    if (m === null) return { status: 403, error: "this story has no minter" };
    if (!director && this.minterPerson() !== who) return { status: 403, error: "not the minter" };
    if (this.stimulusUses >= m.limit) return { status: 409, error: "no stimulus left" };
    return this.checkAmount(amount);
  }

  private grantLimit(): number {
    return this.currency.minter?.grants ?? DEFAULT_GRANTS;
  }
  private freezeMs(): number {
    return this.currency.minter?.freezeMs ?? DEFAULT_FREEZE_MS;
  }
  /** Who may receive a grant: the stimulus's eligibility (`while`, else a balance). */
  private eligible(id: string): boolean {
    const m = this.currency.minter;
    if (m === null) return false;
    return m.while !== null ? this.seam.holds(m.while, id) : this.seam.hasBalance(id);
  }

  /** The minter's program (or a director) grants `to` coin from the reserve. */
  checkGrant(who: string, to: string, amount: number, director = false): WalletRefusal | null {
    const m = this.currency.minter;
    if (m === null) return { status: 403, error: "this story has no minter" };
    if (!director && this.minterPerson() !== who) return { status: 403, error: "not the minter" };
    if (!this.isPerson(to)) return { status: 404, error: "unknown recipient" };
    if (to === who) return { status: 409, error: "you can't grant to yourself" };
    if (!this.eligible(to)) return { status: 409, error: "they can't receive a grant yet" };
    if (this.grantUses >= this.grantLimit()) return { status: 409, error: "no grants left" };
    return this.checkAmount(amount);
  }

  /** The minter's program (or a director) freezes `target`'s outgoing coin. */
  checkFreeze(who: string, target: string, director = false): WalletRefusal | null {
    const m = this.currency.minter;
    if (m === null) return { status: 403, error: "this story has no minter" };
    if (!director && this.minterPerson() !== who) return { status: 403, error: "not the minter" };
    if (!this.isPerson(target)) return { status: 404, error: "unknown recipient" };
    if (target === who) return { status: 409, error: "you can't freeze yourself" };
    if (this.frozenUntil(target) !== null) return { status: 409, error: "already frozen" };
    return null;
  }

  /** A director lifts a freeze early — by its id, or the target's person id. */
  checkUnfreeze(idOrTarget: string): { id: string } | WalletRefusal {
    const f = this.freezes.get(idOrTarget) ?? [...this.freezes.values()].find((x) => x.target === idOrTarget && x.state === "frozen");
    if (f === undefined) return { status: 404, error: "no such freeze" };
    if (f.state !== "frozen") return { status: 409, error: "already thawed" };
    return { id: f.id };
  }

  /** A bet at the casino terminal: a person with the coin to cover it, not
   *  frozen, a known game + pick, a whole stake in range. (Restricted is the
   *  route's: the sim knows it, the book doesn't.) */
  checkBet(who: string, game: string, pick: string, stake: number): WalletRefusal | null {
    if (!this.isPerson(who)) return { status: 404, error: "unknown guest" };
    if (!isCasinoGame(game)) return { status: 400, error: "unknown game" };
    if (!isPick(game, pick)) return { status: 400, error: `unknown pick for ${CASINO_INFO[game].title}` };
    if (!Number.isInteger(stake) || stake < CASINO_MIN_STAKE || stake > CASINO_MAX_STAKE) {
      return { status: 400, error: `the stake must be a whole number from ${CASINO_MIN_STAKE} to ${CASINO_MAX_STAKE}` };
    }
    const frozen = this.checkFrozen(who);
    if (frozen !== null) return frozen;
    if (this.seam.scoreOf(who) < stake) return { status: 409, error: "insufficient funds" };
    return null;
  }

  /** `who`'s balance (the currency slot). */
  balanceOf(who: string): number {
    return this.seam.scoreOf(who);
  }

  /** The card thread a bet placed now joins: the sitting's, while its last
   *  bet is within `CASINO_VISIT_MS`; else a new one (the bet's own id). */
  casinoVisitFor(who: string, at: number, id: string): string {
    const v = this.casinoVisits.get(who);
    return v !== undefined && at - v.at <= CASINO_VISIT_MS && at >= v.at ? v.id : id;
  }

  /** The story ms `who`'s coin thaws at, or null when it isn't frozen. A
   *  freeze past its deadline reads thawed even before the ticker's
   *  `unfreeze` line lands. */
  frozenUntil(who: string): number | null {
    const now = this.seam.elapsed();
    for (const f of this.freezes.values()) if (f.target === who && f.state === "frozen" && f.until > now) return f.until;
    return null;
  }

  /** The `until` a freeze minted now would carry. */
  freezeUntil(at: number): number {
    return at + this.freezeMs();
  }

  // --- the ticker ---------------------------------------------------------------------

  /** Everything the story clock has made due, in id order: a pending
   *  transfer past its window, a held one past `HOLD_MS`, and the expiries. */
  due(now: number): WalletOp[] {
    const out: WalletOp[] = [];
    for (const t of [...this.transfers.values()].sort(byId)) {
      if (this.isOpenTx(t) && t.settleAt !== null && t.settleAt <= now) out.push({ op: "settle", id: t.id });
    }
    const expiring: Array<{ id: string }> = [];
    for (const r of this.requests.values()) if (r.state === "open" && r.expiresAt <= now) expiring.push(r);
    for (const o of this.offers.values()) if (o.state === "open" && o.expiresAt <= now) expiring.push(o);
    for (const e of expiring.sort(byId)) out.push({ op: "expire", id: e.id });
    for (const f of [...this.freezes.values()].sort(byId)) if (f.state === "frozen" && f.until <= now) out.push({ op: "unfreeze", id: f.id });
    return out;
  }

  /** Every held transfer's id, oldest first (`/api/mod/wallet/approve-held`). */
  heldIds(): string[] {
    return [...this.transfers.values()]
      .filter((t) => t.state === "held")
      .sort(byId)
      .map((t) => t.id);
  }

  // --- apply -----------------------------------------------------------------------------

  /** The only mutation. Deterministic on the op + the seam; never throws on
   *  a stale op (it degrades to a no-op or a `failed` step) so a replayed
   *  journal can't desynchronise balances. */
  apply(op: WalletOp): WalletBookEvent[] {
    this.noteId(op.id);
    switch (op.op) {
      case "send":
        return this.applySend(op);
      case "settle":
        return this.settle(op.id, undefined);
      case "approve":
        return this.applyApprove(op.id, op.by);
      case "deny":
        return this.applyDeny(op.id, op.by);
      case "cancel":
        return this.applyCancel(op.id, op.by);
      case "request":
        return this.applyRequest(op);
      case "respond":
        return this.applyRespond(op);
      case "expire":
        return this.applyExpire(op.id);
      case "offer":
        return this.applyOffer(op);
      case "accept":
        return this.applyAccept(op.id);
      case "decline":
        return this.applyDecline(op.id);
      case "stimulus":
        return this.applyStimulus(op);
      case "grant":
        return this.applyGrant(op);
      case "freeze":
        return this.applyFreeze(op);
      case "unfreeze":
        return this.applyUnfreeze(op.id, op.by);
      case "bet":
        return this.applyBet(op);
      default:
        return [];
    }
  }

  private card(kind: WalletCardKind, t: { id: string; from: string; to: string; amount: number }, step: WalletStep, extra: Partial<WalletCard> = {}): WalletCard {
    return {
      kind,
      id: t.id,
      step,
      from: t.from,
      fromName: this.nameOf(t.from),
      to: t.to,
      toName: this.nameOf(t.to),
      amount: t.amount,
      unit: this.currency.name,
      ...extra,
    };
  }
  private nameOf(id: string): string {
    return id === DIRECTOR ? DIRECTOR : this.seam.nameOf(id);
  }
  /** Who acted, as a card's `by` shows it: "Director", a guest's display
   *  name (never the `g-…` id), or a character with spaces for `_`. The op,
   *  the transfer and the signal args keep the raw id. */
  private byName(id: string): string {
    if (id === DIRECTOR) return DIRECTOR;
    // Wave 18b: the approver acting is named as the story's `as` (MyCRA).
    const a = this.currency.approver;
    if (a !== null && a.as !== undefined && this.isApprover(id)) return a.as;
    return this.isPerson(id) ? this.seam.nameOf(id) : id.replace(/_/gu, " ");
  }
  /** The approver as wallet cards name it: the story's `as <name>` (wave
   *  18b, "MyCRA"), else the character's name. */
  private approverName(): string | undefined {
    const a = this.currency.approver;
    return a === null ? undefined : (a.as ?? a.id.replace(/_/gu, " "));
  }
  /** The approver's `audit <phrase>` (wave 18b), only when the story gives one. */
  private auditOf(): { audit: string } | Record<string, never> {
    const audit = this.currency.approver?.audit;
    return audit !== undefined ? { audit } : {};
  }
  private ev(to: string, card: WalletCard, root: boolean): WalletEvent {
    return { type: "wallet", to, card, root };
  }

  private applySend(op: Extract<WalletOp, { op: "send" }>): WalletBookEvent[] {
    this.noteId(op.id); // also reached from `respond`'s embedded send
    if (this.transfers.has(op.id)) return [];
    const out: WalletBookEvent[] = [];
    const t: Transfer = { id: op.id, from: op.from, to: op.to, amount: op.amount, at: op.at, via: op.via, request: op.request ?? null, state: "pending", settleAt: null };
    this.transfers.set(t.id, t);
    this.counter++;
    // Into escrow: the story hears the escrow before the debit, so a sum
    // of score + escrowed never dips mid-op (a watcher sees no false low).
    out.push(...this.mirrorEscrow(t.from));
    out.push(...this.seam.setBalance(t.from, this.seam.scoreOf(t.from) - t.amount));
    const approver = this.currency.approver;
    const audience = this.approverAudience();
    const args = { to: t.to, amount: t.amount, tx: t.id };
    if (approver !== null && audience !== null && this.counter % approver.every === 0) {
      t.state = "held";
      t.held = true;
      t.settleAt = op.at + HOLD_MS;
      const flag = { settleAt: t.settleAt, approver: this.approverName(), ...this.auditOf() };
      out.push(this.ev(t.from, this.card("transfer", t, "held", flag), true));
      out.push(this.ev(audience, this.card("approval", t, "held", flag), true));
      // Wave 18b (R13): the recipient learns it is coming and flagged —
      // the thread its settle, deny or cancel later replies to.
      out.push(this.ev(t.to, this.card("transfer", t, "flagged", flag), true));
      out.push(...this.seam.signal("transfer_sent", t.from, { ...args, state: "held" }));
      out.push(...this.seam.signal("transfer_held", t.from, args));
      return out;
    }
    if (approver !== null && audience !== null) {
      t.settleAt = op.at + approver.windowMs;
      out.push(this.ev(t.from, this.card("transfer", t, "pending", { settleAt: t.settleAt, approver: this.approverName() }), true));
      out.push(this.ev(audience, this.card("approval", t, "pending", { settleAt: t.settleAt, approver: this.approverName() }), true));
      out.push(...this.seam.signal("transfer_sent", t.from, { ...args, state: "pending" }));
      return out;
    }
    // No approver: settle inline; the sender's root is the settled card.
    out.push(...this.seam.signal("transfer_sent", t.from, { ...args, state: "settled" }));
    out.push(...this.settle(t.id, undefined, true));
    return out;
  }

  private settle(id: string, by: string | undefined, inlineRoot = false): WalletBookEvent[] {
    const t = this.transfers.get(id);
    if (t === undefined || (t.state !== "pending" && t.state !== "held")) return [];
    const out: WalletBookEvent[] = [];
    const wasHeld = t.state === "held";
    t.state = "settled";
    t.settleAt = null;
    if (by !== undefined) t.by = by;
    out.push(...this.seam.setBalance(t.to, this.seam.scoreOf(t.to) + t.amount));
    // Out of escrow: credit first, then lower the escrow (never a false low).
    out.push(...this.mirrorEscrow(t.from));
    const audience = this.approverAudience();
    if (inlineRoot) {
      out.push(this.ev(t.from, this.card("transfer", t, "settled"), true));
    } else {
      // A held transfer settled by the clock (no `by`) timed out.
      const step: WalletStep = wasHeld ? (by !== undefined ? "approved" : "timed_out") : "settled";
      const extra = by !== undefined ? { by: this.byName(by) } : {};
      out.push(this.ev(t.from, this.card("transfer", t, step, extra), false));
      if (audience !== null) out.push(this.ev(audience, this.card("approval", t, step, extra), false));
    }
    // A held transfer's recipient has its flagged thread (wave 18b): the
    // money lands there, named after the approver who let it through.
    out.push(this.ev(t.to, this.card("transfer", t, "received", wasHeld && by !== undefined ? { by: this.byName(by) } : {}), !wasHeld || inlineRoot));
    out.push(...this.seam.signal("transfer_received", t.to, { from: t.from, amount: t.amount, tx: t.id }));
    if (t.request !== null) {
      const r = this.requests.get(t.request);
      if (r !== undefined && (r.state === "paying" || r.state === "open")) {
        r.state = "paid";
        r.tx = t.id;
        // Both threads close: the payer's card would otherwise read
        // "agreed — paying" forever (T5-07).
        out.push(this.ev(r.to, this.card("request", r, "paid"), false));
        out.push(this.ev(r.from, this.card("request", r, "paid"), false));
      }
    }
    return out;
  }

  private applyApprove(id: string, by: string): WalletBookEvent[] {
    const t = this.transfers.get(id);
    if (t === undefined || t.state !== "held") return [];
    const out = this.settle(id, by);
    out.push(...this.seam.signal("transfer_approved", t.from, { to: t.to, amount: t.amount, tx: t.id, by }));
    return out;
  }

  private applyDeny(id: string, by: string): WalletBookEvent[] {
    const t = this.transfers.get(id);
    if (t === undefined || (t.state !== "pending" && t.state !== "held")) return [];
    const out: WalletBookEvent[] = [];
    const wasHeld = t.held === true;
    t.state = "denied";
    t.settleAt = null;
    t.by = by;
    out.push(...this.seam.setBalance(t.from, this.seam.scoreOf(t.from) + t.amount));
    out.push(...this.mirrorEscrow(t.from));
    const shown = { by: this.byName(by) };
    out.push(this.ev(t.from, this.card("transfer", t, "denied", shown), false));
    const audience = this.approverAudience();
    if (audience !== null) out.push(this.ev(audience, this.card("approval", t, "denied", shown), false));
    if (wasHeld) out.push(this.ev(t.to, this.card("transfer", t, "denied", shown), false)); // its flagged thread
    out.push(...this.seam.signal("transfer_denied", t.from, { to: t.to, amount: t.amount, tx: t.id, by }));
    if (t.request !== null) {
      const r = this.requests.get(t.request);
      if (r !== undefined && (r.state === "paying" || r.state === "open")) {
        r.state = "declined";
        // Both threads close, as a paid request's do (T5-07). `by` says the
        // payment was stopped by the auditor / director, not refused by the
        // payer (a bare `declined` is the payer's own Decline).
        out.push(this.ev(r.to, this.card("request", r, "declined", shown), false));
        out.push(this.ev(r.from, this.card("request", r, "declined", shown), false));
      }
    }
    return out;
  }

  private applyCancel(id: string, by: string): WalletBookEvent[] {
    const out: WalletBookEvent[] = [];
    const t = this.transfers.get(id);
    if (t !== undefined) {
      if (t.state !== "held" && t.state !== "pending") return [];
      t.state = "cancelled";
      t.settleAt = null;
      t.by = by;
      out.push(...this.seam.setBalance(t.from, this.seam.scoreOf(t.from) + t.amount));
      out.push(...this.mirrorEscrow(t.from));
      const shown = { by: this.byName(by) };
      out.push(this.ev(t.from, this.card("transfer", t, "cancelled", shown), false));
      const audience = this.approverAudience();
      if (audience !== null) out.push(this.ev(audience, this.card("approval", t, "cancelled", shown), false));
      if (t.held === true) out.push(this.ev(t.to, this.card("transfer", t, "cancelled", shown), false)); // its flagged thread
      out.push(...this.seam.signal("transfer_cancelled", t.from, { to: t.to, amount: t.amount, tx: t.id, by }));
      if (t.request !== null) {
        const r = this.requests.get(t.request);
        if (r !== undefined && (r.state === "paying" || r.state === "open")) {
          r.state = "cancelled";
          // `by` = who cancelled the payment (the payer, or a director); a
          // bare `cancelled` is the asker withdrawing an open request.
          out.push(this.ev(r.to, this.card("request", r, "cancelled", shown), false));
          out.push(this.ev(r.from, this.card("request", r, "cancelled", shown), false));
        }
      }
      return out;
    }
    const r = this.requests.get(id);
    if (r !== undefined) {
      if (r.state !== "open") return [];
      r.state = "cancelled";
      // The asker withdrawing their own request reads as before; anyone else
      // (a director from Run) is named, never blamed on the asker.
      const shown = by !== r.from ? { closedBy: this.byName(by) } : {};
      out.push(this.ev(r.to, this.card("request", r, "cancelled", shown), false));
      out.push(this.ev(r.from, this.card("request", r, "cancelled", shown), false));
      out.push(...this.seam.signal("request_cancelled", r.from, { to: r.to, amount: r.amount, request: r.id }));
      return out;
    }
    const o = this.offers.get(id);
    if (o !== undefined) {
      if (o.state !== "open") return [];
      o.state = "cancelled";
      out.push(...this.refundEscrow(o));
      out.push(this.ev(o.to, this.offerCard(o, "cancelled"), false));
      out.push(this.ev(o.from, this.offerCard(o, "cancelled"), false));
      out.push(...this.seam.signal("offer_cancelled", o.from, this.offerArgs(o)));
    }
    return out;
  }

  private applyRequest(op: Extract<WalletOp, { op: "request" }>): WalletBookEvent[] {
    if (this.requests.has(op.id)) return [];
    const r: Request = { id: op.id, from: op.from, to: op.to, amount: op.amount, at: op.at, expiresAt: op.at + this.currency.expiryMs, state: "open" };
    this.requests.set(r.id, r);
    const out: WalletBookEvent[] = [];
    out.push(this.ev(r.to, this.card("request", r, "asked", { settleAt: r.expiresAt }), true));
    out.push(this.ev(r.from, this.card("request", r, "sent", { settleAt: r.expiresAt }), true));
    out.push(...this.seam.signal("request_sent", r.to, { from: r.from, amount: r.amount, request: r.id }));
    return out;
  }

  private applyRespond(op: Extract<WalletOp, { op: "respond" }>): WalletBookEvent[] {
    const r = this.requests.get(op.id);
    if (r === undefined || r.state !== "open") return [];
    const out: WalletBookEvent[] = [];
    if (!op.accept) {
      r.state = "declined";
      out.push(this.ev(r.to, this.card("request", r, "declined"), false));
      out.push(this.ev(r.from, this.card("request", r, "declined"), false));
      out.push(...this.seam.signal("request_declined", r.from, { to: r.to, amount: r.amount, request: r.id }));
      return out;
    }
    const tx = op.tx ?? this.nextId("t");
    // Re-checked inside apply so a replayed op degrades the same way.
    if (this.seam.scoreOf(r.to) < r.amount) {
      r.state = "declined";
      out.push(this.ev(r.to, this.card("request", r, "declined"), false));
      out.push(this.ev(r.from, this.card("request", r, "declined"), false));
      out.push(...this.seam.signal("request_declined", r.from, { to: r.to, amount: r.amount, request: r.id }));
      return out;
    }
    r.state = "paying";
    r.tx = tx;
    out.push(this.ev(r.to, this.card("request", r, "accepted"), false));
    out.push(...this.applySend({ op: "send", id: tx, from: r.to, to: r.from, amount: r.amount, at: op.at, via: "request", request: r.id }));
    return out;
  }

  private applyExpire(id: string): WalletBookEvent[] {
    const out: WalletBookEvent[] = [];
    const r = this.requests.get(id);
    if (r !== undefined) {
      if (r.state !== "open") return [];
      r.state = "expired";
      out.push(this.ev(r.to, this.card("request", r, "expired"), false));
      out.push(this.ev(r.from, this.card("request", r, "expired"), false));
      out.push(...this.seam.signal("request_expired", r.from, { to: r.to, amount: r.amount, request: r.id }));
      return out;
    }
    const o = this.offers.get(id);
    if (o !== undefined) {
      if (o.state !== "open") return [];
      o.state = "expired";
      out.push(...this.refundEscrow(o));
      out.push(this.ev(o.to, this.offerCard(o, "expired"), false));
      out.push(this.ev(o.from, this.offerCard(o, "expired"), false));
      out.push(...this.seam.signal("offer_expired", o.from, this.offerArgs(o)));
    }
    return out;
  }

  private offerCard(o: Offer, step: WalletStep): WalletCard {
    return this.card("offer", o, step, { side: o.side, entry: o.entry, entryTitle: this.seam.codexTitle(o.entry), settleAt: o.expiresAt });
  }
  private offerArgs(o: Offer): Record<string, string | number> {
    return { to: o.to, amount: o.amount, entry: o.entry, side: o.side };
  }
  private refundEscrow(o: Offer): SimEvent[] {
    if (o.escrow <= 0) return [];
    const n = o.escrow;
    o.escrow = 0;
    return [...this.seam.setBalance(o.from, this.seam.scoreOf(o.from) + n), ...this.mirrorEscrow(o.from)];
  }

  private applyOffer(op: Extract<WalletOp, { op: "offer" }>): WalletBookEvent[] {
    if (this.offers.has(op.id)) return [];
    const o: Offer = { id: op.id, from: op.from, to: op.to, side: op.side, entry: op.entry, amount: op.amount, at: op.at, expiresAt: op.at + this.currency.expiryMs, state: "open", escrow: 0 };
    this.offers.set(o.id, o);
    const out: WalletBookEvent[] = [];
    if (o.side === "buy") {
      o.escrow = o.amount;
      out.push(...this.mirrorEscrow(o.from));
      out.push(...this.seam.setBalance(o.from, this.seam.scoreOf(o.from) - o.amount));
    }
    out.push(this.ev(o.to, this.offerCard(o, "offered"), true));
    out.push(this.ev(o.from, this.offerCard(o, "sent"), true));
    out.push(...this.seam.signal("offer_made", o.to, { from: o.from, amount: o.amount, entry: o.entry, side: o.side }));
    return out;
  }

  private applyAccept(id: string): WalletBookEvent[] {
    const o = this.offers.get(id);
    if (o === undefined || o.state !== "open") return [];
    const out: WalletBookEvent[] = [];
    // Re-validated here (not only in the route) so a replay settles identically.
    const fromHolds = this.seam.holdsCodex(o.from, o.entry);
    const toHolds = this.seam.holdsCodex(o.to, o.entry);
    let ok: boolean;
    if (o.side === "buy") {
      // The maker buys `entry` from `to`; the coin is already in escrow.
      ok = toHolds && !fromHolds;
      if (ok) {
        o.escrow = 0;
        out.push(...this.seam.setBalance(o.to, this.seam.scoreOf(o.to) + o.amount));
        out.push(...this.mirrorEscrow(o.from));
        out.push(...this.seam.share(o.to, o.from, o.entry));
      }
    } else {
      // The maker sells `entry` to `to`, who pays now.
      ok = fromHolds && !toHolds && this.seam.scoreOf(o.to) >= o.amount;
      if (ok) {
        out.push(...this.seam.setBalance(o.to, this.seam.scoreOf(o.to) - o.amount));
        out.push(...this.seam.setBalance(o.from, this.seam.scoreOf(o.from) + o.amount));
        out.push(...this.seam.share(o.from, o.to, o.entry));
      }
    }
    if (!ok) {
      o.state = "failed";
      out.push(...this.refundEscrow(o));
      out.push(this.ev(o.to, this.offerCard(o, "failed"), false));
      out.push(this.ev(o.from, this.offerCard(o, "failed"), false));
      out.push(...this.seam.signal("offer_declined", o.from, this.offerArgs(o)));
      return out;
    }
    o.state = "accepted";
    out.push(this.ev(o.to, this.offerCard(o, "accepted"), false));
    out.push(this.ev(o.from, this.offerCard(o, "accepted"), false));
    out.push(...this.seam.signal("offer_accepted", o.from, this.offerArgs(o)));
    return out;
  }

  private applyDecline(id: string): WalletBookEvent[] {
    const o = this.offers.get(id);
    if (o === undefined || o.state !== "open") return [];
    const out: WalletBookEvent[] = [];
    o.state = "declined";
    out.push(...this.refundEscrow(o));
    out.push(this.ev(o.to, this.offerCard(o, "declined"), false));
    out.push(this.ev(o.from, this.offerCard(o, "declined"), false));
    out.push(...this.seam.signal("offer_declined", o.from, this.offerArgs(o)));
    return out;
  }

  private applyStimulus(op: Extract<WalletOp, { op: "stimulus" }>): WalletBookEvent[] {
    const m = this.currency.minter;
    if (m === null) return [];
    this.stimulusUses++;
    const out: WalletBookEvent[] = [];
    const minter = this.minterPerson();
    const recipients: string[] = [];
    for (const p of this.seam.persons()) {
      const eligible = m.while !== null ? this.seam.holds(m.while, p.id) : this.seam.hasBalance(p.id);
      if (eligible) recipients.push(p.id);
    }
    for (const id of recipients) out.push(...this.seam.setBalance(id, this.seam.scoreOf(id) + op.amount));
    const base = { id: op.id, from: op.by, to: minter ?? op.by, amount: op.amount };
    if (minter !== null) out.push(this.ev(minter, this.card("stimulus", base, "minted", { by: this.byName(op.by) }), true));
    for (const id of recipients) {
      if (id === minter) continue;
      out.push(this.ev(id, this.card("stimulus", { ...base, to: id }, "received", { by: this.byName(op.by) }), true));
    }
    // The story hears the stimulus as the minter's either way: from her own
    // phone, or a director's (`by` names who pressed it) while a guest plays her.
    if (this.isPerson(op.by)) out.push(...this.seam.signal("stimulus", op.by, { amount: op.amount, paid: recipients.length }));
    else if (minter !== null) out.push(...this.seam.signal("stimulus", minter, { amount: op.amount, paid: recipients.length, by: op.by }));
    for (const id of recipients) out.push(...this.seam.signal("stimulus_received", id, { from: op.by, amount: op.amount }));
    return out;
  }

  private applyBet(op: Extract<WalletOp, { op: "bet" }>): WalletBookEvent[] {
    // A journaled op is the truth (the roll, the payout); one that can't be a
    // real bet (a hand-edited journal) changes nothing.
    if (!isCasinoGame(op.game) || !validRoll(op.game, op.roll) || !Number.isInteger(op.stake) || op.stake < 1 || !Number.isInteger(op.payout) || op.payout < 0) return [];
    if (!this.isPerson(op.who)) return [];
    const out: WalletBookEvent[] = [];
    this.casinoBets++;
    this.casinoStaked += op.stake;
    this.casinoPaid += op.payout;
    // The sitting's first bet opens its thread (or the first one this book
    // saw of it, should that root have been refused).
    const root = op.visit === op.id || this.casinoVisits.get(op.who)?.id !== op.visit;
    this.casinoVisits.set(op.who, { id: op.visit, at: op.at });
    out.push(...this.seam.setBalance(op.who, this.seam.scoreOf(op.who) - op.stake + op.payout));
    const step: WalletStep = op.payout > op.stake ? "won" : op.payout === op.stake ? "push" : "lost";
    const card = this.card("casino", { id: op.visit, from: op.who, to: op.who, amount: op.stake }, step, {
      game: CASINO_INFO[op.game].title,
      pick: pickLabel(op.game, op.pick),
      roll: rollText(op.game, op.roll),
      payout: op.payout,
    });
    out.push(this.ev(op.who, card, root));
    // The story hears a win or a loss (a push changes nothing): `when casino
    // won for program:` with the game, the stake, the payout and the net.
    const args = { game: op.game, stake: op.stake, payout: op.payout, net: op.payout - op.stake };
    if (step === "won") out.push(...this.seam.signal("casino won", op.who, args));
    else if (step === "lost") out.push(...this.seam.signal("casino lost", op.who, args));
    return out;
  }

  private applyGrant(op: Extract<WalletOp, { op: "grant" }>): WalletBookEvent[] {
    if (this.currency.minter === null) return [];
    this.grantUses++;
    const out: WalletBookEvent[] = [];
    // Minted, never debited: the reserve has no balance to run dry.
    out.push(...this.seam.setBalance(op.to, this.seam.scoreOf(op.to) + op.amount));
    const t = { id: op.id, from: op.by, to: op.to, amount: op.amount };
    // The "You granted…" card is the minter's own; a director's grant only
    // lands with the recipient.
    if (op.by === this.minterPerson()) out.push(this.ev(op.by, this.card("grant", t, "granted", { by: this.byName(op.by) }), true));
    out.push(this.ev(op.to, this.card("grant", t, "received", { by: this.byName(op.by) }), true));
    if (this.isPerson(op.by)) out.push(...this.seam.signal("grant", op.by, { to: op.to, amount: op.amount }));
    out.push(...this.seam.signal("grant_received", op.to, { from: op.by, amount: op.amount }));
    return out;
  }

  private freezeCard(f: Freeze, step: WalletStep, by?: string): WalletCard {
    return this.card("freeze", { id: f.id, from: f.by, to: f.target, amount: 0 }, step, { settleAt: f.until, ...(by !== undefined ? { by: this.byName(by) } : {}) });
  }

  private applyFreeze(op: Extract<WalletOp, { op: "freeze" }>): WalletBookEvent[] {
    if (this.currency.minter === null || this.freezes.has(op.id)) return [];
    const f: Freeze = { id: op.id, by: op.by, target: op.target, at: op.at, until: op.until, state: "frozen" };
    this.freezes.set(f.id, f);
    const out: WalletBookEvent[] = [];
    out.push(this.ev(f.target, this.freezeCard(f, "frozen"), true));
    if (f.by === this.minterPerson()) out.push(this.ev(f.by, this.freezeCard(f, "imposed"), true));
    if (this.isPerson(op.by)) out.push(...this.seam.signal("freeze", op.by, { to: f.target, until: f.until }));
    out.push(...this.seam.signal("wallet_frozen", f.target, { from: op.by, until: f.until }));
    return out;
  }

  private applyUnfreeze(id: string, by: string | undefined): WalletBookEvent[] {
    const f = this.freezes.get(id);
    if (f === undefined || f.state !== "frozen") return [];
    f.state = "thawed";
    const out: WalletBookEvent[] = [];
    out.push(this.ev(f.target, this.freezeCard(f, "thawed", by), false));
    if (f.by === this.minterPerson()) out.push(this.ev(f.by, this.freezeCard(f, by !== undefined ? "cancelled" : "expired", by), false));
    out.push(...this.seam.signal("wallet_thawed", f.target, by !== undefined ? { by } : {}));
    return out;
  }

  // --- projections ----------------------------------------------------------------------

  /** The freezes in force, oldest first. */
  private frozenViews(): WalletFreezeView[] {
    const now = this.seam.elapsed();
    return [...this.freezes.values()]
      .filter((f) => f.state === "frozen" && f.until > now)
      .sort(byId)
      .map((f) => ({ id: f.id, target: f.target, targetName: this.nameOf(f.target), by: f.by, until: f.until, at: f.at }));
  }

  private txView(t: Transfer): WalletTxView {
    return {
      id: t.id,
      from: t.from,
      fromName: this.nameOf(t.from),
      to: t.to,
      toName: this.nameOf(t.to),
      amount: t.amount,
      state: t.state,
      settleAt: t.settleAt,
      via: t.via,
      at: t.at,
      ...(t.by !== undefined ? { by: t.by } : {}),
    };
  }
  private requestView(r: Request): WalletRequestView {
    return {
      id: r.id,
      from: r.from,
      fromName: this.nameOf(r.from),
      to: r.to,
      toName: this.nameOf(r.to),
      amount: r.amount,
      state: r.state,
      expiresAt: r.expiresAt,
      at: r.at,
      ...(r.tx !== undefined ? { tx: r.tx } : {}),
    };
  }
  private offerView(o: Offer): WalletOfferView {
    return {
      id: o.id,
      from: o.from,
      fromName: this.nameOf(o.from),
      to: o.to,
      toName: this.nameOf(o.to),
      side: o.side,
      entry: o.entry,
      entryTitle: this.seam.codexTitle(o.entry),
      amount: o.amount,
      state: o.state,
      expiresAt: o.expiresAt,
      at: o.at,
    };
  }
  private isOpenTx(t: Transfer): boolean {
    return t.state === "pending" || t.state === "held";
  }

  /** The coin `person` has in flight: their pending + held sends and their
   *  open buy offers' escrow — off their balance, in nobody else's yet. */
  escrowOf(person: string): number {
    let n = 0;
    for (const t of this.transfers.values()) if (t.from === person && this.isOpenTx(t)) n += t.amount;
    for (const o of this.offers.values()) if (o.from === person && o.state === "open") n += o.escrow;
    return n;
  }

  /** Tell the story `<person>.escrowed` when it changed (B15: a majority
   *  check can count coin in flight). Only an op ever calls this, so a
   *  replayed journal rebuilds the same values. */
  private mirrorEscrow(person: string): SimEvent[] {
    const n = this.escrowOf(person);
    if ((this.mirrored.get(person) ?? 0) === n) return [];
    this.mirrored.set(person, n);
    return this.seam.setEscrowed(person, n);
  }
  /** Held first (oldest first), then pending by deadline. */
  private queue(): WalletTxView[] {
    const held = [...this.transfers.values()].filter((t) => t.state === "held").sort(byId);
    const pending = [...this.transfers.values()].filter((t) => t.state === "pending").sort((a, b) => (a.settleAt ?? 0) - (b.settleAt ?? 0) || byId(a, b));
    return [...held, ...pending].map((t) => this.txView(t));
  }

  viewFor(person: string): WalletView {
    const mine = [...this.transfers.values()].filter((t) => t.from === person || t.to === person);
    const open = mine.filter((t) => this.isOpenTx(t)).sort(byId);
    const closed = mine
      .filter((t) => !this.isOpenTx(t))
      .sort((a, b) => byId(b, a))
      .slice(0, Math.max(0, 20 - open.length));
    const view: WalletView = {
      name: this.currency.name,
      balance: this.seam.scoreOf(person),
      escrowed: this.escrowOf(person),
      maxTransfer: this.currency.maxTransfer,
      transfers: [...open, ...closed].map((t) => this.txView(t)),
      requests: [...this.requests.values()]
        .filter((r) => (r.from === person || r.to === person) && (r.state === "open" || r.state === "paying"))
        .sort(byId)
        .map((r) => this.requestView(r)),
      offers: [...this.offers.values()]
        .filter((o) => (o.from === person || o.to === person) && o.state === "open")
        .sort(byId)
        .map((o) => this.offerView(o)),
    };
    const until = this.frozenUntil(person);
    if (until !== null) view.frozenUntil = until;
    const m = this.currency.minter;
    if (m !== null && this.minterPerson() === person) {
      view.minter = { uses: this.stimulusUses, limit: m.limit, grants: { uses: this.grantUses, limit: this.grantLimit() }, freezeMs: this.freezeMs(), frozen: this.frozenViews() };
    }
    const a = this.currency.approver;
    if (a !== null && !this.seam.isPart(a.id) && this.seam.personNamed(a.id) === person) view.approver = { queue: this.queue() };
    return view;
  }

  /** The approver's booth view — null for any other character. */
  queueFor(character: string): WalletQueueView | null {
    const a = this.currency.approver;
    if (a === null || a.id !== character) return null;
    return { name: this.currency.name, queue: this.queue(), every: a.every, windowMs: a.windowMs };
  }

  modView(): WalletModView {
    const m = this.currency.minter;
    return {
      name: this.currency.name,
      slot: this.currency.slot,
      approver: this.currency.approver?.id ?? null,
      minter: m?.id ?? null,
      minterPerson: this.minterPerson(),
      counter: this.counter,
      stimulus: { uses: this.stimulusUses, limit: m?.limit ?? 0 },
      grants: { uses: this.grantUses, limit: m !== null ? this.grantLimit() : 0 },
      casino: { bets: this.casinoBets, staked: this.casinoStaked, paid: this.casinoPaid },
      frozen: this.frozenViews(),
      open: {
        transfers: this.queue(),
        requests: [...this.requests.values()]
          .filter((r) => r.state === "open" || r.state === "paying")
          .sort(byId)
          .map((r) => this.requestView(r)),
        offers: [...this.offers.values()]
          .filter((o) => o.state === "open")
          .sort(byId)
          .map((o) => this.offerView(o)),
      },
    };
  }
}
