import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { attractOf, parseScreenState, pollScreen, screenStateUrl } from "../src/screen.ts";

const config = defaultConfig({ eventId: "evt 1", token: "tok", name: "Kitchen", spot: "kitchen", view: "auto" });

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
    expect(screenStateUrl(config)).toBe("/e/evt%201/api/screen/state?name=Kitchen&spot=kitchen&view=auto&character=Trabolta");
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const out = await pollScreen(config, fakeFetch(200, body, seen));
    expect(out).toMatchObject({ kind: "state", state: { attract: true, character: { id: "Trabolta", hidden: true, awake: false } } });
    expect((seen[0]!.init!.headers as Record<string, string>)["x-loom-token"]).toBe("tok");
  });

  it("a refused token is revoked; anything else that fails is a miss", async () => {
    expect(await pollScreen(config, fakeFetch(403, {}))).toEqual({ kind: "revoked" });
    expect(await pollScreen(config, fakeFetch(401, {}))).toEqual({ kind: "revoked" });
    expect(await pollScreen(config, fakeFetch(404, {}))).toEqual({ kind: "miss" });
    expect(await pollScreen(config, fakeFetch(200, { nope: 1 }))).toEqual({ kind: "miss" });
    const throwing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await pollScreen(config, throwing)).toEqual({ kind: "miss" });
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
    expect(s.character).toEqual({ id: "Clippy", hidden: false, awake: true, online: false });
    expect(s.remaining).toBeNull();
    expect(s.night).toEqual({ screen: null, terminals: null });
  });
});
