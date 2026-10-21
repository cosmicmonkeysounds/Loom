//! Wave 11b: a MARKED program (flagged for the Internet; since wave 18 the
//! mark no longer restricts it) can still reach Trabolta's heart. Pins what the
//! wave 11 recheck found works, so nobody "fixes" it: the heart terminal's
//! `terminal opened` still sets `at_the_heart`, his worker's request carries
//! `marked` (not secret; the persona's `them:` reads it, its situations gate
//! on it) but never the reason, the terminal's 📎 GIVE (the piloted guest's
//! own share) still lands, and STANDING DOWN is still open to them.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { scenarioSource } from "../examples/load.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { AgentRequest } from "../server/agents.ts";

const SHOW = "trapped-in-the-internet";
const SRC = scenarioSource(SHOW);
const CODES = { event: "EVT777", prime: "PRM777", mod: "MOD777" };
const SLOW = 120_000;
const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
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

/** A cleared program with Trabolta awake, then marked by a host. */
async function markedProgram() {
  const dir = mkdtempSync(join(tmpdir(), "loom-w11b-"));
  tmp.push(dir);
  const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: SRC, joinBase: () => "http://localhost" });
  rt.openDoors();
  const g = await call(rt, "POST", "/api/guest/register", { name: "Calculator", passcode: CODES.event });
  const id = g.json["id"] as string;
  const token = g.json["token"] as string;
  const mod = (name: string, extra: Record<string, unknown> = {}) => call(rt, "POST", "/api/mod/signal", { name, ...extra }, { moderator: true });
  await mod("captcha answered", { subject: id, args: { passed: false } });
  await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token });
  await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token });
  await call(rt, "POST", "/api/mod/scan", { as: "Norton Anti-Virus", target: id }, { moderator: true });
  for (const n of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta"]) await mod(n);
  expect((await mod("mark_for_reinstallation", { subject: id, args: { reason: "missed the cup" } })).status).toBe(200);
  const sim = rt.liveSim!;
  expect(sim.world.peek(`${id}.marked`)).toMatchObject({ value: true });
  // Wave 18 (Q30): a mark no longer restricts: the phone keeps its buttons.
  expect(sim.isRestricted(id)).toBe(false);
  return { rt, sim, id, token, mod };
}

describe("Trapped in the Internet — a marked program at his heart (wave 11b)", () => {
  it("the heart terminal still puts a marked program at his heart, and his worker sees the mark but not why", { timeout: SLOW }, async () => {
    const { rt, sim, id, mod } = await markedProgram();
    // The terminal pilots the guest's own thread, then posts `terminal opened`.
    const pilot = await call(rt, "POST", "/api/mod/impersonate", { role: "guest", id, label: "Terminal · Server Room" }, { moderator: true });
    expect(pilot.status).toBe(200);
    expect((await mod("terminal opened", { subject: id, args: { at: "The Server Room" }, label: "Terminal · Server Room" })).status).toBe(200);
    expect(sim.world.peek(`${id}.at_the_heart`)).toMatchObject({ value: true });
    expect(sim.world.peek(`${id}.marked`)).toMatchObject({ value: true });
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "They marked me. Is this your heart?" }, { token: pilot.json["token"] as string })).status).toBe(200);
    const req = worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest)[0]!;
    expect(req.speaker.id).toBe(id);
    expect(String(req.them.vars["at_the_heart"])).toBe("true");
    expect(String(req.them.vars["marked"])).toBe("true");
    // The reason rides the request (not secret) but the persona leaves it off
    // `them:` (stagehand's test_trabolta_show pins that): he asks them why.
    expect(String(req.them.vars["marked_for"])).toBe("missed the cup");
    rt.dispose();
  });

  it("the terminal's 📎 GIVE still hands him a marked program's file, and STANDING DOWN is still theirs to win", { timeout: SLOW }, async () => {
    const { rt, sim, id, mod } = await markedProgram();
    const pilot = await call(rt, "POST", "/api/mod/impersonate", { role: "guest", id, label: "Terminal · Server Room" }, { moderator: true });
    const ptoken = pilot.json["token"] as string;
    await mod("terminal opened", { subject: id, args: { at: "The Server Room" }, label: "Terminal · Server Room" });
    sim.unlock(id, "The Optical Drive");
    expect(sim.holdsCodex("Trabolta", "The Optical Drive")).toBe(false);
    expect((await call(rt, "POST", "/api/guest/codex/share", { entry: "The Optical Drive", to: "Trabolta" }, { token: ptoken })).status).toBe(200);
    expect(sim.holdsCodex("Trabolta", "The Optical Drive")).toBe(true);
    // From the Y2K hour, holding her one line, the mark doesn't close the door on standing down.
    sim.setVar("Night.step", "14");
    sim.unlock(id, "What Sandy Says");
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "She only ever says one thing. She can't answer you." }, { token: ptoken });
    const req = worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest)[0]!;
    expect(req.powers.map((p) => p.id)).toContain("stand_down");
    const reply = await call(rt, "POST", "/api/agent/reply", { id: req.id, say: "You are right.", acts: [{ kind: "fire", name: "stand_down" }] }, { moderator: true });
    expect(reply.status).toBe(200);
    expect(reply.json["acted"]).toEqual([{ kind: "fire", ok: true, what: "stand_down" }]);
    expect(sim.world.peek("Night.stand_down_by")).toMatchObject({ value: "Calculator" });
    rt.dispose();
  });
});
