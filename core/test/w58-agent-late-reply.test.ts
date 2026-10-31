//! Wave 58: "his DMs stop". A reply the model wrote while he was awake and that
//! lands after the cables came out is dropped, while the gate's own lines, which
//! use the same route, still reach the guest.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventRuntime } from "../server/event-runtime.ts";
import type { AgentRequest } from "../server/agents.ts";
import { Store } from "../server/store.ts";

const SOURCE = `# Late

LOCATION Lobby

CHARACTER Trabolta
  listed: true
  mind: external
  awake: bool = true
  mood: int = 0
  range mood: 0..10

CHARACTER Clippy
  listed: true
  mind: external

INTERACTION cables
  who: admin

when cables:
  set Trabolta.awake = false
`;
const CODES = { event: "EVT581", prime: "PRM581", mod: "MOD581" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown, headers: Record<string, string> = {}) {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
}
function fakeRes() {
  let buf = "";
  const res = {
    statusCode: 0,
    body: "",
    setHeader: () => res,
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
    frames: (): Array<[string, unknown]> =>
      buf
        .split("\n\n")
        .map((block) => {
          const ev = /^event: (.*)$/mu.exec(block)?.[1];
          const data = /^data: (.*)$/mu.exec(block)?.[1];
          return ev !== undefined && data !== undefined ? ([ev, JSON.parse(data)] as [string, unknown]) : null;
        })
        .filter((f): f is [string, unknown] => f !== null),
  };
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, method: string, pathAndQuery: string, body: unknown, o: { moderator?: boolean; token?: string } = {}) {
  const url = new URL(`http://x${pathAndQuery}`);
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

async function room(query: string, character = "Trabolta") {
  const d = mkdtempSync(join(tmpdir(), "loom-w58-late-"));
  dirs.push(d);
  const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "late", scenarioSource: SOURCE, joinBase: () => "http://localhost" });
  rt.openDoors();
  const g = await call(rt, "POST", "/api/guest/register", { name: "Calculator", passcode: CODES.event });
  const guest = { id: g.json["id"] as string, token: g.json["token"] as string };
  const w = await call(rt, "GET", `/api/agent/stream?characters=${character}&name=laptop${query}`, {}, { moderator: true });
  const requests = () => w.res.frames().filter(([e]) => e === "request").map(([, r]) => r as AgentRequest);
  const say = (text: string) => call(rt, "POST", "/api/guest/say", { channel: `dm:${character}`, text }, { token: guest.token });
  const reply = (id: string, text: string, extra: Record<string, unknown> = {}) => call(rt, "POST", "/api/agent/reply", { id, say: text, ...extra }, { moderator: true });
  const cables = () => call(rt, "POST", "/api/mod/signal", { name: "cables" }, { moderator: true });
  const thread = () => rt.chatHistoryFor(guest.id).filter((m) => m.channel === `dm:${character}` && m.from === character).map((m) => m.text);
  return { rt, requests, say, reply, cables, thread };
}

describe.each([
  ["a windowed worker", "&capacity=4"],
  ["a legacy worker", ""],
])("a reply in flight when he dies (%s)", (_name, query) => {
  it("lands nowhere, moves nothing, and the thread gets the gate's own line instead", async () => {
    const r = await room(query);
    await r.say("Are you there?");
    const asked = r.requests()[0]!;
    expect(asked.self.vars["awake"]).toBe("true");
    await r.cables();
    const late = await r.reply(asked.id, "A line written before the cables came out.", { adjust: { mood: 3 } });
    expect(late.status).toBe(410);
    expect(r.thread()).toEqual([]);
    expect(r.rt.liveSim?.world.peek("Trabolta.mood")).toEqual(expect.objectContaining({ value: 0 }));
    // Asked again, the body reads him asleep, so the worker's gate answers.
    const again = r.requests()[1]!;
    expect(again.id).not.toBe(asked.id);
    expect(again.self.vars["awake"]).toBe("false");
    expect((await r.reply(again.id, "Jean Trabolta is unavailable.")).status).toBe(200);
    expect(r.thread()).toEqual(["Jean Trabolta is unavailable."]);
    r.rt.dispose();
  });

  it("a guest who writes after he dies is answered by the gate, as before", async () => {
    const r = await room(query);
    await r.cables();
    await r.say("Hello?");
    const asked = r.requests()[0]!;
    expect(asked.self.vars["awake"]).toBe("false");
    expect((await r.reply(asked.id, "Jean Trabolta is unavailable.")).status).toBe(200);
    expect(r.thread()).toEqual(["Jean Trabolta is unavailable."]);
    r.rt.dispose();
  });

  it("while he lives a reply lands, and a character with no `awake` is never held", async () => {
    const r = await room(query);
    await r.say("Are you there?");
    expect((await r.reply(r.requests()[0]!.id, "I am here.")).status).toBe(200);
    expect(r.thread()).toEqual(["I am here."]);
    r.rt.dispose();
    const c = await room(query, "Clippy");
    await c.say("Hi Clippy");
    await c.cables();
    expect((await c.reply(c.requests()[0]!.id, "Hello!")).status).toBe(200);
    expect(c.thread()).toEqual(["Hello!"]);
    c.rt.dispose();
  });
});
