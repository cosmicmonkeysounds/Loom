//! The 💰 wallet: the pure helpers behind the Wallet room (summary, needs-you,
//! amount parsing, the per-card buttons read from the live view) and the
//! cards + sheets rendered to static markup — the phone's and the booth's
//! view of one transfer, request, offer and stimulus.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BalancePill,
  OfferSheet,
  PeopleAmountSheet,
  StimulusSheet,
  WalletActionsProvider,
  WalletCardView,
  approvalBadge,
  parseAmount,
  queueSummary,
  secondsLeft,
  walletButtonsFor,
  walletCardTitle,
  walletFooterActions,
  walletItemState,
  walletNeedsYou,
  walletStepLine,
  walletSummary,
} from "../src/wallet.tsx";
import type { ChatMessage, GuestView, PrimeView, WalletCard, WalletQueueView, WalletTxView, WalletView } from "../src/types.ts";
import { INBOX, buildGuestChannels, buildPrimeChannels, isPinnedRoom, personalStream } from "../src/session.ts";
import { WALLET_ROOM, channelHead } from "../src/threads.ts";

function tx(extra: Partial<WalletTxView> = {}): WalletTxView {
  return { id: "t1", from: "me", fromName: "Winamp", to: "g2", toName: "Paint", amount: 50, state: "pending", settleAt: 61_000, via: "send", at: 1000, ...extra };
}
function view(extra: Partial<WalletView> = {}): WalletView {
  return { name: "Truthcoin", balance: 120, escrowed: 0, maxTransfer: 500, transfers: [], requests: [], offers: [], ...extra };
}
function card(extra: Partial<WalletCard> = {}): WalletCard {
  return { kind: "transfer", id: "t1", step: "pending", from: "me", fromName: "Winamp", to: "g2", toName: "Paint", amount: 50, unit: "Truthcoin", settleAt: 61_000, approver: "Auditor", ...extra };
}
function msg(c: WalletCard, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { seq: 7, channel: "wallet", channelKind: "lobby", title: "Wallet", from: "", kind: "system", text: `card ${c.id}`, ts: 1000, audience: ["me"], parentSeq: null, hidden: false, ...extra };
}
function render(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

describe("wallet summaries", () => {
  it("names the balance and counts what is in flight", () => {
    expect(walletSummary(view())).toBe("🪙 120 Truthcoin");
    expect(walletSummary(view({ transfers: [tx(), tx({ id: "t2", state: "settled" })], requests: [{ id: "r1", from: "g2", fromName: "Paint", to: "me", toName: "Winamp", amount: 5, state: "open", expiresAt: 0, at: 0 }] }))).toBe("🪙 120 Truthcoin · 2 pending");
    expect(walletSummary(view({ approver: { queue: [tx({ state: "held" }), tx({ id: "t2" })] } }))).toBe("🪙 120 Truthcoin · 1 to approve");
  });

  it("summarises the approver's queue and badges the booth", () => {
    const q: WalletQueueView = { name: "Truthcoin", queue: [tx({ state: "held" }), tx({ id: "t2", state: "held" }), tx({ id: "t3" })], every: 3, windowMs: 60_000 };
    expect(queueSummary(q)).toBe("2 awaiting approval · 1 settling");
    expect(queueSummary({ ...q, queue: [tx()] })).toBe("1 settling");
    expect(queueSummary({ ...q, queue: [] })).toBe("nothing to approve");
    expect(approvalBadge(q)).toBe("🧾 2 awaiting approval");
    expect(approvalBadge({ ...q, queue: [tx()] })).toBeNull();
    expect(approvalBadge(undefined)).toBeNull();
  });

  it("knows when a card waits on me", () => {
    const incoming = { id: "r1", from: "g2", fromName: "Paint", to: "me", toName: "Winamp", amount: 5, state: "open" as const, expiresAt: 0, at: 0 };
    expect(walletNeedsYou(view({ requests: [incoming] }), "me")).toBe(true);
    expect(walletNeedsYou(view({ requests: [{ ...incoming, from: "me", to: "g2" }] }), "me")).toBe(false); // only outgoing
    expect(walletNeedsYou(view({ requests: [{ ...incoming, state: "paying" }] }), "me")).toBe(false);
    const offer = { id: "o1", from: "g2", fromName: "Paint", to: "me", toName: "Winamp", side: "buy" as const, entry: "e", entryTitle: "E", amount: 5, state: "open" as const, expiresAt: 0, at: 0 };
    expect(walletNeedsYou(view({ offers: [offer] }), "me")).toBe(true);
    expect(walletNeedsYou(view({ offers: [{ ...offer, to: "g3" }] }), "me")).toBe(false);
    expect(walletNeedsYou(view({ approver: { queue: [tx({ state: "held" })] } }), "me")).toBe(true);
    expect(walletNeedsYou(view({ approver: { queue: [tx()] } }), "me")).toBe(false); // pending settles on its own
    expect(walletNeedsYou(view(), "me")).toBe(false);
  });
});

describe("amounts + clocks", () => {
  it("parses a whole number from 1 to max and rejects the rest", () => {
    expect(parseAmount("50", 500)).toBe(50);
    expect(parseAmount(" 500 ", 500)).toBe(500);
    expect(parseAmount("0", 500)).toBeNull();
    expect(parseAmount("501", 500)).toBeNull();
    expect(parseAmount("2.5", 500)).toBeNull();
    expect(parseAmount("abc", 500)).toBeNull();
    expect(parseAmount("-3", 500)).toBeNull();
    expect(parseAmount("", 500)).toBeNull();
  });

  it("counts the seconds left on the story clock, never below zero", () => {
    expect(secondsLeft(61_000, 1000)).toBe(60);
    expect(secondsLeft(61_000, 60_500)).toBe(1);
    expect(secondsLeft(61_000, 70_000)).toBe(0);
    expect(secondsLeft(null, 0)).toBe(0);
    expect(secondsLeft(undefined, 0)).toBe(0);
  });
});

describe("card copy", () => {
  it("writes a step line per step", () => {
    expect(walletStepLine(card({ step: "settled" }))).toBe("✅ Settled — 50 Truthcoin is Paint's");
    expect(walletStepLine(card({ kind: "approval", step: "settled" }))).toBe("✅ Settled: Winamp → Paint, 50 Truthcoin");
    expect(walletStepLine(card({ step: "approved", by: "Auditor" }))).toBe("✅ Approved by Auditor");
    expect(walletStepLine(card({ step: "denied", by: "Director" }))).toBe("⛔ Denied by Director — refunded");
    expect(walletStepLine(card({ step: "cancelled" }))).toBe("↩️ Cancelled");
    expect(walletStepLine(card({ kind: "request", step: "paid", to: "g2", toName: "Paint" }))).toBe("✅ Paid — Paint sent 50 Truthcoin");
    expect(walletStepLine(card({ kind: "request", step: "accepted" }))).toBe("💸 Agreed — paying 50 Truthcoin");
    expect(walletStepLine(card({ kind: "offer", step: "accepted" }))).toBe("✅ Done — the fact changed hands for 50 Truthcoin");
    expect(walletStepLine(card({ kind: "offer", step: "failed" }))).toBe("⛔ Could not settle — refunded");
    expect(walletStepLine(card({ kind: "request", step: "expired" }))).toBe("⌛ Expired");
    expect(walletStepLine(card({ step: "received" }))).toBe("💰 Received 50 Truthcoin from Winamp");
    expect(walletStepLine(card({ kind: "offer", step: "declined" }))).toBe("⛔ Declined");
  });

  it("titles a root card from the viewer's side", () => {
    expect(walletCardTitle(card())).toBe("You sent Paint 50 Truthcoin");
    expect(walletCardTitle(card({ step: "received" }))).toBe("Winamp sent you 50 Truthcoin");
    expect(walletCardTitle(card({ kind: "approval", step: "held" }))).toBe("Winamp → Paint: 50 Truthcoin");
    expect(walletCardTitle(card({ kind: "request", step: "asked" }))).toBe("Winamp asks you for 50 Truthcoin");
    expect(walletCardTitle(card({ kind: "request", step: "sent" }))).toBe("You asked Paint for 50 Truthcoin");
    expect(walletCardTitle(card({ kind: "offer", step: "offered", side: "buy", entryTitle: "The Lease" }))).toBe("Winamp offers you 50 Truthcoin for “The Lease”");
    expect(walletCardTitle(card({ kind: "offer", step: "sent", side: "sell", entryTitle: "The Lease" }))).toBe("You offered Paint “The Lease” for 50 Truthcoin");
    expect(walletCardTitle(card({ kind: "stimulus", step: "minted" }))).toBe("You paid every program 50 Truthcoin");
    expect(walletCardTitle(card({ kind: "stimulus", step: "received" }))).toBe("Stimulus from Winamp: 50 Truthcoin");
  });
});

describe("the buttons a card offers", () => {
  const req = { id: "r1", from: "g2", fromName: "Paint", to: "me", toName: "Winamp", amount: 5, state: "open" as const, expiresAt: 0, at: 0 };
  const offer = { id: "o1", from: "g2", fromName: "Paint", to: "me", toName: "Winamp", side: "buy" as const, entry: "e", entryTitle: "E", amount: 5, state: "open" as const, expiresAt: 0, at: 0 };

  it("reads the state from the view, never from the message", () => {
    const v = view({ transfers: [tx({ state: "held" })] });
    expect(walletItemState(v, card({ step: "pending" }))).toBe("held");
    expect(walletItemState(view(), card())).toBeNull(); // closed: gone from the view
    expect(walletItemState(null, card())).toBeNull();
    expect(walletItemState(view({ requests: [req] }), card({ kind: "request", id: "r1" }))).toBe("open");
    expect(walletItemState(view({ offers: [offer] }), card({ kind: "offer", id: "o1" }))).toBe("open");
    const q: WalletQueueView = { name: "Truthcoin", queue: [tx({ state: "held" })], every: 3, windowMs: 60_000 };
    expect(walletItemState(q, card({ kind: "approval" }))).toBe("held");
  });

  it("a request asked of me: Pay / Decline while open; my own: Cancel", () => {
    const asked = card({ kind: "request", id: "r1", step: "asked", from: "g2", fromName: "Paint", to: "me", toName: "Winamp" });
    expect(walletButtonsFor(asked, view({ requests: [req] }), "me")).toEqual(["pay", "declineRequest"]);
    expect(walletButtonsFor(asked, view({ requests: [{ ...req, state: "paying" }] }), "me")).toEqual([]);
    expect(walletButtonsFor(asked, view(), "me")).toEqual([]); // closed
    const sent = card({ kind: "request", id: "r1", step: "sent", from: "me", to: "g2" });
    expect(walletButtonsFor(sent, view({ requests: [{ ...req, from: "me", to: "g2" }] }), "me")).toEqual(["cancel"]);
  });

  it("an offer made to me: Accept / Decline; my own open offer: Cancel", () => {
    const offered = card({ kind: "offer", id: "o1", step: "offered", from: "g2", to: "me", side: "buy" });
    expect(walletButtonsFor(offered, view({ offers: [offer] }), "me")).toEqual(["accept", "declineOffer"]);
    expect(walletButtonsFor(offered, view({ offers: [offer] }), "g9")).toEqual([]); // not mine to answer
    const mine = card({ kind: "offer", id: "o1", step: "sent", from: "me", to: "g2", side: "sell" });
    expect(walletButtonsFor(mine, view({ offers: [{ ...offer, from: "me", to: "g2" }] }), "me")).toEqual(["cancel"]);
  });

  it("the approver: Approve / Deny on a held transfer, Deny only while pending, nothing after", () => {
    const held = card({ kind: "approval", step: "held" });
    const q: WalletQueueView = { name: "Truthcoin", queue: [tx({ state: "held" })], every: 3, windowMs: 60_000 };
    expect(walletButtonsFor(held, q, null)).toEqual(["approve", "deny"]);
    expect(walletButtonsFor(card({ kind: "approval", step: "pending" }), { ...q, queue: [tx()] }, null)).toEqual(["deny"]);
    expect(walletButtonsFor(held, { ...q, queue: [] }, null)).toEqual([]);
    // The approver as a guest program reads the same from `view.approver.queue`.
    expect(walletButtonsFor(held, view({ approver: { queue: [tx({ state: "held" })] } }), "me")).toEqual(["approve", "deny"]);
  });

  it("my held transfer: Cancel; a pending one waits; a settled one offers nothing", () => {
    expect(walletButtonsFor(card({ step: "held" }), view({ transfers: [tx({ state: "held" })] }), "me")).toEqual(["cancel"]);
    expect(walletButtonsFor(card(), view({ transfers: [tx()] }), "me")).toEqual([]);
    expect(walletButtonsFor(card(), view({ transfers: [tx({ state: "settled" })] }), "me")).toEqual([]);
    expect(walletButtonsFor(card({ step: "received", from: "g2", to: "me" }), view({ transfers: [tx({ from: "g2", to: "me" })] }), "me")).toEqual([]);
  });
});

describe("rendering", () => {
  const actions = (v: WalletView | WalletQueueView | null, me: string | null) => ({ view: v, me, clock: 1000 });

  it("renders a pending transfer root with its countdown and no buttons, and a step as one line", () => {
    const html = render(
      <WalletActionsProvider value={actions(view({ transfers: [tx()] }), "me")}>
        <WalletCardView msg={msg(card())} card={card()} replies={2} onOpenThread={() => {}} />
      </WalletActionsProvider>,
    );
    expect(html).toContain("You sent Paint 50 Truthcoin");
    expect(html).toContain("settles in 60 s");
    expect(html).toContain("2 updates");
    expect(html).not.toContain("card-actions");
    const step = render(<WalletCardView msg={msg(card({ step: "settled" }), { parentSeq: 7, text: "" })} card={card({ step: "settled" })} />);
    expect(step).toContain("wallet-step settled");
    expect(step).toContain("✅ Settled — 50 Truthcoin is Paint&#x27;s");
  });

  it("renders Pay / Decline on a request asked of me and Approve / Deny on the booth's held card", () => {
    const req = { id: "r1", from: "g2", fromName: "Paint", to: "me", toName: "Winamp", amount: 5, state: "open" as const, expiresAt: 601_000, at: 1000 };
    const asked = card({ kind: "request", id: "r1", step: "asked", from: "g2", fromName: "Paint", to: "me", toName: "Winamp", amount: 5, settleAt: 601_000 });
    const phone = render(
      <WalletActionsProvider value={actions(view({ requests: [req] }), "me")}>
        <WalletCardView msg={msg(asked)} card={asked} />
      </WalletActionsProvider>,
    );
    expect(phone).toContain(">Pay<");
    expect(phone).toContain(">Decline<");
    expect(phone).toContain("expires in 600 s");
    const q: WalletQueueView = { name: "Truthcoin", queue: [tx({ state: "held" })], every: 3, windowMs: 60_000 };
    const held = card({ kind: "approval", step: "held" });
    const booth = render(
      <WalletActionsProvider value={actions(q, null)}>
        <WalletCardView msg={msg(held, { audience: ["@Auditor"] })} card={held} />
      </WalletActionsProvider>,
    );
    expect(booth).toContain(">Approve<");
    expect(booth).toContain(">Deny<");
    expect(booth).toContain("Winamp → Paint: 50 Truthcoin");
    // Closed: the view no longer lists it.
    const closed = render(
      <WalletActionsProvider value={actions(q, null)}>
        <WalletCardView msg={msg(card({ kind: "approval", step: "held", id: "t9" }))} card={card({ kind: "approval", step: "held", id: "t9" })} />
      </WalletActionsProvider>,
    );
    expect(closed).not.toContain(">Approve<");
    expect(closed).toContain("closed");
  });

  it("the balance pill, the footer and the sheets read the view", () => {
    expect(render(<BalancePill view={view({ escrowed: 30 })} onOpen={() => {}} />)).toContain("🪙 120 Truthcoin");
    expect(render(<BalancePill view={view({ escrowed: 30 })} onOpen={() => {}} />)).toContain("30 on hold");
    expect(render(<BalancePill view={view()} onOpen={() => {}} />)).toContain('data-tour="wallet"');
    expect(walletFooterActions(view(), () => {}).map((a) => a.label)).toEqual(["💸 Send", "🙏 Request", "💱 Trade a fact"]);
    expect(walletFooterActions(view({ minter: { uses: 1, limit: 3 } }), () => {}).map((a) => a.label)).toEqual(["💸 Send", "🙏 Request", "💱 Trade a fact", "💰 Stimulus (2 left)"]);
    expect(walletFooterActions(view({ minter: { uses: 3, limit: 3 } }), () => {}).at(-1)!.label).toBe("💰 Stimulus (none left)");

    const people = [{ id: "g2", name: "Paint" }];
    const send = render(<PeopleAmountSheet mode="send" view={view()} people={people} onDone={() => {}} onClose={() => {}} />);
    expect(send).toContain("Send to…");
    expect(send).toContain("Paint");
    const ask = render(<PeopleAmountSheet mode="request" view={view()} people={[]} onDone={() => {}} onClose={() => {}} />);
    expect(ask).toContain("Ask…");
    expect(ask).toContain("Nobody else is here yet.");

    const trade = render(<OfferSheet view={view()} people={people} codex={[{ id: "e1", title: "The Lease" }]} onDone={() => {}} onClose={() => {}} />);
    expect(trade).toContain("Trade a fact");
    expect(trade).toContain("Sell one I hold");
    expect(trade).toContain("The Lease");
    const noLore = render(<OfferSheet view={view()} people={people} codex={[]} onDone={() => {}} onClose={() => {}} />);
    expect(noLore).toContain("You hold no entries to sell.");

    const stim = render(<StimulusSheet view={view({ minter: { uses: 2, limit: 3 } })} onDone={() => {}} onClose={() => {}} />);
    expect(stim).toContain("1 use left tonight");
    expect(stim).toContain("Pay everyone");
    const spent = render(<StimulusSheet view={view({ minter: { uses: 3, limit: 3 } })} onDone={() => {}} onClose={() => {}} />);
    expect(spent).toContain("No stimulus left tonight.");
    expect(spent).not.toContain("Pay everyone");
  });
});

describe("the Wallet room in the sidebars (wiring)", () => {
  function guestView(extra: Partial<GuestView> = {}): GuestView {
    return {
      id: "me",
      name: "Me",
      role: null,
      faction: null,
      score: 0,
      location: null,
      captured: false,
      pendingChoice: null,
      decisionChannel: null,
      channels: [],
      spaces: [],
      roster: [],
      codex: [],
      codexTotal: 3,
      quests: [],
      questTotal: 2,
      ...extra,
    };
  }
  function primeView(extra: Partial<PrimeView> = {}): PrimeView {
    return { character: "Auditor", faction: null, guests: [], channels: [], spaces: [], codex: [], codexTotal: 3, quests: [], questTotal: 2, ...extra } as PrimeView;
  }
  const walletMsg = (seq: number, c: WalletCard, audience: string[], parentSeq: number | null = null): ChatMessage =>
    ({ seq, channel: WALLET_ROOM, channelKind: "wallet", title: "Wallet", from: "", kind: "wallet", text: `card ${c.id}`, ts: seq, audience, parentSeq, hidden: false, wallet: c });

  it("is a pinned room (the server's twin), excluded from the personal stream", () => {
    expect(isPinnedRoom("wallet")).toBe(true);
    expect(channelHead(WALLET_ROOM)).toEqual({ kind: "wallet", title: "Wallet" });
    const messages = new Map<number, ChatMessage>([
      [1, walletMsg(1, card(), ["me"])],
      [2, { ...walletMsg(2, card(), ["me"]), channel: "lobby", channelKind: "lobby", kind: "line", text: "hi" }],
    ]);
    expect(personalStream(messages, "me").map((m) => m.seq)).toEqual([2]);
  });

  it("the guest's sidebar pins the Wallet above the Quest Log only when the story has a currency, tagged for the tour", () => {
    const none = buildGuestChannels(new Map(), null, guestView());
    expect(none.find((c) => c.id === WALLET_ROOM)).toBeUndefined();
    expect(none.map((c) => c.id)).toEqual(expect.arrayContaining(["codex", "quests"]));

    const w = view({ requests: [{ id: "r1", from: "g2", fromName: "Paint", to: "me", toName: "Me", amount: 5, state: "open", expiresAt: 9000, at: 1 }] });
    const list = buildGuestChannels(new Map([[1, walletMsg(1, card({ kind: "request", id: "r1", step: "asked", from: "g2", fromName: "Paint", to: "me", toName: "Me" }), ["me"])]]), null, guestView({ wallet: w }));
    const room = list.find((c) => c.id === WALLET_ROOM)!;
    expect(room).toMatchObject({ kind: "wallet", title: "Wallet", spaceId: "pinned", order: -1, canPost: false, threadable: true, tour: "wallet", needsYou: true });
    expect(room.subtitle).toBe("🪙 120 Truthcoin · 1 pending");
    expect(room.messages.map((m) => m.seq)).toEqual([1]);
    const quests = list.find((c) => c.id === "quests")!;
    expect(room.order!).toBeLessThan(quests.order!);
    // Nothing waiting on me → no needsYou; an empty wallet still pins the room.
    expect(buildGuestChannels(new Map(), null, guestView({ wallet: view() })).find((c) => c.id === WALLET_ROOM)).toMatchObject({ needsYou: false, subtitle: "🪙 120 Truthcoin" });
  });

  it("the booth's sidebar pins the Wallet (its `@<me>` cards) only for the approver's view", () => {
    const messages = new Map<number, ChatMessage>([
      [1, walletMsg(1, card({ kind: "approval", step: "held" }), ["@Auditor"])],
      [2, walletMsg(2, card({ kind: "approval", step: "settled" }), ["@Auditor"], 1)],
      [3, walletMsg(3, card({ kind: "approval", step: "held", id: "t2" }), ["@Clerk"])],
    ]);
    expect(buildPrimeChannels(messages, primeView()).find((c) => c.id === WALLET_ROOM)).toBeUndefined();
    const q: WalletQueueView = { name: "Truthcoin", queue: [tx({ state: "held" })], every: 3, windowMs: 60_000 };
    const list = buildPrimeChannels(messages, primeView({ wallet: q }));
    const room = list.find((c) => c.id === WALLET_ROOM)!;
    expect(room).toMatchObject({ kind: "wallet", title: "Wallet", spaceId: "booth", order: -1, canPost: false, threadable: true, needsYou: true, subtitle: "1 awaiting approval" });
    expect(room.messages.map((m) => m.seq)).toEqual([1, 2]); // never the Clerk's
    // Pinned with the booth's Quest Log + Codex, right after the Scanner / Inbox / feed, before the rooms.
    expect(list.slice(0, 6).map((c) => c.id)).toEqual(expect.arrayContaining(["__scanner", INBOX, "__feed", "quests", "codex", WALLET_ROOM]));
    expect(buildPrimeChannels(messages, primeView({ wallet: { ...q, queue: [] } })).find((c) => c.id === WALLET_ROOM)).toMatchObject({ needsYou: false, subtitle: "nothing to approve" });
  });
});
