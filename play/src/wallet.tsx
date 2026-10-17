//! The 💰 wallet — a guest's balance in the story's currency, and the cards
//! that move it: send / request / trade a fact (an escrowed codex offer),
//! the approver's Approve / Deny, the minter's stimulus + reserve (🎁 grant one
//! program coin, 🧊 freeze one program's coin for ten minutes). The server's wallet
//! book settles everything; this file renders its cards (in the pinned
//! Wallet room) and posts to its routes through a `WalletActions` context,
//! so the same card works in a guest's phone and in the approver's booth.
//!
//! Pure helpers first (unit-tested with no DOM), then the components.
//! Nothing here knows the currency's name or who the approver is: the view
//! carries the unit, the card carries the people.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ActionRow, PersonAvatar, PickerSheet, Sheet, type PickItem } from "./chat.tsx";
import type { Action, ChatMessage, WalletCard, WalletQueueView, WalletTxView, WalletView } from "./types.ts";

// --- pure helpers ---------------------------------------------------------------

/** The Wallet room's subtitle: `🪙 120 Truthcoin · 2 pending`. With `me`,
 *  only the viewer's own sends count: an incoming transfer has no card in
 *  the room until it settles (its deny window is not the recipient's to
 *  see), so counting it read "1 pending" over an empty room (B7). */
export function walletSummary(w: WalletView, me?: string | null): string {
  const base = `🪙 ${w.balance} ${w.name}`;
  const held = w.approver?.queue.filter((t) => t.state === "held").length ?? 0;
  if (held > 0) return `${base} · ${held} to approve`;
  const sends = w.transfers.filter((t) => (t.state === "pending" || t.state === "held") && (me == null || t.from === me)).length;
  const open = sends + w.requests.length + w.offers.length;
  return open > 0 ? `${base} · ${open} pending` : base;
}

/** The booth Wallet room's subtitle: `2 awaiting approval`. */
export function queueSummary(q: WalletQueueView): string {
  const held = q.queue.filter((t) => t.state === "held").length;
  const pending = q.queue.length - held;
  if (held === 0 && pending === 0) return "nothing to approve";
  const parts: string[] = [];
  if (held > 0) parts.push(`${held} awaiting approval`);
  if (pending > 0) parts.push(`${pending} settling`);
  return parts.join(" · ");
}

/** Is a card in here waiting on the viewer — a request / offer asked of me,
 *  or (when I am the approver) a held transfer? */
export function walletNeedsYou(w: WalletView, me: string): boolean {
  if (w.requests.some((r) => r.to === me && r.state === "open")) return true;
  if (w.offers.some((o) => o.to === me && o.state === "open")) return true;
  return w.approver?.queue.some((t) => t.state === "held") ?? false;
}

/** A typed amount: a whole number from 1 to `max`, else null. */
export function parseAmount(text: string, max: number): number | null {
  const t = text.trim();
  if (!/^\d+$/u.test(t)) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

/** Seconds until a story-clock deadline (never negative). */
export function secondsLeft(settleAt: number | null | undefined, clock: number): number {
  if (settleAt === null || settleAt === undefined) return 0;
  return Math.max(0, Math.ceil((settleAt - clock) / 1000));
}

/** The story clock now on the phone: the last snapshot's reading plus the
 *  wall time since it arrived. The server pushes a view only when
 *  something happens, so a countdown read off the raw snapshot clock
 *  stands still in a quiet stretch. (A guest isn't told about a pause; the
 *  next snapshot re-bases the clock.) */
export function liveClock(clock: number, arrivedAt: number, wallNow: number): number {
  return clock + Math.max(0, wallNow - arrivedAt);
}

/** Is a wallet deadline running — a freeze, a pending / held transfer, an
 *  open request or offer, or (the approver's booth) a held send in the
 *  queue — so its countdowns need to tick? */
export function walletTicking(view: WalletView | WalletQueueView | null | undefined): boolean {
  if (view === null || view === undefined) return false;
  if ("queue" in view) return view.queue.length > 0;
  if (view.frozenUntil !== undefined || (view.minter?.frozen?.length ?? 0) > 0) return true;
  if ((view.approver?.queue.length ?? 0) > 0 || view.requests.length > 0 || view.offers.length > 0) return true;
  return view.transfers.some((t) => t.state === "pending" || t.state === "held");
}

/** The phone's (or the approver booth's) ticking story clock: `liveClock`
 *  off the snapshot, re-read once a second while `walletTicking(view)`,
 *  else the snapshot's own. */
export function useWalletClock(clock: number | undefined, view: WalletView | WalletQueueView | null | undefined): number {
  const base = clock ?? 0;
  // The wall time this snapshot clock arrived (a new reading re-bases it).
  const arrived = useRef({ clock: base, at: Date.now() });
  if (arrived.current.clock !== base) arrived.current = { clock: base, at: Date.now() };
  const ticking = walletTicking(view);
  const [wall, setWall] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setWall(Date.now());
    const t = setInterval(() => setWall(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  return ticking ? liveClock(base, arrived.current.at, wall) : base;
}

/** `4:05` — a held transfer's auto-approve countdown. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A held transfer's auto-approve deadline: the live view's `settleAt`
 *  (the book sets it when it holds a send), else the card's own. */
export function heldDeadline(view: WalletView | WalletQueueView | null, card: WalletCard): number | null {
  const list = view === null ? [] : "queue" in view ? view.queue : [...view.transfers, ...(view.approver?.queue ?? [])];
  const t = list.find((x) => x.id === card.id);
  return t?.settleAt ?? card.settleAt ?? null;
}

/** The viewer's freeze as the story ms it thaws at — null while their coin
 *  moves (no freeze, or one past its deadline before the sweep lands). */
export function frozenUntil(view: WalletView | WalletQueueView | null, clock?: number): number | null {
  if (view === null || "queue" in view || view.frozenUntil === undefined) return null;
  return clock === undefined || view.frozenUntil > clock ? view.frozenUntil : null;
}

/** The Wallet room's note while the viewer is frozen, else null. */
export function frozenNote(view: WalletView, clock?: number): string | null {
  const until = frozenUntil(view, clock);
  if (until === null) return null;
  const left = clock === undefined ? 0 : secondsLeft(until, clock);
  return `🧊 Your ${view.name} is frozen${left > 0 ? ` — it thaws in ${mmss(left)}` : ""}. You can't send, pay or buy, but coin still comes in.`;
}

const STEP_GLYPH: Record<string, string> = {
  sent: "💸",
  pending: "⏳",
  held: "⏳",
  settled: "✅",
  received: "💰",
  approved: "✅",
  denied: "⛔",
  cancelled: "↩️",
  asked: "🙏",
  paid: "✅",
  declined: "⛔",
  expired: "⌛",
  offered: "💱",
  accepted: "✅",
  failed: "⛔",
  minted: "💰",
  timed_out: "✅",
  granted: "🎁",
  frozen: "🧊",
  imposed: "🧊",
  thawed: "☀️",
};

/** The glyph for a card's step — or, on an in-flight root card (⏳) given
 *  its live `state`, for that state: a settled send shows ✅, a denied one
 *  ⛔ (B7). Thread steps pass no state and keep their own glyph. */
export function walletGlyph(card: WalletCard, state?: string | null): string {
  if (card.kind === "grant") return "🎁";
  if (card.kind === "freeze" && card.step === "expired") return "☀️";
  if ((card.step === "pending" || card.step === "held") && state != null && STEP_GLYPH[state] !== undefined) return STEP_GLYPH[state]!;
  return STEP_GLYPH[card.step] ?? "💰";
}

/** The short per-step line a thread reply shows under its card. `me` is the
 *  viewer: a request's `paid` step reaches both parties (C3), and the payer
 *  reads it as their own payment. */
export function walletStepLine(card: WalletCard, me?: string | null): string {
  const amt = `${card.amount} ${card.unit}`;
  const by = card.by ? ` by ${card.by.replace(/_/gu, " ")}` : "";
  switch (card.step) {
    case "settled":
      return card.kind === "approval" ? `✅ Settled: ${card.fromName} → ${card.toName}, ${amt}` : `✅ Settled — ${amt} is ${card.toName}'s`;
    case "approved":
      return `✅ Approved${by}`;
    case "timed_out":
      return "✅ Approved automatically — nobody audited it in time";
    case "denied":
      return `⛔ Denied${by} — refunded`;
    case "cancelled":
      return card.kind === "freeze" ? `↩️ Lifted early${by}` : `↩️ Cancelled${by}`;
    case "thawed":
      return card.by ? `☀️ Lifted early${by} — your ${card.unit} moves again` : `☀️ Thawed — your ${card.unit} moves again`;
    case "paid":
      return card.kind === "request" && me != null && me === card.to ? `✅ Paid — you sent ${amt}` : `✅ Paid — ${card.toName} sent ${amt}`;
    case "accepted":
      return card.kind === "request" ? `💸 Agreed — paying ${amt}` : `✅ Done — the fact changed hands for ${amt}`;
    case "declined":
      return "⛔ Declined";
    case "failed":
      return "⛔ Could not settle — refunded";
    case "expired":
      return card.kind === "freeze" ? `☀️ The freeze on ${card.toName} is over` : "⌛ Expired";
    case "received":
      return card.kind === "grant" ? `🎁 ${card.fromName} granted you ${amt}` : `💰 Received ${amt} from ${card.fromName}`;
    default:
      return `${walletGlyph(card)} ${amt}`;
  }
}

/** The headline on a root card. */
export function walletCardTitle(card: WalletCard): string {
  const amt = `${card.amount} ${card.unit}`;
  const title = card.entryTitle ?? card.entry ?? "a fact";
  switch (card.kind) {
    case "transfer":
      return card.step === "received" ? `${card.fromName} sent you ${amt}` : `You sent ${card.toName} ${amt}`;
    case "approval":
      return `${card.fromName} → ${card.toName}: ${amt}`;
    case "request":
      return card.step === "asked" ? `${card.fromName} asks you for ${amt}` : `You asked ${card.toName} for ${amt}`;
    case "offer": {
      const deal = card.side === "buy" ? `${amt} for “${title}”` : `“${title}” for ${amt}`;
      return card.step === "offered" ? `${card.fromName} offers you ${deal}` : `You offered ${card.toName} ${deal}`;
    }
    case "stimulus":
      return card.step === "minted" ? `You paid every program ${amt}` : `Stimulus from ${card.fromName}: ${amt}`;
    case "grant":
      return card.step === "granted" ? `You granted ${card.toName} ${amt}` : `${card.fromName} granted you ${amt}`;
    case "freeze":
      return card.step === "imposed" ? `You froze ${card.toName}'s ${card.unit}` : `${card.fromName} froze your ${card.unit}`;
    default:
      return amt;
  }
}

/** A root card's live state, read from the view by id — null once it has
 *  closed (the last step in its thread says how). */
export function walletItemState(view: WalletView | WalletQueueView | null, card: WalletCard): string | null {
  if (view === null) return null;
  if ("queue" in view) return view.queue.find((t) => t.id === card.id)?.state ?? null;
  if (card.kind === "transfer" || card.kind === "approval") {
    return view.transfers.find((t) => t.id === card.id)?.state ?? view.approver?.queue.find((t) => t.id === card.id)?.state ?? null;
  }
  if (card.kind === "request") return view.requests.find((r) => r.id === card.id)?.state ?? null;
  if (card.kind === "offer") return view.offers.find((o) => o.id === card.id)?.state ?? null;
  if (card.kind === "freeze") {
    // The target's card is live while their freeze is this one; the
    // minter's while it is in her list of freezes in force.
    if (card.step === "frozen") return view.frozenUntil !== undefined && view.frozenUntil === card.settleAt ? "frozen" : null;
    return view.minter?.frozen?.some((f) => f.id === card.id) ? "frozen" : null;
  }
  return null;
}

/** A root card's foot line: "closed", a held transfer's "auto-approves in
 *  4:05", a pending one's "settles in 60 s", an open request / offer's
 *  "expires in 600 s", else the live state. */
export function walletStateLine(card: WalletCard, state: string | null, view: WalletView | WalletQueueView | null, clock: number): string {
  if (card.kind === "grant") return "from the reserve";
  if (card.kind === "freeze") {
    if (state !== "frozen") return "thawed";
    const left = secondsLeft(card.settleAt, clock);
    return left > 0 ? `thaws in ${mmss(left)}` : "thawing";
  }
  if (state === null) return "closed";
  // A bare state word reads lowercase ("held", "paying"); full sentences
  // (a closed item's outcome) keep their names and currency as written.
  const bare = state.toLowerCase();
  if (state === "held") {
    const held = secondsLeft(heldDeadline(view, card), clock);
    return held > 0 ? `auto-approves in ${mmss(held)}` : bare;
  }
  // Count down only while the item is still live: a denied or cancelled
  // transfer stays in the view and reads its state at once (B9).
  const live = card.step === "pending" ? state === "pending" : (card.step === "asked" || card.step === "sent" || card.step === "offered") && state === "open";
  if (live) {
    const left = secondsLeft(card.settleAt, clock);
    if (left > 0) return card.kind === "request" || card.kind === "offer" ? `expires in ${left} s` : `settles in ${left} s`;
  }
  return bare;
}

/** The newest step in a root card's thread (its outcome once closed), or null. */
export function lastWalletStep(messages: readonly ChatMessage[], rootSeq: number): WalletCard | null {
  let best: ChatMessage | null = null;
  for (const m of messages) if (m.parentSeq === rootSeq && m.wallet && (best === null || m.seq > best.seq)) best = m;
  return best?.wallet ?? null;
}

/** The root card's foot: the live state line, or — once the item has left
 *  the view ("closed") — how it closed, read off its last step (B8). */
export function walletFootLine(card: WalletCard, state: string | null, view: WalletView | WalletQueueView | null, clock: number, outcome?: WalletCard | null, me?: string | null): string {
  if (state === null && outcome && card.kind !== "grant" && card.kind !== "freeze") return walletStepLine(outcome, me);
  return walletStateLine(card, state, view, clock);
}

/** A thread step's text: the server's line, except the payer's copy of a
 *  request's `paid` step, which reads as their own payment (the server's
 *  line speaks to the requester). */
export function walletStepText(msg: Pick<ChatMessage, "text">, card: WalletCard, me: string | null | undefined): string {
  if (card.kind === "request" && card.step === "paid" && me != null && me === card.to) return walletStepLine(card, me);
  return msg.text || walletStepLine(card, me);
}

export type WalletButton = "pay" | "declineRequest" | "accept" | "declineOffer" | "approve" | "deny" | "cancel";

/** What a restricted guest's wallet can't do (the server answers 403):
 *  pay or refuse a request, accept an offer. Declining an offer and
 *  cancelling your own stay open, so a marked guest can back out. */
const RESTRICTED_BUTTONS: ReadonlySet<WalletButton> = new Set<WalletButton>(["pay", "declineRequest", "accept"]);

/** Which buttons a root card offers this viewer right now — pure, so the
 *  booth and the phone agree, and so it is testable without a DOM. A
 *  frozen viewer can't pay a request or accept a sell offer (both move
 *  their coin out — the server answers 409); declining still works. */
export function walletButtonsFor(card: WalletCard, view: WalletView | WalletQueueView | null, me: string | null, restricted = false, frozen = false): WalletButton[] {
  let buttons = walletButtonsOpen(card, view, me);
  if (restricted) buttons = buttons.filter((b) => !RESTRICTED_BUTTONS.has(b));
  if (frozen) buttons = buttons.filter((b) => b !== "pay" && !(b === "accept" && card.side === "sell"));
  return buttons;
}

function walletButtonsOpen(card: WalletCard, view: WalletView | WalletQueueView | null, me: string | null): WalletButton[] {
  const state = walletItemState(view, card);
  if (state === null) return [];
  switch (card.kind) {
    case "request":
      if (card.step === "asked" && card.to === me && state === "open") return ["pay", "declineRequest"];
      if (card.step === "sent" && card.from === me && state === "open") return ["cancel"];
      return [];
    case "offer":
      if (card.step === "offered" && card.to === me && state === "open") return ["accept", "declineOffer"];
      if (card.step === "sent" && card.from === me && state === "open") return ["cancel"];
      return [];
    case "approval":
      if (state === "held") return ["approve", "deny"];
      if (state === "pending") return ["deny"];
      return [];
    case "transfer":
      if (card.from === me && state === "held") return ["cancel"];
      return [];
    default:
      return [];
  }
}

const BUTTON_LABEL: Record<WalletButton, string> = {
  pay: "Pay",
  declineRequest: "Decline",
  accept: "Accept",
  declineOffer: "Decline",
  approve: "Approve",
  deny: "Deny",
  cancel: "Cancel",
};

// --- the actions context ---------------------------------------------------------

/** What the app can do with a card — the routes behind the buttons. The
 *  phone supplies the guest calls (approve / deny too, for a story whose
 *  approver is a guest's program); the booth supplies approve / deny. */
export interface WalletActions {
  view: WalletView | WalletQueueView | null;
  me: string | null;
  /** Story clock (ms) for the countdowns. */
  clock: number;
  /** The guest is restricted (`restrict who`): no paying, accepting, sending. */
  restricted?: boolean;
  respond?: (id: string, accept: boolean) => void;
  accept?: (id: string) => void;
  decline?: (id: string) => void;
  cancel?: (id: string) => void;
  approve?: (id: string) => void;
  deny?: (id: string) => void;
}
/** The session's guest wallet calls the cards need (session.ts `wallet`). */
export interface GuestWalletCalls {
  respond: (id: string, accept: boolean) => Promise<unknown>;
  accept: (id: string) => Promise<unknown>;
  decline: (id: string) => Promise<unknown>;
  cancel: (id: string) => Promise<unknown>;
  approve: (id: string) => Promise<unknown>;
  deny: (id: string) => Promise<unknown>;
}

/** The phone's card actions: every guest call, approve / deny included —
 *  a bare program can be the approver and audits from its guest's phone. */
export function guestWalletActions(view: WalletView | null, me: string, clock: number, restricted: boolean, w: GuestWalletCalls): WalletActions {
  return {
    view,
    me,
    clock,
    restricted,
    respond: (id, accept) => void w.respond(id, accept),
    accept: (id) => void w.accept(id),
    decline: (id) => void w.decline(id),
    cancel: (id) => void w.cancel(id),
    approve: (id) => void w.approve(id),
    deny: (id) => void w.deny(id),
  };
}

const WalletActionsContext = createContext<WalletActions>({ view: null, me: null, clock: 0 });
export const WalletActionsProvider = WalletActionsContext.Provider;
export function useWalletActions(): WalletActions {
  return useContext(WalletActionsContext);
}

function fire(actions: WalletActions, button: WalletButton, id: string): void {
  switch (button) {
    case "pay":
      actions.respond?.(id, true);
      break;
    case "declineRequest":
      actions.respond?.(id, false);
      break;
    case "accept":
      actions.accept?.(id);
      break;
    case "declineOffer":
      actions.decline?.(id);
      break;
    case "approve":
      actions.approve?.(id);
      break;
    case "deny":
      actions.deny?.(id);
      break;
    case "cancel":
      actions.cancel?.(id);
      break;
    default:
      break;
  }
}

// --- the card ----------------------------------------------------------------------

/**
 * A wallet card in the Wallet room: a step (a thread reply) renders as one
 * line; a root renders the card with its state read from the view (never
 * from the message) and the buttons that apply. Settled cards show their
 * last step's text.
 */
export function WalletCardView({
  msg,
  card,
  modBtn,
  replies,
  onOpenThread,
  outcome,
}: {
  msg: ChatMessage;
  card: WalletCard;
  modBtn?: ReactNode;
  replies?: number;
  onOpenThread?: (rootSeq: number) => void;
  /** The newest step in its thread (`lastWalletStep`). */
  outcome?: WalletCard | null;
}) {
  const actions = useWalletActions();
  if (msg.parentSeq != null) {
    return (
      <div className={`msg wallet-step ${card.step} ${msg.hidden ? "hidden" : ""}`}>
        <span className="wallet-step-ico" aria-hidden>
          {walletGlyph(card)}
        </span>
        <span className="bubble plain">{walletStepText(msg, card, actions.me)}</span>
        {modBtn}
      </div>
    );
  }
  const state = walletItemState(actions.view, card);
  const buttons = walletButtonsFor(card, actions.view, actions.me, actions.restricted ?? false, frozenUntil(actions.view, actions.clock) !== null);
  const open = onOpenThread ? () => onOpenThread(msg.seq) : undefined;
  const other =
    card.kind === "approval" ? card.fromName : card.step === "received" || card.step === "asked" || card.step === "offered" || card.step === "frozen" ? card.fromName : card.toName;
  return (
    <div className={`msg wallet-msg ${msg.hidden ? "hidden" : ""}`}>
      <div className={`wallet-card ${card.kind} ${state ?? "closed"}`}>
        <div className="wallet-head">
          <span className="wallet-ico" aria-hidden>
            {/* A closed item (gone from the view) reads its glyph off its
                outcome, like its foot line — never ⏳ beside "Denied". */}
            {walletGlyph(card, state ?? outcome?.step ?? null)}
          </span>
          <strong className="wallet-title">{walletCardTitle(card)}</strong>
          {card.kind !== "freeze" && (
            <span className="wallet-amount">
              {card.amount} {card.unit}
            </span>
          )}
        </div>
        {other && card.kind !== "stimulus" && (
          <div className="wallet-party">
            <PersonAvatar name={other} size="sm" /> {other.replace(/_/gu, " ")}
          </div>
        )}
        {msg.text && <p className="wallet-text">{msg.text}</p>}
        <div className="wallet-foot">
          <span className="muted wallet-state">
            {walletFootLine(card, state, actions.view, actions.clock, outcome, actions.me)}
          </span>
          {open && (
            <button className="link" onClick={open}>
              {replies ? `${replies} ${replies === 1 ? "update" : "updates"} ›` : "Open ›"}
            </button>
          )}
        </div>
        {buttons.length > 0 && (
          <div className="card-actions">
            {buttons.map((b) => (
              <button
                key={b}
                className={`choice ${b === "deny" || b === "declineRequest" || b === "declineOffer" || b === "cancel" ? "danger" : "primary"}`}
                onClick={() => fire(actions, b, card.id)}
              >
                {BUTTON_LABEL[b]}
              </button>
            ))}
          </div>
        )}
      </div>
      {modBtn}
    </div>
  );
}

// --- the balance pill + the room's footer -----------------------------------------------

/** `🪙 120 Truthcoin` — replaces the ⭐ score on the identity card; tapping
 *  it opens the Wallet room. */
export function BalancePill({ view, onOpen }: { view: WalletView; onOpen: () => void }) {
  return (
    <button className="wallet-pill" onClick={onOpen} data-tour="wallet" title="Open your Wallet">
      🪙 {view.balance} {view.name}
      {view.escrowed > 0 && <span className="muted wallet-escrow"> · {view.escrowed} on hold</span>}
      {view.frozenUntil !== undefined && <span className="wallet-frozen"> · 🧊 frozen</span>}
    </button>
  );
}

/** The note a restricted guest's Wallet room shows instead of its buttons. */
export const WALLET_RESTRICTED_NOTE = "⛔ You're restricted: your wallet can't send, request or trade until the story lifts it.";

/** The Wallet room's footer: Send · Request · Trade a fact · (the
 *  minter's Stimulus · 🎁 Grant · 🧊 Freeze). None for a restricted guest
 *  (the footer shows the ⛔ note instead); Send is greyed while frozen
 *  (`clock` = the story clock the freeze is read against). */
export function walletFooterActions(view: WalletView, open: (sheet: WalletSheet) => void, restricted = false, clock?: number): Action[] {
  if (restricted) return [];
  const actions: Action[] = [
    { label: "💸 Send", onClick: () => open("send"), ...(frozenUntil(view, clock) !== null ? { disabled: true } : {}) },
    { label: "🙏 Request", onClick: () => open("request") },
    { label: "💱 Trade a fact", onClick: () => open("offer") },
  ];
  if (view.minter !== undefined) {
    const left = view.minter.limit - view.minter.uses;
    actions.push({ label: left > 0 ? `💰 Stimulus (${left} left)` : "💰 Stimulus (none left)", onClick: () => open("stimulus"), tone: "ghost" });
    // The reserve (a server that knows it sends `grants`).
    if (view.minter.grants !== undefined) {
      const g = view.minter.grants.limit - view.minter.grants.uses;
      actions.push({ label: g > 0 ? `🎁 Grant (${g} left)` : "🎁 Grant (none left)", onClick: () => open("grant"), tone: "ghost" });
      actions.push({ label: "🧊 Freeze", onClick: () => open("freeze"), tone: "ghost" });
    }
  }
  return actions;
}

export type WalletSheet = "send" | "request" | "offer" | "stimulus" | "grant" | "freeze";

export function WalletFooter({ view, open, restricted = false, clock }: { view: WalletView; open: (sheet: WalletSheet) => void; restricted?: boolean; clock?: number }) {
  if (restricted) {
    return (
      <p className="notice" role="status">
        {WALLET_RESTRICTED_NOTE}
      </p>
    );
  }
  const note = frozenNote(view, clock);
  return (
    <>
      {note !== null && (
        <p className="notice wallet-frozen-note" role="status">
          {note}
        </p>
      )}
      <ActionRow actions={walletFooterActions(view, open, false, clock)} />
    </>
  );
}

// --- the sheets -----------------------------------------------------------------------------

export interface WalletPerson {
  id: string;
  name: string;
}

function AmountField({ max, unit, onSubmit, verb }: { max: number; unit: string; onSubmit: (n: number) => void; verb: string }) {
  const [text, setText] = useState("");
  const n = parseAmount(text, max);
  return (
    <form
      className="wallet-amount-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (n !== null) onSubmit(n);
      }}
    >
      <label className="wallet-amount-label">
        Amount
        <input
          className="wallet-amount-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder={`1–${max}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <span className="muted"> {unit}</span>
      </label>
      {text !== "" && n === null && <div className="muted wallet-hint">A whole number from 1 to {max}.</div>}
      <button className="choice primary" type="submit" disabled={n === null}>
        {verb}
      </button>
    </form>
  );
}

/** Pick a person, then an amount. `mode: "send"` = "Send 50 Truthcoin to
 *  Winamp"; `mode: "request"` = "Ask Winamp for 50 Truthcoin"; `mode:
 *  "grant"` = the minter's "Grant Winamp 50 Truthcoin" from the reserve. */
export function PeopleAmountSheet({
  mode,
  view,
  people,
  onDone,
  onClose,
}: {
  mode: "send" | "request" | "grant";
  view: WalletView;
  people: WalletPerson[];
  onDone: (personId: string, amount: number) => void;
  onClose: () => void;
}) {
  const [who, setWho] = useState<WalletPerson | null>(null);
  const grants = view.minter?.grants;
  const grantsLeft = grants === undefined ? 0 : grants.limit - grants.uses;
  if (mode === "grant" && grantsLeft < 1) {
    return (
      <Sheet title="🎁 Grant" onClose={onClose}>
        <div className="muted pad">No grants left tonight.</div>
      </Sheet>
    );
  }
  if (who === null) {
    const items: PickItem[] = people.map((p) => ({ id: p.id, label: p.name, avatar: true }));
    return (
      <PickerSheet
        title={mode === "send" ? "Send to…" : mode === "grant" ? "🎁 Grant to…" : "Ask…"}
        items={items}
        empty="Nobody else is here yet."
        keepOpen
        onPick={(id) => {
          const p = people.find((x) => x.id === id);
          if (p) setWho(p);
        }}
        onClose={onClose}
      />
    );
  }
  const max = mode === "send" ? Math.min(view.maxTransfer, view.balance) : view.maxTransfer;
  const title = mode === "send" ? `Send ${view.name} to ${who.name}` : mode === "grant" ? `🎁 Grant ${who.name} ${view.name}` : `Ask ${who.name} for ${view.name}`;
  const hint =
    mode === "send"
      ? `You have ${view.balance} ${view.name}.`
      : mode === "grant"
        ? `Minted from the reserve — nothing leaves your balance. ${grantsLeft} ${grantsLeft === 1 ? "grant" : "grants"} left tonight.`
        : `They will see a card with Pay / Decline. It expires if nobody answers.`;
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="muted pad">{hint}</div>
      {max < 1 ? (
        <div className="muted pad">You have nothing to send.</div>
      ) : (
        <AmountField
          max={max}
          unit={view.name}
          verb={mode === "send" ? `Send to ${who.name}` : mode === "grant" ? `Grant ${who.name}` : `Ask ${who.name}`}
          onSubmit={(n) => {
            onDone(who.id, n);
            onClose();
          }}
        />
      )}
    </Sheet>
  );
}

export interface WalletEntry {
  id: string;
  title: string;
}

/** The entry an offer posts and the title the sheet shows: a sale posts
 *  the held entry's id (a title often differs from its id, and the server
 *  resolves ids); a buy posts the typed title as typed. */
export interface OfferChoice {
  entry: string;
  title: string;
}
export function sellChoice(e: WalletEntry): OfferChoice {
  return { entry: e.id, title: e.title };
}
export function buyChoice(typed: string): OfferChoice {
  return { entry: typed.trim(), title: typed.trim() };
}

/** Trade a fact: sell one you hold, or buy one by title (resolved on the
 *  server), to a counterparty, for an amount. A frozen viewer can only
 *  sell (a buy moves their coin out). */
export function OfferSheet({
  view,
  people,
  codex,
  onDone,
  onClose,
  frozen = false,
}: {
  view: WalletView;
  people: WalletPerson[];
  codex: WalletEntry[];
  onDone: (personId: string, entry: string, side: "buy" | "sell", amount: number) => void;
  onClose: () => void;
  frozen?: boolean;
}) {
  const [side, setSide] = useState<"buy" | "sell">("sell");
  // `typed` is the buy box; `choice` is what the offer will post + show.
  const [typed, setTyped] = useState<string>("");
  const [choice, setChoice] = useState<OfferChoice>({ entry: "", title: "" });
  const [who, setWho] = useState<WalletPerson | null>(null);
  const [stage, setStage] = useState<"entry" | "who" | "amount">("entry");
  if (stage === "who") {
    return (
      <PickerSheet
        title={side === "sell" ? "Offer it to…" : "Buy it from…"}
        items={people.map((p) => ({ id: p.id, label: p.name, avatar: true }))}
        empty="Nobody else is here yet."
        keepOpen
        onPick={(id) => {
          const p = people.find((x) => x.id === id);
          if (p) {
            setWho(p);
            setStage("amount");
          }
        }}
        onClose={onClose}
      />
    );
  }
  if (stage === "amount" && who !== null) {
    const max = side === "buy" ? Math.min(view.maxTransfer, view.balance) : view.maxTransfer;
    return (
      <Sheet title={side === "sell" ? `Sell “${choice.title}” to ${who.name}` : `Buy “${choice.title}” from ${who.name}`} onClose={onClose}>
        <div className="muted pad">{side === "sell" ? `${who.name} pays you when they accept.` : `Your ${view.name} is held until ${who.name} answers.`}</div>
        {max < 1 ? (
          <div className="muted pad">You have nothing to offer.</div>
        ) : (
          <AmountField
            max={max}
            unit={view.name}
            verb={side === "sell" ? "Offer it" : "Offer to buy"}
            onSubmit={(n) => {
              onDone(who.id, choice.entry, side, n);
              onClose();
            }}
          />
        )}
      </Sheet>
    );
  }
  return (
    <Sheet title="Trade a fact" onClose={onClose} tall={codex.length > 6}>
      <div className="wallet-side">
        <button className={`choice ${side === "sell" ? "primary" : "ghost"}`} onClick={() => setSide("sell")}>
          Sell one I hold
        </button>
        <button className={`choice ${side === "buy" ? "primary" : "ghost"}`} onClick={() => setSide("buy")} disabled={frozen}>
          Buy one by title
        </button>
      </div>
      {frozen && <div className="muted pad">🧊 Your {view.name} is frozen — you can sell, not buy, until it thaws.</div>}
      {side === "sell" ? (
        codex.length === 0 ? (
          <div className="muted pad">You hold no entries to sell.</div>
        ) : (
          codex.map((e) => (
            <button
              key={e.id}
              className="choice ghost pick"
              onClick={() => {
                setChoice(sellChoice(e));
                setStage("who");
              }}
            >
              <span className="pick-label">{e.title}</span>
            </button>
          ))
        )
      ) : (
        <form
          className="wallet-amount-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim() !== "") {
              setChoice(buyChoice(typed));
              setStage("who");
            }
          }}
        >
          <label className="wallet-amount-label">
            The entry's title
            <input className="wallet-entry-input" type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Exactly as it is titled" autoFocus />
          </label>
          <button className="choice primary" type="submit" disabled={typed.trim() === ""}>
            Next
          </button>
        </form>
      )}
    </Sheet>
  );
}

/** The minter's stimulus: an amount every eligible program receives. */
export function StimulusSheet({ view, onDone, onClose }: { view: WalletView; onDone: (amount: number) => void; onClose: () => void }) {
  const left = view.minter ? view.minter.limit - view.minter.uses : 0;
  return (
    <Sheet title="💰 Stimulus" onClose={onClose}>
      <div className="muted pad">
        {left > 0 ? `Pays every eligible program the same amount, minted from nothing. ${left} ${left === 1 ? "use" : "uses"} left tonight.` : "No stimulus left tonight."}
      </div>
      {left > 0 && (
        <AmountField
          max={view.maxTransfer}
          unit={view.name}
          verb="Pay everyone"
          onSubmit={(n) => {
            onDone(n);
            onClose();
          }}
        />
      )}
    </Sheet>
  );
}

/** The minter's 🧊 Freeze: pick a program, then confirm. Someone already
 *  frozen shows their thaw countdown and can't be frozen again. */
export function FreezeSheet({
  view,
  people,
  clock,
  onDone,
  onClose,
}: {
  view: WalletView;
  people: WalletPerson[];
  clock: number;
  onDone: (personId: string) => void;
  onClose: () => void;
}) {
  const [who, setWho] = useState<WalletPerson | null>(null);
  const frozen = view.minter?.frozen ?? [];
  const thaws = (id: string): string | null => {
    const f = frozen.find((x) => x.target === id);
    return f === undefined ? null : `🧊 thaws in ${mmss(secondsLeft(f.until, clock))}`;
  };
  const mins = Math.max(1, Math.round((view.minter?.freezeMs ?? 600_000) / 60_000));
  if (who === null) {
    const items: PickItem[] = people.map((p) => {
      const sub = thaws(p.id);
      return { id: p.id, label: p.name, avatar: true, ...(sub !== null ? { sub } : {}) };
    });
    return (
      <PickerSheet
        title="🧊 Freeze whose coin?"
        items={items}
        empty="Nobody else is here yet."
        keepOpen
        onPick={(id) => {
          const p = people.find((x) => x.id === id);
          if (p) setWho(p);
        }}
        onClose={onClose}
      />
    );
  }
  const already = thaws(who.id);
  return (
    <Sheet title={`🧊 Freeze ${who.name}`} onClose={onClose}>
      <div className="muted pad">
        {already !== null ? `${who.name} is already frozen (${already.replace("🧊 ", "")}).` : `For ${mins} min ${who.name} can't send, pay or buy with ${view.name}. Coin still comes in.`}
      </div>
      {already === null && (
        <button
          className="choice primary"
          onClick={() => {
            onDone(who.id);
            onClose();
          }}
        >
          Freeze for {mins} min
        </button>
      )}
    </Sheet>
  );
}

/** The booth card's line: `🧾 2 awaiting approval`. */
export function approvalBadge(q: WalletQueueView | undefined): string | null {
  if (q === undefined) return null;
  const held = q.queue.filter((t: WalletTxView) => t.state === "held").length;
  return held > 0 ? `🧾 ${held} awaiting approval` : null;
}
