//! The 💰 wallet: the pure helpers behind the Wallet room (summary, needs-you,
//! amount parsing, the per-card buttons read from the live view) and the
//! cards + sheets rendered to static markup — the phone's and the booth's
//! view of one transfer, request, offer and stimulus.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BalancePill,
  FreezeSheet,
  OfferSheet,
  PeopleAmountSheet,
  StimulusSheet,
  WALLET_RESTRICTED_NOTE,
  WalletActionsProvider,
  WalletCardView,
  WalletFooter,
  approvalBadge,
  frozenNote,
  frozenUntil,
  buyChoice,
  guestWalletActions,
  heldDeadline,
  liveClock,
  mmss,
  parseAmount,
  queueSummary,
  secondsLeft,
  sellChoice,
  walletButtonsFor,
  walletCardTitle,
  walletFooterActions,
  walletGlyph,
  lastWalletStep,
  walletFootLine,
  walletItemState,
  walletNeedsYou,
  walletStateLine,
  walletStepLine,
  walletSummary,
  walletTicking,
} from "../src/wallet.tsx";
import type { ChatMessage, GuestView, PrimeView, WalletCard, WalletQueueView, WalletTxView, WalletView } from "../src/types.ts";
import { MessageGroup, PickerSheet } from "../src/chat.tsx";
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

describe("wave 5: the guest approver, selling by id, restriction, the held countdown", () => {
  it("the phone's actions carry approve / deny for a guest-program approver (D1)", () => {
    const calls: string[] = [];
    const rec = (name: string) => (id: string, extra?: boolean) => {
      calls.push(extra === undefined ? `${name} ${id}` : `${name} ${id} ${extra}`);
      return Promise.resolve(null);
    };
    const a = guestWalletActions(view(), "me", 1000, false, {
      respond: rec("respond"),
      accept: rec("accept"),
      decline: rec("decline"),
      cancel: rec("cancel"),
      approve: rec("approve"),
      deny: rec("deny"),
    });
    a.approve!("t1");
    a.deny!("t2");
    a.respond!("r1", true);
    a.cancel!("t3");
    expect(calls).toEqual(["approve t1", "deny t2", "respond r1 true", "cancel t3"]);
    expect(a).toMatchObject({ me: "me", clock: 1000, restricted: false });
    // …and the held approval card in that guest's Wallet renders the buttons.
    const held = card({ kind: "approval", step: "held" });
    const html = render(
      <WalletActionsProvider value={{ ...a, view: view({ approver: { queue: [tx({ state: "held" })] } }) }}>
        <WalletCardView msg={msg(held)} card={held} />
      </WalletActionsProvider>,
    );
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Deny<");
  });

  it("a sale posts the held entry's id and shows its title; a buy posts what was typed (D2)", () => {
    expect(sellChoice({ id: "LiveJournal", title: "Trabolta's LiveJournal (trabolta_4ever)" })).toEqual({ entry: "LiveJournal", title: "Trabolta's LiveJournal (trabolta_4ever)" });
    expect(buyChoice("  truth.txt ")).toEqual({ entry: "truth.txt", title: "truth.txt" });
    const trade = render(<OfferSheet view={view()} people={[{ id: "g2", name: "Paint" }]} codex={[{ id: "Jeeves_01", title: "JEEVES.IDX — fragment 01" }]} onDone={() => {}} onClose={() => {}} />);
    expect(trade).toContain("JEEVES.IDX — fragment 01");
  });

  it("a restricted guest loses Pay / Decline a request and Accept an offer, keeps Decline an offer and Cancel (D3)", () => {
    const req = { id: "r1", from: "g2", fromName: "Paint", to: "me", toName: "Winamp", amount: 5, state: "open" as const, expiresAt: 0, at: 0 };
    const offer = { id: "o1", from: "g2", fromName: "Paint", to: "me", toName: "Winamp", side: "buy" as const, entry: "e", entryTitle: "E", amount: 5, state: "open" as const, expiresAt: 0, at: 0 };
    const asked = card({ kind: "request", id: "r1", step: "asked", from: "g2", to: "me" });
    expect(walletButtonsFor(asked, view({ requests: [req] }), "me", true)).toEqual([]);
    const offered = card({ kind: "offer", id: "o1", step: "offered", from: "g2", to: "me", side: "buy" });
    expect(walletButtonsFor(offered, view({ offers: [offer] }), "me", true)).toEqual(["declineOffer"]);
    const mine = card({ kind: "offer", id: "o1", step: "sent", from: "me", to: "g2", side: "sell" });
    expect(walletButtonsFor(mine, view({ offers: [{ ...offer, from: "me", to: "g2" }] }), "me", true)).toEqual(["cancel"]);
    expect(walletButtonsFor(card({ step: "held" }), view({ transfers: [tx({ state: "held" })] }), "me", true)).toEqual(["cancel"]);
    // Unrestricted is unchanged.
    expect(walletButtonsFor(asked, view({ requests: [req] }), "me")).toEqual(["pay", "declineRequest"]);

    // The footer: no Send / Request / Trade / Stimulus, the ⛔ note instead.
    expect(walletFooterActions(view({ minter: { uses: 0, limit: 3 } }), () => {}, true)).toEqual([]);
    const foot = render(<WalletFooter view={view()} open={() => {}} restricted />);
    expect(foot).toContain("⛔ You&#x27;re restricted");
    expect(WALLET_RESTRICTED_NOTE).toContain("can't send, request or trade");
    expect(foot).not.toContain("Send");
    expect(render(<WalletFooter view={view()} open={() => {}} />)).toContain("💸 Send");

    // A rendered card asked of a restricted guest shows no Pay.
    const html = render(
      <WalletActionsProvider value={{ view: view({ requests: [req] }), me: "me", clock: 0, restricted: true }}>
        <WalletCardView msg={msg(asked)} card={asked} />
      </WalletActionsProvider>,
    );
    expect(html).not.toContain(">Pay<");
  });

  it("a held transfer counts down to its auto-approval in m:ss, read from the view (D4)", () => {
    expect(mmss(300)).toBe("5:00");
    expect(mmss(65)).toBe("1:05");
    expect(mmss(0)).toBe("0:00");
    const heldCard = card({ step: "held", settleAt: undefined });
    const v = view({ transfers: [tx({ state: "held", settleAt: 301_000 })] });
    expect(heldDeadline(v, heldCard)).toBe(301_000);
    expect(heldDeadline(view(), card({ step: "held", settleAt: 5000 }))).toBe(5000); // falls back to the card
    expect(walletStateLine(heldCard, "held", v, 1000)).toBe("auto-approves in 5:00");
    expect(walletStateLine(heldCard, "held", v, 236_000)).toBe("auto-approves in 1:05");
    expect(walletStateLine(heldCard, "held", v, 400_000)).toBe("held"); // past due: the sweep is coming
    expect(walletStateLine(card({ step: "held", settleAt: undefined }), "held", view({ transfers: [tx({ state: "held", settleAt: null })] }), 0)).toBe("held"); // an old book: no deadline
    // The booth's approval card reads the queue.
    const q: WalletQueueView = { name: "Truthcoin", queue: [tx({ state: "held", settleAt: 121_000 })], every: 3, windowMs: 60_000 };
    const booth = render(
      <WalletActionsProvider value={{ view: q, me: null, clock: 1000 }}>
        <WalletCardView msg={msg(card({ kind: "approval", step: "held" }))} card={card({ kind: "approval", step: "held" })} />
      </WalletActionsProvider>,
    );
    expect(booth).toContain("auto-approves in 2:00");
    // The other countdowns are unchanged.
    expect(walletStateLine(card(), "pending", view({ transfers: [tx()] }), 1000)).toBe("settles in 60 s");
    expect(walletStateLine(card({ kind: "request", step: "asked", settleAt: 601_000 }), "open", null, 1000)).toBe("expires in 600 s");
    expect(walletStateLine(card(), null, null, 0)).toBe("closed");
    expect(walletStepLine(card({ step: "timed_out" }))).toBe("✅ Approved automatically — nobody audited it in time");
  });
});

describe("A9: the minter's reserve — 🎁 grant, 🧊 freeze, a frozen wallet", () => {
  const freezeView = { id: "f1", target: "g2", targetName: "Paint", by: "me", until: 601_000, at: 1000 };
  function minter(extra: Partial<NonNullable<WalletView["minter"]>> = {}): NonNullable<WalletView["minter"]> {
    return { uses: 0, limit: 3, grants: { uses: 1, limit: 3 }, freezeMs: 600_000, frozen: [], ...extra };
  }

  it("the minter's footer adds 🎁 Grant (N left) and 🧊 Freeze; an old server's minter (no grants) keeps the old footer", () => {
    const opened: string[] = [];
    const acts = walletFooterActions(view({ minter: minter() }), (s) => opened.push(s));
    expect(acts.map((a) => a.label)).toEqual(["💸 Send", "🙏 Request", "💱 Trade a fact", "💰 Stimulus (3 left)", "🎁 Grant (2 left)", "🧊 Freeze"]);
    acts[4]!.onClick();
    acts[5]!.onClick();
    expect(opened).toEqual(["grant", "freeze"]);
    expect(walletFooterActions(view({ minter: minter({ grants: { uses: 3, limit: 3 } }) }), () => {}).at(-2)!.label).toBe("🎁 Grant (none left)");
    expect(walletFooterActions(view({ minter: { uses: 0, limit: 3 } }), () => {}).map((a) => a.label)).not.toContain("🧊 Freeze");
    expect(walletFooterActions(view({ minter: minter() }), () => {}, true)).toEqual([]); // restricted: the ⛔ note instead
  });

  it("a frozen wallet: Send greyed, a 🧊 note with the countdown, the pill says so — and it thaws on the story clock", () => {
    const frozen = view({ frozenUntil: 601_000 });
    expect(frozenUntil(frozen, 1000)).toBe(601_000);
    expect(frozenUntil(frozen, 601_000)).toBeNull(); // past the deadline before the sweep lands
    expect(frozenUntil(view(), 1000)).toBeNull();
    expect(frozenUntil(null, 0)).toBeNull();
    const acts = walletFooterActions(frozen, () => {}, false, 1000);
    expect(acts.find((a) => a.label === "💸 Send")!.disabled).toBe(true);
    expect(acts.find((a) => a.label === "🙏 Request")!.disabled).toBeUndefined(); // asking still works
    expect(acts.find((a) => a.label === "💱 Trade a fact")!.disabled).toBeUndefined(); // selling still works
    expect(walletFooterActions(frozen, () => {}, false, 700_000).find((a) => a.label === "💸 Send")!.disabled).toBeUndefined();
    expect(frozenNote(frozen, 1000)).toBe("🧊 Your Truthcoin is frozen — it thaws in 10:00. You can't send, pay or buy, but coin still comes in.");
    expect(frozenNote(view(), 1000)).toBeNull();
    const footer = render(<WalletFooter view={frozen} open={() => {}} clock={1000} />);
    expect(footer).toContain("thaws in 10:00");
    expect(footer).toMatch(/disabled="">💸 Send/u);
    expect(render(<BalancePill view={frozen} onOpen={() => {}} />)).toContain("🧊 frozen");
    expect(render(<BalancePill view={view()} onOpen={() => {}} />)).not.toContain("frozen");
    // Buying is off in the trade sheet; selling stays.
    const trade = render(<OfferSheet view={frozen} people={[]} codex={[{ id: "e1", title: "The Lease" }]} onDone={() => {}} onClose={() => {}} frozen />);
    expect(trade).toMatch(/disabled="">Buy one by title/u);
    expect(trade).toContain("you can sell, not buy");
  });

  it("the countdowns tick between snapshots: the snapshot clock plus the wall time since it arrived", () => {
    // A quiet stretch: the last snapshot said story 1000 ms, at wall 50_000.
    expect(liveClock(1000, 50_000, 50_000)).toBe(1000);
    expect(liveClock(1000, 50_000, 98_000)).toBe(49_000);
    expect(liveClock(1000, 50_000, 40_000)).toBe(1000); // a wall clock behind the arrival never runs it back
    const frozen = view({ frozenUntil: 601_000 });
    expect(frozenNote(frozen, liveClock(1000, 50_000, 98_000))).toContain("thaws in 9:12");
    // Only a running deadline makes the phone tick.
    expect(walletTicking(frozen)).toBe(true);
    expect(walletTicking(view({ minter: { uses: 0, limit: 3, grants: { uses: 0, limit: 3 }, freezeMs: 600_000, frozen: [{ id: "f1", target: "g2", targetName: "Paint", by: "me", until: 601_000, at: 1000 }] } }))).toBe(true);
    expect(walletTicking(view({ transfers: [tx()] }))).toBe(true);
    expect(walletTicking(view({ transfers: [tx({ state: "settled" })] }))).toBe(false);
    expect(walletTicking(view({ requests: [{ id: "r1", from: "g2", fromName: "Paint", to: "me", toName: "Winamp", amount: 5, state: "open", expiresAt: 9e9, at: 0 }] }))).toBe(true);
    expect(walletTicking(view())).toBe(false);
    expect(walletTicking(undefined)).toBe(false);
  });

  it("the approver booth's queue countdown ticks between snapshots too (issue 9)", () => {
    // The booth's view is the queue (`PrimeView.wallet`), not a guest wallet.
    const q: WalletQueueView = { name: "Truthcoin", queue: [tx({ state: "held", settleAt: 61_000 })], every: 3, windowMs: 60_000 };
    expect(walletTicking(q)).toBe(true);
    expect(walletTicking({ ...q, queue: [] })).toBe(false);
    const held = card({ kind: "approval", step: "held", settleAt: undefined });
    // Snapshot at story 1000 ms (wall 50_000); 20 s of quiet later the line has moved on.
    expect(walletStateLine(held, "held", q, liveClock(1000, 50_000, 50_000))).toBe("auto-approves in 1:00");
    expect(walletStateLine(held, "held", q, liveClock(1000, 50_000, 70_000))).toBe("auto-approves in 0:40");
    // The booth feeds its cards that ticking clock, not the raw snapshot's.
    const booth = readFileSync(new URL("../src/performer.tsx", import.meta.url), "utf8");
    expect(booth).toContain("useWalletClock(s.view?.clock, s.view?.wallet)");
    expect(booth).toContain("clock: walletClock");
  });

  it("a frozen viewer can't Pay a request or Accept a sell offer; declining and accepting a buy offer (coin in) stay", () => {
    const req = card({ kind: "request", id: "r1", step: "asked", from: "g2", to: "me" });
    const reqView = view({ requests: [{ id: "r1", from: "g2", fromName: "Paint", to: "me", toName: "Winamp", amount: 50, state: "open", expiresAt: 9e9, at: 0 }] });
    expect(walletButtonsFor(req, reqView, "me", false, true)).toEqual(["declineRequest"]);
    expect(walletButtonsFor(req, reqView, "me")).toEqual(["pay", "declineRequest"]);
    const offer = (side: "buy" | "sell") => ({
      c: card({ kind: "offer", id: "o1", step: "offered", from: "g2", to: "me", side }),
      v: view({ offers: [{ id: "o1", from: "g2", fromName: "Paint", to: "me", toName: "Winamp", side, entry: "e1", entryTitle: "The Lease", amount: 50, state: "open", expiresAt: 9e9, at: 0 }] }),
    });
    const sell = offer("sell");
    expect(walletButtonsFor(sell.c, sell.v, "me", false, true)).toEqual(["declineOffer"]);
    const buy = offer("buy");
    expect(walletButtonsFor(buy.c, buy.v, "me", false, true)).toEqual(["accept", "declineOffer"]);
    // The card reads the freeze off the provider's view + clock.
    const html = render(
      <WalletActionsProvider value={{ view: { ...reqView, frozenUntil: 601_000 }, me: "me", clock: 1000 }}>
        <WalletCardView msg={msg(req)} card={req} />
      </WalletActionsProvider>,
    );
    expect(html).not.toContain(">Pay<");
    expect(html).toContain(">Decline<");
  });

  it("grant and freeze cards: titles, glyphs, step lines and a live thaw countdown (no 0-coin amount on a freeze)", () => {
    const granted = card({ kind: "grant", id: "g1", step: "granted", settleAt: undefined });
    const gotIt = card({ kind: "grant", id: "g1", step: "received", from: "me", fromName: "Runescape", to: "g2", toName: "Paint", settleAt: undefined });
    expect(walletCardTitle(granted)).toBe("You granted Paint 50 Truthcoin");
    expect(walletCardTitle(gotIt)).toBe("Runescape granted you 50 Truthcoin");
    expect(walletGlyph(gotIt)).toBe("🎁");
    expect(walletStepLine(gotIt)).toBe("🎁 Runescape granted you 50 Truthcoin");
    expect(walletStateLine(granted, null, view(), 0)).toBe("from the reserve");

    const frozenCard = card({ kind: "freeze", id: "f1", step: "frozen", from: "me", fromName: "Runescape", to: "g2", toName: "Paint", amount: 0, settleAt: 601_000 });
    const imposed = card({ kind: "freeze", id: "f1", step: "imposed", amount: 0, settleAt: 601_000 });
    expect(walletCardTitle(frozenCard)).toBe("Runescape froze your Truthcoin");
    expect(walletCardTitle(imposed)).toBe("You froze Paint's Truthcoin");
    expect(walletGlyph(frozenCard)).toBe("🧊");
    // The target's card is live while their freeze is this one.
    const targetView = view({ frozenUntil: 601_000 });
    expect(walletItemState(targetView, frozenCard)).toBe("frozen");
    expect(walletStateLine(frozenCard, "frozen", targetView, 1000)).toBe("thaws in 10:00");
    expect(walletItemState(view(), frozenCard)).toBeNull();
    expect(walletStateLine(frozenCard, null, view(), 700_000)).toBe("thawed");
    // The minter's card is live while it is in her list of freezes in force.
    expect(walletItemState(view({ minter: minter({ frozen: [freezeView] }) }), imposed)).toBe("frozen");
    expect(walletItemState(view({ minter: minter() }), imposed)).toBeNull();
    // Thaw lines.
    expect(walletStepLine(card({ kind: "freeze", step: "thawed", amount: 0 }))).toBe("☀️ Thawed — your Truthcoin moves again");
    expect(walletStepLine(card({ kind: "freeze", step: "thawed", amount: 0, by: "Director" }))).toBe("☀️ Lifted early by Director — your Truthcoin moves again");
    expect(walletStepLine(card({ kind: "freeze", step: "expired", amount: 0 }))).toBe("☀️ The freeze on Paint is over");
    expect(walletGlyph(card({ kind: "freeze", step: "expired" }))).toBe("☀️");
    expect(walletStepLine(card({ kind: "freeze", step: "cancelled", amount: 0, by: "Director" }))).toBe("↩️ Lifted early by Director");
    expect(walletStepLine(card({ kind: "request", step: "expired" }))).toBe("⌛ Expired"); // unchanged for the rest
    // Rendered: the freeze shows its countdown, never "0 Truthcoin".
    const html = render(
      <WalletActionsProvider value={{ view: targetView, me: "g2", clock: 1000 }}>
        <WalletCardView msg={msg(frozenCard, { text: "" })} card={frozenCard} />
      </WalletActionsProvider>,
    );
    expect(html).toContain("Runescape froze your Truthcoin");
    expect(html).toContain("thaws in 10:00");
    expect(html).not.toContain("0 Truthcoin");
  });

  it("the grant sheet picks a program then an amount from the reserve; the freeze sheet marks who is already frozen", () => {
    const people = [
      { id: "g2", name: "Paint" },
      { id: "g3", name: "Winamp" },
    ];
    const grant = render(<PeopleAmountSheet mode="grant" view={view({ minter: minter() })} people={people} onDone={() => {}} onClose={() => {}} />);
    expect(grant).toContain("🎁 Grant to…");
    expect(grant).toContain("Paint");
    const spent = render(<PeopleAmountSheet mode="grant" view={view({ minter: minter({ grants: { uses: 3, limit: 3 } }) })} people={people} onDone={() => {}} onClose={() => {}} />);
    expect(spent).toContain("No grants left tonight.");
    const freeze = render(<FreezeSheet view={view({ minter: minter({ frozen: [freezeView] }) })} people={people} clock={1000} onDone={() => {}} onClose={() => {}} />);
    expect(freeze).toContain("🧊 Freeze whose coin?");
    expect(freeze).toContain("🧊 thaws in 10:00"); // Paint is frozen already
    expect(freeze.match(/thaws in/gu)?.length).toBe(1); // Winamp isn't
  });

  it("a multi-step sheet's person picker moves on instead of closing the sheet (keepOpen)", () => {
    // Sheet + PickerSheet are hook-free, so the element tree can be walked.
    type El = { type: unknown; props: { onClick?: () => void; children?: unknown } };
    const buttons = (node: unknown): El[] => {
      if (node === null || typeof node !== "object") return [];
      if (Array.isArray(node)) return node.flatMap(buttons);
      const el = node as El;
      const own = el.type === "button" ? [el] : [];
      const inner = typeof el.type === "function" ? buttons((el.type as (p: unknown) => unknown)(el.props)) : buttons(el.props?.children);
      return [...own, ...inner];
    };
    for (const keepOpen of [true, false]) {
      const picked: string[] = [];
      let closed = 0;
      const tree = PickerSheet({ title: "Send to…", items: [{ id: "g2", label: "Paint" }], onPick: (id) => picked.push(id), onClose: () => closed++, keepOpen });
      const pick = buttons(tree).find((b) => b.props.onClick !== undefined && (b.props as { className?: string }).className?.includes("pick"));
      pick!.props.onClick!();
      expect(picked).toEqual(["g2"]);
      expect(closed).toBe(keepOpen ? 0 : 1);
    }
  });
});

describe("a wallet card opens its thread of updates (B8)", () => {
  const actions = (v: WalletView | WalletQueueView | null, me: string | null) => ({ view: v, me, clock: 5000 });
  const root = (c: WalletCard): ChatMessage => msg(c, { kind: "wallet", wallet: c, text: "— settles in 60 s unless CRA Agent Software denies it." });
  const step = (c: WalletCard, seq: number): ChatMessage => msg(c, { seq, kind: "wallet", wallet: c, parentSeq: 7, text: "" });

  it("the root plus one step draws `.wallet-foot .link` reading \"1 update ›\"", () => {
    const r = root(card());
    const denied = step(card({ step: "denied", by: "CRA_Agent_Software" }), 9);
    const html = render(
      <WalletActionsProvider value={actions(view(), "me")}>
        <MessageGroup run={{ from: "", kind: "wallet", messages: [r] }} allMessages={[r, denied]} onOpenThread={() => {}} />
      </WalletActionsProvider>,
    );
    expect(html).toMatch(/<div class="wallet-foot">.*<button class="link">1 update ›<\/button>/su);
    // Closed (gone from the view): the foot says how, not just "closed".
    expect(html).toContain("⛔ Denied by CRA Agent Software — refunded");
  });

  it("the booth's closed approval card reads its outcome", () => {
    const appr = card({ kind: "approval", step: "held", id: "t9" });
    const r = root(appr);
    const ok = step(card({ kind: "approval", step: "approved", id: "t9", by: "CRA_Agent_Software" }), 11);
    const q: WalletQueueView = { name: "Truthcoin", queue: [], every: 3, windowMs: 60_000 };
    const html = render(
      <WalletActionsProvider value={actions(q, null)}>
        <MessageGroup run={{ from: "", kind: "wallet", messages: [r] }} allMessages={[r, ok]} onOpenThread={() => {}} />
      </WalletActionsProvider>,
    );
    expect(html).toContain("✅ Approved by CRA Agent Software");
    expect(html).toContain("1 update ›");
  });

  it("the newest step wins; a live item keeps its state line", () => {
    const list = [root(card()), step(card({ step: "approved" }), 9), step(card({ step: "settled" }), 10), msg(card(), { seq: 12 })];
    expect(lastWalletStep(list, 7)?.step).toBe("settled");
    expect(lastWalletStep(list, 99)).toBeNull();
    expect(walletFootLine(card(), "pending", view({ transfers: [tx()] }), 1000, card({ step: "settled" }))).toBe("settles in 60 s");
    expect(walletFootLine(card(), null, null, 1000, null)).toBe("closed");
  });
});

describe("a denied or cancelled transfer stops counting down (B9)", () => {
  it("reads its state at once, not the old deny window", () => {
    expect(walletStateLine(card(), "denied", view({ transfers: [tx({ state: "denied" })] }), 5000)).toBe("denied");
    expect(walletStateLine(card(), "cancelled", view({ transfers: [tx({ state: "cancelled" })] }), 5000)).toBe("cancelled");
    expect(walletStateLine(card(), "settled", view({ transfers: [tx({ state: "settled" })] }), 5000)).toBe("settled");
    // Still pending: the countdown.
    expect(walletStateLine(card(), "pending", view({ transfers: [tx()] }), 5000)).toBe("settles in 56 s");
    // A request only counts down while open.
    const asked = card({ kind: "request", id: "r1", step: "asked", settleAt: 601_000 });
    expect(walletStateLine(asked, "open", view(), 1000)).toBe("expires in 600 s");
    expect(walletStateLine(asked, "paying", view(), 1000)).toBe("paying");
  });
});
