//! Near-miss judging on the real show (wave 11, C6 review): a 📝 filing of
//! "Mr Pickels" for H2 in `auto` mode goes through *Trapped in the
//! Internet*'s own filing rule (`main.loom`'s `when fact answered`, which
//! reads `Night.judge_mode` at filing) — pending with `near`, one story line
//! in # hosts saying "Proposed: accurate" plus the server's ⚠ near-miss line,
//! and the mode back to `auto` — while a near-looking wrong hour or appendix
//! stays an automatic lie. If a rewrite of the story's rule stops reading the
//! mode at filing, this fails instead of near misses turning silently into
//! automatic verdicts.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { scenarioSource } from "../examples/load.ts";
import type { ChatMessage } from "../server/chat.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { FactsView } from "../server/views.ts";

const SHOW = "trapped-in-the-internet";
const SRC = scenarioSource(SHOW);
const FACTS = readFileSync(join(import.meta.dirname, "..", "examples", SHOW, "facts.json"), "utf8");
const CODES = { event: "EVT556", prime: "PRM556", mod: "MOD556" };
const SLOW = 120_000;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown, headers: Record<string, string>): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
    destroy() {},
  } as unknown as IncomingMessage;
}
function fakeRes(): ServerResponse & { statusCode: number; body: string } {
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write() {
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string };
}
async function call(rt: EventRuntime, method: string, p: string, body: unknown, o: { moderator?: boolean; token?: string } = {}) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, { moderator: o.moderator ?? false });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

describe("Trapped in the Internet — a near miss in auto mode goes to a director", () => {
  it("H2 'Mr Pickels' at 100 is pending with near, one 📝 Proposed line + the ⚠ line in # hosts, the mode back to auto; a wrong hour stays a lie", { timeout: SLOW }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-near-show-"));
    dirs.push(dir);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: SRC, joinBase: () => "http://localhost", factsFile: join(dir, "no-such-facts.json"), facts: FACTS });
    rt.openDoors();
    const mod = (name: string, extra: Record<string, unknown> = {}) => call(rt, "POST", "/api/mod/signal", { name, ...extra }, { moderator: true });
    const upload = async (name: string) => {
      const g = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event });
      expect(g.status).toBe(200);
      const id = g.json["id"] as string;
      const token = g.json["token"] as string;
      await mod("captcha answered", { subject: id, args: { passed: false } });
      expect((await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token })).status).toBe(200);
      expect((await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token })).status).toBe(200);
      expect((await call(rt, "POST", "/api/mod/scan", { as: "Norton Anti-Virus", target: id }, { moderator: true })).status).toBe(200);
      return { id, token };
    };
    const calc = await upload("Calculator");
    const excel = await upload("Microsoft Excel");
    for (const n of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt"]) expect((await mod(n)).status).toBe(200);
    expect(rt.liveSim!.world.peek("Night.judge_mode")).toMatchObject({ value: "auto" });
    const file = async (g: { id: string; token: string }, question: string, answer: string) => {
      const card = rt
        .chatHistoryFor(g.id)
        .filter((m) => m.kind === "widget" && m.widget?.kind === "fact")
        .at(-1)!;
      expect(card, "a fact card").toBeDefined();
      return call(rt, "POST", "/api/guest/widget", { seq: card.seq, result: { question, answer, confidence: 100 } }, { token: g.token });
    };
    const hosts = () =>
      (rt as unknown as { chat: { all(): ChatMessage[] } }).chat
        .all()
        .filter((m) => m.channel === "room:hosts" && (m.text.startsWith("📝") || m.text.startsWith("⚠")))
        .map((m) => m.text);

    expect((await file(calc, "H2", "Mr Pickels")).status).toBe(200);
    expect(rt.liveSim!.world.peek("Night.judge_mode")).toMatchObject({ value: "auto" });
    expect(rt.liveSim!.world.peek(`${calc.id}.fact_v2`)).toMatchObject({ value: "pending" });
    const lines = hosts();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^📝 Calculator filed H2 .*Mr Pickels.*Proposed: accurate\./u);
    expect(lines[1]).toBe('⚠ Near miss, not an exact match: Calculator\'s H2 filing "Mr Pickels" is close to "Mister Pickles", so it is proposed accurate and is credited if nobody judges it. Judge it on Run → Mind → Judging.');

    // A wrong hour that looks close (9pm for 9:00 a.m.) is a clear miss: judged at once.
    expect((await file(excel, "H3", "9pm")).status).toBe(200);
    expect(rt.liveSim!.world.peek(`${excel.id}.fact_v3`)).toMatchObject({ value: "lie" });
    expect(hosts().slice(2)).toEqual([expect.stringMatching(/^📝 Microsoft Excel filed H3 .*9pm.*Judged lie\./u)]);

    const view = ((await call(rt, "GET", "/api/state?role=mod", {}, { moderator: true })).json as { facts?: FactsView }).facts!;
    expect(view.mode).toBe("auto");
    const f = (q: string) => view.questions.find((x) => x.id === q)!.filings;
    expect(f("H2").map((x) => [x.name, x.answer, x.verdict, x.final, x.near])).toEqual([["Calculator", "Mr Pickels", "accurate", null, { key: "Mister Pickles" }]]);
    expect(f("H3").map((x) => [x.name, x.final, x.near])).toEqual([["Microsoft Excel", "lie", undefined]]);
    expect(view.pending).toBe(1);
    rt.dispose();
  });
});
