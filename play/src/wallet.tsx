//! The 💰 wallet — a guest's balance in the story's currency, and the cards
//! that move it: send / request / trade a fact (an escrowed codex offer),
//! the approver's Approve / Deny, the minter's stimulus. The server's wallet
//! book settles everything; this file renders its cards (in the pinned
//! Wallet room) and posts to its routes through a `WalletActions` context,
//! so the same card works in a guest's phone and in the approver's booth.
//!
//! Pure helpers first (unit-tested with no DOM), then the components.
//! Nothing here knows the currency's name or who the approver is: the view
//! carries the unit, the card carries the people.

import { createContext, useContext, useState, type ReactNode } from "react";
import { ActionRow, PersonAvatar, PickerSheet, Sheet, type PickItem } from "./chat.tsx";
import type { Action, ChatMessage, WalletCard, WalletQueueView, WalletTxView, WalletView } from "./types.ts";

// --- pure helpers ---------------------------------------------------------------

/** The Wallet room's subtitle: `🪙 120 Truthcoin · 2 pending`. */
export function walletSummary(w: WalletView): string {
  const base = `🪙 ${w.balance} ${w.name}`;
  const held = w.approver?.queue.filter((t) => t.state === "held").length ?? 0;
  if (held > 0) return `${base} · ${held} to approve`;
  const open = w.transfers.filter((t) => t.state === "pending" || t.state === "held").length + w.requests.length + w.offers.length;
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
};

/** The glyph for a card's step. */
export function walletGlyph(card: WalletCard): string {
  return STEP_GLYPH[card.step] ?? "💰";
}

/** The short per-step line a thread reply shows under its card. */
export function walletStepLine(card: WalletCard): string {
  const amt = `${card.amount} ${card.unit}`;
  const by = card.by ? ` by ${card.by.replace(/_/gu, " ")}` : "";
  switch (card.step) {
    case "settled":
      return card.kind === "approval" ? `✅ Settled: ${card.fromName} → ${card.toName}, ${amt}` : `✅ Settled — ${amt} is ${card.toName}'s`;
    case "approved":
      return `✅ Approved${by}`;
    case "denied":
      return `⛔ Denied${by} — refunded`;
    case "cancelled":
      return `↩️ Cancelled${by}`;
    case "paid":
      return `✅ Paid — ${card.toName} sent ${amt}`;
    case "accepted":
      return card.kind === "request" ? `💸 Agreed — paying ${amt}` : `✅ Done — the fact changed hands for ${amt}`;
    case "declined":
      return "⛔ Declined";
    case "failed":
      return "⛔ Could not settle — refunded";
    case "expired":
      return "⌛ Expired";
    case "received":
      return `💰 Received ${amt} from ${card.fromName}`;
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
  return null;
}

export type WalletButton = "pay" | "declineRequest" | "accept" | "declineOffer" | "approve" | "deny" | "cancel";

/** Which buttons a root card offers this viewer right now — pure, so the
 *  booth and the phone agree, and so it is testable without a DOM. */
export function walletButtonsFor(card: WalletCard, view: WalletView | WalletQueueView | null, me: string | null): WalletButton[] {
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
 *  phone supplies the guest calls; the booth supplies approve / deny. */
export interface WalletActions {
  view: WalletView | WalletQueueView | null;
  me: string | null;
  /** Story clock (ms) for the countdowns. */
  clock: number;
  respond?: (id: string, accept: boolean) => void;
  accept?: (id: string) => void;
  decline?: (id: string) => void;
  cancel?: (id: string) => void;
  approve?: (id: string) => void;
  deny?: (id: string) => void;
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
}: {
  msg: ChatMessage;
  card: WalletCard;
  modBtn?: ReactNode;
  replies?: number;
  onOpenThread?: (rootSeq: number) => void;
}) {
  const actions = useWalletActions();
  if (msg.parentSeq != null) {
    return (
      <div className={`msg wallet-step ${card.step} ${msg.hidden ? "hidden" : ""}`}>
        <span className="wallet-step-ico" aria-hidden>
          {walletGlyph(card)}
        </span>
        <span className="bubble plain">{msg.text || walletStepLine(card)}</span>
        {modBtn}
      </div>
    );
  }
  const state = walletItemState(actions.view, card);
  const buttons = walletButtonsFor(card, actions.view, actions.me);
  const deadline = (card.step === "pending" || card.step === "asked" || card.step === "sent" || card.step === "offered") && state !== null ? secondsLeft(card.settleAt, actions.clock) : null;
  const open = onOpenThread ? () => onOpenThread(msg.seq) : undefined;
  const other = card.kind === "approval" ? card.fromName : card.step === "received" || card.step === "asked" || card.step === "offered" ? card.fromName : card.toName;
  return (
    <div className={`msg wallet-msg ${msg.hidden ? "hidden" : ""}`}>
      <div className={`wallet-card ${card.kind} ${state ?? "closed"}`}>
        <div className="wallet-head">
          <span className="wallet-ico" aria-hidden>
            {walletGlyph(card)}
          </span>
          <strong className="wallet-title">{walletCardTitle(card)}</strong>
          <span className="wallet-amount">
            {card.amount} {card.unit}
          </span>
        </div>
        {other && card.kind !== "stimulus" && (
          <div className="wallet-party">
            <PersonAvatar name={other} size="sm" /> {other.replace(/_/gu, " ")}
          </div>
        )}
        {msg.text && <p className="wallet-text">{msg.text}</p>}
        <div className="wallet-foot">
          <span className="muted wallet-state">
            {state === null
              ? "closed"
              : deadline !== null && deadline > 0
                ? card.kind === "request" || card.kind === "offer"
                  ? `expires in ${deadline} s`
                  : `settles in ${deadline} s`
                : state}
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
    </button>
  );
}

/** The Wallet room's footer: Send · Request · Trade a fact · (Stimulus). */
export function walletFooterActions(view: WalletView, open: (sheet: WalletSheet) => void): Action[] {
  const actions: Action[] = [
    { label: "💸 Send", onClick: () => open("send") },
    { label: "🙏 Request", onClick: () => open("request") },
    { label: "💱 Trade a fact", onClick: () => open("offer") },
  ];
  if (view.minter !== undefined) {
    const left = view.minter.limit - view.minter.uses;
    actions.push({ label: left > 0 ? `💰 Stimulus (${left} left)` : "💰 Stimulus (none left)", onClick: () => open("stimulus"), tone: "ghost" });
  }
  return actions;
}

export type WalletSheet = "send" | "request" | "offer" | "stimulus";

export function WalletFooter({ view, open }: { view: WalletView; open: (sheet: WalletSheet) => void }) {
  return <ActionRow actions={walletFooterActions(view, open)} />;
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
 *  Winamp"; `mode: "request"` = "Ask Winamp for 50 Truthcoin". */
export function PeopleAmountSheet({
  mode,
  view,
  people,
  onDone,
  onClose,
}: {
  mode: "send" | "request";
  view: WalletView;
  people: WalletPerson[];
  onDone: (personId: string, amount: number) => void;
  onClose: () => void;
}) {
  const [who, setWho] = useState<WalletPerson | null>(null);
  if (who === null) {
    const items: PickItem[] = people.map((p) => ({ id: p.id, label: p.name, avatar: true }));
    return (
      <PickerSheet
        title={mode === "send" ? "Send to…" : "Ask…"}
        items={items}
        empty="Nobody else is here yet."
        onPick={(id) => {
          const p = people.find((x) => x.id === id);
          if (p) setWho(p);
        }}
        onClose={onClose}
      />
    );
  }
  const max = mode === "send" ? Math.min(view.maxTransfer, view.balance) : view.maxTransfer;
  return (
    <Sheet title={mode === "send" ? `Send ${view.name} to ${who.name}` : `Ask ${who.name} for ${view.name}`} onClose={onClose}>
      <div className="muted pad">
        {mode === "send" ? `You have ${view.balance} ${view.name}.` : `They will see a card with Pay / Decline. It expires if nobody answers.`}
      </div>
      {max < 1 ? (
        <div className="muted pad">You have nothing to send.</div>
      ) : (
        <AmountField
          max={max}
          unit={view.name}
          verb={mode === "send" ? `Send to ${who.name}` : `Ask ${who.name}`}
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

/** Trade a fact: sell one you hold, or buy one by title (resolved on the
 *  server), to a counterparty, for an amount. */
export function OfferSheet({
  view,
  people,
  codex,
  onDone,
  onClose,
}: {
  view: WalletView;
  people: WalletPerson[];
  codex: WalletEntry[];
  onDone: (personId: string, entry: string, side: "buy" | "sell", amount: number) => void;
  onClose: () => void;
}) {
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const [entry, setEntry] = useState<string>("");
  const [who, setWho] = useState<WalletPerson | null>(null);
  const [stage, setStage] = useState<"entry" | "who" | "amount">("entry");
  if (stage === "who") {
    return (
      <PickerSheet
        title={side === "sell" ? "Offer it to…" : "Buy it from…"}
        items={people.map((p) => ({ id: p.id, label: p.name, avatar: true }))}
        empty="Nobody else is here yet."
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
      <Sheet title={side === "sell" ? `Sell “${entry}” to ${who.name}` : `Buy “${entry}” from ${who.name}`} onClose={onClose}>
        <div className="muted pad">{side === "sell" ? `${who.name} pays you when they accept.` : `Your ${view.name} is held until ${who.name} answers.`}</div>
        {max < 1 ? (
          <div className="muted pad">You have nothing to offer.</div>
        ) : (
          <AmountField
            max={max}
            unit={view.name}
            verb={side === "sell" ? "Offer it" : "Offer to buy"}
            onSubmit={(n) => {
              onDone(who.id, entry, side, n);
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
        <button className={`choice ${side === "buy" ? "primary" : "ghost"}`} onClick={() => setSide("buy")}>
          Buy one by title
        </button>
      </div>
      {side === "sell" ? (
        codex.length === 0 ? (
          <div className="muted pad">You hold no entries to sell.</div>
        ) : (
          codex.map((e) => (
            <button
              key={e.id}
              className="choice ghost pick"
              onClick={() => {
                setEntry(e.title);
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
            if (entry.trim() !== "") setStage("who");
          }}
        >
          <label className="wallet-amount-label">
            The entry's title
            <input className="wallet-entry-input" type="text" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="Exactly as it is titled" autoFocus />
          </label>
          <button className="choice primary" type="submit" disabled={entry.trim() === ""}>
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

/** The booth card's line: `🧾 2 awaiting approval`. */
export function approvalBadge(q: WalletQueueView | undefined): string | null {
  if (q === undefined) return null;
  const held = q.queue.filter((t: WalletTxView) => t.state === "held").length;
  return held > 0 ? `🧾 ${held} awaiting approval` : null;
}
