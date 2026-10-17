//! W8 T9-02: a restart replays the journal into a fresh sim, and every
//! replayed line drains every watcher for every guest. With the parse cache
//! a 40-guest night replays in seconds, not minutes, and lands on exactly
//! the live world — the guard against a shared parse tree drifting a replay
//! (the replay starts on a cold cache, so it re-parses what the night shared).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { clearParseCache } from "../src/runtime/expr.ts";
import { Store } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";

const SHOW = "trapped-in-the-internet";
const CODES = { event: "EVT444", prime: "PRM444", mod: "MOD444" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function post(rt: EventRuntime, path: string, body: unknown) {
  const buf = Buffer.from(JSON.stringify(body));
  const req = {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write: () => true,
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  await rt.handle(req, res as unknown as ServerResponse, "POST", path, new URL(`http://x${path}`), { moderator: true });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

describe("restore at show scale", () => {
  it("replays a 2,000-line, 40-guest journal of the show onto the live world, within a budget", { timeout: 120_000 }, async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-restore-"));
    dirs.push(d);
    const store = new Store(d);
    const mk = () => new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: SHOW, scenarioSource: scenarioSource(SHOW), joinBase: () => "http://localhost" });
    const rt = mk();
    rt.openDoors();
    const guests: string[] = [];
    for (let i = 0; i < 40; i++) {
      const r = await post(rt, "/api/mod/persona", { name: `Program ${i}` });
      expect(r.status).toBe(200);
      guests.push(String((r.json["guest"] as { id: string } | undefined)?.id ?? r.json["id"]));
    }
    await post(rt, "/api/mod/signal", { name: "call_to_the_desktop" });
    for (let i = 0; store.readJournal().length < 2000; i++) {
      const g = guests[i % guests.length]!;
      if (i % 3 === 0) rt.tickOnce(20_000); // a long tick journals at once
      else if (i % 3 === 1) await post(rt, "/api/mod/var", { path: `${g}.humanity`, value: String(i % 100) });
      else await post(rt, "/api/mod/var", { path: "Night.probe", value: String(i) });
    }
    rt.pause();
    const live = rt.liveSim!;
    const lines = store.readJournal().length;
    expect(lines).toBeGreaterThanOrEqual(2000);

    // Replay on a cold cache, as a booted server does: the live night ran on
    // shared cached trees, the replay re-parses — any drift shows below.
    clearParseCache();
    const again = mk();
    const t0 = performance.now();
    expect(again.restore()).not.toBeNull();
    const ms = performance.now() - t0;
    const replayed = again.liveSim!;
    expect(replayed.persons.size).toBe(40);
    expect(replayed.worldEntries()).toEqual(live.worldEntries());
    expect(replayed.log.len()).toBe(live.log.len());
    // ≈ 1.8 ms a line on an M-series laptop with the parse cached (≈ 7 ms
    // without): a loose bound, so a slow CI box never flakes, that still
    // catches the regression.
    expect(ms).toBeLessThan(lines * 6);
    rt.dispose();
    again.dispose();
  });
});
