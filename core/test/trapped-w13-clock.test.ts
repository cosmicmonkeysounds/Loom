//! Trapped in the Internet — the show clock in the story (wave 13, DRAFT
//! Q37 / Q38): Power On starts it at 7:00 PM, 🕚 y2k_clock jumps it to
//! 11:00 PM so the final round ends at midnight.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { notePress, pressRefused } from "../server/views.ts";
import { formatShowTime, showClock, showMinutes } from "../src/show-clock.ts";
import { TO_Y2K, pressChain } from "../../scripts/accept/chains.ts";

const CODES = { event: "EVTTCL", prime: "PRMTCL", mod: "MODTCL" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
}
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: Record<string, unknown> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    setHeader() {},
    write() {
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body), res as unknown as ServerResponse, method, url.pathname, url, {});
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}

describe("Trapped in the Internet: the clock in the story (DRAFT Q37 / Q38)", () => {
  it("Power On starts it at 7:00 PM; 🕚 y2k_clock jumps it to 11:00 PM", { timeout: 60_000 }, async () => {
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    sim.fireBeat("Power On");
    expect(showClock(sim, true)).toEqual({ minutes: 1140, running: true });
    sim.tick(1000);
    for (let i = 0; i < 599; i++) sim.tick(1000);
    expect(showClock(sim, true)?.minutes).toBe(1150);
    const signal = async (name: string) => {
      const out = sim.signal(name);
      notePress(sim, out);
      return pressRefused(sim, out) ? { ok: true, refused: true } : { ok: true };
    };
    const r = await pressChain(TO_Y2K, signal, () => {});
    expect(r.ok).toBe(true);
    expect(showClock(sim, true)?.minutes).toBe(1380);
    for (let i = 0; i < 3600; i++) sim.tick(1000);
    expect(formatShowTime(showMinutes(sim)!)).toBe("12:00 AM");
  });

  it("a guest's view on the event server reads 7:00 PM once the doors open", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-tclock-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "trapped", scenarioSource: scenarioSource("trapped-in-the-internet"), joinBase: () => "http://localhost" });
    rt.openDoors();
    const reg = await call(rt, "POST", "/api/guest/register", { name: "Winamp", passcode: CODES.event });
    expect(reg.status).toBe(200);
    const view = await call(rt, "GET", `/api/state?role=guest&token=${reg.json.token as string}`);
    expect(view.json.showClock).toEqual({ minutes: 1140, running: true });
  });
});
