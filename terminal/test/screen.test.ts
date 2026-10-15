import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { MISSES_OFFLINE, attractOf, missesAfter, parseScreenState, pollScreen, screenReachable, screenStateUrl, voiceOf } from "../src/screen.ts";

const config = defaultConfig({ eventId: "evt 1", token: "tok", name: "Kitchen", spot: "start-bar", view: "auto" });

const body = {
  now: 1,
  night: { screen: "screensaver", terminals: "screensaver" },
  cues: { screens: { value: "screensaver", seq: 1 }, terminals: null, tv: null, tablet: null },
  character: { id: "Trabolta", hidden: true, awake: false, online: true },
  attract: true,
  countdown: null,
  remaining: null,
  terminals: [],
};

function fakeFetch(status: number, json: unknown, seen: Array<{ url: string; init?: RequestInit }> = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return { status, ok: status >= 200 && status < 300, json: async () => json } as Response;
  }) as unknown as typeof fetch;
}

describe("screen state", () => {
  it("polls the event-scoped route with the terminal's heartbeat fields and its token", async () => {
    expect(screenStateUrl(config)).toBe("/e/evt%201/api/screen/state?name=Kitchen&spot=start-bar&view=auto&character=Trabolta");
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const out = await pollScreen(config, fakeFetch(200, body, seen));
    expect(out).toMatchObject({ kind: "state", state: { attract: true, character: { id: "Trabolta", hidden: true, awake: false } } });
    expect((seen[0]!.init!.headers as Record<string, string>)["x-loom-token"]).toBe("tok");
  });

  it("a refused token is revoked; anything else that fails is a miss", async () => {
    expect(await pollScreen(config, fakeFetch(403, {}))).toEqual({ kind: "revoked" });
    expect(await pollScreen(config, fakeFetch(401, {}))).toEqual({ kind: "revoked" });
    expect(await pollScreen(config, fakeFetch(404, {}))).toEqual({ kind: "miss" });
    // The event this terminal was set up for is over (a new one launched).
    expect(await pollScreen(config, fakeFetch(404, { error: "unknown event" }))).toEqual({ kind: "ended" });
    expect(await pollScreen(config, fakeFetch(200, { nope: 1 }))).toEqual({ kind: "miss" });
    const throwing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await pollScreen(config, throwing)).toEqual({ kind: "miss" });
  });

  it("the bar's dot goes dark when the server stops answering, though the last state is kept", () => {
    const state = parseScreenState(body);
    expect(screenReachable(null, 0)).toBe(false); // never answered
    let misses = missesAfter(0, "state");
    expect(screenReachable(state, misses)).toBe(true);
    misses = missesAfter(misses, "miss"); // one dropped poll is a blip
    expect(screenReachable(state, misses)).toBe(true);
    misses = missesAfter(misses, "miss");
    expect(misses).toBe(MISSES_OFFLINE);
    expect(screenReachable(state, misses)).toBe(false); // the server is gone
    expect(screenReachable(state, missesAfter(misses, "state"))).toBe(true); // and back
  });

  it("fails closed: no answer yet is attract", () => {
    expect(attractOf(null)).toBe(true);
    expect(attractOf(parseScreenState(body))).toBe(true);
    expect(attractOf(parseScreenState({ ...body, attract: false }))).toBe(false);
  });

  it("parses defensively", () => {
    expect(parseScreenState(null)).toBeNull();
    expect(parseScreenState({ attract: "yes" })).toBeNull();
    const s = parseScreenState({ attract: false, character: { id: "Clippy" }, remaining: Number.NaN })!;
    expect(s.character).toEqual({ id: "Clippy", hidden: false, awake: true, online: false, hold: false });
    expect(parseScreenState({ attract: false, character: { id: "Trabolta", online: false, hold: true } })!.character!.hold).toBe(true);
    expect(s.remaining).toBeNull();
    expect(s.night).toEqual({ screen: null, terminals: null });
  });
});

describe("the TV's voice block (K-18)", () => {
  const tv = defaultConfig({ eventId: "evt", token: "tok", name: "TV", spot: "desktop-tv", view: "tv" });

  it("the TV names its room and cursor in the poll", async () => {
    expect(screenStateUrl(tv, { room: "The Desktop", after: null })).toBe("/e/evt/api/screen/state?name=TV&spot=desktop-tv&view=tv&character=Trabolta&voice=The+Desktop");
    expect(screenStateUrl(tv, { room: "The Desktop", after: 41 })).toMatch(/&voice=The\+Desktop&after=41$/u);
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    await pollScreen(tv, fakeFetch(200, body, seen), { room: "The Desktop", after: 7 });
    expect(seen[0]!.url).toContain("after=7");
  });

  it("parses the voice block; malformed lines are dropped, no block is null", () => {
    const s = parseScreenState({
      ...body,
      voice: { room: "loc:The Desktop", muted: true, head: 9, lines: [{ seq: 9, from: "Trabolta", text: "Hi.", beat: null }, { seq: "x" }, { seq: 8, from: "Sandy", text: "…", beat: "Song Ending" }] },
    });
    expect(s?.voice).toEqual({
      room: "loc:The Desktop",
      muted: true,
      head: 9,
      lines: [
        { seq: 9, from: "Trabolta", text: "Hi.", beat: null },
        { seq: 8, from: "Sandy", text: "…", beat: "Song Ending" },
      ],
    });
    expect(parseScreenState(body)?.voice).toBeNull();
    expect(voiceOf({ lines: [] })).toBeNull();
  });
});
