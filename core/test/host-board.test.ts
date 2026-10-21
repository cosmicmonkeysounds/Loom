//! The host board (wave 13, CONTRACTS §2.6): the editor's judging / queue /
//! parts / guests / wallet / award helpers moved to core — their editor test
//! cases ported 1:1 — plus `hostNeeds` and the host view.

import { describe, expect, it } from "vitest";
import {
  AWARD_SOURCES,
  NeedKind,
  PartPresence,
  QUEUE_SLOW_MS,
  QueueTone,
  UNSEEN_MS,
  agentQueueOf,
  askingOf,
  askingText,
  awardSuggestion,
  newestFilingFirst,
  castPresence,
  confirmEvent,
  fillAwards,
  filingButtons,
  heldTransfers,
  hostNeeds,
  hostView,
  isGone,
  isPersonaRow,
  isSignedIn,
  judgeModeOf,
  nearCount,
  nearKeyOf,
  nightEnded,
  partPresence,
  pendingFilings,
  performerParts,
  pickWinner,
  questionFilings,
  queueBadge,
  ruledFilings,
  rulingOf,
  rulingText,
  suggestionHint,
  unseenGuests,
  verdictCall,
  waitText,
  type AwardFields,
  type CastLike,
  type FactsLike,
  type FilingLike,
  type HostViewInput,
  type MindLike,
  type ModLike,
  type RecapRowWire,
  type RecapWire,
  type RosterLike,
  type WalletLike,
} from "../src/host-board.ts";

describe("judging (moved from cockpit/mind.ts)", () => {
  const filing = (over: Partial<FilingLike>): FilingLike => ({ person: "g1", name: "Ada", question: "Q1", answer: "eleven", confidence: 100, verdict: "accurate", final: null, how: null, by: null, at: 10, ...over });
  const view = (over: Partial<FactsLike> = {}): FactsLike => {
    const q1 = [filing({ at: 30 }), filing({ person: "g2", name: "Ben", answer: "twelve", verdict: "lie", at: 20 })];
    const q2 = [filing({ question: "Q2", answer: "pickles", confidence: 40, verdict: "uncertain", final: "marked", at: 5 })];
    return {
      mode: "review",
      confirm: { accurate: "fact_accurate", lie: "fact_lie", uncertain: "fact_uncertain" },
      questions: [
        { id: "Q1", round: 1, text: "How many years?", filings: q1 },
        { id: "Q2", round: 1, text: "Who?", filings: q2 },
        { id: "P1", round: null, text: "The line.", filings: [] },
      ],
      pending: 2,
      ...over,
    };
  };

  it("judgeModeOf: the view first, then the world var, else auto", () => {
    expect(judgeModeOf([], view())).toBe("review");
    expect(judgeModeOf([{ path: "Night.judge_mode", value: "review" }], view({ mode: "auto" }))).toBe("auto");
    expect(judgeModeOf([{ path: "Night.judge_mode", value: "review" }], null)).toBe("review");
    expect(judgeModeOf([{ path: "Night.judge_mode", value: "auto" }], null)).toBe("auto");
    expect(judgeModeOf([], null)).toBe("auto");
  });

  it("pendingFilings: only unsettled filings, oldest first", () => {
    expect(pendingFilings(view()).map((r) => [r.name, r.question, r.proposed, r.at])).toEqual([
      ["Ben", "Q1", "lie", 20],
      ["Ada", "Q1", "accurate", 30],
    ]);
    expect(pendingFilings(view())[0]).toEqual({ person: "g2", name: "Ben", question: "Q1", answer: "twelve", confidence: 100, proposed: "lie", final: null, at: 20, near: null, asking: false, ruling: null });
  });

  it("questionFilings: the server's how + by — auto, confirmed by whom, settled", () => {
    const q = [
      filing({ person: "g1", name: "Ada", final: "accurate", how: "auto", at: 1 }),
      filing({ person: "g2", name: "Ben", final: "accurate", how: "confirmed", by: "Jo", at: 2 }),
      filing({ person: "g3", name: "Cy", verdict: "lie", final: "accurate", how: "overridden", by: "Clippy", at: 3 }),
      filing({ person: "g4", name: "Di", final: "accurate", how: "settled", by: "Jo", at: 4 }),
      filing({ person: "g5", name: "Ed", verdict: "uncertain", final: "marked", how: "marked", by: "Jo", at: 5 }),
    ];
    const v = view({ questions: [{ id: "Q1", round: 1, text: "x", filings: q }] });
    expect(questionFilings(v, "Q1").map((r) => [r.name, r.how, r.by])).toEqual([
      ["Ada", "auto", null],
      ["Ben", "confirmed", "Jo"],
      ["Cy", "overridden", "Clippy"],
      ["Di", "settled", "Jo"],
      ["Ed", "marked", "Jo"],
    ]);
  });

  it("questionFilings: every filing oldest first, with how it was judged (an older server with no how)", () => {
    const q = [
      filing({ person: "g1", name: "Ada", final: "accurate", at: 40 }),
      filing({ person: "g2", name: "Ben", verdict: "lie", final: "accurate", at: 10 }),
      filing({ person: "g3", name: "Cy", verdict: "uncertain", final: "marked", at: 30 }),
      filing({ person: "g4", name: "Di", at: 20 }),
    ];
    const v = view({ questions: [{ id: "Q1", round: 1, text: "x", filings: q }] });
    expect(questionFilings(v, "Q1").map((r) => [r.name, r.proposed, r.final, r.how, r.at])).toEqual([
      ["Ben", "lie", "accurate", "overridden", 10],
      ["Di", "accurate", null, "pending", 20],
      ["Cy", "uncertain", "marked", "marked", 30],
      ["Ada", "accurate", "accurate", "kept", 40],
    ]);
    expect(questionFilings({ ...v, mode: "auto" }, "Q1").find((r) => r.name === "Ada")!.how).toBe("kept");
    expect(questionFilings({ ...v, mode: "review" }, "Q1").find((r) => r.name === "Ada")!.how).toBe("kept");
    expect(questionFilings(v, "Q1")[0]).toEqual({ person: "g2", name: "Ben", answer: "eleven", confidence: 100, proposed: "lie", final: "accurate", how: "overridden", by: null, at: 10, near: null, asking: false, ruling: null });
    expect(questionFilings(v, "nope")).toEqual([]);
    expect(questionFilings(view(), "P1")).toEqual([]);
  });

  it("near misses: the key on a pending filing, counted, tagged in both lists", () => {
    const near = (key: unknown) => ({ near: key }) as unknown as Partial<FilingLike>;
    const q = [
      filing({ person: "g1", name: "Calculator", question: "H2", answer: "Mr Pickels", confidence: 100, verdict: "lie", at: 1, ...near({ key: "Mr. Pickles" }) }),
      filing({ person: "g2", name: "VLC", question: "H2", answer: "Garfield", verdict: "lie", at: 2 }),
      filing({ person: "g3", name: "Winamp", question: "H2", answer: "1,997", verdict: "uncertain", at: 3, ...near({ key: "" }) }),
      filing({ person: "g4", name: "Excel", question: "H2", answer: "pickle", verdict: "lie", at: 4, ...near("Mr. Pickles") }),
    ];
    const v = view({ mode: "auto", pending: 4, questions: [{ id: "H2", round: 1, text: "The cat?", filings: q }] });
    expect(pendingFilings(v).map((r) => [r.name, r.near])).toEqual([
      ["Calculator", "Mr. Pickles"],
      ["VLC", null],
      ["Winamp", null],
      ["Excel", null],
    ]);
    expect(nearKeyOf(q[0]!)).toBe("Mr. Pickles");
    expect(nearCount(v)).toBe(1);
    expect(nearCount({ ...v, near: 3 })).toBe(3);
    expect(questionFilings(v, "H2")[0]!.near).toBe("Mr. Pickles");
    expect(nearCount(view())).toBe(0);
  });

  it("rulings: asking while the judge is asked, then its ruling on the row, newest first, with the override buttons", () => {
    const extra = (o: Record<string, unknown>) => o as unknown as Partial<FilingLike>;
    const q = [
      filing({ person: "g1", name: "Calculator", question: "H2", answer: "Mr Pickels", verdict: "accurate", at: 1, ...extra({ near: { key: "Mister Pickles" }, asking: true }) }),
      filing({ person: "g2", name: "VLC", question: "H2", answer: "Mrs Pickles", verdict: "accurate", final: "lie", how: "overridden", by: "Trabolta", at: 2, ...extra({ near: { key: "Mister Pickles" }, ruling: { by: "Trabolta", same: false, why: "A different cat.", at: 50 } }) }),
      filing({ person: "g3", name: "Winamp", question: "H2", answer: "Mister Pickels", verdict: "accurate", final: "accurate", how: "confirmed", by: "Trabolta", at: 3, ...extra({ ruling: { by: "Trabolta", same: true, why: "", at: 60 } }) }),
      filing({ person: "g4", name: "Excel", question: "H2", answer: "x", verdict: "lie", at: 4, ...extra({ asking: "yes", ruling: { by: 7, same: true } }) }),
    ];
    const v = view({ mode: "auto", pending: 2, questions: [{ id: "H2", round: 1, text: "The cat?", filings: q }], judge: "Trabolta" });
    expect(pendingFilings(v).map((r) => [r.name, r.asking, r.ruling])).toEqual([
      ["Calculator", true, null],
      ["Excel", false, null],
    ]);
    expect(askingText(v)).toBe("🤖 asking Trabolta…");
    expect(askingText(view())).toBe("🤖 asking the judge…");
    const ruled = ruledFilings(v);
    expect(ruled.map((r) => [r.name, r.question, rulingText(r.ruling)])).toEqual([
      ["Winamp", "H2", "🤖 Trabolta: same"],
      ["VLC", "H2", "🤖 Trabolta: not the same — A different cat."],
    ]);
    expect(filingButtons(v, ruled[1]!).map((b) => [b.verdict, b.current])).toEqual([
      ["accurate", false],
      ["lie", true],
      ["uncertain", false],
    ]);
    expect(rulingOf(q[0]!)).toBeNull();
    expect(askingOf(q[3]!)).toBe(false);
  });

  it("confirmEvent: the confirm event per verdict, null without one", () => {
    expect(confirmEvent(view(), "lie")).toBe("fact_lie");
    expect(confirmEvent(view(), "uncertain")).toBe("fact_uncertain");
    expect(confirmEvent(view({ confirm: null }), "accurate")).toBeNull();
    expect(confirmEvent(view({ confirm: { accurate: "", lie: "x", uncertain: "y" } }), "accurate")).toBeNull();
  });

  it("filingButtons: an auto-mode judged lie offers all three, its verdict outlined; a marked filing none", () => {
    const q = [
      filing({ person: "g1", name: "Calculator", question: "H2", answer: "Mr. Pickles", verdict: "lie", final: "lie", how: "auto", at: 1 }),
      filing({ person: "g2", name: "VLC", question: "H2", answer: "Mr Pickles", confidence: 60, verdict: "uncertain", final: "marked", how: "marked", by: "Jo", at: 2 }),
      filing({ person: "g3", name: "Winamp", question: "H2", answer: "Garfield", verdict: "lie", at: 3 }),
    ];
    const v = view({ mode: "auto", questions: [{ id: "H2", round: 1, text: "The cat?", filings: q }] });
    const [lie, marked, pending] = questionFilings(v, "H2");
    const judged = filingButtons(v, lie!);
    expect(judged.map((b) => [b.verdict, b.current, b.disabled])).toEqual([
      ["accurate", false, false],
      ["lie", true, false],
      ["uncertain", false, false],
    ]);
    expect(judged[0]!.title).toBe("Override: accurate (judged lie)");
    expect(judged[1]!.title).toMatch(/already on record/);
    expect(filingButtons(v, marked!)).toEqual([]);
    expect(filingButtons(v, pending!).map((b) => [b.verdict, b.current, b.title])).toEqual([
      ["accurate", false, "Override: accurate"],
      ["lie", true, "Confirm: confident lie"],
      ["uncertain", false, "Override: uncertain"],
    ]);
    expect(filingButtons(view({ confirm: null }), lie!).every((b) => b.disabled)).toBe(true);
  });

  it("verdictCall: the confirm event on the filer with the question named", () => {
    expect(verdictCall(view(), { person: "g1", question: "H2" }, "accurate")).toEqual({ event: "fact_accurate", person: "g1", args: { question: "H2" } });
    expect(verdictCall(view(), { person: "g1", question: "H1" }, "uncertain")).toEqual({ event: "fact_uncertain", person: "g1", args: { question: "H1" } });
    expect(verdictCall(view({ confirm: null }), { person: "g1", question: "H2" }, "lie")).toBeNull();
  });
});

describe("an agent's queue (moved from cockpit/mind.ts)", () => {
  const mind = (character: string, agentQueue?: unknown): MindLike => ({ character, ...(agentQueue !== undefined ? { agentQueue } : {}) });

  it("agentQueueOf: the cast row first, then the mind summary, else null", () => {
    const q = { depth: 2, oldestMs: 5000, stalled: false };
    expect(agentQueueOf("Trabolta", [{ id: "Trabolta", agent: true, agentQueue: q }], [])).toEqual(q);
    expect(agentQueueOf("Trabolta", [{ id: "Trabolta", agent: true }], [mind("Trabolta", { depth: 1, oldestMs: null, stalled: true })])).toEqual({ depth: 1, oldestMs: null, stalled: true });
    expect(agentQueueOf("Trabolta", [{ id: "Trabolta", agent: true }], [mind("Trabolta")])).toBeNull();
    expect(agentQueueOf("Trabolta", [], [mind("Trabolta", { depth: "x" })])).toBeNull();
  });

  it("agentQueueOf with a clock: the wait ages between snapshots from when it arrived", () => {
    const q = { depth: 2, oldestMs: 3000, stalled: false, receivedAt: 1_000_000 };
    const cast: CastLike[] = [{ id: "Trabolta", agent: true, agentQueue: q }];
    const aged = agentQueueOf("Trabolta", cast, [], 1_060_000)!;
    expect(aged.oldestMs).toBe(63_000);
    expect(queueBadge(aged)).toMatchObject({ text: "⚠ 2 waiting · oldest 1:03", tone: QueueTone.Slow });
    expect(agentQueueOf("Trabolta", cast, [])!.oldestMs).toBe(3000);
    expect(agentQueueOf("Trabolta", [{ ...cast[0]!, agentQueue: { depth: 2, oldestMs: 3000, stalled: false } }], [], 1_060_000)!.oldestMs).toBe(3000);
    expect(agentQueueOf("Trabolta", [{ ...cast[0]!, agentQueue: { depth: 0, oldestMs: null, stalled: false, receivedAt: 1 } }], [], 1_060_000)!.oldestMs).toBeNull();
    expect(agentQueueOf("Trabolta", cast, [], 999_000)!.oldestMs).toBe(3000);
  });

  it("queueBadge: empty, waiting, slow past the busy line, stalled", () => {
    expect(queueBadge({ depth: 0, oldestMs: null, stalled: false })).toMatchObject({ text: "queue empty", tone: QueueTone.Idle });
    expect(queueBadge({ depth: 3, oldestMs: 12_000, stalled: false })).toMatchObject({ text: "3 waiting · oldest 0:12", tone: QueueTone.Waiting });
    expect(queueBadge({ depth: 3, oldestMs: QUEUE_SLOW_MS + 40_000, stalled: false })).toMatchObject({ text: "⚠ 3 waiting · oldest 1:20", tone: QueueTone.Slow });
    expect(queueBadge({ depth: 4, oldestMs: 95_000, stalled: true })).toMatchObject({ text: "⛔ stalled · 4 waiting · oldest 1:35", tone: QueueTone.Stalled });
    expect(waitText(61_400)).toBe("1:01");
  });
});

describe("wallet (moved from cockpit/wallet.ts)", () => {
  const tx = (id: string, state: string) => ({ id, state, fromName: "Excel", toName: "Winamp", amount: 50, settleAt: null });
  it("heldTransfers: the held ones, in the view order", () => {
    expect(heldTransfers({ open: { transfers: [tx("t1", "held"), tx("t2", "pending"), tx("t3", "held")] } }).map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(heldTransfers(null)).toEqual([]);
  });
});

describe("performer parts (moved from cockpit/parts.ts)", () => {
  const row = (id: string, more: Partial<CastLike> = {}): CastLike => ({ id, ...more });
  it("lists only the parts when the server flags them", () => {
    const cast = [
      row("Clippy", { part: true, online: true, held: true }),
      row("Norton", { part: true, online: false, held: false }),
      row("Microsoft Excel", { part: false }),
      row("Kernel", { part: false }),
      row("Trabolta", { part: false, agent: true, online: true }),
    ];
    expect(performerParts(cast).map((c) => c.id)).toEqual(["Clippy", "Norton"]);
  });
  it("an older server flags nothing: every non-agent character, as before", () => {
    expect(performerParts([row("Clippy", { online: false }), row("Trabolta", { agent: true, online: true })]).map((c) => c.id)).toEqual(["Clippy"]);
  });
  it("a held part whose phone is not streaming is signed in, phone offline", () => {
    expect(partPresence({ online: true, held: true })).toBe(PartPresence.Online);
    expect(partPresence({ online: false, held: true })).toBe(PartPresence.PhoneOffline);
    expect(partPresence({ online: false, held: false })).toBe(PartPresence.Free);
    expect(partPresence({ online: false })).toBe(PartPresence.Free);
    expect(partPresence({})).toBe(PartPresence.Unknown);
    expect(isSignedIn(PartPresence.PhoneOffline)).toBe(true);
    expect(isSignedIn(PartPresence.Free)).toBe(false);
  });
  it("an agent keeps its worker dot, never counted as a signed-in performer", () => {
    expect(castPresence({ agent: true, online: true }, false)).toBe(PartPresence.Voiced);
    expect(castPresence({ agent: true, online: false }, false)).toBe(PartPresence.Unvoiced);
    expect(castPresence({ agent: true }, false)).toBe(PartPresence.Unknown);
    expect(isSignedIn(PartPresence.Voiced)).toBe(false);
    expect(castPresence({ online: false, held: true }, true)).toBe(PartPresence.PhoneOffline);
    expect(castPresence({ online: true }, false)).toBe(PartPresence.Unknown);
  });
});

describe("who is still here (moved from cockpit/guests.ts)", () => {
  const row = (id: string, name: string, extra: Partial<RosterLike> = {}): RosterLike => ({ id, name, ...extra });
  const w = (path: string, value: string) => ({ path, value });
  const NOW = 10_000_000;

  it("isGone / isPersonaRow read the world vars (quoted or bare), an owner, a p… id", () => {
    const world = [w("g-1.gone", "true"), w("g-2.gone", "false"), w("g-3.persona", '"true"')];
    expect(isGone(world, "g-1")).toBe(true);
    expect(isGone(world, "g-2")).toBe(false);
    expect(isGone(world, "g-9")).toBe(false);
    expect(isGone(new Map([["g-1.gone", "true"]]), "g-1")).toBe(true);
    expect(isPersonaRow(row("g-3", "Puppet"), world)).toBe(true);
    expect(isPersonaRow(row("p4", "Writer"), world)).toBe(true);
    expect(isPersonaRow(row("g-5", "Ana’s", { owner: "Ana" }), world)).toBe(true);
    expect(isPersonaRow(row("g-1", "Excel"), world)).toBe(false);
  });

  it("unseenGuests: real guests silent for 30 min, longest first — never online, gone, personas, or untracked rows", () => {
    const roster = [
      row("g-1", "Excel", { lastSeen: NOW - UNSEEN_MS - 1 }),
      row("g-2", "Winamp", { lastSeen: NOW - 2 * UNSEEN_MS }),
      row("g-3", "VLC", { lastSeen: NOW - UNSEEN_MS + 1 }),
      row("g-4", "Pong", { lastSeen: NOW - 2 * UNSEEN_MS, online: true }),
      row("g-5", "Paint", { lastSeen: NOW - 2 * UNSEEN_MS }),
      row("g-6", "Puppet", { lastSeen: NOW - 2 * UNSEEN_MS }),
      row("p7", "Writer", { lastSeen: NOW - 2 * UNSEEN_MS }),
      row("g-8", "Clippy fan", { lastSeen: null }),
      row("g-9", "Local"),
    ];
    const world = [w("g-5.gone", "true"), w("g-6.persona", "true")];
    expect(unseenGuests(roster, world, NOW).map((g) => g.name)).toEqual(["Winamp", "Excel"]);
    expect(unseenGuests(roster, world, NOW, 60_000).map((g) => g.name)).toEqual(["Winamp", "Excel", "VLC"]);
  });
});

describe("hostNeeds (the editor's needsYou, refused press left out)", () => {
  const row = (id: string, name: string, extra: Partial<RosterLike> = {}): RosterLike => ({ id, name, ...extra });

  it("lists review filings, held transfers, offline parts, free parts and unvoiced agents, with targets", () => {
    const facts = {
      mode: "review",
      questions: [{ id: "Q1", filings: [{ person: "p1", name: "Ada", question: "Q1", answer: "x", confidence: 50, verdict: "uncertain", final: null, at: 1 }] }],
    } as unknown as FactsLike;
    const wallet = { open: { transfers: [{ id: "t1", state: "held" }, { id: "t2", state: "pending" }] } } as unknown as WalletLike;
    const cast: CastLike[] = [
      { id: "Clippy", part: true, online: true, held: true },
      { id: "Norton", part: true, online: false, held: true },
      { id: "McAfee", part: true, online: false, held: false },
      { id: "Trabolta", agent: true, online: false },
      { id: "Kernel", part: false },
    ];
    const items = hostNeeds({ now: 2000, world: [], facts, wallet, cast, doorsOpen: true });
    expect(items.map((i) => [i.kind, i.target])).toEqual([
      [NeedKind.Filings, "judge"],
      [NeedKind.Held, "wallet"],
      [NeedKind.PhoneOffline, "part"],
      [NeedKind.Free, "part"],
      [NeedKind.NoWorker, "agent"],
    ]);
    expect(items[0]!.text).toBe("📝 1 filing to review");
    expect(items[1]!.text).toBe("💰 1 held transfer");
    expect(items[2]).toMatchObject({ text: "📱 Norton: phone offline", character: "Norton" });
    expect(items[3]!.text).toBe("🎭 McAfee: nobody signed in");
    expect(items[4]).toMatchObject({ text: "🤖 Trabolta: no worker", character: "Trabolta" });
    expect(hostNeeds({ now: 61_000, world: [], facts: { ...facts, mode: "auto" }, wallet: null, cast, doorsOpen: false }).map((i) => i.kind)).toEqual([NeedKind.NoWorker]);
  });

  it("near misses in auto mode, a stalled or slow agent queue, unseen guests", () => {
    const base = { wallet: null, doorsOpen: true };
    const nearFacts = {
      mode: "auto",
      questions: [
        {
          id: "H2",
          filings: [
            { person: "g-1", name: "Excel", question: "H2", answer: "Mr Pickels", confidence: 100, verdict: "lie", final: null, at: 1, near: { key: "Mr. Pickles" } },
            { person: "g-2", name: "VLC", question: "H2", answer: "Garfield", confidence: 100, verdict: "lie", final: "lie", at: 2 },
          ],
        },
      ],
    } as unknown as FactsLike;
    const auto = hostNeeds({ ...base, now: 0, world: [], facts: nearFacts, cast: [] });
    expect(auto.map((i) => [i.kind, i.text, i.target])).toEqual([[NeedKind.NearMiss, "⚠ 1 near miss to judge", "judge"]]);
    expect(hostNeeds({ ...base, now: 0, world: [], facts: { ...nearFacts, mode: "review" }, cast: [] }).map((i) => i.text)).toEqual(["📝 1 filing to review (⚠ 1 near miss)"]);

    const agent = (q: CastLike["agentQueue"]): CastLike => ({ id: "Trabolta", agent: true, online: true, agentQueue: q });
    expect(hostNeeds({ ...base, now: 0, world: [], facts: null, cast: [agent({ depth: 4, oldestMs: 70_000, stalled: true })] }).map((i) => [i.text, i.target])).toEqual([["🤖 Trabolta: ⛔ stalled · 4 waiting · oldest 1:10", "agent"]]);
    expect(hostNeeds({ ...base, now: 0, world: [], facts: null, cast: [agent({ depth: 2, oldestMs: 45_000, stalled: false })] }).map((i) => i.kind)).toEqual([NeedKind.AgentQueue]);
    expect(hostNeeds({ ...base, now: 0, world: [], facts: null, cast: [agent({ depth: 2, oldestMs: 5000, stalled: false })] })).toEqual([]);
    expect(hostNeeds({ ...base, now: 50_000, world: [], facts: null, cast: [agent({ depth: 2, oldestMs: 5000, stalled: false, receivedAt: 0 })] }).map((i) => i.text)).toEqual(["🤖 Trabolta: ⚠ 2 waiting · oldest 0:55"]);

    const now = 100 * 60_000;
    const roster = [
      row("g-1", "Excel", { lastSeen: now - 31 * 60_000 }),
      row("g-2", "Winamp", { lastSeen: now - 50 * 60_000 }),
      row("g-3", "VLC", { lastSeen: now - 5 * 60_000 }),
      row("g-4", "Paint", { lastSeen: now - 50 * 60_000 }),
    ];
    const unseen = hostNeeds({ ...base, now, world: [{ path: "g-4.gone", value: "true" }], facts: null, cast: [], roster });
    expect(unseen.map((i) => [i.kind, i.text, i.target])).toEqual([[NeedKind.Unseen, "👋 2 guests unseen 30 min — mark gone?", "people"]]);
    expect(unseen[0]!.guests!.map((g) => g.id)).toEqual(["g-2", "g-1"]);
  });

  it("silent terminals: one need naming them, target more", () => {
    const one = hostNeeds({ now: 0, world: [], facts: null, wallet: null, cast: [], doorsOpen: true, silentTerminals: ["Kitchen"] });
    expect(one).toEqual([{ kind: NeedKind.Terminals, key: "terminals", text: "📟 1 terminal silent", detail: "Kitchen", target: "more" }]);
    expect(hostNeeds({ now: 0, world: [], facts: null, wallet: null, cast: [], doorsOpen: true, silentTerminals: ["A", "B"] })[0]!.text).toBe("📟 2 terminals silent");
    expect(hostNeeds({ now: 0, world: [], facts: null, wallet: null, cast: [], doorsOpen: true, silentTerminals: [] })).toEqual([]);
  });
});

describe("award suggestions (moved from cockpit/award-suggest.ts)", () => {
  const row = (id: string, name: string, value: number, persona = false): RecapRowWire => ({ id, name, value, persona });
  const recap: RecapWire = {
    ending: "song",
    text: "Most trusted (trust)\n1. Ada 82",
    lists: {
      trust: [row("p1", "Director", 99, true), row("g1", "Ada", 82), row("g2", "Bob", 82), row("g3", "Cy", 40), row("g4", "Dee", 10), row("g5", "Eve", 10)],
      truths: [row("g1", "Ada", 3)],
      lies: [row("g3", "Cy", 0), row("g1", "Ada", 0)],
      internetVisits: [row("g4", "Dee", 4), row("g1", "Ada", 1)],
      codex: [row("p1", "Director", 40, true), row("g2", "Bob", 12)],
      quests: [],
      truthcoin: [row("g5", "Eve", 310)],
    },
    duck: [
      { id: "p1", name: "Director", ms: 30_000, time: "0:30", persona: true },
      { id: "g3", name: "Cy", ms: 83_400, time: "1:23", persona: false },
      { id: "g1", name: "Ada", ms: 83_400, time: "1:23", persona: false },
      { id: "g2", name: "Bob", ms: 99_000, time: "1:39", persona: false },
    ],
  };

  it("maps every ceremony award cue to a recap list", () => {
    expect(Object.keys(AWARD_SOURCES).sort()).toEqual([
      "award_best_liar",
      "award_duck_speedrun",
      "award_frequent_flyer",
      "award_least_trusted",
      "award_lore_hoarder",
      "award_most_trusted",
      "award_quest_completionist",
      "award_truthcoin_tycoon",
    ]);
  });
  it("skips personas and lists ties at the top", () => {
    expect(awardSuggestion("award_most_trusted", recap)).toEqual({ id: "g1", name: "Ada", value: "82", ties: [{ id: "g2", name: "Bob" }] });
    expect(awardSuggestion("award_lore_hoarder", recap)).toMatchObject({ id: "g2", value: "12", ties: [] });
  });
  it("reads Least Trusted off the bottom of the trust list, ties included", () => {
    expect(awardSuggestion("award_least_trusted", recap)).toEqual({ id: "g4", name: "Dee", value: "10", ties: [{ id: "g5", name: "Eve" }] });
  });
  it("suggests nobody for a count award where the top is 0, or an empty list", () => {
    expect(awardSuggestion("award_best_liar", recap)).toBeNull();
    expect(awardSuggestion("award_quest_completionist", recap)).toBeNull();
    expect(awardSuggestion("award_frequent_flyer", recap)).toMatchObject({ id: "g4", value: "4" });
    expect(awardSuggestion("award_truthcoin_tycoon", recap)).toMatchObject({ id: "g5", value: "310" });
  });
  it("reads the duck board as m:ss, skipping personas, with ties", () => {
    expect(awardSuggestion("award_duck_speedrun", recap)).toEqual({ id: "g3", name: "Cy", value: "1:23", ties: [{ id: "g1", name: "Ada" }] });
    expect(awardSuggestion("award_duck_speedrun", { ...recap, duck: [] })).toBeNull();
    expect(awardSuggestion("award_duck_speedrun", { ...recap, duck: undefined })).toBeNull();
  });
  it("is null for a non-award cue, no recap, or a missing list", () => {
    expect(awardSuggestion("award_the_ribbon", recap)).toBeNull();
    expect(awardSuggestion("award_most_trusted", null)).toBeNull();
    expect(awardSuggestion("award_most_trusted", { ...recap, lists: {} })).toBeNull();
  });
  it("hints the winner, the value and the ties", () => {
    expect(suggestionHint(awardSuggestion("award_most_trusted", recap)!)).toBe("suggested: Ada (82) · tied: Bob");
    expect(suggestionHint(awardSuggestion("award_lore_hoarder", recap)!)).toBe("suggested: Bob (12)");
    // An award the story lets only one program take (G10 is MS Paint's) offers them first, recap or not.
    const only = awardSuggestion("award_the_painting", null, { id: "g9", name: "MS Paint" })!;
    expect(only).toEqual({ id: "g9", name: "MS Paint", value: "", ties: [], only: true });
    expect(awardSuggestion("award_most_trusted", recap, { id: "g9", name: "MS Paint" })!.id).toBe("g9");
    expect(awardSuggestion("award_most_trusted", recap, null)!.id).toBe("g1");
    expect(suggestionHint(only)).toBe("only MS Paint can take this");
  });

  const empty: AwardFields = { winners: {}, values: {}, auto: {} };
  const roster = new Set(["g1", "g2", "g3", "g4", "g5"]);
  const s1 = { award_most_trusted: awardSuggestion("award_most_trusted", recap), award_best_liar: null };

  it("fillAwards: fills empty pickers and value boxes", () => {
    const f = fillAwards(empty, s1, roster);
    expect(f.winners).toEqual({ award_most_trusted: "g1" });
    expect(f.values).toEqual({ award_most_trusted: "82" });
    expect(f.auto).toEqual({ award_most_trusted: { winner: "g1", value: "82" } });
  });
  it("fillAwards: never overwrites a winner the director picked (nor its value)", () => {
    const mine: AwardFields = { winners: { award_most_trusted: "g3" }, values: {}, auto: {} };
    expect(fillAwards(mine, s1, roster)).toEqual(mine);
  });
  it("fillAwards: keeps a typed value but still fills an empty picker", () => {
    const f = fillAwards({ winners: {}, values: { award_most_trusted: "90" }, auto: {} }, s1, roster);
    expect(f.winners.award_most_trusted).toBe("g1");
    expect(f.values.award_most_trusted).toBe("90");
  });
  it("fillAwards: a refresh replaces its own earlier guess, not an edit", () => {
    const first = fillAwards(empty, s1, roster);
    const later = { award_most_trusted: { id: "g2", name: "Bob", value: "95", ties: [] } };
    expect(fillAwards(first, later, roster).winners.award_most_trusted).toBe("g2");
    expect(fillAwards(first, later, roster).values.award_most_trusted).toBe("95");
    const f = fillAwards({ ...first, values: { award_most_trusted: "70" } }, later, roster);
    expect(f.winners.award_most_trusted).toBe("g2");
    expect(f.values.award_most_trusted).toBe("70");
  });
  it("pickWinner: picking another winner clears the suggested winner's number", () => {
    const first = fillAwards(empty, s1, roster);
    const bob = pickWinner(first, "award_most_trusted", "g2");
    expect(bob.winners.award_most_trusted).toBe("g2");
    expect(bob.values.award_most_trusted).toBeUndefined();
    expect(bob.auto.award_most_trusted).toBeUndefined();
    expect(fillAwards(bob, s1, roster)).toEqual(bob);
    expect(pickWinner({ ...first, values: { award_most_trusted: "70" } }, "award_most_trusted", "g2").values.award_most_trusted).toBe("70");
    expect(pickWinner(first, "award_most_trusted", "g1")).toEqual(first);
  });
  it("fillAwards: skips a winner the roster does not list", () => {
    expect(fillAwards(empty, s1, new Set(["g2"]))).toEqual(empty);
  });
  it("nightEnded reads Night.ended", () => {
    expect(nightEnded([{ path: "Night.ended", value: "true" }])).toBe(true);
    expect(nightEnded([{ path: "Night.ended", value: "false" }])).toBe(false);
    expect(nightEnded([])).toBe(false);
  });
});

describe("hostView", () => {
  const filing = (over: Partial<FilingLike>): FilingLike => ({ person: "g1", name: "Ada", question: "Q1", answer: "x", confidence: 100, verdict: "accurate", final: null, how: null, by: null, at: 10, ...over });
  const mod = (over: Partial<ModLike> = {}): ModLike => ({
    title: "Night",
    theme: "aol97",
    phase: "open",
    interactions: [{ id: "open the doors", label: "🚪 Open", who: "admin" }, { id: "wave", label: "Wave", who: "performer" }],
    cues: { last: null, fired: [] },
    world: [{ path: "Night.phase", value: '"doors"' }, { path: "g3.persona", value: "true" }],
    roster: [
      { id: "g1", name: "Ada", location: "Hall", online: true, lastSeen: 1, restricted: true, captured: false },
      { id: "g2", name: "Bo", location: null, gone: true },
      { id: "g3", name: "Ghost", location: null },
      { id: "p4", name: "Mine", location: null, owner: "Jo" },
    ],
    cast: [
      { id: "Clippy", part: true, online: true, held: true },
      { id: "Trabolta", agent: true, online: true, agentQueue: { depth: 1, oldestMs: 2000, stalled: false } },
    ],
    facts: {
      mode: "auto",
      judge: "Trabolta",
      confirm: { accurate: "fact_accurate", lie: "fact_lie", uncertain: "fact_uncertain" },
      questions: [
        {
          id: "Q1",
          round: 1,
          text: "?",
          filings: [
            filing({ final: "accurate", how: "auto", at: 5 }),
            filing({ person: "g2", name: "Bo", at: 6, near: { key: "y" } }),
            filing({ person: "g3", name: "Ghost", final: "lie", how: "confirmed", at: 1, ruling: { by: "Trabolta", same: false, why: "", at: 50 } }),
          ],
        },
      ],
    },
    wallet: {
      name: "Truthcoin",
      stimulus: { uses: 1, limit: 3 },
      frozen: [{ target: "g1", targetName: "Ada", until: 99 }],
      open: { transfers: [{ id: "t1", state: "held", fromName: "Ada", toName: "Bo", amount: 5, settleAt: 70 }, { id: "t2", state: "pending", fromName: "Bo", toName: "Ada", amount: 1, settleAt: 80 }] },
    },
    alerts: { path: "Night.alerts", level: "dialog" },
    ...over,
  });
  const input = (over: Partial<HostViewInput> = {}): HostViewInput => ({
    mod: mod(),
    waiting: new Map([["Trabolta", [{ guest: "g2", name: "Bo", since: 20, text: "b".repeat(300) }, { guest: "g1", name: "Ada", since: 10, text: "hi" }]]]),
    king: { hp: 3, max: 15, fallen: false },
    terminals: { now: 1000, silentMs: 20_000, voiceMuted: true, terminals: [{ name: "Kitchen", ago: 30_000, view: "face", room: "The Kitchen" }, { name: "TV", ago: 500, view: "tv" }] },
    flags: new Map([["g1", [{ label: "Cleared", path: "Program.cleared", value: "false", on: false }]]]),
    staffRooms: ["room:hosts"],
    now: 1000,
    ...over,
  });

  it("builds on the cue sheet and adds the host's panel", () => {
    const v = hostView(input());
    expect(v.interactions.map((i) => i.id)).toEqual(["open the doors"]);
    expect(v.runtime).toBe("open");
    expect(v.alerts).toEqual({ path: "Night.alerts", level: "dialog" });
    expect(v.staffRooms).toEqual(["room:hosts"]);
    expect(v.king).toEqual({ hp: 3, max: 15, fallen: false });
    expect(v.terminals).toEqual({ voiceMuted: true, silentMs: 20_000, rows: [{ name: "Kitchen", agoMs: 30_000, room: "The Kitchen", view: "face" }, { name: "TV", agoMs: 500, view: "tv" }] });
    expect(v.needs.map((n) => n.kind)).toEqual([NeedKind.NearMiss, NeedKind.Held, NeedKind.Terminals]);
    expect(v.needs[2]!.detail).toBe("Kitchen");
    expect(v.wallet).toEqual({ name: "Truthcoin", held: [{ id: "t1", fromName: "Ada", toName: "Bo", amount: 5, settleAt: 70 }], frozen: [{ who: "g1", name: "Ada", until: 99 }], stimulus: { uses: 1, limit: 3 } });
    expect(v.parts).toEqual([{ id: "Clippy", presence: PartPresence.Online }]);
  });

  it("judging: pending + near, recent covers an auto-judged filing and a ruling, newest first, with buttons", () => {
    const j = hostView(input()).judging!;
    expect(j.mode).toBe("auto");
    expect(j.judge).toBe("Trabolta");
    expect(j.pending.map((r) => r.name)).toEqual(["Bo"]);
    expect(j.near).toBe(1);
    expect(j.recent.map((r) => [r.name, r.question, r.how])).toEqual([
      ["Ghost", "Q1", "confirmed"],
      ["Ada", "Q1", "auto"],
    ]);
    expect(j.recent[1]!.buttons.map((b) => b.verdict)).toEqual(["accurate", "lie", "uncertain"]);
    expect(hostView(input({ mod: mod({ facts: null }) })).judging).toBeNull();
  });

  it("agents carry their queue and the guests waiting, oldest first, text capped", () => {
    const [a] = hostView(input()).agents;
    expect(a).toMatchObject({ id: "Trabolta", online: true, queue: { depth: 1, oldestMs: 2000, stalled: false } });
    expect(a!.waiting.map((w) => w.guest)).toEqual(["g1", "g2"]);
    expect(a!.waiting[1]!.text).toHaveLength(200);
  });

  it("people: real guests and owned personas, flags, gone; an ownerless persona left out", () => {
    const people = hostView(input()).people;
    expect(people.map((p) => p.id)).toEqual(["g1", "g2", "p4"]);
    expect(people[0]).toEqual({ id: "g1", name: "Ada", location: "Hall", online: true, lastSeen: 1, restricted: true, captured: false, flags: [{ label: "Cleared", path: "Program.cleared", value: "false", on: false }] });
    expect(people[1]).toMatchObject({ gone: true, restricted: false, captured: false });
    expect(people[2]).toMatchObject({ persona: true });
  });

  it("judging recent: by log position when the server sends one (a restart re-stamps every `at`)", () => {
    const restarted = mod({
      facts: {
        mode: "auto",
        questions: [
          { id: "H1", round: 1, text: "?", filings: [filing({ question: "H1", final: "accurate", how: "auto", at: 7, logAt: 10 })] },
          { id: "H2", round: 2, text: "?", filings: [filing({ person: "g2", name: "Bo", question: "H2", final: "lie", how: "auto", at: 7, logAt: 30 })] },
          { id: "H3", round: 2, text: "?", filings: [filing({ person: "g3", name: "Cy", question: "H3", final: "accurate", how: "auto", at: 7, logAt: 20 })] },
        ],
      },
    });
    expect(hostView(input({ mod: restarted })).judging!.recent.map((r) => r.question)).toEqual(["H2", "H3", "H1"]);
    // Pending (oldest first) and the rulings list (newest first) follow the log too.
    const waiting = mod({
      facts: {
        mode: "review",
        questions: [
          { id: "H1", round: 1, text: "?", filings: [filing({ question: "H1", final: null, at: 7, logAt: 30 }), filing({ person: "g4", name: "Di", question: "H1", final: "accurate", at: 7, logAt: 25, ruling: { by: "agent:T", same: true, why: "", at: 7 } })] },
          { id: "H2", round: 2, text: "?", filings: [filing({ person: "g2", name: "Bo", question: "H2", final: null, at: 7, logAt: 10 }), filing({ person: "g5", name: "Ed", question: "H2", final: "accurate", at: 7, logAt: 40, ruling: { by: "agent:T", same: true, why: "", at: 7 } })] },
        ],
      },
    });
    expect(pendingFilings(waiting.facts!).map((r) => r.question)).toEqual(["H2", "H1"]);
    expect(ruledFilings(waiting.facts!).map((r) => r.name)).toEqual(["Ed", "Di"]);
    expect(newestFilingFirst({ at: 9, ruling: null }, { at: 1, ruling: { by: "T", same: true, why: "", at: 50 } })).toBeGreaterThan(0);
  });

  it("awardOnly rides the view when a cue has one; absent when none", () => {
    expect(hostView(input()).awardOnly).toBeUndefined();
    expect(hostView(input({ awardOnly: {} })).awardOnly).toBeUndefined();
    expect(hostView(input({ awardOnly: { award_the_painting: { id: "g9", name: "MS Paint" } } })).awardOnly).toEqual({ award_the_painting: { id: "g9", name: "MS Paint" } });
  });

  it("an old snapshot with nothing new still builds", () => {
    const v = hostView({ mod: { phase: "idle" }, waiting: new Map(), king: null, terminals: null, flags: new Map(), staffRooms: [], now: 0 });
    expect(v).toMatchObject({ runtime: "idle", needs: [], judging: null, wallet: null, king: null, terminals: null, agents: [], parts: [], people: [], alerts: { path: "Night.alerts", level: "sticky" }, doorsClosed: true });
  });
});

describe("hostNeeds with the judge ruling every non-exact filing (wave 18b, O4)", () => {
  const filing = (person: string, extra: Record<string, unknown>) => ({ person, name: person, question: "H2", answer: "x", confidence: 100, verdict: "lie", final: null, at: 1, ...extra });
  const facts = (filings: unknown[]): FactsLike => ({ mode: "auto", judge: "Trabolta", questions: [{ id: "H2", filings }] }) as unknown as FactsLike;
  const needs = (f: FactsLike) => hostNeeds({ now: 0, world: [], facts: f, wallet: null, cast: [], doorsOpen: true }).map((i) => [i.kind, i.text, i.target]);

  it("a plain miss waiting on a ruling is not 'to judge': it is with the judge", () => {
    expect(needs(facts([filing("g1", { asking: true }), filing("g2", { asking: true, queued: true }), filing("g3", { queued: true })]))).toEqual([[NeedKind.Ruling, "🤖 3 with Trabolta", "judge"]]);
  });

  it("near misses nobody is ruling stay to judge, beside the ones with the judge", () => {
    expect(needs(facts([filing("g1", { near: { key: "Mr. Pickles" } }), filing("g2", { asking: true, near: { key: "Mr. Pickles" } })]))).toEqual([
      [NeedKind.NearMiss, "⚠ 1 near miss to judge", "judge"],
      [NeedKind.Ruling, "🤖 1 with Trabolta", "judge"],
    ]);
  });

  it("in auto, a pending plain miss nobody is ruling (left from review mode) is not to judge", () => {
    expect(needs(facts([filing("g1", {}), filing("g2", { near: { key: "k" } })]))).toEqual([[NeedKind.NearMiss, "⚠ 1 near miss to judge", "judge"]]);
  });

  it("review mode counts only the filings nobody is ruling", () => {
    const f = { ...facts([filing("g1", {}), filing("g2", { asking: true })]), mode: "review" } as FactsLike;
    expect(needs(f)).toEqual([
      [NeedKind.Filings, "📝 1 filing to review", "judge"],
      [NeedKind.Ruling, "🤖 1 with Trabolta", "judge"],
    ]);
  });

  it("names 'the judge' when the view names none, and marks a queued row", () => {
    const f = { mode: "auto", questions: [{ id: "H2", filings: [filing("g1", { queued: true })] }] } as unknown as FactsLike;
    expect(needs(f)).toEqual([[NeedKind.Ruling, "🤖 1 with the judge", "judge"]]);
    expect(pendingFilings(f)[0]).toMatchObject({ asking: true, queued: true });
  });
});

describe("hostView people carry their badges (wave 18b)", () => {
  it("copies a roster row's badges", () => {
    const v = hostView({
      mod: { roster: [{ id: "g1", name: "Ada", location: null, badges: [{ glyph: "🚻", label: "Bathroom Mode" }] }, { id: "g2", name: "Bob", location: null }] } as never,
      waiting: new Map(),
      king: null,
      terminals: null,
      flags: new Map(),
      staffRooms: [],
      now: 0,
    });
    expect(v.people.map((p) => p.badges)).toEqual([[{ glyph: "🚻", label: "Bathroom Mode" }], undefined]);
  });
});
