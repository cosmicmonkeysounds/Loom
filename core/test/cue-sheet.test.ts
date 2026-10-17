//! The director's cue sheet off a mod token (W-26): the phone cue page signs
//! in with the mod passcode only, reads `cues` + the admin interactions off
//! `GET /api/state`, and fires with `/api/mod/signal {name, subject?, label}`
//! — the label is the journal's `by`. The rows are `src/cue-sheet.ts`, the
//! module the editor and the play app share.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { ModView } from "../server/views.ts";
import { cueRows, cueSheetView } from "../src/cue-sheet.ts";

const CODES = { event: "EVT262", prime: "PRM262", mod: "MOD262" };
const SOURCE = `# Cue Phone

INTERACTION ring_the_bell
  label: C1 · 📣 Call everyone
  who: admin

INTERACTION hunt_time_up
  label: C2 · ⏰ Hunt over
  who: admin

INTERACTION accuse
  who: performer

when ring_the_bell:
  set Night.phase = "desktop"
`;

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
  } as unknown as IncomingMessage;
}
function fakeRes() {
  const res = {
    statusCode: 0,
    body: "",
    setHeader() {},
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
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, method: string, p: string, body: unknown, token?: string) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, token ? { "x-loom-token": token } : {}), res, method, url.pathname, url, { moderator: false });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

describe("the phone cue page's server surface (W-26)", () => {
  it("a mod token reads the cue sheet and fires a cue under the phone's label", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-cuephone-"));
    dirs.push(dir);
    const store = new Store(dir);
    const rt = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "cue-phone", scenarioSource: SOURCE, joinBase: () => "http://localhost" });
    rt.openDoors();

    expect((await call(rt, "GET", "/api/state?role=mod", {})).status).toBe(403);
    const login = await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod });
    expect(login.status).toBe(200);
    const token = login.json["token"] as string;

    const before = (await call(rt, "GET", "/api/state?role=mod", {}, token)).json as unknown as ModView;
    expect(before.cues).toEqual({ last: null, lastBy: null, fired: [] });
    const rows = cueRows(before.interactions ?? [], before.cues!);
    expect(rows.map((r) => [r.code, r.next])).toEqual([
      ["C1", true],
      ["C2", false],
    ]);

    const fired = await call(rt, "POST", "/api/mod/signal", { name: "ring_the_bell", label: "Phone · Ana" }, token);
    expect(fired.status).toBe(200);
    const after = (await call(rt, "GET", "/api/state?role=mod", {}, token)).json as unknown as ModView;
    expect(after.cues?.last).toBe("ring_the_bell");
    expect(cueRows(after.interactions ?? [], after.cues!).find((r) => r.next)?.id).toBe("hunt_time_up");
    expect(after.world.find((w) => w.path === "Night.phase")?.value).toContain("desktop");
    const signal = store.readJournal().find((e) => e.m === "signal");
    expect(signal?.by).toBe("Phone · Ana");
    rt.dispose();
  });

  it("?cues=1 answers just the cue sheet, a fraction of the full view", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-cuephone-"));
    dirs.push(dir);
    const store = new Store(dir);
    const rt = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "cue-phone", scenarioSource: SOURCE, joinBase: () => "http://localhost" });
    rt.openDoors();
    for (let i = 0; i < 20; i++) await call(rt, "POST", "/api/guest/register", { passcode: CODES.event, name: `Guest ${i}` });
    const token = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
    await call(rt, "POST", "/api/mod/signal", { name: "ring_the_bell", label: "Phone · Ana" }, token);
    expect((await call(rt, "GET", "/api/state?role=mod&cues=1", {})).status).toBe(403);

    const full = await call(rt, "GET", "/api/state?role=mod", {}, token);
    const lean = await call(rt, "GET", "/api/state?role=mod&cues=1", {}, token);
    expect(lean.status).toBe(200);
    expect(Object.keys(lean.json).sort()).toEqual(["cues", "interactions", "roster", "title", "world"]);
    expect(lean.json).toEqual(cueSheetView(full.json as unknown as ModView));
    const v = lean.json as unknown as ReturnType<typeof cueSheetView>;
    expect(v.interactions.map((i) => i.id)).toEqual(["ring_the_bell", "hunt_time_up"]);
    expect(v.world).toEqual([{ path: "Night.phase", value: expect.stringContaining("desktop") }]);
    expect(v.roster).toHaveLength(20);
    expect(Object.keys(v.roster[0]!).sort()).toEqual(["id", "location", "name", "owner"]);
    expect(v.cues.last).toBe("ring_the_bell");
    expect(JSON.stringify(lean.json).length * 3).toBeLessThan(JSON.stringify(full.json).length);
    rt.dispose();
  });
});

describe("NEXT skips what already ran (T7-01)", () => {
  const ix = (id: string, extra: { sequence?: false; repeat?: true } = {}) => ({ id, label: id, who: "admin", ...extra });
  const sheet = [ix("c1"), ix("v2"), ix("close"), ix("results", { repeat: true }), ix("spin", { sequence: false }), ix("telephone"), ix("zip", { repeat: true }), ix("overshare")];
  const next = (last: string | null, fired: string[]) => cueRows(sheet, { last, fired }).find((r) => r.next)?.id ?? null;

  it("is the first in-sequence row after LAST that hasn't fired", () => {
    expect(next(null, [])).toBe("c1");
    expect(next("c1", ["c1", "close"])).toBe("v2");
    expect(next("v2", ["c1", "v2", "close"])).toBe("results");
    expect(next("close", ["c1", "v2", "close", "telephone"])).toBe("results");
    expect(next("results", ["c1", "v2", "close", "results", "telephone"])).toBe("results");
    expect(next("telephone", ["c1", "v2", "close", "results", "telephone"])).toBe("zip");
  });

  it("a `repeat: true` LAST stays NEXT: 📋 per question, 🗜 per trip, until the director moves on (T7-01)", () => {
    const rows = cueRows(sheet, { last: "results", fired: ["c1", "v2", "close", "results"] });
    expect(rows.find((r) => r.id === "results")).toMatchObject({ last: true, next: true });
    expect(rows.filter((r) => r.next)).toHaveLength(1);
    expect(next("zip", ["zip"])).toBe("zip");
    expect(next("overshare", ["zip", "overshare"])).toBe(null);
  });

  it("a `repeat: true` cue stays eligible once fired; the lean view carries the flag", () => {
    expect(next("v2", ["c1", "v2", "close", "results"])).toBe("results");
    expect(next("telephone", ["telephone", "zip"])).toBe("zip");
    expect(cueSheetView({ interactions: sheet }).interactions.find((i) => i.id === "results")).toMatchObject({ repeat: true });
    expect(cueSheetView({ interactions: sheet }).interactions.find((i) => i.id === "c1")).not.toHaveProperty("repeat");
  });
});
