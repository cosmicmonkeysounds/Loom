// Wave 44 (C8): the credits a screen rolls — `GET /e/<id>/api/credits` with
// the terminal's token, once per slide seq, a 404 final, an error asked again.

import { afterEach, describe, expect, it } from "vitest";
import { CREDITS_TRIES, CreditsCache, asCreditsView, creditsKey, fetchCredits, type CreditsLoad } from "../src/cutscene/credits-fetch.ts";
import { sceneAccess, setSceneAccess } from "../src/cutscene/access-bus.ts";
import { fakeCredits } from "../src/cutscene/fake.ts";

const ACCESS = { base: "/e/ev1", token: "tok" };
const flush = () => new Promise((r) => setTimeout(r, 0));

function res(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

describe("the access bus", () => {
  afterEach(() => setSceneAccess(null));

  it("carries the app's base and token, and nothing half-set", () => {
    expect(sceneAccess()).toBeNull();
    setSceneAccess(ACCESS);
    expect(sceneAccess()).toEqual(ACCESS);
    setSceneAccess({ base: "/e/x", token: "" });
    expect(sceneAccess()).toBeNull();
  });
});

describe("fetchCredits", () => {
  it("asks the event's route with the mod token, never Authorization", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const view = fakeCredits();
    const r = await fetchCredits(ACCESS, (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return res(200, view);
    }) as typeof fetch);
    expect(r).toEqual({ kind: "ok", view });
    expect(calls[0]![0]).toBe("/e/ev1/api/credits");
    expect(calls[0]![1]!.headers).toEqual({ "x-loom-token": "tok" });
    expect(calls[0]![1]!.cache).toBe("no-store");
  });

  it("reads a 404 (no_credits) as none and anything else as an error", async () => {
    expect(await fetchCredits(ACCESS, (async () => res(404, { error: "no_credits" })) as unknown as typeof fetch)).toEqual({ kind: "none" });
    expect(await fetchCredits(ACCESS, (async () => res(500, {})) as unknown as typeof fetch)).toEqual({ kind: "error" });
    expect(await fetchCredits(ACCESS, (async () => res(403, { error: "not_yet" })) as unknown as typeof fetch)).toEqual({ kind: "error" });
    expect(await fetchCredits(ACCESS, (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).toEqual({ kind: "error" });
    expect(await fetchCredits(null, (async () => res(200, fakeCredits())) as unknown as typeof fetch)).toEqual({ kind: "error" });
    // A 200 that is no CreditsView is no credits.
    expect(await fetchCredits(ACCESS, (async () => res(200, { nope: 1 })) as unknown as typeof fetch)).toEqual({ kind: "none" });
  });
});

describe("asCreditsView", () => {
  it("keeps a good view as it is", () => {
    const v = fakeCredits();
    expect(asCreditsView(JSON.parse(JSON.stringify(v)))).toEqual(v);
  });

  it("reads a wonky answer generously", () => {
    expect(asCreditsView(null)).toBeNull();
    expect(asCreditsView({ title: 3, sections: [] })).toBeNull();
    expect(asCreditsView({ title: "T", sections: "x" })).toBeNull();
    const v = asCreditsView({ title: "T", subtitle: " ", sections: [7, { heading: "H", people: [{ role: "R", name: "N" }, { role: 1 }], lines: ["a", 2], programs: true }], end: ["bye", 4] });
    expect(v).toEqual({ title: "T", subtitle: null, sections: [{ heading: "H", people: [{ role: "R", name: "N" }], lines: ["a"], programs: true }], end: ["bye"], roll: 0 });
  });
});

describe("the cache (once per slide seq)", () => {
  function harness(answers: CreditsLoad[]) {
    let calls = 0;
    const timers: Array<() => void> = [];
    const cache = new CreditsCache({
      load: async () => answers[Math.min(calls++, answers.length - 1)]!,
      later: (fn) => void timers.push(fn),
    });
    return { cache, timers, calls: () => calls };
  }
  const view = fakeCredits();

  it("keys a roll on the sim's epoch and the slide's seq", () => {
    expect(creditsKey("e1", 4)).not.toBe(creditsKey("e2", 4));
    expect(creditsKey(null, 4)).not.toBe(creditsKey(null, 5));
  });

  it("asks once per key, however many scenes ask", async () => {
    const h = harness([{ kind: "ok", view }]);
    const k = creditsKey("e", 1);
    expect(h.cache.peek(k)).toEqual({ status: "loading" });
    h.cache.request(k);
    h.cache.request(k);
    await flush();
    h.cache.request(k);
    expect(h.calls()).toBe(1);
    expect(h.cache.peek(k)).toEqual({ status: "ready", view });
    // A new roll (G12) is a new seq: asked again.
    h.cache.request(creditsKey("e", 2));
    expect(h.calls()).toBe(2);
  });

  it("tells its listeners when an answer lands", async () => {
    const h = harness([{ kind: "ok", view }]);
    let heard = 0;
    const off = h.cache.subscribe(() => heard++);
    h.cache.request("k");
    await flush();
    expect(heard).toBe(1);
    off();
    h.cache.request("k2");
    await flush();
    expect(heard).toBe(1);
  });

  it("takes a 404 as final: no second ask", async () => {
    const h = harness([{ kind: "none" }]);
    h.cache.request("k");
    await flush();
    expect(h.cache.peek("k")).toEqual({ status: "none" });
    expect(h.timers).toHaveLength(0);
  });

  it("shows the fallback after an error, asks again, and rolls the real credits when they come", async () => {
    const h = harness([{ kind: "error" }, { kind: "ok", view }]);
    h.cache.request("k");
    await flush();
    expect(h.cache.peek("k")).toEqual({ status: "failed" });
    expect(h.timers).toHaveLength(1);
    h.timers.shift()!();
    await flush();
    expect(h.calls()).toBe(2);
    expect(h.cache.peek("k")).toEqual({ status: "ready", view });
  });

  it(`gives up after ${CREDITS_TRIES} tries`, async () => {
    const h = harness([{ kind: "error" }]);
    h.cache.request("k");
    for (let i = 0; i < 10; i++) {
      await flush();
      const next = h.timers.shift();
      if (next === undefined) break;
      next();
    }
    expect(h.calls()).toBe(CREDITS_TRIES);
    expect(h.cache.peek("k")).toEqual({ status: "failed" });
  });

  it("a thrown loader is an error", async () => {
    const cache = new CreditsCache({ load: () => Promise.reject(new Error("x")), later: () => undefined });
    cache.request("k");
    await flush();
    expect(cache.peek("k")).toEqual({ status: "failed" });
  });

  it("remembers only the newest rolls", async () => {
    const h = harness([{ kind: "ok", view }]);
    for (let i = 1; i <= 6; i++) h.cache.request(`k${i}`);
    await flush();
    expect(h.cache.has("k1")).toBe(false);
    expect(h.cache.has("k6")).toBe(true);
  });

  it("forgets every roll when the loader is swapped (the preview), and drops a late answer from the old one", async () => {
    let release: (r: CreditsLoad) => void = () => {};
    const cache = new CreditsCache({ load: () => new Promise<CreditsLoad>((r) => (release = r)), later: () => undefined });
    cache.request("k");
    cache.setLoad(async () => ({ kind: "none" }));
    release({ kind: "ok", view });
    await flush();
    expect(cache.has("k")).toBe(false);
    cache.request("k");
    await flush();
    expect(cache.peek("k")).toEqual({ status: "none" });
  });
});
