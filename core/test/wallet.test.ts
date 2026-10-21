//! The wallet book (`server/wallet.ts`): a story's currency in flight — the
//! settle window, the approver's every-Nth hold, requests with an expiry,
//! escrowed codex offers, the minter's stimulus — driven through a fake
//! seam with an injected story clock, and replayed op for op into a fresh
//! book to prove the journal reproduces every balance and open item. Plus
//! the story-side grammar: the `currency:` header and the `wallet:` role.

import { describe, expect, it } from "vitest";

import { Sim, compileFromSource } from "../src/runtime/sim/index.ts";
import { parseCurrency, walletRoleOf, type CurrencyDef } from "../src/runtime/sim/model.ts";
import type { SimEvent } from "../src/runtime/sim/event.ts";
import { guestPickable, identityDefs, isSpecial } from "../server/identity.ts";
import { WalletBook, DIRECTOR, HOLD_MS, possessive, walletLine, walletSeam, type WalletEvent, type WalletOp, type WalletSeam } from "../server/wallet.ts";

// --- a fake seam -----------------------------------------------------------------

type Signal = [string, string, Record<string, string | number | boolean>];

interface Fake {
  seam: WalletSeam;
  clock: { now: number };
  balances: Map<string, number>;
  codex: Map<string, Set<string>>;
  signals: Signal[];
  cleared: Set<string>;
  parts: Set<string>;
  /** `<id>.escrowed` as the story was told it. */
  escrowed: Map<string, number>;
  /** Every balance / escrow write in order: [id, "score" | "escrowed", n]. */
  writes: Array<[string, string, number]>;
}

function fake(persons: Array<[string, string]>, opts: { parts?: string[]; codex?: Record<string, string[]> } = {}): Fake {
  const clock = { now: 0 };
  const balances = new Map<string, number>();
  const codex = new Map<string, Set<string>>();
  const signals: Signal[] = [];
  const cleared = new Set<string>();
  const parts = new Set(opts.parts ?? []);
  const escrowed = new Map<string, number>();
  const writes: Array<[string, string, number]> = [];
  const titles: Record<string, string> = { the_lease: "The Billboard Lease", the_file: "The Sandy File" };
  for (const [id] of persons) balances.set(id, 100);
  for (const [holder, entries] of Object.entries(opts.codex ?? {})) codex.set(holder, new Set(entries));
  const seam: WalletSeam = {
    elapsed: () => clock.now,
    scoreOf: (id) => balances.get(id) ?? 0,
    hasBalance: (id) => balances.has(id),
    setBalance: (id, n) => {
      balances.set(id, n);
      writes.push([id, "score", n]);
      return [{ type: "worldSet", path: `${id}.score`, value: String(n) } as SimEvent];
    },
    setEscrowed: (id, n) => {
      escrowed.set(id, n);
      writes.push([id, "escrowed", n]);
      return [{ type: "worldSet", path: `${id}.escrowed`, value: String(n) } as SimEvent];
    },
    share: (from, to, entry) => {
      if (!(codex.get(from)?.has(entry) ?? false)) return [];
      let set = codex.get(to);
      if (set === undefined) codex.set(to, (set = new Set()));
      set.add(entry);
      return [{ type: "signal", name: "share", subject: to } as SimEvent];
    },
    signal: (name, subject, args) => {
      signals.push([name, subject, args]);
      return [{ type: "signal", name, subject } as SimEvent];
    },
    persons: () => persons.map(([id, name]) => ({ id, name })),
    nameOf: (id) => persons.find(([p]) => p === id)?.[1] ?? id,
    holdsCodex: (id, entry) => codex.get(id)?.has(entry) ?? false,
    codexIdOf: (entry) => (entry in titles ? entry : (Object.entries(titles).find(([, t]) => t === entry)?.[0] ?? null)),
    codexTitle: (id) => titles[id] ?? id,
    holds: (cond, person) => (cond === "program.cleared == true" ? cleared.has(person) : false),
    isPart: (c) => parts.has(c),
    personNamed: (c) => persons.find(([, name]) => name === c)?.[0] ?? null,
  };
  return { seam, clock, balances, codex, signals, cleared, parts, escrowed, writes };
}

const COIN: CurrencyDef = {
  slot: "score",
  name: "Truthcoin",
  maxTransfer: 500,
  expiryMs: 600_000,
  approver: { id: "Auditor", every: 3, windowMs: 60_000 },
  minter: { id: "Mint", limit: 3, while: "program.cleared == true" },
};

const PEOPLE: Array<[string, string]> = [
  ["g1", "Winamp"],
  ["g2", "Paint"],
  ["g3", "Mint"],
  ["g4", "Solitaire"],
];

function cards(events: Array<SimEvent | WalletEvent>): WalletEvent[] {
  return events.filter((e): e is WalletEvent => e.type === "wallet");
}
function send(book: WalletBook, from: string, to: string, amount: number, at: number): WalletOp {
  return { op: "send", id: book.nextId("t"), from, to, amount, at, via: "send" };
}

describe("wallet book — transfers", () => {
  it("a send escrows at once, settles when the window elapses, and the receiver hears it then", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"] });
    const book = new WalletBook(COIN, f.seam);
    const ev = book.apply(send(book, "g1", "g2", 50, 1000));
    expect(f.balances.get("g1")).toBe(50);
    expect(f.balances.get("g2")).toBe(100); // not yet theirs
    const roots = cards(ev);
    expect(roots.map((c) => [c.to, c.card.kind, c.card.step, c.root])).toEqual([
      ["g1", "transfer", "pending", true],
      ["@Auditor", "approval", "pending", true],
    ]);
    expect(roots[0]!.card.settleAt).toBe(61_000);
    expect(roots[0]!.card.approver).toBe("Auditor");
    expect(f.signals).toEqual([["transfer_sent", "g1", { to: "g2", amount: 50, tx: "t1", state: "pending" }]]);
    expect(walletLine(roots[0]!.card, 1000)).toBe("💸 You sent 50 Truthcoin to Paint — settles in 60 s unless Auditor denies it.");

    expect(book.due(60_999)).toEqual([]);
    expect(book.due(61_000)).toEqual([{ op: "settle", id: "t1" }]);
    const settled = book.apply({ op: "settle", id: "t1" });
    expect(f.balances.get("g2")).toBe(150);
    expect(cards(settled).map((c) => [c.to, c.card.kind, c.card.step, c.root])).toEqual([
      ["g1", "transfer", "settled", false],
      ["@Auditor", "approval", "settled", false],
      ["g2", "transfer", "received", true],
    ]);
    expect(f.signals.at(-1)).toEqual(["transfer_received", "g2", { from: "g1", amount: 50, tx: "t1" }]);
    expect(book.due(999_999)).toEqual([]); // settled once
    const v = book.viewFor("g1");
    expect(v.balance).toBe(50);
    expect(v.escrowed).toBe(0);
    expect(v.transfers.map((t) => t.state)).toEqual(["settled"]);
  });

  it("every third transfer is held for the approver; approve settles, deny refunds, cancel refunds", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"] });
    const book = new WalletBook(COIN, f.seam);
    book.apply(send(book, "g1", "g2", 10, 0));
    book.apply(send(book, "g2", "g1", 10, 0));
    const held = book.apply(send(book, "g4", "g2", 30, 0));
    expect(cards(held).map((c) => [c.to, c.card.step, c.root])).toEqual([
      ["g4", "held", true],
      ["@Auditor", "held", true],
      ["g2", "flagged", true], // wave 18b: the recipient's flagged thread
    ]);
    expect(f.signals.slice(-2).map((s) => s[0])).toEqual(["transfer_sent", "transfer_held"]);
    expect(f.balances.get("g4")).toBe(70);
    expect(book.queueFor("Auditor")!.queue.map((t) => [t.id, t.state])).toEqual([
      ["t3", "held"],
      ["t1", "pending"],
      ["t2", "pending"],
    ]);
    expect(book.queueFor("Someone Else")).toBeNull();
    expect(book.due(60_000)).toEqual([
      { op: "settle", id: "t1" },
      { op: "settle", id: "t2" },
    ]); // never the held one
    expect(book.checkApprove("t3")).toBeNull();
    expect(book.checkApprove("t1")).toEqual({ status: 409, error: "not waiting for approval — it settles on its own" });
    const ok = book.apply({ op: "approve", id: "t3", by: "Auditor" });
    expect(f.balances.get("g2")).toBe(120);
    expect(cards(ok).map((c) => [c.to, c.card.step, c.card.by])).toEqual([
      ["g4", "approved", "Auditor"],
      ["@Auditor", "approved", "Auditor"],
      ["g2", "received", "Auditor"],
    ]);
    expect(cards(ok).find((c) => c.to === "g2")!.root).toBe(false); // into its flagged thread
    expect(f.signals.at(-1)).toEqual(["transfer_approved", "g4", { to: "g2", amount: 30, tx: "t3", by: "Auditor" }]);

    // The sixth is held too; deny it.
    book.apply(send(book, "g1", "g4", 5, 0));
    book.apply(send(book, "g1", "g4", 5, 0));
    const held2 = book.apply(send(book, "g1", "g4", 20, 0));
    expect(cards(held2)[0]!.card.step).toBe("held");
    const before = f.balances.get("g1")!;
    const denied = book.apply({ op: "deny", id: "t6", by: DIRECTOR });
    expect(f.balances.get("g1")).toBe(before + 20);
    expect(cards(denied).map((c) => [c.to, c.card.step, c.card.by, c.root])).toEqual([
      ["g1", "denied", "Director", false],
      ["@Auditor", "denied", "Director", false],
      ["g4", "denied", "Director", false],
    ]);
    expect(walletLine(cards(denied)[0]!.card)).toBe("⛔ Denied by Director: 20 Truthcoin to Solitaire. Refunded.");

    // The ninth: the sender cancels it.
    book.apply(send(book, "g2", "g1", 5, 0));
    book.apply(send(book, "g2", "g1", 5, 0));
    book.apply(send(book, "g2", "g1", 40, 0));
    expect(book.checkCancel("t9", "g1")).toEqual({ status: 404, error: "no such transfer for you" });
    expect(book.checkCancel("t9", "g2")).toBeNull();
    const b2 = f.balances.get("g2")!;
    const cancelled = book.apply({ op: "cancel", id: "t9", by: "g2" });
    expect(f.balances.get("g2")).toBe(b2 + 40);
    expect(cards(cancelled).map((c) => [c.to, c.card.step])).toEqual([
      ["g2", "cancelled"],
      ["@Auditor", "cancelled"],
      ["g1", "cancelled"],
    ]);
    expect(f.signals.at(-1)![0]).toBe("transfer_cancelled");
    expect(book.checkCancel("t9", "g2")).toEqual({ status: 409, error: "already settled" });
    // A pending transfer: only a director may cancel it.
    expect(book.checkCancel("t7", "g2")).toEqual({ status: 409, error: "already settled" });
    expect(book.checkCancel("t7", DIRECTOR, true)).toBeNull();
  });

  it("a held transfer nobody answers settles itself after HOLD_MS: timed_out, no transfer_approved; replay agrees", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"] });
    const book = new WalletBook(COIN, f.seam);
    const journal: WalletOp[] = [];
    const run = (op: WalletOp): Array<SimEvent | WalletEvent> => {
      journal.push(op);
      return book.apply(op);
    };
    run(send(book, "g1", "g2", 10, 0));
    run(send(book, "g2", "g1", 10, 0));
    const held = run(send(book, "g4", "g2", 30, 1000)); // t3 held
    expect(cards(held).map((c) => [c.to, c.card.step, c.card.settleAt])).toEqual([
      ["g4", "held", 1000 + HOLD_MS],
      ["@Auditor", "held", 1000 + HOLD_MS],
      ["g2", "flagged", 1000 + HOLD_MS],
    ]);
    expect(walletLine(cards(held)[0]!.card, 1000)).toBe("🚩 Flagged for an audit: 30 Truthcoin to Paint must be approved by Auditor — it goes through on its own in 5 min.");
    expect(walletLine(cards(held)[1]!.card, HOLD_MS - 29_000)).toBe("🚩 Flagged for an audit: Solitaire → Paint: 30 Truthcoin. Waiting for your approval — it goes through on its own in 30 s.");
    expect(walletLine(cards(held)[2]!.card, 1000, "g2")).toBe("🚩 Flagged for an audit: Solitaire is sending you 30 Truthcoin. It must be approved by Auditor first — it goes through on its own in 5 min.");
    expect(book.viewFor("g4").transfers[0]).toMatchObject({ id: "t3", state: "held", settleAt: 1000 + HOLD_MS });
    for (const op of book.due(60_000)) run(op); // t1 + t2 settle; t3 still held
    expect(book.heldIds()).toEqual(["t3"]);
    expect(book.due(HOLD_MS + 999)).toEqual([]);
    expect(book.due(HOLD_MS + 1000)).toEqual([{ op: "settle", id: "t3" }]);
    const before = f.balances.get("g2")!;
    const timed = run({ op: "settle", id: "t3" });
    expect(f.balances.get("g2")).toBe(before + 30);
    expect(cards(timed).map((c) => [c.to, c.card.step, c.card.by])).toEqual([
      ["g4", "timed_out", undefined],
      ["@Auditor", "timed_out", undefined],
      ["g2", "received", undefined],
    ]);
    expect(walletLine(cards(timed)[0]!.card)).toBe("✅ Approved automatically: 30 Truthcoin to Paint.");
    expect(walletLine(cards(timed)[1]!.card)).toBe("⌛ Timed out — approved automatically: Solitaire → Paint, 30 Truthcoin.");
    expect(f.signals.map((s) => s[0])).not.toContain("transfer_approved"); // The Audit never credits a timeout
    expect(book.heldIds()).toEqual([]);
    expect(book.due(HOLD_MS * 2)).toEqual([]);

    const g = fake(PEOPLE, { parts: ["Auditor"] });
    const fresh = new WalletBook(COIN, g.seam);
    for (const op of journal) fresh.apply(op);
    expect([...g.balances.entries()]).toEqual([...f.balances.entries()]);
    expect(JSON.stringify(fresh.modView())).toBe(JSON.stringify(book.modView()));
    expect(g.signals).toEqual(f.signals);
  });

  it("approve, deny or cancel before the hold deadline wins: nothing is left due", () => {
    for (const close of [
      (id: string): WalletOp => ({ op: "approve", id, by: "Auditor" }),
      (id: string): WalletOp => ({ op: "deny", id, by: "Auditor" }),
      (id: string): WalletOp => ({ op: "cancel", id, by: "g1" }),
    ]) {
      const f = fake(PEOPLE, { parts: ["Auditor"] });
      const book = new WalletBook(COIN, f.seam);
      book.apply(send(book, "g1", "g2", 10, 0));
      book.apply({ op: "settle", id: "t1" });
      book.apply(send(book, "g1", "g2", 10, 0));
      book.apply({ op: "settle", id: "t2" });
      book.apply(send(book, "g1", "g2", 10, 0)); // t3 held
      const done = book.apply(close("t3"));
      expect(cards(done).map((c) => c.card.step)).not.toContain("timed_out");
      expect(book.due(HOLD_MS * 2)).toEqual([]);
      expect(book.apply({ op: "settle", id: "t3" })).toEqual([]); // a stale settle is a no-op
    }
  });

  it("a deny inside the window refunds; after settlement it is refused", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"] });
    const book = new WalletBook(COIN, f.seam);
    book.apply(send(book, "g1", "g2", 50, 0));
    expect(book.checkDeny("t1")).toBeNull();
    book.apply({ op: "deny", id: "t1", by: "Auditor" });
    expect(f.balances.get("g1")).toBe(100);
    expect(f.balances.get("g2")).toBe(100);
    expect(book.due(60_000)).toEqual([]);
    expect(book.checkDeny("t1")).toEqual({ status: 409, error: "too late — already settled" });
    expect(book.checkDeny("t99")).toEqual({ status: 404, error: "no such transfer" });
    // A stale op is a no-op, never a throw (a torn journal line).
    expect(book.apply({ op: "settle", id: "t1" })).toEqual([]);
    expect(book.apply({ op: "deny", id: "t1", by: "Auditor" })).toEqual([]);
    expect(f.balances.get("g1")).toBe(100);
  });

  it("amounts are whole numbers 1..max; self, unknown and unfunded sends are refused with the right status", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"] });
    const book = new WalletBook(COIN, f.seam);
    const bad = { status: 400, error: "amount must be a whole number from 1 to 500" };
    expect(book.checkSend("g1", "g2", 0)).toEqual(bad);
    expect(book.checkSend("g1", "g2", 501)).toEqual(bad);
    expect(book.checkSend("g1", "g2", 2.5)).toEqual(bad);
    expect(book.checkSend("g1", "g2", Number.NaN)).toEqual(bad);
    expect(book.checkSend("g1", "nobody", 5)).toEqual({ status: 404, error: "unknown recipient" });
    expect(book.checkSend("g1", "g1", 5)).toEqual({ status: 409, error: "you can't send to yourself" });
    expect(book.checkSend("g1", "g2", 101)).toEqual({ status: 409, error: "insufficient funds" });
    expect(book.checkSend("g1", "g2", 100)).toBeNull();
  });

  it("without an approver every send settles inline", () => {
    const f = fake(PEOPLE);
    const book = new WalletBook({ ...COIN, approver: null }, f.seam);
    const ev = book.apply(send(book, "g1", "g2", 25, 0));
    expect(f.balances.get("g1")).toBe(75);
    expect(f.balances.get("g2")).toBe(125);
    expect(cards(ev).map((c) => [c.to, c.card.kind, c.card.step, c.root])).toEqual([
      ["g1", "transfer", "settled", true],
      ["g2", "transfer", "received", true],
    ]);
    expect(f.signals.map((s) => s[0])).toEqual(["transfer_sent", "transfer_received"]);
    expect(f.signals[0]![2]["state"]).toBe("settled");
    expect(book.due(1e9)).toEqual([]);
  });

  it("an approver declared as a guest program gets its cards on that phone and its queue in its own view", () => {
    const f = fake([...PEOPLE, ["g5", "Auditor"]]);
    const book = new WalletBook(COIN, f.seam);
    const ev = book.apply(send(book, "g1", "g2", 5, 0));
    expect(cards(ev)[1]!.to).toBe("g5");
    expect(book.isApprover("g5")).toBe(true);
    expect(book.isApprover("Auditor")).toBe(true);
    expect(book.isApprover("g1")).toBe(false);
    expect(book.viewFor("g5").approver!.queue.map((t) => t.id)).toEqual(["t1"]);
    expect(book.viewFor("g1").approver).toBeUndefined();
    // An approver nobody has claimed yet still addresses `@Auditor` (a booth, or nobody).
    const f2 = fake(PEOPLE);
    const book2 = new WalletBook(COIN, f2.seam);
    expect(cards(book2.apply(send(book2, "g1", "g2", 5, 0)))[1]!.to).toBe("@Auditor");
  });
});

describe("wallet book — requests", () => {
  it("a request asks the payer; accepting runs a send linked to it; declining and expiring tell the asker", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"] });
    const book = new WalletBook(COIN, f.seam);
    expect(book.checkRequest("g1", "g2", 40)).toBeNull();
    const ev = book.apply({ op: "request", id: book.nextId("r"), from: "g1", to: "g2", amount: 40, at: 1000 });
    expect(cards(ev).map((c) => [c.to, c.card.kind, c.card.step, c.root])).toEqual([
      ["g2", "request", "asked", true],
      ["g1", "request", "sent", true],
    ]);
    expect(walletLine(cards(ev)[0]!.card)).toBe("🙏 Winamp asks you for 40 Truthcoin.");
    expect(f.signals).toEqual([["request_sent", "g2", { from: "g1", amount: 40, request: "r1" }]]);
    expect(book.viewFor("g2").requests.map((r) => [r.id, r.state, r.expiresAt])).toEqual([["r1", "open", 601_000]]);

    expect(book.checkRespond("r1", "g1", true)).toEqual({ status: 404, error: "no such request for you" });
    expect(book.checkRespond("r1", "g2", true)).toBeNull();
    const paid = book.apply({ op: "respond", id: "r1", accept: true, tx: book.nextId("t"), at: 2000 });
    expect(f.balances.get("g2")).toBe(60);
    expect(cards(paid).map((c) => [c.to, c.card.kind, c.card.step])).toEqual([
      ["g2", "request", "accepted"],
      ["g2", "transfer", "pending"],
      ["@Auditor", "approval", "pending"],
    ]);
    expect(book.viewFor("g1").requests[0]!.state).toBe("paying");
    expect(book.due(62_000)).toEqual([{ op: "settle", id: "t2" }]);
    const settled = book.apply({ op: "settle", id: "t2" });
    expect(f.balances.get("g1")).toBe(140);
    expect(cards(settled).at(-1)).toMatchObject({ to: "g1", card: { kind: "request", step: "paid", id: "r1" } });
    // T5-07: the payer's thread closes too, and the line names both sides.
    expect(cards(settled).at(-2)).toMatchObject({ to: "g2", card: { kind: "request", step: "paid", id: "r1" } });
    expect(walletLine(cards(settled).at(-1)!.card)).toBe("✅ Paid: Paint sent Winamp 40 Truthcoin.");
    expect(book.viewFor("g1").requests).toEqual([]); // paid = closed
    expect(book.checkRespond("r1", "g2", false)).toEqual({ status: 409, error: "already settled" });

    // Decline.
    book.apply({ op: "request", id: book.nextId("r"), from: "g1", to: "g2", amount: 10, at: 3000 });
    const declined = book.apply({ op: "respond", id: "r3", accept: false, at: 3500 });
    expect(cards(declined).map((c) => [c.to, c.card.step])).toEqual([
      ["g2", "declined"],
      ["g1", "declined"],
    ]);
    expect(f.signals.at(-1)).toEqual(["request_declined", "g1", { to: "g2", amount: 10, request: "r3" }]);

    // Expire: 10 min after it was asked.
    book.apply({ op: "request", id: book.nextId("r"), from: "g1", to: "g2", amount: 10, at: 4000 });
    expect(book.due(603_999)).toEqual([]);
    expect(book.due(604_000)).toEqual([{ op: "expire", id: "r4" }]);
    const expired = book.apply({ op: "expire", id: "r4" });
    expect(cards(expired).map((c) => [c.to, c.card.step])).toEqual([
      ["g2", "expired"],
      ["g1", "expired"],
    ]);
    expect(f.signals.at(-1)![0]).toBe("request_expired");
    expect(book.due(1e9)).toEqual([]);

    // Cancel by the asker.
    book.apply({ op: "request", id: book.nextId("r"), from: "g1", to: "g2", amount: 10, at: 5000 });
    expect(book.checkCancel("r5", "g2")).toEqual({ status: 404, error: "no such request for you" });
    const cancelled = book.apply({ op: "cancel", id: "r5", by: "g1" });
    expect(cards(cancelled).map((c) => c.card.step)).toEqual(["cancelled", "cancelled"]);
    expect(f.signals.at(-1)![0]).toBe("request_cancelled");
  });

  it("a request's payment denied or cancelled closes both threads, not only the asker's (T5-07)", () => {
    for (const close of ["deny", "cancel"] as const) {
      const f = fake(PEOPLE, { parts: ["Auditor"] });
      const book = new WalletBook(COIN, f.seam);
      book.apply({ op: "request", id: "r1", from: "g1", to: "g2", amount: 40, at: 0 });
      book.apply({ op: "respond", id: "r1", accept: true, tx: "t2", at: 10 });
      const ev = book.apply(close === "deny" ? { op: "deny", id: "t2", by: "Auditor" } : { op: "cancel", id: "t2", by: "g2" });
      const step = close === "deny" ? "declined" : "cancelled";
      expect(cards(ev).filter((c) => c.card.kind === "request").map((c) => [c.to, c.card.step, c.card.id])).toEqual([
        ["g2", step, "r1"],
        ["g1", step, "r1"],
      ]);
      expect(f.balances.get("g2")).toBe(100); // refunded
    }
  });

  it("a request's closing step says who stopped the payment: the auditor's deny, the payer's cancel (T1-wallet-02, C6)", () => {
    // Denied by the auditor: both request cards carry `by` and read as a deny,
    // not as the payer's Decline.
    {
      const f = fake(PEOPLE, { parts: ["Auditor"] });
      const book = new WalletBook(COIN, f.seam);
      book.apply({ op: "request", id: "r1", from: "g1", to: "g2", amount: 3, at: 0 });
      book.apply({ op: "respond", id: "r1", accept: true, tx: "t2", at: 10 });
      const req = cards(book.apply({ op: "deny", id: "t2", by: "Auditor" })).filter((c) => c.card.kind === "request");
      expect(req.map((c) => [c.to, c.card.step, c.card.by])).toEqual([
        ["g2", "declined", "Auditor"],
        ["g1", "declined", "Auditor"],
      ]);
      const line = walletLine(req[1]!.card, undefined, req[1]!.to);
      expect(line).toBe("⛔ Auditor denied Paint's payment of 3 Truthcoin; refunded.");
      expect(line).not.toContain("Declined:");
      // The payer reads it as their own payment (T1 recheck).
      expect(walletLine(req[0]!.card, undefined, req[0]!.to)).toBe("⛔ Auditor denied your payment of 3 Truthcoin; refunded.");
    }
    // A director's deny names the Director; a character approver reads with spaces.
    {
      const f = fake(PEOPLE, { parts: ["CRA_Agent_Software"] });
      const book = new WalletBook({ ...COIN, approver: { id: "CRA_Agent_Software", every: 3, windowMs: 60_000 } }, f.seam);
      book.apply({ op: "request", id: "r1", from: "g1", to: "g2", amount: 3, at: 0 });
      book.apply({ op: "respond", id: "r1", accept: true, tx: "t2", at: 10 });
      const ev = cards(book.apply({ op: "deny", id: "t2", by: "CRA_Agent_Software" }));
      expect(ev.map((c) => c.card.by)).toEqual(["CRA Agent Software", "CRA Agent Software", "CRA Agent Software", "CRA Agent Software"]);
      expect(f.signals.find((s) => s[0] === "transfer_denied")![2].by).toBe("CRA_Agent_Software");
    }
    // Cancelled by the payer while held: names the payer, never "withdrew".
    {
      const f = fake(PEOPLE, { parts: ["Auditor"] });
      const book = new WalletBook(COIN, f.seam);
      book.apply(send(book, "g3", "g4", 1, 0));
      book.apply({ op: "request", id: book.nextId("r"), from: "g1", to: "g2", amount: 4, at: 0 });
      book.apply(send(book, "g3", "g4", 1, 0));
      expect(cards(book.apply({ op: "respond", id: "r2", accept: true, tx: "t4", at: 10 })).find((c) => c.card.kind === "transfer")!.card.step).toBe("held");
      const req = cards(book.apply({ op: "cancel", id: "t4", by: "g2" })).filter((c) => c.card.kind === "request");
      expect(req.map((c) => [c.to, c.card.step, c.card.by])).toEqual([
        ["g2", "cancelled", "Paint"],
        ["g1", "cancelled", "Paint"],
      ]);
      const line = walletLine(req[1]!.card, undefined, req[1]!.to);
      expect(line).toBe("↩️ Paint cancelled the payment of 4 Truthcoin.");
      expect(line).not.toContain("withdrew");
      expect(walletLine(req[0]!.card, undefined, req[0]!.to)).toBe("↩️ You cancelled the payment of 4 Truthcoin.");
      // A director's cancel: "your payment" to the payer, a possessive to the asker.
      const byDirector = { ...req[0]!.card, by: "Director" };
      expect(walletLine(byDirector, undefined, "g2")).toBe("↩️ Director cancelled your payment of 4 Truthcoin.");
      expect(walletLine(byDirector, undefined, "g1")).toBe("↩️ Director cancelled Paint's payment of 4 Truthcoin.");
      // A name ending in s takes the apostrophe alone.
      const dk = { ...req[0]!.card, toName: "DraftKings", by: "CRA Agent Software", step: "declined" as const };
      expect(walletLine(dk, undefined, "g1")).toBe("⛔ CRA Agent Software denied DraftKings' payment of 4 Truthcoin; refunded.");
      expect(walletLine(dk, undefined, "g2")).toBe("⛔ CRA Agent Software denied your payment of 4 Truthcoin; refunded.");
      expect(possessive("DraftKings")).toBe("DraftKings'");
      expect(possessive("Winamp")).toBe("Winamp's");
    }
    // The old meanings stay: the payer's own Decline, the asker's withdrawal.
    {
      const f = fake(PEOPLE, { parts: ["Auditor"] });
      const book = new WalletBook(COIN, f.seam);
      book.apply({ op: "request", id: "r1", from: "g1", to: "g2", amount: 5, at: 0 });
      const declined = cards(book.apply({ op: "respond", id: "r1", accept: false, at: 1 }));
      expect(declined.every((c) => c.card.by === undefined)).toBe(true);
      expect(walletLine(declined[0]!.card)).toBe("⛔ Declined: 5 Truthcoin from Paint.");
      expect(walletLine(declined[0]!.card, undefined, "g2")).toBe("⛔ You declined Winamp's request for 5 Truthcoin.");
      book.apply({ op: "request", id: "r2", from: "g1", to: "g2", amount: 6, at: 2 });
      const withdrawn = cards(book.apply({ op: "cancel", id: "r2", by: "g1" }));
      expect(withdrawn.every((c) => c.card.by === undefined)).toBe(true);
      expect(walletLine(withdrawn[0]!.card)).toBe("↩️ Winamp withdrew the request for 6 Truthcoin.");
      expect(withdrawn.every((c) => c.card.closedBy === undefined)).toBe(true);
      // A director closing an open request is named on both cards, never
      // read as the asker withdrawing it (server-b finding 4).
      book.apply({ op: "request", id: "r3", from: "g1", to: "g2", amount: 7, at: 3 });
      const closed = cards(book.apply({ op: "cancel", id: "r3", by: "Director" }));
      expect(closed.map((c) => [c.to, c.card.step, c.card.by, c.card.closedBy])).toEqual([
        ["g2", "cancelled", undefined, "Director"],
        ["g1", "cancelled", undefined, "Director"],
      ]);
      for (const c of closed) {
        expect(walletLine(c.card)).toBe("↩️ Director cancelled Winamp's request for 7 Truthcoin.");
        expect(walletLine(c.card)).not.toContain("withdrew");
      }
    }
  });

  it("a card's `by` is a display name, never a guest's person id; the signal keeps the id (T1-wallet-03)", () => {
    const f = fake([...PEOPLE, ["g-cdb857", "MS Paint"]], { parts: ["Auditor"] });
    const book = new WalletBook(COIN, f.seam);
    book.apply(send(book, "g-cdb857", "g1", 7, 0));
    book.apply(send(book, "g-cdb857", "g1", 7, 0));
    expect(cards(book.apply(send(book, "g-cdb857", "g1", 7, 0)))[0]!.card.step).toBe("held");
    const ev = cards(book.apply({ op: "cancel", id: "t3", by: "g-cdb857" }));
    expect(ev.map((c) => [c.card.kind, c.card.step, c.card.by])).toEqual([
      ["transfer", "cancelled", "MS Paint"],
      ["approval", "cancelled", "MS Paint"],
      ["transfer", "cancelled", "MS Paint"], // the recipient's flagged thread
    ]);
    expect(walletLine(ev[2]!.card, undefined, "g1")).toBe("↩️ MS Paint cancelled the 7 Truthcoin. It never reached you.");
    expect(f.signals.at(-1)).toEqual(["transfer_cancelled", "g-cdb857", { to: "g1", amount: 7, tx: "t3", by: "g-cdb857" }]);
    // A guest minter's grant cards name the program too.
    const granted = cards(book.apply({ op: "grant", id: book.nextId("g"), by: "g3", to: "g1", amount: 5, at: 1 }));
    expect(granted.map((c) => [c.to, c.card.step, c.card.by])).toEqual([
      ["g3", "granted", "Mint"],
      ["g1", "received", "Mint"],
    ]);
  });

  it("wave 18b (R13): the approver's `as` names it on every card, `audit` names the hold, and the recipient's thread closes", () => {
    const cra: CurrencyDef = { ...COIN, approver: { id: "CRA_Agent_Software", every: 3, windowMs: 60_000, as: "MyCRA", audit: "a CRA audit" } };
    const f = fake(PEOPLE, { parts: ["CRA_Agent_Software"] });
    const book = new WalletBook(cra, f.seam);
    book.apply(send(book, "g1", "g2", 1, 0));
    book.apply(send(book, "g1", "g2", 1, 0));
    const held = cards(book.apply(send(book, "g1", "g2", 10, 0)));
    expect(held.map((c) => [c.to, c.card.step, c.card.approver, c.card.audit])).toEqual([
      ["g1", "held", "MyCRA", "a CRA audit"],
      ["@CRA_Agent_Software", "held", "MyCRA", "a CRA audit"],
      ["g2", "flagged", "MyCRA", "a CRA audit"],
    ]);
    expect(walletLine(held[0]!.card, 0)).toBe("🚩 Flagged for a CRA audit: 10 Truthcoin to Paint must be approved by MyCRA — it goes through on its own in 5 min.");
    expect(walletLine(held[2]!.card, 0, "g2")).toBe("🚩 Flagged for a CRA audit: Winamp is sending you 10 Truthcoin. It must be approved by MyCRA first — it goes through on its own in 5 min.");
    // The booth denies: named MyCRA on the cards, the raw id in the signal.
    const denied = cards(book.apply({ op: "deny", id: "t3", by: "CRA_Agent_Software" }));
    expect(denied.map((c) => [c.to, c.card.by])).toEqual([
      ["g1", "MyCRA"],
      ["@CRA_Agent_Software", "MyCRA"],
      ["g2", "MyCRA"],
    ]);
    expect(walletLine(denied[2]!.card, 0, "g2")).toBe("⛔ Denied by MyCRA: Winamp's 10 Truthcoin never reached you.");
    expect(f.signals.at(-1)).toEqual(["transfer_denied", "g1", { to: "g2", amount: 10, tx: "t3", by: "CRA_Agent_Software" }]);
    // A pending (not held) transfer's recipient hears only its settle, as before.
    const pending = cards(book.apply(send(book, "g2", "g1", 1, 0)));
    expect(pending.map((c) => c.to)).toEqual(["g2", "@CRA_Agent_Software"]);
    expect(cards(book.apply({ op: "deny", id: "t4", by: "CRA_Agent_Software" })).map((c) => c.to)).toEqual(["g2", "@CRA_Agent_Software"]);
  });

  it("accepting a request you can no longer pay declines it inside apply, deterministically", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"] });
    const book = new WalletBook(COIN, f.seam);
    book.apply({ op: "request", id: "r1", from: "g1", to: "g2", amount: 90, at: 0 });
    f.balances.set("g2", 10); // the story took their coin meanwhile
    expect(book.checkRespond("r1", "g2", true)).toEqual({ status: 409, error: "insufficient funds" });
    const ev = book.apply({ op: "respond", id: "r1", accept: true, tx: "t1", at: 5 });
    expect(cards(ev).map((c) => c.card.step)).toEqual(["declined", "declined"]);
    expect(f.balances.get("g2")).toBe(10);
  });

  it("caps open outgoing requests at five", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"] });
    const book = new WalletBook(COIN, f.seam);
    for (let i = 0; i < 5; i++) book.apply({ op: "request", id: book.nextId("r"), from: "g1", to: "g2", amount: 1, at: 0 });
    expect(book.checkRequest("g1", "g2", 1)).toEqual({ status: 409, error: "too many open requests" });
    expect(book.checkRequest("g1", "g1", 1)).toEqual({ status: 409, error: "you can't ask yourself" });
    expect(book.checkRequest("g2", "g1", 1)).toBeNull();
  });
});

describe("wallet book — offers", () => {
  it("a buy offer escrows the buyer's coin and refunds on decline/expiry; accept shares the entry and pays the seller", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"], codex: { g2: ["the_lease"] } });
    const book = new WalletBook(COIN, f.seam);
    expect(book.checkOffer("g1", "g2", "buy", "The Billboard Lease", 50)).toBeNull();
    // An unknown entry gets the generic refusal; a buy never tests what the
    // seller holds (that would read another guest's secrets) — accept does.
    expect(book.checkOffer("g1", "g2", "buy", "No Such Thing", 50)).toEqual({ status: 409, error: "they don't have that to sell" });
    expect(book.checkOffer("g1", "g4", "buy", "The Billboard Lease", 50)).toBeNull();
    expect(book.checkOffer("g1", "g2", "buy", "The Billboard Lease", 101)).toEqual({ status: 409, error: "insufficient funds" });
    expect(book.entryIdOf("The Billboard Lease")).toBe("the_lease");
    const ev = book.apply({ op: "offer", id: book.nextId("o"), from: "g1", to: "g2", side: "buy", entry: "the_lease", amount: 50, at: 0 });
    expect(f.balances.get("g1")).toBe(50);
    expect(cards(ev).map((c) => [c.to, c.card.step, c.card.entryTitle, c.card.side])).toEqual([
      ["g2", "offered", "The Billboard Lease", "buy"],
      ["g1", "sent", "The Billboard Lease", "buy"],
    ]);
    expect(walletLine(cards(ev)[0]!.card)).toBe("💱 Winamp offers you 50 Truthcoin for “The Billboard Lease”.");
    expect(f.signals).toEqual([["offer_made", "g2", { from: "g1", amount: 50, entry: "the_lease", side: "buy" }]]);
    expect(book.viewFor("g1").escrowed).toBe(50);

    // Decline refunds.
    expect(book.checkDecline("o1", "g1")).toEqual({ status: 404, error: "no such offer for you" });
    expect(book.checkDecline("o1", "g2")).toBeNull();
    const declined = book.apply({ op: "decline", id: "o1" });
    expect(f.balances.get("g1")).toBe(100);
    expect(cards(declined).map((c) => c.card.step)).toEqual(["declined", "declined"]);
    expect(f.signals.at(-1)![0]).toBe("offer_declined");
    expect(book.checkAccept("o1", "g2")).toEqual({ status: 409, error: "already settled" });

    // Expiry refunds.
    book.apply({ op: "offer", id: book.nextId("o"), from: "g1", to: "g2", side: "buy", entry: "the_lease", amount: 50, at: 10 });
    expect(book.due(600_010)).toEqual([{ op: "expire", id: "o2" }]);
    book.apply({ op: "expire", id: "o2" });
    expect(f.balances.get("g1")).toBe(100);
    expect(f.signals.at(-1)![0]).toBe("offer_expired");

    // Accept shares + pays.
    book.apply({ op: "offer", id: book.nextId("o"), from: "g1", to: "g2", side: "buy", entry: "the_lease", amount: 50, at: 20 });
    const ok = book.apply({ op: "accept", id: "o3", at: 30 });
    expect(f.balances.get("g1")).toBe(50);
    expect(f.balances.get("g2")).toBe(150);
    expect(f.codex.get("g1")?.has("the_lease")).toBe(true);
    expect(cards(ok).map((c) => [c.to, c.card.step])).toEqual([
      ["g2", "accepted"],
      ["g1", "accepted"],
    ]);
    expect(f.signals.at(-1)).toEqual(["offer_accepted", "g1", { to: "g2", amount: 50, entry: "the_lease", side: "buy" }]);
    expect(book.viewFor("g1").offers).toEqual([]);
    expect(book.viewFor("g1").escrowed).toBe(0);

    // Accepting after the seller lost the entry (or the buyer got it elsewhere) fails safely + refunds.
    book.apply({ op: "offer", id: book.nextId("o"), from: "g4", to: "g2", side: "buy", entry: "the_lease", amount: 10, at: 40 });
    f.codex.set("g4", new Set(["the_lease"]));
    const failed = book.apply({ op: "accept", id: "o4", at: 50 });
    expect(f.balances.get("g4")).toBe(100);
    expect(cards(failed).map((c) => c.card.step)).toEqual(["failed", "failed"]);
    expect(walletLine(cards(failed)[0]!.card)).toBe("⛔ Could not settle 10 Truthcoin for “The Billboard Lease” — refunded.");
  });

  it("a sell offer charges the payer at accept and is refused when they can't pay", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"], codex: { g1: ["the_file"] } });
    const book = new WalletBook(COIN, f.seam);
    expect(book.checkOffer("g2", "g1", "sell", "The Sandy File", 30)).toEqual({ status: 404, error: "you don't hold that entry" });
    expect(book.checkOffer("g1", "g2", "sell", "No Such Thing", 30)).toEqual({ status: 404, error: "you don't hold that entry" });
    expect(book.checkOffer("g1", "g2", "sell", "The Sandy File", 30)).toBeNull();
    const ev = book.apply({ op: "offer", id: "o1", from: "g1", to: "g2", side: "sell", entry: "the_file", amount: 30, at: 0 });
    expect(f.balances.get("g1")).toBe(100); // no escrow on a sell
    expect(walletLine(cards(ev)[0]!.card)).toBe("💱 Winamp offers you “The Sandy File” for 30 Truthcoin.");
    expect(walletLine(cards(ev)[1]!.card)).toBe("💱 You offered Paint “The Sandy File” for 30 Truthcoin.");
    f.balances.set("g2", 20);
    const failed = book.apply({ op: "accept", id: "o1", at: 1 });
    expect(cards(failed).map((c) => c.card.step)).toEqual(["failed", "failed"]);
    expect(f.codex.get("g2")?.has("the_file") ?? false).toBe(false);
    expect(f.balances.get("g2")).toBe(20);

    book.apply({ op: "offer", id: "o2", from: "g1", to: "g2", side: "sell", entry: "the_file", amount: 15, at: 2 });
    book.apply({ op: "accept", id: "o2", at: 3 });
    expect(f.balances.get("g2")).toBe(5);
    expect(f.balances.get("g1")).toBe(115);
    expect(f.codex.get("g2")?.has("the_file")).toBe(true);

    // The maker withdraws an open one.
    book.apply({ op: "offer", id: "o3", from: "g1", to: "g4", side: "sell", entry: "the_file", amount: 15, at: 4 });
    expect(book.checkCancel("o3", "g4")).toEqual({ status: 404, error: "no such offer for you" });
    expect(book.checkCancel("o3", "g1")).toBeNull();
    const cancelled = book.apply({ op: "cancel", id: "o3", by: "g1" });
    expect(cards(cancelled).map((c) => [c.to, c.card.step])).toEqual([
      ["g4", "cancelled"],
      ["g1", "cancelled"],
    ]);
    expect(f.signals.at(-1)![0]).toBe("offer_cancelled");
  });
});

describe("wallet book — the stimulus", () => {
  it("mints the same amount for every eligible person, three times, never for the ineligible", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"] });
    f.cleared.add("g1");
    f.cleared.add("g3");
    const book = new WalletBook(COIN, f.seam);
    expect(book.minterPerson()).toBe("g3");
    expect(book.checkStimulus("g1", 20)).toEqual({ status: 403, error: "not the minter" });
    expect(book.checkStimulus("g3", 0)).toEqual({ status: 400, error: "amount must be a whole number from 1 to 500" });
    expect(book.checkStimulus("g3", 20)).toBeNull();
    const ev = book.apply({ op: "stimulus", id: book.nextId("s"), by: "g3", amount: 20, at: 0 });
    expect(f.balances.get("g1")).toBe(120);
    expect(f.balances.get("g2")).toBe(100); // not cleared
    expect(f.balances.get("g3")).toBe(120); // the minter is a cleared program too; minted, not debited
    expect(f.balances.get("g4")).toBe(100);
    expect(cards(ev).map((c) => [c.to, c.card.step, c.root])).toEqual([
      ["g3", "minted", true],
      ["g1", "received", true],
    ]);
    expect(f.signals).toEqual([
      ["stimulus", "g3", { amount: 20, paid: 2 }],
      ["stimulus_received", "g1", { from: "g3", amount: 20 }],
      ["stimulus_received", "g3", { from: "g3", amount: 20 }],
    ]);
    expect(book.viewFor("g3").minter).toMatchObject({ uses: 1, limit: 3 });
    expect(book.viewFor("g1").minter).toBeUndefined();

    // A director may fire it from Run; it still counts.
    expect(book.checkStimulus("anyone", 5)).toEqual({ status: 403, error: "not the minter" });
    expect(book.checkStimulus(DIRECTOR, 5, true)).toBeNull();
    const byDirector = book.apply({ op: "stimulus", id: book.nextId("s"), by: DIRECTOR, amount: 5, at: 1 });
    // Not a person: the story still hears it, as the minter's, with who pressed it.
    expect(f.signals.filter((s) => s[0] === "stimulus").at(-1)).toEqual(["stimulus", "g3", { amount: 5, paid: 2, by: "Director" }]);
    expect(cards(byDirector).map((c) => [c.to, c.card.step, c.card.from])).toEqual([
      ["g3", "minted", "Director"],
      ["g1", "received", "Director"],
    ]);
    book.apply({ op: "stimulus", id: book.nextId("s"), by: "g3", amount: 5, at: 2 });
    expect(book.checkStimulus("g3", 5)).toEqual({ status: 409, error: "no stimulus left" });
    expect(book.modView().stimulus).toEqual({ uses: 3, limit: 3 });
  });

  it("without a `while` the stimulus pays everyone who has a balance", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"] });
    f.balances.delete("g4"); // never scored → no balance
    const book = new WalletBook({ ...COIN, minter: { id: "Mint", limit: 1, while: null } }, f.seam);
    book.apply({ op: "stimulus", id: "s1", by: "g3", amount: 7, at: 0 });
    expect([...f.balances.entries()]).toEqual([
      ["g1", 107],
      ["g2", 107],
      ["g3", 107],
    ]);
    const none = new WalletBook({ ...COIN, minter: null }, f.seam);
    expect(none.checkStimulus("g3", 1)).toEqual({ status: 403, error: "this story has no minter" });
    expect(none.apply({ op: "stimulus", id: "s2", by: "g3", amount: 7, at: 0 })).toEqual([]);
  });
});

describe("wallet book — the reserve (grant + freeze)", () => {
  it("grants one eligible person minted coin, three times by default; the fourth is refused", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"] });
    f.cleared.add("g1");
    f.cleared.add("g2");
    const book = new WalletBook(COIN, f.seam);
    expect(book.checkGrant("g1", "g2", 10)).toEqual({ status: 403, error: "not the minter" });
    expect(book.checkGrant("g3", "g3", 10)).toEqual({ status: 409, error: "you can't grant to yourself" });
    expect(book.checkGrant("g3", "g4", 10)).toEqual({ status: 409, error: "they can't receive a grant yet" }); // not cleared
    expect(book.checkGrant("g3", "nobody", 10)).toEqual({ status: 404, error: "unknown recipient" });
    expect(book.checkGrant("g3", "g1", 501)).toEqual({ status: 400, error: "amount must be a whole number from 1 to 500" });
    const ev = book.apply({ op: "grant", id: book.nextId("g"), by: "g3", to: "g1", amount: 40, at: 0 });
    expect(f.balances.get("g1")).toBe(140);
    expect(f.balances.get("g3")).toBe(100); // minted, never debited
    expect(cards(ev).map((c) => [c.to, c.card.kind, c.card.step, c.root])).toEqual([
      ["g3", "grant", "granted", true],
      ["g1", "grant", "received", true],
    ]);
    expect(walletLine(cards(ev)[0]!.card)).toBe("🎁 You granted Winamp 40 Truthcoin from the reserve.");
    expect(walletLine(cards(ev)[1]!.card)).toBe("🎁 Mint granted you 40 Truthcoin from the reserve.");
    expect(f.signals).toEqual([
      ["grant", "g3", { to: "g1", amount: 40 }],
      ["grant_received", "g1", { from: "g3", amount: 40 }],
    ]);
    book.apply({ op: "grant", id: book.nextId("g"), by: "g3", to: "g2", amount: 5, at: 1 });
    // The director's fallback counts too, and only the recipient hears it.
    expect(book.checkGrant(DIRECTOR, "g1", 5, true)).toBeNull();
    const byDirector = book.apply({ op: "grant", id: book.nextId("g"), by: DIRECTOR, to: "g1", amount: 5, at: 2 });
    expect(cards(byDirector).map((c) => [c.to, c.card.step, c.card.fromName])).toEqual([["g1", "received", "Director"]]);
    expect(book.checkGrant("g3", "g2", 5)).toEqual({ status: 409, error: "no grants left" });
    expect(book.checkGrant(DIRECTOR, "g2", 5, true)).toEqual({ status: 409, error: "no grants left" });
    expect(book.viewFor("g3").minter).toMatchObject({ grants: { uses: 3, limit: 3 }, freezeMs: 600_000 });
    expect(book.modView().grants).toEqual({ uses: 3, limit: 3 });
    // `grants N` on the role sets the limit.
    const two = new WalletBook({ ...COIN, minter: { ...COIN.minter!, grants: 0 } }, f.seam);
    expect(two.checkGrant("g3", "g1", 5)).toEqual({ status: 409, error: "no grants left" });
  });

  it("a freeze refuses every way coin leaves the account until it thaws on the clock; receiving still works", () => {
    const f = fake(PEOPLE, { codex: { g1: ["the_lease"], g2: ["the_file"] } });
    const book = new WalletBook({ ...COIN, approver: null }, f.seam);
    f.clock.now = 1_000;
    // g2 asks g1 for coin and offers to sell g1 a fact, before the freeze.
    book.apply({ op: "request", id: book.nextId("r"), from: "g2", to: "g1", amount: 5, at: 1_000 });
    book.apply({ op: "offer", id: book.nextId("o"), from: "g2", to: "g1", side: "sell", entry: "the_file", amount: 5, at: 1_000 });
    book.apply({ op: "offer", id: book.nextId("o"), from: "g2", to: "g1", side: "buy", entry: "the_lease", amount: 5, at: 1_000 });
    expect(book.checkFreeze("g1", "g2")).toEqual({ status: 403, error: "not the minter" });
    expect(book.checkFreeze("g3", "g3")).toEqual({ status: 409, error: "you can't freeze yourself" });
    expect(book.checkFreeze("g3", "g1")).toBeNull();
    const ev = book.apply({ op: "freeze", id: book.nextId("f"), by: "g3", target: "g1", until: book.freezeUntil(1_000), at: 1_000 });
    expect(cards(ev).map((c) => [c.to, c.card.kind, c.card.step, c.root, c.card.settleAt])).toEqual([
      ["g1", "freeze", "frozen", true, 601_000],
      ["g3", "freeze", "imposed", true, 601_000],
    ]);
    expect(walletLine(cards(ev)[0]!.card, 1_000)).toBe("🧊 Mint froze your Truthcoin — you can't send, pay or buy until it thaws in 10 min.");
    expect(walletLine(cards(ev)[1]!.card, 1_000)).toBe("🧊 You froze Winamp's Truthcoin — it thaws in 10 min.");
    expect(f.signals.slice(-2)).toEqual([
      ["freeze", "g3", { to: "g1", until: 601_000 }],
      ["wallet_frozen", "g1", { from: "g3", until: 601_000 }],
    ]);
    expect(book.checkFreeze("g3", "g1")).toEqual({ status: 409, error: "already frozen" });

    const frozen = { status: 409, error: "your Truthcoin is frozen — it thaws in 10 min" };
    expect(book.checkSend("g1", "g2", 5)).toEqual(frozen);
    expect(book.checkRespond("r1", "g1", true)).toEqual(frozen);
    expect(book.checkAccept("o2", "g1")).toEqual(frozen); // a sell offer: g1 would pay
    expect(book.checkOffer("g1", "g2", "buy", "the_file", 5)).toEqual(frozen);
    // Coin coming in, backing out, and selling still work.
    expect(book.checkAccept("o3", "g1")).toBeNull(); // a buy offer: g1 is paid
    expect(book.checkRespond("r1", "g1", false)).toBeNull();
    expect(book.checkRequest("g1", "g2", 5)).toBeNull();
    expect(book.checkOffer("g1", "g2", "sell", "the_lease", 5)).toBeNull();
    expect(book.checkSend("g2", "g1", 5)).toBeNull();
    expect(book.viewFor("g1").frozenUntil).toBe(601_000);
    expect(book.viewFor("g2").frozenUntil).toBeUndefined();
    expect(book.viewFor("g3").minter!.frozen).toEqual([{ id: "f4", target: "g1", targetName: "Winamp", by: "g3", until: 601_000, at: 1_000 }]);
    expect(book.modView().frozen.map((x) => x.target)).toEqual(["g1"]);

    f.clock.now = 600_999;
    expect(book.due(600_999)).toEqual([]);
    f.clock.now = 601_000;
    expect(book.checkSend("g1", "g2", 5)).toBeNull(); // past the deadline reads thawed before the sweep
    expect(book.due(601_000).filter((op) => op.op === "unfreeze")).toEqual([{ op: "unfreeze", id: "f4" }]); // the expiries land too
    const thaw = book.apply({ op: "unfreeze", id: "f4" });
    expect(cards(thaw).map((c) => [c.to, c.card.step, c.root])).toEqual([
      ["g1", "thawed", false],
      ["g3", "expired", false],
    ]);
    expect(walletLine(cards(thaw)[0]!.card)).toBe("☀️ Your Truthcoin thawed — it moves again.");
    expect(f.signals.at(-1)).toEqual(["wallet_thawed", "g1", {}]);
    expect(book.due(999_999).filter((op) => op.op === "unfreeze")).toEqual([]);
    expect(book.apply({ op: "unfreeze", id: "f4" })).toEqual([]); // stale → no-op
    expect(book.viewFor("g1").frozenUntil).toBeUndefined();
    expect(book.checkFreeze("g3", "g1")).toBeNull(); // may be frozen again
  });

  it("a director freezes and lifts a freeze early (by id or target); the minter hears nothing of it", () => {
    const f = fake(PEOPLE);
    const book = new WalletBook(COIN, f.seam);
    expect(book.checkFreeze(DIRECTOR, "g3", true)).toBeNull(); // even the minter
    const ev = book.apply({ op: "freeze", id: book.nextId("f"), by: DIRECTOR, target: "g2", until: 600_000, at: 0 });
    expect(cards(ev).map((c) => [c.to, c.card.step])).toEqual([["g2", "frozen"]]);
    expect(book.checkUnfreeze("nobody")).toEqual({ status: 404, error: "no such freeze" });
    expect(book.checkUnfreeze("g2")).toEqual({ id: "f1" });
    const lift = book.apply({ op: "unfreeze", id: "f1", by: DIRECTOR });
    expect(cards(lift).map((c) => [c.to, c.card.step])).toEqual([["g2", "thawed"]]);
    expect(walletLine(cards(lift)[0]!.card)).toBe("☀️ Director lifted the freeze — your Truthcoin moves again.");
    expect(book.checkUnfreeze("f1")).toEqual({ status: 409, error: "already thawed" });
    expect(book.due(999_999)).toEqual([]);
  });

  it("replays grants, a freeze and its thaw into the same balances and frozen state", () => {
    const f = fake(PEOPLE);
    f.cleared.add("g1");
    const book = new WalletBook(COIN, f.seam);
    const journal: WalletOp[] = [];
    const run = (op: WalletOp): void => {
      journal.push(op);
      book.apply(op);
    };
    run({ op: "grant", id: book.nextId("g"), by: "g3", to: "g1", amount: 25, at: 0 });
    run({ op: "freeze", id: book.nextId("f"), by: "g3", target: "g1", until: book.freezeUntil(0), at: 0 });
    run({ op: "freeze", id: book.nextId("f"), by: "g3", target: "g2", until: book.freezeUntil(300_000), at: 300_000 });
    f.clock.now = 600_000;
    for (const op of book.due(600_000)) run(op); // g1 thaws, g2 still frozen

    const g = fake(PEOPLE);
    g.cleared.add("g1");
    const again = new WalletBook(COIN, g.seam);
    for (const op of journal) again.apply(op);
    g.clock.now = 600_000;
    expect([...g.balances.entries()]).toEqual([...f.balances.entries()]);
    expect(again.viewFor("g1").frozenUntil).toBeUndefined();
    expect(again.viewFor("g2").frozenUntil).toBe(900_000);
    expect(again.modView()).toEqual(book.modView());
    expect(again.nextId("f")).toBe(book.nextId("f"));
  });
});

describe("wallet book — replay + views", () => {
  it("replaying the journaled ops into a fresh book + seam reproduces every balance and open item", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"], codex: { g2: ["the_lease"] } });
    f.cleared.add("g1");
    const book = new WalletBook(COIN, f.seam);
    const journal: WalletOp[] = [];
    const run = (op: WalletOp): void => {
      journal.push(op);
      book.apply(op);
    };
    run(send(book, "g1", "g2", 10, 0));
    run(send(book, "g2", "g4", 20, 100));
    run(send(book, "g4", "g1", 30, 200)); // held
    run({ op: "request", id: book.nextId("r"), from: "g1", to: "g4", amount: 5, at: 300 });
    run({ op: "offer", id: book.nextId("o"), from: "g1", to: "g2", side: "buy", entry: "the_lease", amount: 15, at: 400 });
    run({ op: "stimulus", id: book.nextId("s"), by: "g3", amount: 3, at: 500 });
    for (const op of book.due(60_100)) run(op); // t1 settles; t2 not yet
    run({ op: "respond", id: "r4", accept: true, tx: book.nextId("t"), at: 60_200 });
    run({ op: "deny", id: "t3", by: "Auditor" });
    expect(book.nextId("t")).toBe("t8");

    const g = fake(PEOPLE, { parts: ["Auditor"], codex: { g2: ["the_lease"] } });
    g.cleared.add("g1");
    const fresh = new WalletBook(COIN, g.seam);
    for (const op of journal) fresh.apply(op);
    expect([...g.balances.entries()]).toEqual([...f.balances.entries()]);
    expect(JSON.stringify(fresh.modView())).toBe(JSON.stringify(book.modView()));
    for (const p of ["g1", "g2", "g3", "g4"]) expect(JSON.stringify(fresh.viewFor(p))).toBe(JSON.stringify(book.viewFor(p)));
    expect(g.signals).toEqual(f.signals);
    expect(fresh.nextId("t")).toBe("t8"); // the replay re-mints nothing twice
    expect(fresh.due(60_200)).toEqual(book.due(60_200));
  });

  it("projects a guest's wallet, the approver's queue and the director's mirror", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"] });
    const book = new WalletBook(COIN, f.seam);
    for (let i = 0; i < 25; i++) {
      book.apply(send(book, "g1", "g2", 1, i));
      book.apply({ op: "settle", id: `t${i + 1}` });
    }
    book.apply(send(book, "g2", "g1", 4, 1000));
    const v = book.viewFor("g1");
    expect(v.name).toBe("Truthcoin");
    expect(v.maxTransfer).toBe(500);
    expect(v.transfers).toHaveLength(20);
    expect(v.transfers[0]).toMatchObject({ id: "t26", state: "pending", settleAt: 61_000, via: "send" }); // open first
    expect(v.transfers[1]!.id).toBe("t25"); // then newest closed
    expect(v.escrowed).toBe(0); // the open one is incoming
    expect(book.viewFor("g2").escrowed).toBe(4);
    const q = book.queueFor("Auditor")!;
    expect(q).toMatchObject({ name: "Truthcoin", every: 3, windowMs: 60_000 });
    expect(q.queue.map((t) => t.id)).toEqual(["t26"]);
    const mod = book.modView();
    expect(mod).toMatchObject({ name: "Truthcoin", slot: "score", approver: "Auditor", minter: "Mint", minterPerson: "g3", counter: 26, stimulus: { uses: 0, limit: 3 } });
    expect(mod.open.transfers.map((t) => t.id)).toEqual(["t26"]);
    expect(mod.open.requests).toEqual([]);
    expect(mod.open.offers).toEqual([]);
  });
});

describe("wallet book — escrow the story can see (W6 B15)", () => {
  /** Score + escrowed across everyone, at every write: coin in flight is never lost. */
  function totals(f: Fake): number[] {
    const score = new Map(PEOPLE.map(([id]) => [id, 100]));
    const esc = new Map<string, number>();
    return f.writes.map(([id, kind, n]) => {
      (kind === "score" ? score : esc).set(id, n);
      let t = 0;
      for (const v of score.values()) t += v;
      for (const v of esc.values()) t += v;
      return t;
    });
  }

  it("`<id>.escrowed` follows a send through settle, deny and cancel, and the total never dips", () => {
    const f = fake(PEOPLE, { parts: ["Auditor"] });
    const book = new WalletBook(COIN, f.seam);
    const journal: WalletOp[] = [];
    const run = (op: WalletOp) => {
      journal.push(op);
      return book.apply(op);
    };
    run(send(book, "g1", "g2", 50, 0)); // t1 pending
    expect(f.escrowed.get("g1")).toBe(50);
    expect(f.writes.slice(0, 2)).toEqual([["g1", "escrowed", 50], ["g1", "score", 50]]); // escrow before the debit
    run(send(book, "g1", "g3", 20, 0)); // t2 pending
    expect(f.escrowed.get("g1")).toBe(70);
    expect(book.escrowOf("g1")).toBe(70);
    run({ op: "settle", id: "t1" });
    expect(f.escrowed.get("g1")).toBe(20);
    run({ op: "deny", id: "t2", by: "Auditor" });
    expect(f.escrowed.get("g1")).toBe(0);
    run(send(book, "g2", "g4", 10, 0)); // t3: the third send is held
    expect(f.escrowed.get("g2")).toBe(10);
    run({ op: "cancel", id: "t3", by: "g2" });
    expect(f.escrowed.get("g2")).toBe(0);
    // 4 × 100: never below it at any single write (a moment above it is the
    // conservative side — a majority check can't fire early), and exact after.
    expect(Math.min(...totals(f))).toBe(400);
    expect(totals(f).at(-1)).toBe(400);
    // Replay into a fresh book lands on the same mirror.
    const g = fake(PEOPLE, { parts: ["Auditor"] });
    const fresh = new WalletBook(COIN, g.seam);
    for (const op of journal) fresh.apply(op);
    expect(g.writes).toEqual(f.writes);
  });

  it("a buy offer's escrow is mirrored, and cleared on accept, decline, cancel or expiry", () => {
    for (const close of ["accept", "decline", "cancel", "expire"] as const) {
      const f = fake(PEOPLE, { codex: { g2: ["the_lease"] } });
      const book = new WalletBook(COIN, f.seam);
      book.apply({ op: "offer", id: book.nextId("o"), from: "g1", to: "g2", side: "buy", entry: "the_lease", amount: 30, at: 0 });
      expect(f.escrowed.get("g1")).toBe(30);
      const op: WalletOp = close === "accept" ? { op: "accept", id: "o1", at: 1 } : close === "cancel" ? { op: "cancel", id: "o1", by: "g1" } : { op: close, id: "o1" };
      book.apply(op);
      expect(f.escrowed.get("g1")).toBe(0);
      expect(Math.min(...totals(f))).toBe(400);
      expect(totals(f).at(-1)).toBe(400);
    }
  });

  it("a send with no approver settles inline: escrowed rises and falls inside the one op", () => {
    const f = fake(PEOPLE);
    const book = new WalletBook({ ...COIN, approver: null }, f.seam);
    book.apply(send(book, "g1", "g2", 5, 0));
    expect(f.writes.filter(([, k]) => k === "escrowed")).toEqual([["g1", "escrowed", 5], ["g1", "escrowed", 0]]);
    expect(Math.min(...totals(f))).toBe(400);
    expect(totals(f).at(-1)).toBe(400);
  });
});

describe("the story grammar", () => {
  it("parses the currency header with defaults and clauses, and refuses a typo", () => {
    expect(parseCurrency("score as Truthcoin")).toEqual({ slot: "score", name: "Truthcoin", maxTransfer: 500, expiryMs: 600_000, approver: null, minter: null });
    expect(parseCurrency("coins as Gold Pieces, max 50, expiry 2m")).toMatchObject({ slot: "coins", name: "Gold Pieces", maxTransfer: 50, expiryMs: 120_000 });
    expect(parseCurrency("score as Truthcoin, expiry 90s")).toMatchObject({ expiryMs: 90_000 });
    expect(parseCurrency("Truthcoin")).toBeNull();
    expect(parseCurrency("score as ")).toBeNull();
    expect(parseCurrency("score as Truthcoin, max lots")).toBeNull();
    expect(parseCurrency("score as Truthcoin, max 0")).toBeNull();
    expect(parseCurrency("score as Truthcoin, cap 5")).toBeNull();
    expect(parseCurrency("1score as Truthcoin")).toBeNull();
  });

  it("parses the wallet roles with their clauses in any order", () => {
    expect(walletRoleOf(undefined)).toBeNull();
    expect(walletRoleOf("approver")).toEqual({ role: "approver", every: 3, windowMs: 60_000 });
    expect(walletRoleOf("Approver, window 10s, every 2")).toEqual({ role: "approver", every: 2, windowMs: 10_000 });
    expect(walletRoleOf("approver, every 0")).toBeNull();
    expect(walletRoleOf("approver, limit 3")).toBeNull();
    expect(walletRoleOf("minter")).toEqual({ role: "minter", limit: 3, while: null });
    expect(walletRoleOf("minter, limit 1, while program.cleared == true")).toEqual({ role: "minter", limit: 1, while: "program.cleared == true" });
    expect(walletRoleOf("minter, while program.score >= 10, limit 0")).toEqual({ role: "minter", limit: 0, while: "program.score >= 10" });
    expect(walletRoleOf("minter, grants 2, freeze 5m")).toEqual({ role: "minter", limit: 3, while: null, grants: 2, freezeMs: 300_000 });
    expect(walletRoleOf("minter, freeze 0s")).toBeNull();
    expect(walletRoleOf("minter, grants -1")).toBeNull();
    expect(walletRoleOf("minter, every 2")).toBeNull();
    expect(walletRoleOf("banker")).toBeNull();
  });

  it("a wallet: role on a bare CHARACTER keeps it on the guest picker and resolves into the currency", () => {
    const m = compileFromSource(`# Coin
directory: everyone
currency: score as Truthcoin, max 500, expiry 10m

CHARACTER Auditor
  wallet: approver, every 3, window 60s
  when scanned by guest:
    set guest.seen = true

CHARACTER Mint
  avatar: File:mint.png
  wallet: minter, limit 3, while program.cleared == true

CHARACTER Second Mint
  wallet: minter, limit 9

CHARACTER Calculator

ROLE Program
  cleared: bool = false
`);
    expect(m.currency).toEqual({
      slot: "score",
      name: "Truthcoin",
      maxTransfer: 500,
      expiryMs: 600_000,
      approver: { id: "Auditor", every: 3, windowMs: 60_000 },
      minter: { id: "Mint", limit: 3, while: "program.cleared == true" },
    });
    expect(m.characters.get("Mint")!.wallet).toEqual({ role: "minter", limit: 3, while: "program.cleared == true" });
    expect(m.characters.get("Mint")!.defaults.size).toBe(0); // not a typed slot, no world default
    expect(m.characters.get("Calculator")!.wallet).toBeNull();
    expect(isSpecial(m, "Mint")).toBe(false);
    expect(isSpecial(m, "Auditor")).toBe(true); // its hook, not its wallet line
    const picks = identityDefs(m).filter(guestPickable).map((d) => d.name);
    expect(picks).toEqual(["Mint", "Second Mint", "Calculator"]);
  });

  it("without a currency header the wallet lines are inert, and a broken header reads null", () => {
    const m = compileFromSource(`# Plain
CHARACTER Mint
  wallet: minter
`);
    expect(m.currency).toBeNull();
    expect(m.characters.get("Mint")!.wallet).toEqual({ role: "minter", limit: 3, while: null });
    const broken = compileFromSource(`# Broken
currency: Truthcoin
`);
    expect(broken.currency).toBeNull();
  });
});

describe("walletSeam over a live Sim", () => {
  const SOURCE = `# Coin
directory: everyone
currency: score as Truthcoin

CHARACTER Auditor
  wallet: approver, every 2, window 10s
  when scanned by program:
    set program.seen = true

CHARACTER Mint
  wallet: minter, limit 1, while program.cleared == true

CHARACTER Calculator

CODEX The Billboard Lease
  text: A lease.

CODEX Lease Copy
  title: The Billboard Lease
  text: A second entry whose title folds onto the first one's id.

CODEX Fragment 01
  title: JEEVES.IDX — fragment 01
  text: A title that isn't the id.

ROLE Program
  cleared: bool = false
  bonus: 0 to 100 = 0
  when transfer_received for program:
    set program.bonus += 1
    set program.last_from = from.name
`;

  it("moves the score slot, shares entries, fires story hooks and finds the roles' people", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.createPerson("g1", "Winamp");
    sim.createPerson("g2", "Mint");
    sim.setScore("g1", 100);
    sim.setScore("g2", 100);
    sim.unlock("g1", "The Billboard Lease");
    const seam = walletSeam(sim, sim.model.currency!);
    const book = new WalletBook(sim.model.currency!, seam);
    expect(book.minterPerson()).toBe("g2");
    expect(book.approverAudience()).toBe("@Auditor");
    expect(seam.hasBalance("g1")).toBe(true);
    expect(seam.hasBalance("nobody")).toBe(false);
    expect(seam.codexIdOf("the billboard lease")).toBe("The Billboard Lease"); // the id wins over Lease Copy's title
    expect(seam.codexIdOf("JEEVES.IDX — fragment 01")).toBe("Fragment 01"); // by title
    expect(seam.codexIdOf("jeeves.idx — Fragment 01")).toBe("Fragment 01");
    expect(seam.codexIdOf("fragment_01")).toBe("Fragment 01"); // by folded id
    expect(seam.codexIdOf("Nope")).toBeNull();
    expect(seam.codexTitle("The Billboard Lease")).toBe("The Billboard Lease");

    book.apply(send(book, "g1", "g2", 30, sim.elapsed()));
    expect(sim.scoreOf("g1")).toBe(70);
    sim.tick(10_000);
    const due = book.due(sim.elapsed());
    expect(due).toEqual([{ op: "settle", id: "t1" }]);
    book.apply(due[0]!);
    expect(sim.scoreOf("g2")).toBe(130);
    // The story heard `transfer_received` with `from` bound as a person.
    expect(sim.world.get("g2.bonus")).toMatchObject({ kind: "number", value: 1 });
    expect(sim.world.get("g2.last_from")).toMatchObject({ kind: "string", value: "Winamp" });

    // The stimulus honours `while` through Sim.holds.
    sim.setVar("g1.cleared", "true");
    book.apply({ op: "stimulus", id: book.nextId("s"), by: "g2", amount: 5, at: sim.elapsed() });
    expect(sim.scoreOf("g1")).toBe(75);
    expect(sim.scoreOf("g2")).toBe(130); // not cleared

    // A sell offer shares through Sim.share.
    book.apply({ op: "offer", id: book.nextId("o"), from: "g1", to: "g2", side: "sell", entry: "The Billboard Lease", amount: 10, at: sim.elapsed() });
    book.apply({ op: "accept", id: "o3", at: sim.elapsed() });
    expect(sim.holdsCodex("g2", "The Billboard Lease")).toBe(true);
    expect(sim.scoreOf("g2")).toBe(120);
    expect(sim.scoreOf("g1")).toBe(85);
  });

  it("reads and writes a non-score slot through setVar", () => {
    const sim = Sim.fromSources(`# Gold
currency: gold as Gold

ROLE Adventurer
  gold: 0 to 1000 = 10
`);
    sim.createPerson("g1", "Ann");
    sim.createPerson("g2", "Bo");
    const seam = walletSeam(sim, sim.model.currency!);
    expect(seam.scoreOf("g1")).toBe(10);
    const book = new WalletBook(sim.model.currency!, seam);
    book.apply(send(book, "g1", "g2", 4, 0));
    expect(sim.world.get("g1.gold")).toMatchObject({ kind: "number", value: 6 });
    expect(sim.world.get("g2.gold")).toMatchObject({ kind: "number", value: 14 });
    expect(sim.scoreOf("g1")).toBe(0); // the score slot is untouched
  });
});

describe("`<who>.escrowed` in a story rule (the currency help's majority)", () => {
  it("unset reads as 0 in an addition and a sum; coin in flight counts once set", () => {
    const sim = Sim.fromSources(`ROLE Program
  score: 0 to 100 = 0
  majority: bool = false
  when (self.score + self.escrowed) * 2 > sum([p.score + p.escrowed for p in Persons]):
    set self.majority = true
`);
    sim.createPerson("a", "A");
    sim.createPerson("b", "B");
    sim.setScore("b", 10);
    sim.setScore("a", 10);
    expect(sim.world.get("a.majority")).toEqual({ kind: "bool", value: false }); // 20 > 20: exactly half is no majority
    sim.setVar("a.escrowed", "1"); // one coin of A's on its way
    expect(sim.world.get("a.majority")).toEqual({ kind: "bool", value: true });
  });
});
