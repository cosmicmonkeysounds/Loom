import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchIdentities, landingBrand, retryDelay } from "../src/session.ts";

/** A fake server: each route answers in turn (the last answer repeats). */
function fakeServer(routes: Record<string, Array<{ status: number; body: unknown }>>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (async (url: string) => {
    calls.push(url);
    const q = routes[url];
    const hit = q === undefined ? { status: 404, body: { error: "nope" } } : q.length > 1 ? q.shift()! : q[0]!;
    return new Response(JSON.stringify(hit.body), { status: hit.status });
  }) as unknown as typeof fetch);
  return calls;
}

const closedDoors = { status: 200, body: { role: "guest", identities: [], search: false, doorsOpen: false } };
const resolved = { status: 200, body: { eventId: "evt 1", role: "guest", title: "Trapped" } };

describe("the join screen's code lookup", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves a code once, then re-asks only the event (never the throttled resolve)", async () => {
    const calls = fakeServer({ "/api/resolve-code": [resolved], "/e/evt%201/api/identities": [closedDoors] });
    const first = await fetchIdentities("EVT1");
    expect(first).toMatchObject({ kind: "ok", eventId: "evt 1", title: "Trapped", doorsOpen: false });
    for (let i = 0; i < 3; i++) {
      const again = await fetchIdentities("EVT1", { eventId: "evt 1", title: "Trapped", role: "guest" });
      expect(again).toMatchObject({ kind: "ok", eventId: "evt 1", doorsOpen: false });
    }
    expect(calls.filter((u) => u === "/api/resolve-code")).toHaveLength(1);
  });

  it("a throttled resolve (429) is busy, not a wrong code — and so is no answer at all", async () => {
    fakeServer({ "/api/resolve-code": [{ status: 429, body: { error: "too many attempts — slow down" } }] });
    expect(await fetchIdentities("EVT1")).toEqual({ kind: "busy" });
    fakeServer({ "/api/resolve-code": [{ status: 502, body: {} }] });
    expect(await fetchIdentities("EVT1")).toEqual({ kind: "busy" });
    fakeServer({ "/api/resolve-code": [{ status: 404, body: { error: "no event with that code" } }] });
    expect(await fetchIdentities("NOPE")).toEqual({ kind: "unknown" });
  });

  it("an event that went away is resolved afresh (the code may lead to its relaunch)", async () => {
    const calls = fakeServer({
      "/e/evt%201/api/identities": [{ status: 404, body: { error: "unknown event" } }],
      "/api/resolve-code": [{ status: 200, body: { eventId: "evt 2", role: "guest", title: "Trapped" } }],
      "/e/evt%202/api/identities": [{ ...closedDoors, body: { ...closedDoors.body, doorsOpen: true } }],
    });
    const r = await fetchIdentities("EVT1", { eventId: "evt 1", role: "guest" });
    expect(r).toMatchObject({ kind: "ok", eventId: "evt 2", doorsOpen: true });
    expect(calls).toEqual(["/e/evt%201/api/identities", "/api/resolve-code", "/e/evt%202/api/identities"]);
  });

  it("polls every 5 s at a closed door for a minute, then every 15 s; a busy server backs off", () => {
    expect(retryDelay("closed", 0)).toBe(5000);
    expect(retryDelay("closed", 11)).toBe(5000);
    expect(retryDelay("closed", 12)).toBe(15_000);
    expect([0, 1, 2, 5].map((n) => retryDelay("busy", n))).toEqual([10_000, 20_000, 30_000, 30_000]);
  });

  it("asks for the landing's branding once per page, however many screens want it", async () => {
    const calls = fakeServer({ "/api/resolve-code": [{ status: 200, body: { eventId: "evt 1", role: "guest", title: "Trapped", theme: "aol97" } }] });
    const a = landingBrand("EVT1");
    const b = landingBrand("EVT1");
    expect(await a.ask).toEqual({ title: "Trapped", theme: "aol97", role: "guest" });
    expect(await b.ask).toEqual({ title: "Trapped", theme: "aol97", role: "guest" });
    expect(landingBrand("EVT1").value).toEqual({ title: "Trapped", theme: "aol97", role: "guest" }); // a later screen paints at once
    expect(calls).toEqual(["/api/resolve-code"]);
  });
});
