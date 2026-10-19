//! Wave 11b on the real show (*Trapped in the Internet*):
//!
//! - Trabolta rules on the near misses (contract J): `main.loom`'s header
//!   names him `judge:`, so a 📝 "Mr Pickels" for H2 in `auto` mode goes to
//!   his worker as a `judge` frame, and his ruling lands through the show's
//!   own `fact_accurate` rule — `fact_v2` accurate, the story's 📝 line then
//!   the 🤖 line in # hosts. The judge frame is the only place the key goes:
//!   no DM request, no `/api/agent/facts`.
//! - A marked program still reaches his heart: the server-room terminal's
//!   `terminal opened` puts it at the heart while it is marked (restricted),
//!   its own agent request carries `marked` and `at_the_heart` (the persona's
//!   situations read them), and a file it gives him there lands. Pinned so
//!   nobody "fixes" the mark into locking the heart away.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { scenarioSource } from "../examples/load.ts";
import type { AgentJudgeRequest, AgentRequest } from "../server/agents.ts";
import type { ChatMessage } from "../server/chat.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { FactsView } from "../server/views.ts";

const SHOW = "trapped-in-the-internet";
const SRC = scenarioSource(SHOW);
const FACTS = readFileSync(join(import.meta.dirname, "..", "examples", SHOW, "facts.json"), "utf8");
const CODES = { event: "EVT558", prime: "PRM558", mod: "MOD558" };
const SLOW = 120_000;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown, headers: Record<string, string>) {
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
function fakeRes() {
  let buf = "";
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write(chunk: string) {
      buf += chunk;
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
    frames(): Array<[string, unknown]> {
      return buf
        .split("\n\n")
        .map((block) => {
          const ev = /^event: (.*)$/mu.exec(block)?.[1];
          const data = /^data: (.*)$/mu.exec(block)?.[1];
          return ev !== undefined && data !== undefined ? ([ev, JSON.parse(data)] as [string, unknown]) : null;
        })
        .filter((f): f is [string, unknown] => f !== null);
    },
  };
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, method: string, p: string, body: unknown, o: { moderator?: boolean; token?: string } = {}) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, { moderator: o.moderator ?? false });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    /* a stream */
  }
  return { status: res.statusCode, json, res };
}

/** The show to the hunt: two uploaded, cleared programs and Trabolta's worker online. */
async function toTheHunt() {
  const dir = mkdtempSync(join(tmpdir(), "loom-w11b-show-"));
  dirs.push(dir);
  const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: SRC, joinBase: () => "http://localhost", factsFile: join(dir, "no-such-facts.json"), facts: FACTS });
  rt.openDoors();
  const mod = (name: string, extra: Record<string, unknown> = {}) => call(rt, "POST", "/api/mod/signal", { name, ...extra }, { moderator: true });
  const upload = async (name: string) => {
    const g = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event, claim: rt.claimFor(name) });
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
  const w = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
  const worker = (w.res.frames().find(([e]) => e === "hello")![1] as { worker: string }).worker;
  const frames = (kind: string) => w.res.frames().filter(([e]) => e === kind).map(([, d]) => d);
  const hosts = () =>
    (rt as unknown as { chat: { all(): ChatMessage[] } }).chat
      .all()
      .filter((m) => m.channel === "room:hosts" && /^(📝|⚠|🤖)/u.test(m.text))
      .map((m) => m.text);
  return { rt, mod, calc, excel, worker, frames, hosts };
}

describe("Trapped in the Internet — Trabolta rules on the near misses (wave 11b)", () => {
  it("H2 'Mr Pickels' goes to Trabolta's worker as a judge frame; his ruling 'same' lands through the show's fact_accurate rule", { timeout: SLOW }, async () => {
    const { rt, calc, worker, frames, hosts } = await toTheHunt();
    expect(rt.liveSim!.model.judge).toBe("Trabolta");
    // The lookup document already names the cat inside the hunt-answer
    // marked clue (the worker's secrets filter drops those): a filing, a
    // judge frame and a ruling add nothing to it.
    const keyIn = async () => (JSON.stringify((await call(rt, "GET", "/api/agent/facts", {}, { moderator: true })).json).match(/Mister Pickles|Mr Pickels|ruling/gu) ?? []).length;
    const before = await keyIn();
    const card = rt
      .chatHistoryFor(calc.id)
      .filter((m) => m.kind === "widget" && m.widget?.kind === "fact")
      .at(-1)!;
    expect((await call(rt, "POST", "/api/guest/widget", { seq: card.seq, result: { question: "H2", answer: "Mr Pickels", confidence: 100 } }, { token: calc.token })).status).toBe(200);
    expect(rt.liveSim!.world.peek(`${calc.id}.fact_v2`)).toMatchObject({ value: "pending" });
    const judges = frames("judge") as AgentJudgeRequest[];
    expect(judges).toHaveLength(1);
    expect(judges[0]).toMatchObject({ character: "Trabolta", filing: { person: calc.id, question: "H2" }, key: { answer: "Mister Pickles" }, answer: "Mr Pickels", confidence: 100 });
    // The key rides the judge frame only: no DM request.
    expect(frames("request") as AgentRequest[]).toEqual([]);
    expect(hosts().slice(-1)[0]).toMatch(/^⚠ Near miss, not an exact match: Calculator's H2 filing "Mr Pickels" is close to "Mister Pickles", so it is proposed accurate — asked Trabolta to rule\./u);

    const r = await call(rt, "POST", "/api/agent/judge", { id: judges[0]!.id, worker, same: true, why: "A spelling slip of the cat's name." }, { moderator: true });
    expect(r.json).toEqual({ ok: true, verdict: "accurate" });
    expect(rt.liveSim!.world.peek(`${calc.id}.fact_v2`)).toMatchObject({ value: "accurate" });
    expect(hosts().slice(-2)).toEqual(["📝 Calculator's H2 is judged accurate.", '🤖 Trabolta ruled Calculator\'s H2 filing "Mr Pickels": the same as "Mister Pickles" (accurate). A spelling slip of the cat\'s name.']);
    expect(await keyIn()).toBe(before);
    const view = ((await call(rt, "GET", "/api/state?role=mod", {}, { moderator: true })).json as { facts?: FactsView }).facts!;
    expect(view.questions.find((q) => q.id === "H2")!.filings[0]).toMatchObject({ final: "accurate", how: "confirmed", by: "Trabolta", ruling: { by: "Trabolta", same: true } });
    rt.dispose();
  });
});

describe("Trapped in the Internet — a marked program at his heart (wave 11b)", () => {
  it("terminal opened sets at_the_heart for a marked program; its request carries marked + at_the_heart; a file it gives him there lands", { timeout: SLOW }, async () => {
    const { rt, mod, excel, frames } = await toTheHunt();
    expect((await mod("mark_for_reinstallation", { subject: excel.id, args: { reason: "a test" } })).status).toBe(200);
    expect(rt.liveSim!.world.peek(`${excel.id}.marked`)).toMatchObject({ value: true });
    expect(rt.liveSim!.isRestricted(excel.id)).toBe(true);
    // The server-room terminal pilots the marked program's own thread.
    const pilot = await call(rt, "POST", "/api/mod/impersonate", { role: "guest", id: excel.id, label: "Terminal · Server Room" }, { moderator: true });
    expect(pilot.status).toBe(200);
    const token = pilot.json["token"] as string;
    expect((await mod("terminal opened", { subject: excel.id, args: { at: "The Server Room" }, label: "Terminal · Server Room" })).status).toBe(200);
    expect(rt.liveSim!.world.peek(`${excel.id}.at_the_heart`)).toMatchObject({ value: true });
    // Its line at the heart reaches his worker with both facts on `them`.
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Why am I marked?" }, { token })).status).toBe(200);
    const req = (frames("request") as AgentRequest[]).at(-1)!;
    expect(req.speaker.id).toBe(excel.id);
    expect(req.them.vars["marked"]).toBe("true");
    expect(req.them.vars["at_the_heart"]).toBe("true");
    // A file it gives him at the heart terminal lands.
    expect((await call(rt, "POST", "/api/mod/codex", { who: excel.id, entry: "The Sandy File" }, { moderator: true })).status).toBe(200);
    expect((await call(rt, "POST", "/api/guest/codex/share", { entry: "The Sandy File", to: "Trabolta" }, { token })).status).toBe(200);
    expect(rt.liveSim!.holdsCodex("Trabolta", "The Sandy File")).toBe(true);
    rt.dispose();
  });
});
