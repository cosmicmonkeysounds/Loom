//! Wave 12 (lane S): what the server tells Trabolta's worker about the
//! thread and the house, beyond the lines themselves — and what it never
//! does.
//!
//!   - `AgentLine.story`: the story posted this line (a receipt, a scripted
//!     line, the hold / busy line), not his own free reply (C1.1);
//!   - `AgentRequest.recent` + `storyAt`: at most 6 things the house holds
//!     about him and this speaker (gifts, his house-wide lines, the guest's
//!     filings as question ids, marked, the Trust Chart), built at request
//!     time from what the server already holds (C1.2);
//!   - the guest's codex as titles only (C1.3);
//!   - `LOOM_AGENT_RECENT=off`: the request is field-for-field the base
//!     branch's (C1.6), pinned against a fixture frozen from that build.
//!
//! And the secrecy rule, on the real show: no secret codex title, no
//! `▒ HUNT ANSWER` title, nothing from the Kernel, no verdict / answer /
//! confidence / near key in a filing item, and no hunt answer in a house
//! line before the verdict. Answers are read from facts.json at run time;
//! none is written here.

import { afterAll, afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AgentRequest } from "../server/agents.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_FIXTURE = join(HERE, "fixtures", "agent-request-base.json");

const SOURCE = `# Recent
directory: everyone

LOCATION The Cache
  label: The Cache (kitchen)

ROLE Program
  humanity: 0 to 100 = 20

CHARACTER Trabolta
  listed: true
  mind: external
  hold: One moment, program.
  busy: The line is long tonight.
  truth: 0 to 100 = 35

CHARACTER Clippy
  listed: true

CODEX The Ribbon
  about: Trabolta
  code: RIBBON-1
  text: A blue ribbon from the county fair.

CODEX The Recipe
  about: World
  code: RECIPE-1
  text: Two cups of flour, one of sugar.

CODEX The Locked Drawer
  about: Trabolta
  secret: true
  code: DRAWER-1
  text: What is in the drawer stays in the drawer.

INTERACTION greet
  who: admin

INTERACTION file the receipt
  who: admin

when greet for program:
  Trabolta: Welcome, program. I have been expecting you.

when file the receipt for program:
  Trabolta: Filed for Q1.

== Announce
Trabolta: Attention, house. The kitchen is open.
`;
const CODES = { event: "EVT912", prime: "PRM912", mod: "MOD912" };

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  delete process.env["LOOM_AGENT_RECENT"];
});

function runtime(source = SOURCE): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-recent-"));
  dirs.push(d);
  let clock = 1_000_000;
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "recent", scenarioSource: source, joinBase: () => "http://localhost", now: () => (clock += 1) });
}

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
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write(c: string) {
      buf += c;
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
    on() {
      return res;
    },
    once() {
      return res;
    },
    setHeader() {},
    flushHeaders() {},
    frames(): Array<[string, unknown]> {
      return buf
        .split("\n\n")
        .map((bl) => {
          const ev = /^event: (.*)$/mu.exec(bl)?.[1];
          const d = /^data: (.*)$/mu.exec(bl)?.[1];
          return ev !== undefined && d !== undefined ? ([ev, JSON.parse(d)] as [string, unknown]) : null;
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

/** The mini story's night: a guest gets a scripted welcome, hears his
 *  house-wide line, gives him a ribbon, talks, gets a free reply, talks
 *  again. Returns every request the worker saw, in order. */
async function miniNight() {
  const rt = runtime();
  rt.openDoors();
  const g = await call(rt, "POST", "/api/guest/register", { name: "Ada", passcode: CODES.event });
  expect(g.status).toBe(200);
  const guest = { id: g.json["id"] as string, token: g.json["token"] as string };
  const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
  const requests = () => worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
  const mod = async (p: string, body: unknown) => expect((await call(rt, "POST", p, body, { moderator: true })).status, p).toBe(200);
  expect((await call(rt, "POST", "/api/guest/codex/redeem", { code: "RIBBON-1" }, { token: guest.token })).json["unlocked"]).toBeTruthy();
  expect((await call(rt, "POST", "/api/guest/codex/redeem", { code: "RECIPE-1" }, { token: guest.token })).json["unlocked"]).toBeTruthy();
  await mod("/api/mod/signal", { name: "greet", subject: guest.id });
  await mod("/api/mod/beat", { name: "Announce" });
  expect((await call(rt, "POST", "/api/guest/codex/share", { entry: "The Ribbon", to: "Trabolta" }, { token: guest.token })).status).toBe(200);
  await mod("/api/mod/signal", { name: "file the receipt", subject: guest.id });
  expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Hello, are you there?" }, { token: guest.token })).status).toBe(200);
  await mod("/api/agent/reply", { id: requests()[0]!.id, say: "I am here. Thank you for the ribbon.", adjust: {} });
  expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Do you like it?" }, { token: guest.token })).status).toBe(200);
  return { rt, guest, worker, requests };
}

/** A request with its run-to-run noise (random ids, the injected clock)
 *  replaced by placeholders, so two builds compare field by field. */
function normalised(r: AgentRequest, guestId: string): unknown {
  return JSON.parse(JSON.stringify({ ...r, id: "<request>" }).split(guestId).join("<guest>"));
}

describe("LOOM_AGENT_RECENT=off: the base branch's request, field for field (C1.6)", () => {
  it("deep-equals the fixture frozen from the trabolta/answers build", async () => {
    process.env["LOOM_AGENT_RECENT"] = "off";
    const { rt, guest, requests } = await miniNight();
    const got = requests().map((r) => normalised(r, guest.id));
    expect(got).toHaveLength(2);
    if (process.env["LOOM_FREEZE_AGENT_REQUEST"] === "1") {
      // Run only on the base branch (trabolta/answers, before wave 12's
      // change): `LOOM_FREEZE_AGENT_REQUEST=1 vitest run test/agent-recent.test.ts`.
      mkdirSync(dirname(BASE_FIXTURE), { recursive: true });
      writeFileSync(BASE_FIXTURE, `${JSON.stringify(got, null, 2)}\n`);
    }
    expect(existsSync(BASE_FIXTURE)).toBe(true);
    expect(got).toEqual(JSON.parse(readFileSync(BASE_FIXTURE, "utf8")));
    rt.dispose();
  });
});
