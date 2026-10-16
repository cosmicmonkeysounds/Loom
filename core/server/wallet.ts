//! The wallet book — the story's currency in flight.
//!
//! A story opts in with one header line (`currency: score as Truthcoin`);
//! the balance stays the engine's per-person slot (`<id>.score`), so every
//! `set program.score`, `scoreOf`, roster column and recap keeps working.
//! What this module owns is the *in-flight* state the engine has no word
//! for: pending transfers inside their deny window, the approver's held
//! queue (every Nth transfer), open requests, escrowed codex offers, and
//! the minter's stimulus count.
//!
//! Every state change is one `WalletOp`, applied by `WalletBook.apply`, which
//! is the **only** mutation. It reads nothing but the op and the seam (the
//! slice of the `Sim` it touches, unjournaled calls: balances, codex grants,
//! story signals), so the runtime journals the op as a single `wallet` line
//! and a restart replaying the same ops lands on identical balances, cards
//! and story reactions. The timers (the settle window, request / offer
//! expiry) run on the story clock: the ticker asks `due(now)` and commits
//! each `settle` / `expire` as its own journal line, so replay never depends
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
  | { op: "stimulus"; id: string; by: string; amount: number; at: number };

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
  return {
    elapsed: () => sim.elapsed(),
    scoreOf: (id) => (slot === "score" ? sim.scoreOf(id) : (asNumber(sim.world.get(key(id))) ?? 0)),
    hasBalance: (id) => sim.world.peek(key(id)) !== null,
    setBalance: (id, n) => (slot === "score" ? sim.setScore(id, n) : sim.setVar(key(id), String(n))),
    share: (from, to, entry) => sim.share(from, to, entry),
    signal: (name, subject, args) => sim.signal(name, subject, args),
    persons: () => [...sim.persons.values()].map((p) => ({ id: p.id, name: p.name })),
    nameOf: (id) => sim.persons.get(id)?.name ?? id,
    holdsCodex: (id, entry) => sim.holdsCodex(id, entry),
    codexIdOf: (entry) => {
      const t = entry.trim();
      if (sim.model.codex.has(t)) return t;
      return sim.model.codexIndex.get(t);
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
  /** When the viewer is the minter's program. */
  minter?: { uses: number; limit: number };
  /** When the viewer IS the approver (the approver declared as a guest program). */
  approver?: { queue: WalletTxView[] };
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
  open: { transfers: WalletTxView[]; requests: WalletRequestView[]; offers: WalletOfferView[] };
}

/** A route refusal: HTTP status + the message the phone shows. */
export interface WalletRefusal {
  status: 400 | 403 | 404 | 409;
  error: string;
}

const MAX_OPEN_OUTGOING = 5;

function idNumber(id: string): number {
  const m = /(\d+)$/u.exec(id);
  return m === null ? 0 : Number(m[1]);
}
function byId<T extends { id: string }>(a: T, b: T): number {
  return idNumber(a.id) - idNumber(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The plain one-line summary of a card — the sidebar preview, the thread
 *  text, an old client's fallback. Perspective is the card's `kind` + `step`;
 *  `now` (story ms, the compose-time clock) turns `settleAt` into "60 s". */
export function walletLine(c: WalletCard, now?: number): string {
  const amt = `${c.amount} ${c.unit}`;
  const audit = c.approver ?? "the auditor";
  const windowText = (): string =>
    c.settleAt !== undefined && now !== undefined ? `${Math.max(0, Math.ceil((c.settleAt - now) / 1000))} s` : "a moment";
  switch (c.kind) {
    case "transfer":
      switch (c.step) {
        case "pending":
          return `💸 You sent ${amt} to ${c.toName} — settles in ${windowText()} unless ${audit} denies it.`;
        case "held":
          return `⏳ ${amt} to ${c.toName} is waiting for ${audit} to approve.`;
        case "settled":
          return `✅ ${amt} to ${c.toName} settled.`;
        case "received":
          return `💰 ${c.fromName} sent you ${amt}.`;
        case "approved":
          return `✅ Approved by ${c.by ?? audit}: ${amt} to ${c.toName}.`;
        case "denied":
          return `⛔ Denied by ${c.by ?? audit}: ${amt} to ${c.toName}. Refunded.`;
        case "cancelled":
          return `↩️ Cancelled: ${amt} to ${c.toName}. Refunded.`;
        default:
          return `💸 ${amt} to ${c.toName}.`;
      }
    case "approval":
      switch (c.step) {
        case "pending":
          return `🧾 ${c.fromName} → ${c.toName}: ${amt}. Settles in ${windowText()} unless you deny it.`;
        case "held":
          return `🧾 ${c.fromName} → ${c.toName}: ${amt}. Waiting for your approval.`;
        case "settled":
          return `✅ Settled: ${c.fromName} → ${c.toName}, ${amt}.`;
        case "approved":
          return `✅ Approved${c.by ? ` by ${c.by}` : ""}: ${c.fromName} → ${c.toName}, ${amt}.`;
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
          return `✅ ${c.toName} paid you ${amt}.`;
        case "declined":
          return `⛔ Declined: ${amt} from ${c.toName}.`;
        case "expired":
          return `⌛ Expired: ${c.fromName}'s request for ${amt}.`;
        case "cancelled":
          return `↩️ ${c.fromName} withdrew the request for ${amt}.`;
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
  private seq = 0;

  readonly currency: CurrencyDef;
  private readonly seam: WalletSeam;

  constructor(currency: CurrencyDef, seam: WalletSeam) {
    this.currency = currency;
    this.seam = seam;
  }

  // --- ids -------------------------------------------------------------------

  /** Mint the next id for a route (`t12`); `apply` raises `seq` past any id
   *  it sees, so a replay re-mints nothing twice. */
  nextId(prefix: "t" | "r" | "o" | "s"): string {
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

  checkSend(from: string, to: string, amount: number): WalletRefusal | null {
    const bad = this.checkAmount(amount);
    if (bad !== null) return bad;
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
    const id = this.seam.codexIdOf(entry);
    if (id === null) return { status: 404, error: "no such entry" };
    if (side === "sell" && !this.seam.holdsCodex(from, id)) return { status: 404, error: "you don't hold that entry" };
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

  checkAccept(id: string, who: string): WalletRefusal | null {
    return this.checkOfferSide(id, who);
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

  // --- the ticker ---------------------------------------------------------------------

  /** Everything the story clock has made due, in id order. */
  due(now: number): WalletOp[] {
    const out: WalletOp[] = [];
    for (const t of [...this.transfers.values()].sort(byId)) {
      if (t.state === "pending" && t.settleAt !== null && t.settleAt <= now) out.push({ op: "settle", id: t.id });
    }
    const expiring: Array<{ id: string }> = [];
    for (const r of this.requests.values()) if (r.state === "open" && r.expiresAt <= now) expiring.push(r);
    for (const o of this.offers.values()) if (o.state === "open" && o.expiresAt <= now) expiring.push(o);
    for (const e of expiring.sort(byId)) out.push({ op: "expire", id: e.id });
    return out;
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
  private approverName(): string | undefined {
    const a = this.currency.approver;
    return a === null ? undefined : a.id.replace(/_/gu, " ");
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
    out.push(...this.seam.setBalance(t.from, this.seam.scoreOf(t.from) - t.amount));
    const approver = this.currency.approver;
    const audience = this.approverAudience();
    const args = { to: t.to, amount: t.amount, tx: t.id };
    if (approver !== null && audience !== null && this.counter % approver.every === 0) {
      t.state = "held";
      out.push(this.ev(t.from, this.card("transfer", t, "held", { approver: this.approverName() }), true));
      out.push(this.ev(audience, this.card("approval", t, "held", { approver: this.approverName() }), true));
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
    const audience = this.approverAudience();
    if (inlineRoot) {
      out.push(this.ev(t.from, this.card("transfer", t, "settled"), true));
    } else {
      out.push(this.ev(t.from, this.card("transfer", t, wasHeld && by !== undefined ? "approved" : "settled", by !== undefined ? { by } : {}), false));
      if (audience !== null) out.push(this.ev(audience, this.card("approval", t, wasHeld && by !== undefined ? "approved" : "settled", by !== undefined ? { by } : {}), false));
    }
    out.push(this.ev(t.to, this.card("transfer", t, "received"), true));
    out.push(...this.seam.signal("transfer_received", t.to, { from: t.from, amount: t.amount, tx: t.id }));
    if (t.request !== null) {
      const r = this.requests.get(t.request);
      if (r !== undefined && (r.state === "paying" || r.state === "open")) {
        r.state = "paid";
        r.tx = t.id;
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
    t.state = "denied";
    t.settleAt = null;
    t.by = by;
    out.push(...this.seam.setBalance(t.from, this.seam.scoreOf(t.from) + t.amount));
    out.push(this.ev(t.from, this.card("transfer", t, "denied", { by }), false));
    const audience = this.approverAudience();
    if (audience !== null) out.push(this.ev(audience, this.card("approval", t, "denied", { by }), false));
    out.push(...this.seam.signal("transfer_denied", t.from, { to: t.to, amount: t.amount, tx: t.id, by }));
    if (t.request !== null) {
      const r = this.requests.get(t.request);
      if (r !== undefined && (r.state === "paying" || r.state === "open")) {
        r.state = "declined";
        out.push(this.ev(r.from, this.card("request", r, "declined"), false));
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
      out.push(this.ev(t.from, this.card("transfer", t, "cancelled", { by }), false));
      const audience = this.approverAudience();
      if (audience !== null) out.push(this.ev(audience, this.card("approval", t, "cancelled", { by }), false));
      out.push(...this.seam.signal("transfer_cancelled", t.from, { to: t.to, amount: t.amount, tx: t.id, by }));
      if (t.request !== null) {
        const r = this.requests.get(t.request);
        if (r !== undefined && (r.state === "paying" || r.state === "open")) {
          r.state = "cancelled";
          out.push(this.ev(r.from, this.card("request", r, "cancelled"), false));
        }
      }
      return out;
    }
    const r = this.requests.get(id);
    if (r !== undefined) {
      if (r.state !== "open") return [];
      r.state = "cancelled";
      out.push(this.ev(r.to, this.card("request", r, "cancelled"), false));
      out.push(this.ev(r.from, this.card("request", r, "cancelled"), false));
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
    return this.seam.setBalance(o.from, this.seam.scoreOf(o.from) + n);
  }

  private applyOffer(op: Extract<WalletOp, { op: "offer" }>): WalletBookEvent[] {
    if (this.offers.has(op.id)) return [];
    const o: Offer = { id: op.id, from: op.from, to: op.to, side: op.side, entry: op.entry, amount: op.amount, at: op.at, expiresAt: op.at + this.currency.expiryMs, state: "open", escrow: 0 };
    this.offers.set(o.id, o);
    const out: WalletBookEvent[] = [];
    if (o.side === "buy") {
      o.escrow = o.amount;
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
    if (minter !== null) out.push(this.ev(minter, this.card("stimulus", base, "minted", { by: op.by }), true));
    for (const id of recipients) {
      if (id === minter) continue;
      out.push(this.ev(id, this.card("stimulus", { ...base, to: id }, "received", { by: op.by }), true));
    }
    if (this.isPerson(op.by)) out.push(...this.seam.signal("stimulus", op.by, { amount: op.amount, paid: recipients.length }));
    for (const id of recipients) out.push(...this.seam.signal("stimulus_received", id, { from: op.by, amount: op.amount }));
    return out;
  }

  // --- projections ----------------------------------------------------------------------

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
    let escrowed = 0;
    for (const t of open) if (t.from === person) escrowed += t.amount;
    for (const o of this.offers.values()) if (o.from === person && o.state === "open") escrowed += o.escrow;
    const view: WalletView = {
      name: this.currency.name,
      balance: this.seam.scoreOf(person),
      escrowed,
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
    const m = this.currency.minter;
    if (m !== null && this.minterPerson() === person) view.minter = { uses: this.stimulusUses, limit: m.limit };
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
