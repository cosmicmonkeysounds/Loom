import { describe, expect, it } from "vitest";
import { defaultAudio } from "@loom/house";
import { audioConflictText, audioViewOf, fetchAudio, saveAudio, saveAudioToProject, testAge, testAudio, testRefusal } from "../src/map/audio-api.ts";

/** A fetch that answers `status` + `body` and records each call. */
function fake(status: number, body: unknown, calls: { url: string; init?: RequestInit }[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init !== undefined ? { init } : {}) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("the speaker routes", () => {
  it("reads a GET, tolerating an older or partial shape", () => {
    const v = audioViewOf({ audio: { version: 1 }, version: "abc", source: "project", sounds: ["zip", 3], locations: ["The Desktop"], tests: [{ seq: 2, at: 10, speaker: "a", out: null }, { bogus: true }] });
    expect(v.version).toBe("abc");
    expect(v.source).toBe("project");
    expect(v.sounds).toEqual(["zip"]);
    expect(v.tests).toEqual([{ seq: 2, at: 10, speaker: "a", out: null }]);
    expect(v.audio.speakers).toEqual([]);
    expect(audioViewOf({}).source).toBe("default");
  });

  it("long-polls with after / tests / wait and the mod token", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const r = await fetchAudio("/e/x", "TOK", { after: "v1", tests: 4, wait: 25, fetcher: fake(200, { audio: defaultAudio(), version: "v2" }, calls) });
    expect(r.kind).toBe("ok");
    expect(calls[0]!.url).toBe("/e/x/api/mod/audio?after=v1&tests=4&wait=25");
    expect((calls[0]!.init!.headers as Record<string, string>)["x-loom-token"]).toBe("TOK");
    expect((await fetchAudio("/e/x", "T", { fetcher: fake(404, {}) })).kind).toBe("missing");
    expect(await fetchAudio("/e/x", "T", { fetcher: fake(403, { error: "moderators only" }) })).toEqual({ kind: "error", status: 403, error: "moderators only" });
    const away = await fetchAudio("/e/x", "T", { fetcher: (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch });
    expect(away).toEqual({ kind: "error", status: null, error: "offline" });
  });

  it("saves with the base it loaded; a 409 with a version is a conflict", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const ok = await saveAudio("/e/x", "T", defaultAudio(), "v1", fake(200, { ok: true, version: "v2", warnings: ["w"] }, calls));
    expect(ok).toEqual({ ok: true, result: { ok: true, version: "v2", warnings: ["w"] } });
    expect(JSON.parse(String(calls[0]!.init!.body))).toMatchObject({ base: "v1" });
    const conflict = await saveAudio("/e/x", "T", defaultAudio(), "v1", fake(409, { error: "the speakers changed since you loaded them", version: "v9" }));
    expect(conflict).toMatchObject({ ok: false, conflict: true, version: "v9" });
    const bad = await saveAudio("/e/x", "T", defaultAudio(), null, fake(400, { error: "invalid audio.json", problems: ["p"] }));
    expect(bad).toMatchObject({ ok: false, conflict: false, problems: ["p"] });
    expect(audioConflictText("v9")).toMatch(/now vv9|v9/);
  });

  it("saves to the project (409 without a version = no project, not a conflict)", async () => {
    const r = await saveAudioToProject("/e/x", "T", fake(409, { error: "this event has no project — download the JSON instead" }));
    expect(r).toMatchObject({ ok: false, conflict: false, status: 409 });
  });

  it("asks for a test and explains a refusal", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const r = await testAudio("/e/x", "T", { out: 3 }, fake(200, { ok: true, seq: 7 }, calls));
    expect(r).toEqual({ ok: true, result: { ok: true, seq: 7 } });
    expect(calls[0]!.url).toBe("/e/x/api/mod/audio/test");
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ out: 3 });
    expect(testRefusal({ status: 404, error: "no such speaker" }, { speaker: "s1" })).toMatch(/isn't saved yet/);
    expect(testRefusal({ status: 0, error: "offline" }, { out: 1 })).toMatch(/Couldn't reach/);
    expect(testRefusal({ status: 400, error: "out must be an output from 1 to 16" }, { out: 99 })).toBe("Not tested — out must be an output from 1 to 16.");
    expect(testAge(1000, 5400)).toBe("4 s ago");
    expect(testAge(0, 120_000)).toBe("2 min ago");
  });
});

describe("is the router listening? (LA-4)", () => {
  it("reads the server's router block (null from an older server) and says what a Test did", async () => {
    const { routerBadge, routerOf, testSentText } = await import("../src/map/audio-api.ts");
    expect(routerOf(undefined)).toBeNull();
    expect(routerOf({ online: true, lastSeen: 5, name: "mac" })).toEqual({ online: true, lastSeen: 5, name: "mac" });
    expect(testSentText(4, "Living L", { online: true, lastSeen: 1, name: null }, 2)).toContain("plays a tone");
    const down = testSentText(4, "Living L", { online: false, lastSeen: 1000, name: null }, 61_000);
    expect(down).toContain("queued");
    expect(down).toContain("stagehand audio module");
    expect(testSentText(4, "Living L", { online: false, lastSeen: null, name: null }, 0)).toContain("no router has polled since the server started");
    expect(testSentText(4, "x", null, 0)).toContain("if it is running");
    expect(routerBadge({ online: true, lastSeen: 1, name: "mac" }, 2)).toEqual({ text: "router online · mac", ok: true });
    expect(routerBadge({ online: false, lastSeen: null, name: null }, 2)).toEqual({ text: "no router yet", ok: false });
    expect(routerBadge(null, 2)).toBeNull();
  });
});
