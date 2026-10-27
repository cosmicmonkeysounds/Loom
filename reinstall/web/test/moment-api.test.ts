//! The game moment route on the wire (wave 26, C6): `POST
//! /api/spatial/moment` for the void, the heart and the virus disk, against
//! a fake fetch with the contract's exact shapes. The two 404s are told
//! apart by the `error` string only.
import { describe, expect, it } from "vitest";
import { momentLinesOf, OLD_SERVER_404, postMoment, type MomentRequest } from "../src/api.ts";

function stubFetch(status: number, body: unknown, raw = false): { urls: string[]; inits: RequestInit[]; fetch: typeof fetch } {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    inits.push(init ?? {});
    return new Response(raw ? String(body) : JSON.stringify(body), { status, headers: { "content-type": raw ? "text/plain" : "application/json" } });
  }) as unknown as typeof fetch;
  return { urls, inits, fetch: f };
}

const ESCAPE: MomentRequest = { kind: "escape" };
const HEART: MomentRequest = { kind: "heart", prop: "server-heart" };
const PICKUP: MomentRequest = { kind: "pickup", prop: "virus-disk" };
const LINES = [
  { from: "Trabolta", text: "First line." },
  { from: "Trabolta", text: "Second line." },
];
const SPAWN = { room: "tent", pos: [-4.5, 0, 26.3], yaw: 90 };

describe("postMoment — the request", () => {
  it("POSTs the request as JSON with the session token", async () => {
    const s = stubFetch(200, { ok: true, kind: "pickup", lines: [], item: "virus", prop: "virus-disk" });
    await postMoment("/e/ev", "sess-tok", PICKUP, s.fetch);
    expect(s.urls).toEqual(["/e/ev/api/spatial/moment"]);
    expect(s.inits[0]!.method).toBe("POST");
    expect((s.inits[0]!.headers as Record<string, string>)["x-loom-token"]).toBe("sess-tok");
    expect(JSON.parse(String(s.inits[0]!.body))).toEqual({ kind: "pickup", prop: "virus-disk" });
    const e = stubFetch(200, { ok: true, kind: "escape", lines: [], spawn: SPAWN, cooldownMs: 20000 });
    await postMoment("/e/ev", "t", ESCAPE, e.fetch);
    expect(JSON.parse(String(e.inits[0]!.body))).toEqual({ kind: "escape" });
  });
});

describe("postMoment — 200", () => {
  it("escape: the lines, the spawn and the cooldown", async () => {
    const s = stubFetch(200, { ok: true, kind: "escape", lines: LINES, spawn: SPAWN, cooldownMs: 20000 });
    expect(await postMoment("/e/ev", "t", ESCAPE, s.fetch)).toEqual({ kind: "escaped", lines: LINES, spawn: SPAWN, cooldownMs: 20000 });
  });

  it("heart: the lines (empty = nothing to say)", async () => {
    expect(await postMoment("/e/ev", "t", HEART, stubFetch(200, { ok: true, kind: "heart", lines: LINES }).fetch)).toEqual({ kind: "heart", lines: LINES });
    expect(await postMoment("/e/ev", "t", HEART, stubFetch(200, { ok: true, kind: "heart", lines: [] }).fetch)).toEqual({ kind: "heart", lines: [] });
  });

  it("pickup: the lines, the item and the prop", async () => {
    const s = stubFetch(200, { ok: true, kind: "pickup", lines: [LINES[0]], item: "virus", prop: "virus-disk" });
    expect(await postMoment("/e/ev", "t", PICKUP, s.fetch)).toEqual({ kind: "picked", lines: [LINES[0]], item: "virus", prop: "virus-disk" });
  });

  it("malformed lines are dropped; a spawn that isn't one is null", async () => {
    expect(momentLinesOf([{ from: "A", text: "ok" }, { text: "" }, null, 3, { from: 1, text: "no from" }])).toEqual([
      { from: "A", text: "ok" },
      { from: "", text: "no from" },
    ]);
    expect(momentLinesOf(undefined)).toEqual([]);
    const s = stubFetch(200, { ok: true, kind: "escape", lines: [], spawn: { pos: [1, 2] } });
    expect(await postMoment("/e/ev", "t", ESCAPE, s.fetch)).toEqual({ kind: "escaped", lines: [], spawn: null, cooldownMs: 0 });
  });
});

describe("postMoment — refusals", () => {
  const cases: Array<[string, number, unknown, MomentRequest, unknown]> = [
    ["400 bad moment", 400, { error: "bad moment" }, HEART, { kind: "bad" }],
    ["401 unknown session token", 401, { error: "unknown session token" }, ESCAPE, { kind: "over", status: 401 }],
    ["410 this session is over", 410, { error: "this session is over" }, ESCAPE, { kind: "over", status: 410 }],
    ["404 no such prop", 404, { error: "no such prop" }, PICKUP, { kind: "noProp" }],
    ["404 not found (an old server)", 404, { error: OLD_SERVER_404 }, ESCAPE, { kind: "old" }],
    ["409 doors are closed", 409, { error: "doors are closed" }, ESCAPE, { kind: "paused" }],
    ["409 parked", 409, { error: "this session has not started — send a pose first" }, HEART, { kind: "parked" }],
    ["409 not out", 409, { error: "not out", distance: 3.2 }, ESCAPE, { kind: "notOut", distance: 3.2 }],
    ["409 cooldown", 409, { error: "cooldown", retryMs: 12000 }, ESCAPE, { kind: "cooldown", retryMs: 12000 }],
    ["409 sealed", 409, { error: "sealed" }, HEART, { kind: "sealed" }],
    ["409 not there", 409, { error: "not there" }, HEART, { kind: "notThere" }],
    ["409 far", 409, { error: "far", distance: 1.4 }, PICKUP, { kind: "far", distance: 1.4 }],
    ["409 already", 409, { error: "already" }, PICKUP, { kind: "already" }],
  ];
  for (const [name, status, body, req, want] of cases) {
    it(name, async () => {
      expect(await postMoment("/e/ev", "t", req, stubFetch(status, body).fetch)).toEqual(want);
    });
  }

  it("any other 404 body is an old server — even one that isn't JSON", async () => {
    expect(await postMoment("/e/ev", "t", ESCAPE, stubFetch(404, "Not Found", true).fetch)).toEqual({ kind: "old" });
    expect(await postMoment("/e/ev", "t", ESCAPE, stubFetch(404, { error: "something else" }).fetch)).toEqual({ kind: "old" });
  });

  it("an unknown 409, a 500 or a network failure is an error", async () => {
    expect(await postMoment("/e/ev", "t", ESCAPE, stubFetch(409, { error: "weird" }).fetch)).toEqual({ kind: "error", message: "weird" });
    expect(await postMoment("/e/ev", "t", ESCAPE, stubFetch(500, {}).fetch)).toEqual({ kind: "error", message: "HTTP 500" });
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await postMoment("/e/ev", "t", ESCAPE, down)).toEqual({ kind: "error", message: "offline" });
  });
});
