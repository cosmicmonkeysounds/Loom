//! The wallet on the event server (wave 4, lane C): the guest / prime / mod
//! wallet routes, the pinned Wallet room's cards and threads, the approver's
//! booth (its `PrimeView.wallet` queue and the `@<Character>` cards on its
//! stream), the story clock settling + expiring through `tickOnce`, the
//! stimulus limit, the rate limit, and a restart that replays the journaled
//! `wallet` ops into the same balances, open items and threads.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { EventRuntime } from "../server/event-runtime.ts";
import { HOLD_MS } from "../server/wallet.ts";
import { Store } from "../server/store.ts";
import type { ChatMessage } from "../server/chat.ts";
import type { GuestView, ModView, PrimeView } from "../server/views.ts";

const CODES = { event: "EVT441", prime: "PRM441", mod: "MOD441" };

// A story with a currency: an approver who is a performer's part (a hook
// makes it one), a minter who is a bare program (a guest picks it), one
// codex entry to trade, and a ROLE that narrates what the book fires.
const SOURCE = `# Coin
directory: everyone
currency: score as Coin

CHARACTER Auditor
  wallet: approver, every 2, window 10s
  when scanned by guest:
    set guest.seen = true

CHARACTER Clerk
  when scanned by guest:
    set guest.clerked = true

CHARACTER Mint
  wallet: minter, limit 1

CODEX The Lease
  text: A lease.

CODEX Patch Sheet
  title: Patch Sheet A · 1 of 2
  text: The phone shows (and sends) the title, not the id.

ROLE Guest
  got: 0 to 100 = 0
  denials: 0 to 100 = 0
  when transfer_received for guest:
    set guest.got += 1
  when transfer_denied for guest:
    set guest.denials += 1
`;

// The same story with no `currency:` line — nothing wallet-shaped anywhere.
const NO_CURRENCY = SOURCE.replace("currency: score as Coin\n", "");

const dirs: string[] = [];
function runtimeIn(d: string, source = SOURCE, limits?: ConstructorParameters<typeof EventRuntime>[0]["limits"]): EventRuntime {
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "coin",
    scenarioSource: source,
    joinBase: () => "http://localhost",
    limits,
  });
}
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-wallet-"));
  dirs.push(d);
  return d;
}
function freshRuntime(source = SOURCE, limits?: ConstructorParameters<typeof EventRuntime>[0]["limits"]): EventRuntime {
  const rt = runtimeIn(freshDir(), source, limits);
  rt.openDoors();
  return rt;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown, token?: string): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: token ? { "x-loom-token": token } : {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
}
interface FakeRes {
  statusCode: number;
  body: string;
  frames: Array<{ event: string; data: unknown }>;
}
function fakeRes(): ServerResponse & FakeRes {
  const res = {
    statusCode: 0,
    body: "",
    frames: [] as Array<{ event: string; data: unknown }>,
    pendingEvent: null as string | null,
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write(chunk: string) {
      const ev = /^event: (\S+)\n$/u.exec(chunk);
      if (ev) res.pendingEvent = ev[1]!;
      const data = /^data: (.*)\n\n$/su.exec(chunk);
      if (data && res.pendingEvent !== null) res.frames.push({ event: res.pendingEvent, data: JSON.parse(data[1]!) });
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res as unknown as ServerResponse & FakeRes;
}
async function post(rt: EventRuntime, path: string, body: unknown, token?: string, moderator = false) {
  const res = fakeRes();
  await rt.handle(fakeReq(body, token), res, "POST", path, new URL(`http://x${path}`), { moderator });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
async function get(rt: EventRuntime, path: string, moderator = false) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq({}), res, "GET", url.pathname, url, { moderator });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
async function stream(rt: EventRuntime, role: string, token: string): Promise<FakeRes> {
  const res = fakeRes();
  const url = new URL(`http://x/events?role=${role}&token=${encodeURIComponent(token)}`);
  await rt.handle(fakeReq({}), res, "GET", "/events", url, {});
  return res;
}
async function guest(rt: EventRuntime, name: string, score = 100): Promise<{ id: string; token: string }> {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  expect(r.status).toBe(200);
  const g = { id: r.json.id as string, token: r.json.token as string };
  if (score > 0) expect((await post(rt, "/api/mod/set", { id: g.id, field: "score", value: score }, undefined, true)).status).toBe(200);
  return g;
}
async function performer(rt: EventRuntime, character: string): Promise<string> {
  const r = await post(rt, "/api/prime/login", { character, passcode: CODES.prime });
  expect(r.status).toBe(200);
  return r.json.token as string;
}
async function guestState(rt: EventRuntime, token: string): Promise<GuestView> {
  return (await get(rt, `/api/state?role=guest&token=${encodeURIComponent(token)}`)).json as unknown as GuestView;
}
async function primeState(rt: EventRuntime, token: string): Promise<PrimeView> {
  return (await get(rt, `/api/state?role=prime&token=${encodeURIComponent(token)}`)).json as unknown as PrimeView;
}
async function modState(rt: EventRuntime): Promise<ModView> {
  return (await get(rt, "/api/state", true)).json as unknown as ModView;
}
const wallet = (rt: EventRuntime, sub: string, body: unknown, token: string) => post(rt, `/api/guest/wallet/${sub}`, body, token);
const walletRoom = (rt: EventRuntime, id: string): ChatMessage[] => rt.chatHistoryFor(id).filter((m) => m.channel === "wallet");
const rows = (ms: ChatMessage[]) => ms.map((m) => [m.wallet?.kind, m.wallet?.step, m.parentSeq === null ? "root" : "step"]);
/** A numeric world slot (`<id>.got`) as a plain number. */
const num = (rt: EventRuntime, path: string): unknown => (rt.liveSim!.world.get(path) as { value?: unknown } | null)?.value;

describe("the wallet is opt-in by declaration", () => {
  it("a story with no `currency:` has no wallet anywhere: no view field, no room, 404 on every route", async () => {
    const rt = freshRuntime(NO_CURRENCY);
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    expect((await guestState(rt, a.token)).wallet).toBeUndefined();
    expect((await primeState(rt, await performer(rt, "Auditor"))).wallet).toBeUndefined();
    expect((await modState(rt)).wallet).toBeUndefined();
    expect(await wallet(rt, "send", { to: b.id, amount: 5 }, a.token)).toMatchObject({ status: 404, json: { error: "this story has no currency" } });
    expect((await post(rt, "/api/mod/wallet/stimulus", { amount: 5 }, undefined, true)).status).toBe(404);
  });

  it("with one, every guest carries a wallet view and the director a mirror; the Wallet room takes no typed chat", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const v = (await guestState(rt, a.token)).wallet!;
    expect(v).toMatchObject({ name: "Coin", balance: 100, escrowed: 0, maxTransfer: 500, transfers: [], requests: [], offers: [] });
    expect(v.minter).toBeUndefined();
    expect((await modState(rt)).wallet).toMatchObject({ name: "Coin", slot: "score", approver: "Auditor", minter: "Mint", minterPerson: null, counter: 0, stimulus: { uses: 0, limit: 1 } });
    expect((await post(rt, "/api/guest/say", { channel: "wallet", text: "hi" }, a.token)).status).toBe(403);
  });
});

describe("sending coin", () => {
  it("refuses a bad amount (400), an unknown recipient (404), yourself and an empty balance (409); a missing session is 401", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    expect((await wallet(rt, "send", { to: b.id, amount: 5 }, "nope")).status).toBe(401);
    expect(await wallet(rt, "send", { to: b.id, amount: 0 }, a.token)).toMatchObject({ status: 400, json: { error: "amount must be a whole number from 1 to 500" } });
    expect((await wallet(rt, "send", { to: b.id, amount: 2.5 }, a.token)).status).toBe(400);
    expect((await wallet(rt, "send", { to: b.id, amount: 501 }, a.token)).status).toBe(400);
    expect((await wallet(rt, "send", { to: b.id, amount: "abc" }, a.token)).status).toBe(400);
    expect(await wallet(rt, "send", { to: "ghost", amount: 5 }, a.token)).toMatchObject({ status: 404, json: { error: "unknown recipient" } });
    expect(await wallet(rt, "send", { to: a.id, amount: 5 }, a.token)).toMatchObject({ status: 409, json: { error: "you can't send to yourself" } });
    expect(await wallet(rt, "send", { to: b.id, amount: 101 }, a.token)).toMatchObject({ status: 409, json: { error: "insufficient funds" } });
    // Nothing was journaled or dealt.
    expect(walletRoom(rt, a.id)).toEqual([]);
    expect((await guestState(rt, a.token)).wallet!.balance).toBe(100);
  });

  it("a send escrows at once, deals both parties their cards, and settles when the window elapses on the story clock", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    const r = await wallet(rt, "send", { to: b.id, amount: 30 }, a.token);
    expect(r.status).toBe(200);
    expect(r.json["ok"]).toBe(true);
    const mine = r.json["wallet"] as GuestView["wallet"];
    expect(mine).toMatchObject({ balance: 70, escrowed: 30 });
    expect(mine!.transfers.map((t) => [t.id, t.state, t.settleAt])).toEqual([["t1", "pending", 10_000]]);
    // The sender's root card, with the approver named and the countdown.
    expect(rows(walletRoom(rt, a.id))).toEqual([["transfer", "pending", "root"]]);
    expect(walletRoom(rt, a.id)[0]!.text).toBe("💸 You sent 30 Coin to Bob — settles in 10 s unless Auditor denies it.");
    expect(walletRoom(rt, a.id)[0]!.wallet).toMatchObject({ id: "t1", approver: "Auditor", settleAt: 10_000 });
    // The receiver hears nothing until it settles.
    expect(walletRoom(rt, b.id)).toEqual([]);
    expect((await guestState(rt, b.token)).wallet!.balance).toBe(100);
    // 9 s: not yet. 10 s: settled — the receiver's root card, the sender's step, the story's hook.
    rt.tickOnce(9_000);
    expect((await guestState(rt, b.token)).wallet!.balance).toBe(100);
    rt.tickOnce(1_000);
    expect((await guestState(rt, b.token)).wallet!.balance).toBe(130);
    expect((await guestState(rt, a.token)).wallet).toMatchObject({ balance: 70, escrowed: 0 });
    const sender = walletRoom(rt, a.id);
    expect(rows(sender)).toEqual([
      ["transfer", "pending", "root"],
      ["transfer", "settled", "step"],
    ]);
    expect(sender[1]!.parentSeq).toBe(sender[0]!.seq);
    expect(rows(walletRoom(rt, b.id))).toEqual([["transfer", "received", "root"]]);
    expect(num(rt, `${b.id}.got`)).toBe(1);
    expect(num(rt, `${a.id}.got`)).toBe(0);
    // A guest's wallet rows are theirs alone.
    expect(walletRoom(rt, b.id).every((m) => m.audience === "all" || m.audience.includes(b.id))).toBe(true);
  });

  it("every Nth transfer is held for the approver's booth: its queue, its stream, Approve settles; the wrong booth is refused", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    const auditor = await performer(rt, "Auditor");
    const clerk = await performer(rt, "Clerk");
    const aStream = await stream(rt, "prime", auditor);
    const cStream = await stream(rt, "prime", clerk);
    expect((await wallet(rt, "send", { to: b.id, amount: 10 }, a.token)).status).toBe(200); // #1 pending
    expect((await wallet(rt, "send", { to: b.id, amount: 20 }, a.token)).status).toBe(200); // #2 held
    const q = (await primeState(rt, auditor)).wallet!;
    expect(q).toMatchObject({ name: "Coin", every: 2, windowMs: 10_000 });
    expect(q.queue.map((t) => [t.id, t.state])).toEqual([
      ["t2", "held"],
      ["t1", "pending"],
    ]);
    expect((await primeState(rt, clerk)).wallet).toBeUndefined();
    // The approval cards ride the Auditor's stream as `@Auditor`, nobody else's.
    const seen = (r: FakeRes) => r.frames.filter((f) => f.event === "message").map((f) => f.data as ChatMessage).filter((m) => m.channel === "wallet");
    expect(seen(aStream).map((m) => [m.audience, m.wallet?.kind, m.wallet?.step])).toEqual([
      [["@Auditor"], "approval", "pending"],
      [["@Auditor"], "approval", "held"],
    ]);
    expect(seen(cStream)).toEqual([]);
    expect(walletRoom(rt, b.id)).toEqual([]);
    // A fresh booth stream replays them in its history.
    const again = await stream(rt, "prime", auditor);
    const history = again.frames.find((f) => f.event === "history")!.data as ChatMessage[];
    expect(history.filter((m) => m.channel === "wallet").map((m) => m.audience)).toEqual([["@Auditor"], ["@Auditor"]]);
    // The sender sees it waiting and may cancel a held one (not a pending one).
    expect(rows(walletRoom(rt, a.id))).toEqual([
      ["transfer", "pending", "root"],
      ["transfer", "held", "root"],
    ]);
    expect((await wallet(rt, "cancel", { id: "t1" }, a.token)).status).toBe(409);
    expect((await wallet(rt, "cancel", { id: "t2" }, b.token)).status).toBe(404);
    // Approve: the Clerk can't, the Auditor can; a guest can't (not the approver).
    expect(await post(rt, "/api/prime/wallet/approve", { id: "t2" }, clerk)).toMatchObject({ status: 403, json: { error: "not the approver" } });
    expect(await wallet(rt, "approve", { id: "t2" }, a.token)).toMatchObject({ status: 403, json: { error: "not the approver" } });
    expect((await post(rt, "/api/prime/wallet/approve", { id: "t1" }, auditor)).status).toBe(409); // pending settles on its own
    const ok = await post(rt, "/api/prime/wallet/approve", { id: "t2" }, auditor);
    expect(ok.status).toBe(200);
    expect((ok.json["queue"] as { queue: unknown[] }).queue.map((t) => (t as { id: string }).id)).toEqual(["t1"]);
    expect((await guestState(rt, b.token)).wallet!.balance).toBe(120);
    expect(rows(walletRoom(rt, b.id))).toEqual([["transfer", "received", "root"]]);
    expect(rows(walletRoom(rt, a.id)).at(-1)).toEqual(["transfer", "approved", "step"]);
    expect(walletRoom(rt, a.id).at(-1)!.wallet!.by).toBe("Auditor");
    expect((await post(rt, "/api/prime/wallet/approve", { id: "t2" }, auditor)).status).toBe(409);
    expect((await post(rt, "/api/prime/wallet/approve", { id: "t9" }, auditor)).status).toBe(404);
  });

  it("a deny inside the window refunds the sender and tells the story; after settlement it is too late", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    const auditor = await performer(rt, "Auditor");
    expect((await wallet(rt, "send", { to: b.id, amount: 40 }, a.token)).status).toBe(200);
    rt.tickOnce(5_000);
    expect((await post(rt, "/api/prime/wallet/deny", { id: "t1" }, auditor)).status).toBe(200);
    expect((await guestState(rt, a.token)).wallet).toMatchObject({ balance: 100, escrowed: 0 });
    expect((await guestState(rt, b.token)).wallet!.balance).toBe(100);
    expect(num(rt, `${a.id}.denials`)).toBe(1);
    expect(rows(walletRoom(rt, a.id))).toEqual([
      ["transfer", "pending", "root"],
      ["transfer", "denied", "step"],
    ]);
    expect(walletRoom(rt, a.id)[1]!.text).toBe("⛔ Denied by Auditor: 40 Coin to Bob. Refunded.");
    rt.tickOnce(10_000); // nothing left to settle
    expect((await guestState(rt, b.token)).wallet!.balance).toBe(100);
    // A second send settles; then a deny is too late — and the director's deny too.
    expect((await wallet(rt, "send", { to: b.id, amount: 5 }, a.token)).status).toBe(200); // #2 → held
    expect((await post(rt, "/api/mod/wallet/deny", { id: "t2" }, undefined, true)).status).toBe(200); // the director denies a held one
    expect((await guestState(rt, a.token)).wallet!.balance).toBe(100);
    expect(walletRoom(rt, a.id).at(-1)!.wallet!.by).toBe("Director");
    expect((await wallet(rt, "send", { to: b.id, amount: 5 }, a.token)).status).toBe(200); // #3 → pending
    rt.tickOnce(10_000);
    expect(await post(rt, "/api/prime/wallet/deny", { id: "t3" }, auditor)).toMatchObject({ status: 409, json: { error: "too late — already settled" } });
    expect((await post(rt, "/api/mod/wallet/deny", { id: "t3" }, undefined, true)).status).toBe(409);
  });

  it("the rate limit answers 429 past `LOOM_RL_WALLET` without journaling the call", async () => {
    const rt = freshRuntime(SOURCE, { wallet: { max: 2, windowMs: 60_000 } });
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    expect((await wallet(rt, "send", { to: b.id, amount: 1 }, a.token)).status).toBe(200);
    expect((await wallet(rt, "send", { to: b.id, amount: 1 }, a.token)).status).toBe(200);
    expect(await wallet(rt, "send", { to: b.id, amount: 1 }, a.token)).toMatchObject({ status: 429, json: { error: "slow down — wait a minute" } });
    expect((await guestState(rt, a.token)).wallet!.balance).toBe(98);
    // A refusal the book makes (400) is not a call that counts.
    expect((await wallet(rt, "send", { to: b.id, amount: 0 }, b.token)).status).toBe(400);
    expect((await wallet(rt, "send", { to: a.id, amount: 1 }, b.token)).status).toBe(200);
  });

  it("coin in a deny window rides `<id>.escrowed`, so a majority over score + escrowed doesn't fire early (W6 B15)", async () => {
    const source = SOURCE.replace("every 2, window 10s", "every 100, window 10s").replace(
      "  when transfer_received for guest:\n",
      "  majority: bool = false\n  when count([p for p in Persons where p.score > 0]) >= 3 and self.score * 2 > sum([p.score + p.escrowed for p in Persons]):\n    set self.majority = true\n  when transfer_received for guest:\n",
    );
    const d = freshDir();
    const rt = runtimeIn(d, source);
    rt.openDoors();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    const c = await guest(rt, "Cy");
    const sim = rt.liveSim!;
    const num = (path: string) => sim.world.peek(path);
    expect((await wallet(rt, "send", { to: a.id, amount: 50 }, c.token)).status).toBe(200);
    expect(num(`${c.id}.escrowed`)).toEqual({ kind: "number", value: 50 });
    rt.tickOnce(10_000); // settles: Alice 150 of 300 — exactly half
    expect(num(`${c.id}.escrowed`)).toEqual({ kind: "number", value: 0 });
    expect(sim.scoreOf(a.id)).toBe(150);
    // Bob → Cy sits in its window: 290 scored, but 300 exist.
    expect((await wallet(rt, "send", { to: c.id, amount: 10 }, b.token)).status).toBe(200);
    expect(num(`${a.id}.majority`)).toEqual({ kind: "bool", value: false });
    rt.tickOnce(10_000);
    expect(num(`${a.id}.majority`)).toEqual({ kind: "bool", value: false });
    // One more coin to Alice is a real majority (151 of 300).
    expect((await wallet(rt, "send", { to: a.id, amount: 1 }, b.token)).status).toBe(200);
    expect(num(`${a.id}.majority`)).toEqual({ kind: "bool", value: false });
    rt.tickOnce(10_000);
    expect(num(`${a.id}.majority`)).toEqual({ kind: "bool", value: true });
    // A restart mid-window replays the journal onto the same mirror.
    expect((await wallet(rt, "send", { to: c.id, amount: 5 }, b.token)).status).toBe(200);
    const mirror = (s: typeof sim) => s.worldEntries().filter((e) => e.path.endsWith(".escrowed"));
    expect(mirror(sim)).toContainEqual({ path: `${b.id}.escrowed`, value: "5" });
    const rt2 = runtimeIn(d, source);
    expect(rt2.restore()).not.toBeNull();
    expect(mirror(rt2.liveSim!)).toEqual(mirror(sim));
  });

  it("backing out (cancel / decline) is never rate-limited, and a 429 spends no id (W6 B10)", async () => {
    const rt = freshRuntime(SOURCE, { wallet: { max: 2, windowMs: 60_000 } });
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    expect((await post(rt, "/api/mod/codex", { who: a.id, entry: "The Lease" }, undefined, true)).status).toBe(200);
    expect((await wallet(rt, "offer", { to: b.id, entry: "The Lease", side: "sell", amount: 5 }, a.token)).status).toBe(200); // o1
    // Bob opens two requests (his limit), then is over it.
    expect((await wallet(rt, "request", { from: a.id, amount: 1 }, b.token)).status).toBe(200); // r2
    expect((await wallet(rt, "request", { from: a.id, amount: 1 }, b.token)).status).toBe(200); // r3
    expect((await wallet(rt, "request", { from: a.id, amount: 1 }, b.token)).status).toBe(429);
    // Over the limit he can still back out: decline Alice's offer, withdraw a request.
    expect((await wallet(rt, "decline", { id: "o1" }, b.token)).status).toBe(200);
    expect((await wallet(rt, "cancel", { id: "r2" }, b.token)).status).toBe(200);
    expect((await wallet(rt, "cancel", { id: "r3" }, b.token)).status).toBe(200);
    // The next id is r4: Bob's 429 never spent one.
    expect((await wallet(rt, "request", { from: b.id, amount: 1 }, a.token)).status).toBe(200);
    expect((await guestState(rt, a.token)).wallet!.requests.map((r) => r.id)).toEqual(["r4"]);
  });

  it("declining an incoming request is backing out too: never rate-limited, while paying one still is (W6 B10 review)", async () => {
    const rt = freshRuntime(SOURCE, { wallet: { max: 2, windowMs: 60_000 } });
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    // Alice asks Bob twice; Bob spends his limit, then is over it.
    expect((await wallet(rt, "request", { from: b.id, amount: 1 }, a.token)).status).toBe(200); // r1
    expect((await wallet(rt, "request", { from: b.id, amount: 1 }, a.token)).status).toBe(200); // r2
    expect((await wallet(rt, "request", { from: a.id, amount: 1 }, b.token)).status).toBe(200); // r3
    expect((await wallet(rt, "cancel", { id: "r3" }, b.token)).status).toBe(200);
    expect((await wallet(rt, "request", { from: a.id, amount: 1 }, b.token)).status).toBe(200); // r4
    expect((await wallet(rt, "respond", { id: "r1", accept: true }, b.token)).status).toBe(429);
    // The phone's Decline on a request card: `respond {accept: false}`.
    expect((await wallet(rt, "respond", { id: "r1", accept: false }, b.token)).status).toBe(200);
    expect((await wallet(rt, "respond", { id: "r2" }, b.token)).status).toBe(200);
    expect((await guestState(rt, b.token)).wallet!.requests.map((r) => r.id)).toEqual(["r4"]);
  });

  it("a refused offer still counts, so guessing codex titles hits the limit", async () => {
    const rt = freshRuntime(SOURCE, { wallet: { max: 2, windowMs: 60_000 } });
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    const guess = (entry: string) => wallet(rt, "offer", { to: b.id, entry, side: "buy", amount: 1 }, a.token);
    expect((await guess("Guess One")).status).toBe(409);
    expect((await guess("Guess Two")).status).toBe(409);
    expect(await guess("The Lease")).toMatchObject({ status: 429, json: { error: "slow down — wait a minute" } });
    expect(await guess("Guess Three")).toMatchObject({ status: 429 });
  });
});

describe("requests", () => {
  it("asks the payer, who pays (a linked send) or declines; a request nobody answers expires on the story clock", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    expect((await wallet(rt, "request", { from: a.id, amount: 25 }, a.token)).status).toBe(409); // can't ask yourself
    expect((await wallet(rt, "request", { from: "ghost", amount: 25 }, a.token)).status).toBe(404);
    const r = await wallet(rt, "request", { from: b.id, amount: 25 }, a.token);
    expect(r.status).toBe(200);
    expect((r.json["wallet"] as GuestView["wallet"])!.requests.map((x) => [x.id, x.from, x.to, x.state, x.expiresAt])).toEqual([["r1", a.id, b.id, "open", 600_000]]);
    expect(rows(walletRoom(rt, b.id))).toEqual([["request", "asked", "root"]]);
    expect(rows(walletRoom(rt, a.id))).toEqual([["request", "sent", "root"]]);
    // Only the payer may answer it.
    expect((await wallet(rt, "respond", { id: "r1", accept: true }, a.token)).status).toBe(404);
    expect((await wallet(rt, "respond", { id: "r1", accept: true }, b.token)).status).toBe(200);
    expect((await guestState(rt, b.token)).wallet).toMatchObject({ balance: 75, escrowed: 25 });
    expect((await guestState(rt, b.token)).wallet!.requests.map((x) => x.state)).toEqual(["paying"]);
    expect((await wallet(rt, "respond", { id: "r1", accept: false }, b.token)).status).toBe(409); // already answered
    rt.tickOnce(10_000);
    expect((await guestState(rt, a.token)).wallet!.balance).toBe(125);
    expect(rows(walletRoom(rt, a.id))).toEqual([
      ["request", "sent", "root"],
      ["transfer", "received", "root"],
      ["request", "paid", "step"],
    ]);
    // A declined request, and one that expires. (Ids share one counter:
    // the payment above was t2, so these are r3 and r4.)
    expect((await wallet(rt, "request", { from: b.id, amount: 5 }, a.token)).status).toBe(200); // r3
    expect((await wallet(rt, "respond", { id: "r3", accept: false }, b.token)).status).toBe(200);
    expect(rows(walletRoom(rt, a.id)).at(-1)).toEqual(["request", "declined", "step"]);
    expect((await wallet(rt, "request", { from: b.id, amount: 5 }, a.token)).status).toBe(200); // r4
    rt.tickOnce(599_000);
    expect((await guestState(rt, a.token)).wallet!.requests.map((x) => x.id)).toEqual(["r4"]);
    rt.tickOnce(1_000);
    expect((await guestState(rt, a.token)).wallet!.requests).toEqual([]);
    expect(rows(walletRoom(rt, a.id)).at(-1)).toEqual(["request", "expired", "step"]);
    expect(rows(walletRoom(rt, b.id)).at(-1)).toEqual(["request", "expired", "step"]);
    expect((await wallet(rt, "respond", { id: "r4", accept: true }, b.token)).status).toBe(409);
  });
});

describe("offers (trading a fact)", () => {
  it("a sell offer: the buyer pays at Accept and the entry changes hands through `share`; a buy offer escrows and refunds on Decline", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    expect((await post(rt, "/api/mod/codex", { who: a.id, entry: "The Lease" }, undefined, true)).status).toBe(200);
    expect(await wallet(rt, "offer", { to: b.id, entry: "Nope", side: "sell", amount: 10 }, a.token)).toMatchObject({ status: 404, json: { error: "you don't hold that entry" } });
    expect(await wallet(rt, "offer", { to: a.id, entry: "The Lease", side: "sell", amount: 10 }, b.token)).toMatchObject({ status: 404, json: { error: "you don't hold that entry" } });
    const o = await wallet(rt, "offer", { to: b.id, entry: "the lease", side: "sell", amount: 10 }, a.token);
    expect(o.status).toBe(200);
    expect((o.json["wallet"] as GuestView["wallet"])!.offers.map((x) => [x.id, x.side, x.entry, x.entryTitle, x.state])).toEqual([["o1", "sell", "The Lease", "The Lease", "open"]]);
    expect(rows(walletRoom(rt, b.id))).toEqual([["offer", "offered", "root"]]);
    expect(walletRoom(rt, b.id)[0]!.text).toBe("💱 Alice offers you “The Lease” for 10 Coin.");
    expect((await wallet(rt, "accept", { id: "o1" }, a.token)).status).toBe(404); // not the counterparty
    expect((await wallet(rt, "accept", { id: "o1" }, b.token)).status).toBe(200);
    expect((await guestState(rt, b.token)).wallet!.balance).toBe(90);
    expect((await guestState(rt, a.token)).wallet!.balance).toBe(110);
    expect(rt.liveSim!.holdsCodex(b.id, "The Lease")).toBe(true);
    expect(rt.chatHistoryFor(b.id).filter((m) => m.channel === "codex").map((m) => [m.kind, m.codex?.via, m.codex?.from])).toEqual([["codex", "share", "Alice"]]);
    expect(rows(walletRoom(rt, a.id)).at(-1)).toEqual(["offer", "accepted", "step"]);
    // Bob now holds it; Alice can't sell it to him again — the accept fails inside apply, deterministically.
    expect((await wallet(rt, "offer", { to: b.id, entry: "The Lease", side: "sell", amount: 10 }, a.token)).status).toBe(200); // o2
    expect((await wallet(rt, "accept", { id: "o2" }, b.token)).status).toBe(200);
    expect(rows(walletRoom(rt, b.id)).at(-1)).toEqual(["offer", "failed", "step"]);
    expect((await guestState(rt, b.token)).wallet!.balance).toBe(90);
    // A buy offer escrows the buyer's coin; Decline refunds it.
    expect(await wallet(rt, "offer", { to: b.id, entry: "The Lease", side: "buy", amount: 95 }, a.token)).toMatchObject({ status: 200 });
    expect((await guestState(rt, a.token)).wallet).toMatchObject({ balance: 15, escrowed: 95 });
    expect((await wallet(rt, "decline", { id: "o3" }, b.token)).status).toBe(200);
    expect((await guestState(rt, a.token)).wallet).toMatchObject({ balance: 110, escrowed: 0 });
    expect(await wallet(rt, "offer", { to: b.id, entry: "The Lease", side: "buy", amount: 111 }, a.token)).toMatchObject({ status: 409, json: { error: "insufficient funds" } });
    // The maker may withdraw an open offer.
    expect((await wallet(rt, "offer", { to: b.id, entry: "The Lease", side: "buy", amount: 5 }, a.token)).status).toBe(200); // o4
    expect((await wallet(rt, "cancel", { id: "o4" }, a.token)).status).toBe(200);
    expect((await guestState(rt, a.token)).wallet).toMatchObject({ balance: 110, escrowed: 0, offers: [] });
  });
});

describe("offers resolve titles and can't probe the codex", () => {
  it("sells an entry by its display title (title ≠ id); a buy never reveals what the seller holds; an unknown entry gets one generic 409", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    const c = await guest(rt, "Cleo");
    expect((await post(rt, "/api/mod/codex", { who: a.id, entry: "Patch Sheet" }, undefined, true)).status).toBe(200);
    const o = await wallet(rt, "offer", { to: b.id, entry: "Patch Sheet A · 1 of 2", side: "sell", amount: 10 }, a.token);
    expect(o.status).toBe(200);
    expect((o.json["wallet"] as GuestView["wallet"])!.offers.map((x) => [x.entry, x.entryTitle])).toEqual([["Patch Sheet", "Patch Sheet A · 1 of 2"]]);
    expect((await wallet(rt, "accept", { id: "o1" }, b.token)).status).toBe(200);
    expect(rt.liveSim!.holdsCodex(b.id, "Patch Sheet")).toBe(true);
    // A buy of no entry at all gets the generic refusal and mints no card.
    const generic = { status: 409, json: { error: "they don't have that to sell" } };
    expect(await wallet(rt, "offer", { to: c.id, entry: "No Such Entry", side: "buy", amount: 10 }, a.token)).toMatchObject(generic);
    expect(walletRoom(rt, c.id)).toEqual([]);
    // A buy from one who doesn't hold it is not refused (a refusal would tell
    // the buyer what Cleo holds, unseen): Cleo gets the card, and accepting
    // fails on the re-check, refunding the escrow.
    expect((await wallet(rt, "offer", { to: c.id, entry: "Patch Sheet A · 1 of 2", side: "buy", amount: 10 }, a.token)).status).toBe(200);
    expect(rows(walletRoom(rt, c.id)).at(-1)).toEqual(["offer", "offered", "root"]);
    expect((await wallet(rt, "accept", { id: "o2" }, c.token)).status).toBe(200);
    expect(rt.liveSim!.holdsCodex(a.id, "Patch Sheet")).toBe(true);
    expect(rt.liveSim!.holdsCodex(c.id, "Patch Sheet")).toBe(false);
    // From one who holds it, the buy goes through by title.
    expect((await wallet(rt, "offer", { to: b.id, entry: "patch sheet a · 1 of 2", side: "buy", amount: 5 }, c.token)).status).toBe(200);
    expect(rows(walletRoom(rt, b.id)).at(-1)).toEqual(["offer", "offered", "root"]);
  });
});

describe("a held transfer times out", () => {
  it("settles itself after HOLD_MS on the story clock (timed_out, no approval credited) and a restart replays it", async () => {
    const d = freshDir();
    const rt = runtimeIn(d);
    rt.openDoors();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    expect((await wallet(rt, "send", { to: b.id, amount: 10 }, a.token)).status).toBe(200); // t1 pending
    expect((await wallet(rt, "send", { to: b.id, amount: 20 }, a.token)).status).toBe(200); // t2 held
    const t2 = (await guestState(rt, a.token)).wallet!.transfers.find((t) => t.id === "t2")!;
    expect(t2).toMatchObject({ state: "held", settleAt: rt.liveSim!.elapsed() + HOLD_MS });
    rt.tickOnce(10_000); // t1 settles
    expect((await guestState(rt, b.token)).wallet!.balance).toBe(110);
    rt.tickOnce(t2.settleAt! - rt.liveSim!.elapsed() - 1_000);
    expect((await modState(rt)).wallet!.open.transfers.map((t) => t.id)).toEqual(["t2"]);
    rt.tickOnce(1_000);
    expect((await guestState(rt, b.token)).wallet!.balance).toBe(130);
    expect((await modState(rt)).wallet!.open.transfers).toEqual([]);
    expect(rows(walletRoom(rt, a.id)).at(-1)).toEqual(["transfer", "timed_out", "step"]);
    expect(walletRoom(rt, a.id).at(-1)!.text).toBe("✅ Approved automatically: 20 Coin to Bob.");
    expect(num(rt, `${b.id}.got`)).toBe(2);

    const rt2 = runtimeIn(d);
    expect(rt2.restore()).not.toBeNull();
    expect((await guestState(rt2, b.token)).wallet!.balance).toBe(130);
    expect((await modState(rt2)).wallet!.open.transfers).toEqual([]);
    expect(rows(walletRoom(rt2, a.id))).toEqual(rows(walletRoom(rt, a.id)));
  });

  it("approve-held approves every held transfer at once, by the director; pending ones keep their window", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    for (const amount of [1, 2, 3, 4]) expect((await wallet(rt, "send", { to: b.id, amount }, a.token)).status).toBe(200); // t1 t3 pending, t2 t4 held
    expect((await post(rt, "/api/mod/wallet/approve-held", {}, a.token)).status).toBe(403); // moderators only
    const r = await post(rt, "/api/mod/wallet/approve-held", {}, undefined, true);
    expect(r.status).toBe(200);
    expect(r.json["approved"]).toEqual(["t2", "t4"]);
    expect((r.json["wallet"] as ModView["wallet"])!.open.transfers.map((t) => [t.id, t.state])).toEqual([
      ["t1", "pending"],
      ["t3", "pending"],
    ]);
    expect((await guestState(rt, b.token)).wallet!.balance).toBe(106);
    expect(walletRoom(rt, a.id).filter((m) => m.wallet?.step === "approved").map((m) => m.wallet?.by)).toEqual(["Director", "Director"]);
    expect((await post(rt, "/api/mod/wallet/approve-held", {}, undefined, true)).json["approved"]).toEqual([]);
  });
});

describe("a restricted guest's wallet is frozen", () => {
  it("send / request / respond / offer / accept / stimulus are 403; decline + cancel still work; the director and others are untouched", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    expect((await post(rt, "/api/mod/codex", { who: b.id, entry: "The Lease" }, undefined, true)).status).toBe(200);
    expect((await wallet(rt, "request", { from: a.id, amount: 5 }, b.token)).status).toBe(200); // r1: Bob asks Alice
    expect((await wallet(rt, "offer", { to: a.id, entry: "The Lease", side: "sell", amount: 5 }, b.token)).status).toBe(200); // o2
    expect((await wallet(rt, "offer", { to: a.id, entry: "The Lease", side: "sell", amount: 6 }, b.token)).status).toBe(200); // o3
    expect((await wallet(rt, "request", { from: b.id, amount: 5 }, a.token)).status).toBe(200); // r4: Alice asks Bob
    expect((await post(rt, "/api/mod/act", { id: a.id, action: "restrict" }, undefined, true)).status).toBe(200);
    const frozen = { status: 403, json: { error: "you're restricted — the story has to lift it first" } };
    expect(await wallet(rt, "send", { to: b.id, amount: 5 }, a.token)).toMatchObject(frozen);
    expect(await wallet(rt, "request", { from: b.id, amount: 5 }, a.token)).toMatchObject(frozen);
    expect(await wallet(rt, "respond", { id: "r1", accept: true }, a.token)).toMatchObject(frozen);
    expect(await wallet(rt, "offer", { to: b.id, entry: "The Lease", side: "buy", amount: 5 }, a.token)).toMatchObject(frozen);
    expect(await wallet(rt, "accept", { id: "o2" }, a.token)).toMatchObject(frozen);
    expect(await wallet(rt, "stimulus", { amount: 5 }, a.token)).toMatchObject(frozen);
    // Backing out is allowed.
    expect((await wallet(rt, "decline", { id: "o2" }, a.token)).status).toBe(200);
    expect((await wallet(rt, "cancel", { id: "r4" }, a.token)).status).toBe(200);
    // Bob and the director still move coin for and to her.
    expect((await wallet(rt, "send", { to: a.id, amount: 5 }, b.token)).status).toBe(200);
    expect((await post(rt, "/api/mod/wallet/cancel", { id: "r1" }, undefined, true)).status).toBe(200);
    expect((await post(rt, "/api/mod/act", { id: a.id, action: "unrestrict" }, undefined, true)).status).toBe(200);
    expect((await wallet(rt, "accept", { id: "o3" }, a.token)).status).toBe(200);
    expect(rt.liveSim!.holdsCodex(a.id, "The Lease")).toBe(true);
  });
});

describe("the stimulus", () => {
  it("only the minter's program (or the director) pays it, to every person with a balance, within the limit", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    expect(await wallet(rt, "stimulus", { amount: 10 }, a.token)).toMatchObject({ status: 403, json: { error: "not the minter" } });
    const mint = await guest(rt, "Mint", 0);
    expect((await guestState(rt, mint.token)).wallet!.minter).toEqual({ uses: 0, limit: 1, grants: { uses: 0, limit: 3 }, freezeMs: 600_000, frozen: [] });
    expect((await modState(rt)).wallet!.minterPerson).toBe(mint.id);
    expect((await wallet(rt, "stimulus", { amount: 0 }, mint.token)).status).toBe(400);
    expect((await wallet(rt, "stimulus", { amount: 10 }, mint.token)).status).toBe(200);
    expect((await guestState(rt, a.token)).wallet!.balance).toBe(110);
    expect((await guestState(rt, b.token)).wallet!.balance).toBe(110);
    // Mint's own score was never set — no balance, so no stimulus for Mint; the minter's root card still lands.
    expect((await guestState(rt, mint.token)).wallet).toMatchObject({ balance: 0, minter: { uses: 1, limit: 1 } });
    expect(rows(walletRoom(rt, mint.id))).toEqual([["stimulus", "minted", "root"]]);
    expect(rows(walletRoom(rt, a.id))).toEqual([["stimulus", "received", "root"]]);
    expect(walletRoom(rt, a.id)[0]!.text).toBe("💰 Stimulus from Mint: 10 Coin.");
    expect(await wallet(rt, "stimulus", { amount: 10 }, mint.token)).toMatchObject({ status: 409, json: { error: "no stimulus left" } });
    expect((await post(rt, "/api/mod/wallet/stimulus", { amount: 10 }, undefined, true)).status).toBe(409);
    expect((await modState(rt)).wallet!.stimulus).toEqual({ uses: 1, limit: 1 });
  });

  it("the director's stimulus counts against the same limit and reads `Director`", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const r = await post(rt, "/api/mod/wallet/stimulus", { amount: 7 }, undefined, true);
    expect(r.status).toBe(200);
    expect((r.json["wallet"] as ModView["wallet"])!.stimulus).toEqual({ uses: 1, limit: 1 });
    expect((await guestState(rt, a.token)).wallet!.balance).toBe(107);
    expect(walletRoom(rt, a.id)[0]!.text).toBe("💰 Stimulus from Director: 7 Coin.");
    expect((await post(rt, "/api/mod/wallet/stimulus", { amount: 7 })).status).toBe(403); // not a moderator
  });

  it("a director's stimulus fires the story's `stimulus` event as the minter's program, with `by` (W6 open item)", async () => {
    const source = SOURCE.replace(
      "  when transfer_received for guest:\n",
      '  when stimulus for guest:\n    set Night.stimulus_n += 1\n    broadcast "!💰 {guest.name} sends every program {amount} ({by})." to everyone\n  when transfer_received for guest:\n',
    );
    const rt = freshRuntime(source);
    const a = await guest(rt, "Alice");
    await guest(rt, "Mint", 0);
    expect((await post(rt, "/api/mod/wallet/stimulus", { amount: 7 }, undefined, true)).status).toBe(200);
    expect(rt.liveSim!.world.peek("Night.stimulus_n")).toEqual({ kind: "number", value: 1 });
    const notice = rt.chatHistoryFor(a.id).find((m) => m.text === "💰 Mint sends every program 7 (Director).");
    expect(notice?.alert).toBe(true); // the `!` cue, as from her own phone
  });
});

describe("the reserve: grants + a ten-minute freeze", () => {
  it("the minter grants one account (limit 3, the director's counts) and freezes one; a frozen send is 409 and thaws on the story clock", async () => {
    const d = freshDir();
    const rt = runtimeIn(d);
    rt.openDoors();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    const mint = await guest(rt, "Mint", 0);
    expect(await wallet(rt, "grant", { to: b.id, amount: 5 }, a.token)).toMatchObject({ status: 403, json: { error: "not the minter" } });
    expect(await wallet(rt, "freeze", { to: b.id }, a.token)).toMatchObject({ status: 403, json: { error: "not the minter" } });
    expect((await wallet(rt, "grant", { to: a.id, amount: 20 }, mint.token)).status).toBe(200);
    expect((await guestState(rt, a.token)).wallet!.balance).toBe(120);
    expect(rows(walletRoom(rt, a.id))).toEqual([["grant", "received", "root"]]);
    expect(walletRoom(rt, a.id)[0]!.text).toBe("🎁 Mint granted you 20 Coin from the reserve.");
    expect(rows(walletRoom(rt, mint.id))).toEqual([["grant", "granted", "root"]]);
    expect((await post(rt, "/api/mod/wallet/grant", { to: b.id, amount: 5 })).status).toBe(403); // not a moderator
    expect((await post(rt, "/api/mod/wallet/grant", { to: b.id, amount: 5 }, undefined, true)).status).toBe(200);
    expect((await wallet(rt, "grant", { to: b.id, amount: 5 }, mint.token)).status).toBe(200);
    expect(await wallet(rt, "grant", { to: b.id, amount: 5 }, mint.token)).toMatchObject({ status: 409, json: { error: "no grants left" } });
    expect((await modState(rt)).wallet!.grants).toEqual({ uses: 3, limit: 3 });

    const r = await wallet(rt, "freeze", { to: a.id }, mint.token);
    expect(r.status).toBe(200);
    const until = rt.liveSim!.elapsed() + 600_000;
    expect((r.json["wallet"] as GuestView["wallet"])!.minter!.frozen).toEqual([{ id: "f4", target: a.id, targetName: "Alice", by: mint.id, until, at: until - 600_000 }]);
    expect((await guestState(rt, a.token)).wallet!.frozenUntil).toBe(until);
    expect(rows(walletRoom(rt, a.id)).at(-1)).toEqual(["freeze", "frozen", "root"]);
    expect(await wallet(rt, "freeze", { to: a.id }, mint.token)).toMatchObject({ status: 409, json: { error: "already frozen" } });
    expect(await wallet(rt, "send", { to: b.id, amount: 5 }, a.token)).toMatchObject({ status: 409, json: { error: "your Coin is frozen — it thaws in 10 min" } });
    expect((await wallet(rt, "send", { to: a.id, amount: 5 }, b.token)).status).toBe(200); // coin still comes in
    expect((await modState(rt)).wallet!.frozen.map((f) => f.target)).toEqual([a.id]);

    // A restart mid-freeze keeps it; the thaw lands at 600 s on the replayed clock.
    const rt2 = runtimeIn(d);
    expect(rt2.restore()).not.toBeNull();
    expect((await guestState(rt2, a.token)).wallet!.frozenUntil).toBe(until);
    expect((await wallet(rt2, "send", { to: b.id, amount: 5 }, a.token)).status).toBe(409);
    rt2.tickOnce(until - rt2.liveSim!.elapsed() - 1_000);
    expect((await guestState(rt2, a.token)).wallet!.frozenUntil).toBe(until);
    rt2.tickOnce(1_000);
    expect((await guestState(rt2, a.token)).wallet!.frozenUntil).toBeUndefined();
    expect(rows(walletRoom(rt2, a.id)).at(-1)).toEqual(["freeze", "thawed", "step"]);
    expect(rows(walletRoom(rt2, mint.id)).at(-1)).toEqual(["freeze", "expired", "step"]);
    expect((await modState(rt2)).wallet!.frozen).toEqual([]);
    expect((await wallet(rt2, "send", { to: b.id, amount: 5 }, a.token)).status).toBe(200);

    const rt3 = runtimeIn(d);
    expect(rt3.restore()).not.toBeNull();
    expect((await guestState(rt3, a.token)).wallet).toEqual((await guestState(rt2, a.token)).wallet);
    expect(rows(walletRoom(rt3, a.id))).toEqual(rows(walletRoom(rt2, a.id)));
  });

  it("the director freezes and lifts early; a restricted minter can neither grant nor freeze", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const mint = await guest(rt, "Mint", 0);
    expect((await post(rt, "/api/mod/wallet/freeze", { to: a.id }, undefined, true)).status).toBe(200);
    expect(await wallet(rt, "send", { to: mint.id, amount: 5 }, a.token)).toMatchObject({ status: 409 });
    expect(walletRoom(rt, mint.id)).toEqual([]); // the minter didn't impose it
    expect(await post(rt, "/api/mod/wallet/unfreeze", { to: "nobody" }, undefined, true)).toMatchObject({ status: 404, json: { error: "no such freeze" } });
    const lift = await post(rt, "/api/mod/wallet/unfreeze", { to: a.id }, undefined, true);
    expect(lift.status).toBe(200);
    expect((lift.json["wallet"] as ModView["wallet"])!.frozen).toEqual([]);
    expect(walletRoom(rt, a.id).at(-1)!.text).toBe("☀️ Director lifted the freeze — your Coin moves again.");
    expect((await wallet(rt, "send", { to: mint.id, amount: 5 }, a.token)).status).toBe(200);
    expect((await post(rt, "/api/mod/act", { id: mint.id, action: "restrict" }, undefined, true)).status).toBe(200);
    expect((await wallet(rt, "grant", { to: a.id, amount: 5 }, mint.token)).status).toBe(403);
    expect((await wallet(rt, "freeze", { to: a.id }, mint.token)).status).toBe(403);
  });
});

describe("the director's hand", () => {
  it("cancels a held or pending transfer, an open request or offer; the mirror lists what is open", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    expect((await wallet(rt, "send", { to: b.id, amount: 10 }, a.token)).status).toBe(200); // t1 pending
    expect((await wallet(rt, "request", { from: b.id, amount: 5 }, a.token)).status).toBe(200); // r2
    const m = (await modState(rt)).wallet!;
    expect(m.counter).toBe(1);
    expect(m.open.transfers.map((t) => t.id)).toEqual(["t1"]);
    expect(m.open.requests.map((r) => r.id)).toEqual(["r2"]);
    expect((await post(rt, "/api/mod/wallet/cancel", { id: "t1" }, undefined, true)).status).toBe(200);
    expect((await post(rt, "/api/mod/wallet/cancel", { id: "r2" }, undefined, true)).status).toBe(200);
    expect(await post(rt, "/api/mod/wallet/cancel", { id: "r2" }, undefined, true)).toMatchObject({ status: 409 });
    expect(await post(rt, "/api/mod/wallet/cancel", { id: "zz" }, undefined, true)).toMatchObject({ status: 404 });
    expect((await guestState(rt, a.token)).wallet).toMatchObject({ balance: 100, escrowed: 0, requests: [] });
    expect((await modState(rt)).wallet!.open).toEqual({ transfers: [], requests: [], offers: [] });
    expect(rows(walletRoom(rt, a.id))).toEqual([
      ["transfer", "pending", "root"],
      ["request", "sent", "root"],
      ["transfer", "cancelled", "step"],
      ["request", "cancelled", "step"],
    ]);
  });
});

describe("a restart replays the journal", () => {
  it("rebuilds every balance, open item and Wallet-room thread exactly; a tick after restore settles what was pending", async () => {
    const d = freshDir();
    const rt = runtimeIn(d);
    rt.openDoors();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    const auditor = await performer(rt, "Auditor");
    expect((await post(rt, "/api/mod/codex", { who: a.id, entry: "The Lease" }, undefined, true)).status).toBe(200);
    expect((await wallet(rt, "send", { to: b.id, amount: 10 }, a.token)).status).toBe(200); // t1 pending
    rt.tickOnce(10_000); // settles
    expect((await wallet(rt, "send", { to: b.id, amount: 20 }, a.token)).status).toBe(200); // t2 held
    expect((await post(rt, "/api/prime/wallet/deny", { id: "t2" }, auditor)).status).toBe(200);
    expect((await wallet(rt, "request", { from: b.id, amount: 5 }, a.token)).status).toBe(200); // r3
    expect((await wallet(rt, "respond", { id: "r3", accept: true }, b.token)).status).toBe(200); // t4 pending (via request)
    expect((await wallet(rt, "offer", { to: b.id, entry: "The Lease", side: "sell", amount: 15 }, a.token)).status).toBe(200); // o5 open
    rt.tickOnce(4_000);
    const snapshot = async (r: EventRuntime) => ({
      a: (await guestState(r, a.token)).wallet,
      b: (await guestState(r, b.token)).wallet,
      q: (await primeState(r, auditor)).wallet,
      mod: (await modState(r)).wallet,
      aRoom: walletRoom(r, a.id).map((m) => [m.seq, m.parentSeq, m.audience, m.text, m.wallet]),
      bRoom: walletRoom(r, b.id).map((m) => [m.seq, m.parentSeq, m.audience, m.text, m.wallet]),
      got: [num(r, `${a.id}.got`), num(r, `${b.id}.got`), num(r, `${a.id}.denials`)],
    });
    const before = await snapshot(rt);
    expect(before.a).toMatchObject({ balance: 90, escrowed: 0 });
    expect(before.b).toMatchObject({ balance: 105, escrowed: 5 });
    expect(before.q!.queue.map((t) => t.id)).toEqual(["t4"]);
    expect(before.got).toEqual([0, 1, 1]);

    const rt2 = runtimeIn(d);
    expect(rt2.restore()).not.toBeNull();
    const after = await snapshot(rt2);
    expect(after).toEqual(before);
    // The ids keep counting from where they were (nothing re-minted twice).
    expect((await wallet(rt2, "request", { from: b.id, amount: 1 }, a.token)).status).toBe(200);
    expect((await guestState(rt2, a.token)).wallet!.requests.map((r) => [r.id, r.state])).toEqual([
      ["r3", "paying"],
      ["r6", "open"],
    ]);
    // The pending request payment (t4, window 10 s) settles on the restored
    // story clock — which lags the live one by the ticks that were never
    // flushed (the journal coalesces up to 15 s of idle ticks), so count
    // from the clock the restore landed on.
    const t4 = (await guestState(rt2, b.token)).wallet!.transfers.find((t) => t.id === "t4")!;
    expect(t4).toMatchObject({ state: "pending", settleAt: 20_000 });
    rt2.tickOnce(t4.settleAt! - rt2.liveSim!.elapsed() - 1_000);
    expect((await guestState(rt2, a.token)).wallet!.balance).toBe(90);
    rt2.tickOnce(1_000);
    expect((await guestState(rt2, a.token)).wallet!.balance).toBe(95);
    expect((await guestState(rt2, b.token)).wallet).toMatchObject({ balance: 105, escrowed: 0 });
    expect(rows(walletRoom(rt2, a.id)).at(-1)).toEqual(["request", "paid", "step"]);
    // The open offer survived too, and still closes.
    expect((await wallet(rt2, "accept", { id: "o5" }, b.token)).status).toBe(200);
    expect(rt2.liveSim!.holdsCodex(b.id, "The Lease")).toBe(true);
    expect((await guestState(rt2, a.token)).wallet!.balance).toBe(110);
  });

  it("a story restart drops the book with the journal: fresh balances, no open items", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    const b = await guest(rt, "Bob");
    expect((await wallet(rt, "send", { to: b.id, amount: 10 }, a.token)).status).toBe(200);
    expect((await modState(rt)).wallet!.open.transfers).toHaveLength(1);
    expect((await post(rt, "/api/mod/reset", {}, undefined, true)).status).toBe(200);
    expect((await modState(rt)).wallet).toMatchObject({ counter: 0, open: { transfers: [], requests: [], offers: [] } });
  });
});
