import { describe, expect, it } from "vitest";
import { defaultLights } from "@loom/house";
import { fetchLights, lightRefusal, lightTestSentText, lightsConflictText, lightsViewOf, moduleBadge, pairLights, saveLights, testLight, type LightsFetch, type LightsQuery, type LightsView } from "../src/map/lights-api.ts";
import { runLightsPoll } from "../src/map/lights-poll.ts";

function fakeFetch(status: number, body: unknown, seen: { url: string; init?: RequestInit }[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, ...(init !== undefined ? { init } : {}) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

const view = (version: string, extra: Partial<LightsView> = {}): LightsView => ({ lights: defaultLights(), version, source: "director", looks: [], locations: [], tests: [], pair: null, devices: [], devicesAt: null, module: null, problems: [], warnings: [], ...extra });

describe("the lights routes", () => {
  it("reads a GET answer, tolerating an older or odd shape", () => {
    const v = lightsViewOf({
      lights: { version: 1, fixtures: [] },
      version: "abc",
      source: "project",
      looks: ["heart_idle", 3],
      tests: [{ seq: 2, at: 5, fixture: "f", set: { color: "#FF0000" }, by: "Map" }, { nope: true }],
      pair: { seq: 1, at: 0, seconds: 120, until: 120000, by: "x" },
      devices: [{ friendly: "server_room_rgb", ieee: "0x1", type: "Router", model: null, vendor: null, description: null, caps: { color: true, ct: true, dim: true } }, { friendly: "" }],
      devicesAt: 77,
      module: { name: "house-mac", at: 1, online: true },
    });
    expect(v.lights.zones).toEqual([]);
    expect(v.looks).toEqual(["heart_idle"]);
    expect(v.tests).toHaveLength(1);
    expect(v.tests[0]!.set).toEqual({ color: "#FF0000" });
    expect(v.pair!.until).toBe(120000);
    expect(v.devices.map((d) => d.friendly)).toEqual(["server_room_rgb"]);
    expect(v.devicesAt).toBe(77);
    expect(v.module!.online).toBe(true);
    const old = lightsViewOf({});
    expect(old.source).toBe("default");
    expect(old.module).toBeNull();
  });

  it("sends every cursor of the long poll, and the token", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const r = await fetchLights("/e/x", "tok", { after: "v1", tests: 3, pairs: 2, devicesAt: 99, wait: 25, fetcher: fakeFetch(200, { version: "v2" }, seen) });
    expect(r.kind).toBe("ok");
    expect(seen[0]!.url).toBe("/e/x/api/mod/lights?after=v1&tests=3&pairs=2&devicesAt=99&wait=25");
    expect((seen[0]!.init!.headers as Record<string, string>)["x-loom-token"]).toBe("tok");
    expect((await fetchLights("/e/x", "t", { fetcher: fakeFetch(404, {}) })).kind).toBe("missing");
    const e = await fetchLights("/e/x", "t", { fetcher: fakeFetch(403, { error: "moderators only" }) });
    expect(e).toEqual({ kind: "error", status: 403, error: "moderators only" });
  });

  it("a save sends its base; a 409 is a conflict with the server's version", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const ok = await saveLights("/e/x", "t", defaultLights(), "v1", fakeFetch(200, { ok: true, version: "v2", warnings: [] }, seen));
    expect(JSON.parse(seen[0]!.init!.body as string).base).toBe("v1");
    expect(ok.ok).toBe(true);
    const c = await saveLights("/e/x", "t", defaultLights(), "v1", fakeFetch(409, { error: "stale", version: "v3", source: "director" }));
    expect(c.ok === false && c.conflict && c.version === "v3").toBe(true);
    const bad = await saveLights("/e/x", "t", defaultLights(), null, fakeFetch(400, { error: "invalid lights.json", problems: ["version must be 1"] }));
    expect(bad.ok === false && bad.problems[0] === "version must be 1").toBe(true);
    expect(lightsConflictText("v3")).toMatch(/changed since you loaded them \(now vv3\)/);
  });

  it("explains a refused test: unsaved, a set that does nothing, the server away", async () => {
    const r = await testLight("/e/x", "t", { fixture: "a", set: { transition: 1 } }, fakeFetch(400, { error: "set does nothing" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(lightRefusal(r, { fixture: "a", set: {} })).toMatch(/change nothing/);
    expect(lightRefusal({ status: 404, error: "no such fixture" }, { fixture: "light-1" })).toMatch(/save the lights/);
    expect(lightRefusal({ status: 404, error: "no such look" }, { look: "heart_wake" })).toMatch(/heart_wake/);
    expect(lightRefusal({ status: 0, error: "offline" }, { pair: 120 })).toMatch(/Couldn't reach/);
    expect(lightTestSentText("Identify", false)).toMatch(/isn't polling/);
    const p = await pairLights("/e/x", "t", 120, fakeFetch(200, { ok: true, seq: 1, until: 5 }));
    expect(p.ok && p.result.until === 5).toBe(true);
  });

  it("badges the module", () => {
    expect(moduleBadge(null, 0)).toEqual({ text: "💡 no lights module yet", ok: false });
    expect(moduleBadge({ name: "mac", at: 0, online: true }, 0).text).toBe("💡 module online · mac");
    expect(moduleBadge({ name: "", at: 0, online: false }, 120_000).text).toBe("💡 module last seen 2 min ago");
  });
});

describe("the lights long poll", () => {
  it("asks after the newest version with the test / pair cursors and the last devicesAt", async () => {
    const asks: LightsQuery[] = [];
    const answers: LightsFetch[] = [
      { kind: "ok", view: view("v1", { devicesAt: 10 }) },
      { kind: "ok", view: view("v2", { devicesAt: 20 }) },
      { kind: "error", status: 401, error: "end" },
    ];
    let testSeq = 4;
    await runLightsPoll({
      fetch: async (q) => {
        asks.push(q);
        return answers.shift()!;
      },
      onView: () => {
        testSeq = 5;
        return true;
      },
      onMissing: () => {},
      onError: () => {},
      testSeq: () => testSeq,
      pairSeq: () => 7,
      stopped: () => false,
      sleep: async () => {},
    });
    expect(asks[0]).toEqual({});
    expect(asks[1]).toEqual({ after: "v1", tests: 5, pairs: 7, devicesAt: 10, wait: 25 });
    expect(asks[2]).toEqual({ after: "v2", tests: 5, pairs: 7, devicesAt: 20, wait: 25 });
  });

  it("waits after an answer it took nothing from, backs off when away, stops on a missing server", async () => {
    const sleeps: number[] = [];
    const answers: LightsFetch[] = [{ kind: "ok", view: view("v1") }, { kind: "error", status: null, error: "away" }, { kind: "error", status: 502, error: "bad gateway" }, { kind: "missing" }];
    let missing = false;
    const errors: string[] = [];
    await runLightsPoll({
      fetch: async () => answers.shift()!,
      onView: () => false,
      onMissing: () => {
        missing = true;
      },
      onError: (r) => errors.push(r.error),
      testSeq: () => 0,
      pairSeq: () => 0,
      stopped: () => false,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      idleMs: 900,
    });
    expect(sleeps).toEqual([900, 1000, 2000]);
    expect(errors).toEqual(["away", "bad gateway"]);
    expect(missing).toBe(true);
  });
});
