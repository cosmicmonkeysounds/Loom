//! The casino terminal's server side (`POST /api/mod/casino/bet`, wave 15):
//! the server throws the dice, the bet is one journaled `bet` wallet op, the
//! card threads per sitting in the guest's Wallet room, the story hears
//! `casino won` / `casino lost`, and a restart replays the same balances.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

// The dice: a queue the test fills (`rolls.push(…)`), else 0.
const rolls: number[] = [];
vi.mock("node:crypto", async (orig) => {
  const real = await orig<typeof import("node:crypto")>();
  return { ...real, randomInt: (n: number) => Math.min(n - 1, rolls.shift() ?? 0) };
});

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { ChatMessage } from "../server/chat.ts";
import type { GuestView, ModView, PrimeView } from "../server/views.ts";

const CODES = { event: "EVT515", prime: "PRM515", mod: "MOD515" };

const SOURCE = `# Coin
currency: score as Coin

CHARACTER Mint
  wallet: minter, limit 1, freeze 10m

ROLE Guest
  wins: 0 to 100 = 0
  losses: 0 to 100 = 0
  staked: 0 to 1000 = 0
  when casino won for guest:
    set guest.wins += 1
    set guest.staked += stake
  when casino lost for guest:
    set guest.losses += 1
    set guest.staked += stake
`;

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

let clock = 1_000_000;
beforeEach(() => {
  rolls.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  clock += 60_000;
  vi.setSystemTime(clock);
});
/** A bet, a second later than the last (past the per-guest gap). */
async function bet(rt: EventRuntime, guestId: string, game: string, pick: string, stake: number, ...dice: number[]) {
  clock += 1_000;
  vi.setSystemTime(clock);
  rolls.push(...dice);
  return post(rt, "/api/mod/casino/bet", { guest: guestId, game, pick, stake }, undefined, true);
}
const walletRoom = (rt: EventRuntime, id: string): ChatMessage[] => rt.chatHistoryFor(id).filter((m) => m.channel === "wallet");
const num = (rt: EventRuntime, path: string): unknown => (rt.liveSim!.world.get(path) as { value?: unknown } | null)?.value;

describe("the casino", () => {
  it("throws the dice, settles, and threads a sitting's bets under one card", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    // heads (not the edge: 5, then face 0) on heads — won 20.
    const r1 = await bet(rt, a.id, "coin", "heads", 10, 5, 0);
    expect(r1).toMatchObject({ status: 200, json: { ok: true, roll: [0], payout: 20, net: 10, balance: 110, unit: "Coin" } });
    // 4 + 3 = 7 on over — lost.
    const r2 = await bet(rt, a.id, "dice", "over", 25, 3, 2);
    expect(r2.json).toMatchObject({ roll: [4, 3], payout: 0, net: -25, balance: 85 });
    // 7 $ ♣ — a lone seven: the stake back.
    const r3 = await bet(rt, a.id, "slots", "pull", 5, 0, 1, 15);
    expect(r3.json).toMatchObject({ roll: [0, 1, 4], payout: 5, net: 0, balance: 85 });
    expect((await guestState(rt, a.token)).wallet!.balance).toBe(85);
    const room = walletRoom(rt, a.id);
    expect(room.map((m) => [m.wallet?.kind, m.wallet?.step, m.parentSeq === null ? "root" : "step"])).toEqual([
      ["casino", "won", "root"],
      ["casino", "lost", "step"],
      ["casino", "push", "step"],
    ]);
    expect(room[1]!.parentSeq).toBe(room[0]!.seq);
    expect(room[0]!.text).toBe("🎰 THE COIN: 10 Coin on HEADS — HEADS. Won 20 Coin.");
    expect(room[1]!.text).toBe("🎰 UNDER / OVER 7: 25 Coin on OVER 7 — 4 + 3 = 7. Lost.");
    expect(room[2]!.text).toBe("🎰 ONE-ARMED BANDIT: 5 Coin on PULL — 7 $ ♣. Your stake back.");
    // The story heard the win and the loss, not the push.
    expect([num(rt, `${a.id}.wins`), num(rt, `${a.id}.losses`), num(rt, `${a.id}.staked`)]).toEqual([1, 1, 35]);
    expect((await modState(rt)).wallet!.casino).toEqual({ bets: 3, staked: 40, paid: 25 });
  });

  it("a sitting ends after ten quiet minutes on the story clock: the next bet opens a new card", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice");
    await bet(rt, a.id, "coin", "tails", 1, 5, 1);
    rt.tickOnce(11 * 60_000);
    await bet(rt, a.id, "coin", "tails", 1, 5, 1);
    expect(walletRoom(rt, a.id).map((m) => [m.wallet?.id, m.parentSeq === null])).toEqual([
      ["c1", true],
      ["c2", true],
    ]);
  });

  it("refuses what it can't take, and journals nothing for it", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Alice", 20);
    expect(await bet(rt, a.id, "coin", "heads", 21)).toMatchObject({ status: 409, json: { error: "insufficient funds" } });
    expect(await bet(rt, a.id, "coin", "heads", 0)).toMatchObject({ status: 400 });
    expect(await bet(rt, a.id, "coin", "heads", 51)).toMatchObject({ status: 400 });
    expect(await bet(rt, a.id, "coin", "heads", 2.5)).toMatchObject({ status: 400 });
    expect(await bet(rt, a.id, "roulette", "red", 5)).toMatchObject({ status: 400, json: { error: "unknown game" } });
    expect(await bet(rt, a.id, "coin", "pull", 5)).toMatchObject({ status: 400 });
    expect(await bet(rt, "g-000000", "coin", "heads", 5)).toMatchObject({ status: 404 });
    // Not a moderator: the route is the mod plane's.
    expect((await post(rt, "/api/mod/casino/bet", { guest: a.id, game: "coin", pick: "heads", stake: 5 })).status).toBe(403);
    // A marked program.
    expect((await post(rt, "/api/mod/act", { id: a.id, action: "restrict" }, undefined, true)).status).toBe(200);
    expect(await bet(rt, a.id, "coin", "heads", 5)).toMatchObject({ status: 403, json: { error: "marked programs can't gamble" } });
    expect((await post(rt, "/api/mod/act", { id: a.id, action: "unrestrict" }, undefined, true)).status).toBe(200);
    // A program in the Internet is in the tent, not at the tables (wave 18).
    expect((await post(rt, "/api/mod/act", { id: a.id, action: "capture" }, undefined, true)).status).toBe(200);
    expect(await bet(rt, a.id, "coin", "heads", 5)).toMatchObject({ status: 403, json: { error: "programs in the Internet can't gamble" } });
    expect((await post(rt, "/api/mod/act", { id: a.id, action: "release" }, undefined, true)).status).toBe(200);
    // A merely marked program plays (Q30: a mark does not hinder).
    expect((await post(rt, "/api/mod/var", { path: `${a.id}.marked`, value: "true" }, undefined, true)).status).toBe(200);
    expect(rt.liveSim!.isRestricted(a.id)).toBe(false);
    // A frozen account.
    expect((await post(rt, "/api/mod/wallet/freeze", { to: a.id }, undefined, true)).status).toBe(200);
    expect((await bet(rt, a.id, "coin", "heads", 5)).json["error"]).toMatch(/frozen/u);
    expect((await post(rt, "/api/mod/wallet/unfreeze", { to: a.id }, undefined, true)).status).toBe(200);
    // Two bets inside the gap: the second waits.
    expect((await bet(rt, a.id, "coin", "heads", 1, 5, 0)).status).toBe(200);
    rolls.push(5, 0);
    expect(await post(rt, "/api/mod/casino/bet", { guest: a.id, game: "coin", pick: "heads", stake: 1 }, undefined, true)).toMatchObject({ status: 429 });
    expect(walletRoom(rt, a.id).filter((m) => m.wallet?.kind === "casino")).toHaveLength(1);
    // The doors closed.
    rt.pause();
    expect(await bet(rt, a.id, "coin", "heads", 1)).toMatchObject({ status: 409, json: { error: "doors are closed" } });
  });

  it("a restart replays the bets onto the same balances and cards, without rolling again", async () => {
    const d = freshDir();
    const rt = runtimeIn(d);
    rt.openDoors();
    const a = await guest(rt, "Alice");
    await bet(rt, a.id, "slots", "pull", 10, 0, 0, 0); // 7 7 7 — 40×
    await bet(rt, a.id, "dice", "seven", 10, 0, 5); // 1 + 6 — 5×
    const snap = async (r: EventRuntime) => ({
      balance: (await guestState(r, a.token)).wallet!.balance,
      room: walletRoom(r, a.id).map((m) => [m.seq, m.parentSeq, m.text]),
      casino: (await modState(r)).wallet!.casino,
      wins: num(r, `${a.id}.wins`),
    });
    const before = await snap(rt);
    expect(before.balance).toBe(100 - 10 + 400 - 10 + 50);
    rolls.push(4, 4, 4, 4, 4, 4); // a replay that rolled again would land elsewhere
    const rt2 = runtimeIn(d);
    expect(rt2.restore()).not.toBeNull();
    expect(await snap(rt2)).toEqual(before);
  });
});
