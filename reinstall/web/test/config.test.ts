import { afterEach, describe, expect, it, vi } from "vitest";
import { applyHints, baseOf, CONFIG_KEY, defaultConfig, dropConfig, hintsFromSearch, loadConfig, provision, saveConfig, withoutSecrets } from "../src/config.ts";

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe("URL hints", () => {
  it("reads a provisioning link", () => {
    expect(hintsFromSearch("?code=ab12&name=Tent%20tablet&role=player&camera=environment&arrows=strafe")).toEqual({
      code: "ab12",
      name: "Tent tablet",
      role: "player",
      camera: "environment",
      arrowsTurn: false,
      voice: null,
    });
  });

  it("reads the voice link switch (voice=1 / voice=0)", () => {
    expect(hintsFromSearch("?voice=1").voice).toBe(true);
    expect(hintsFromSearch("?voice=0").voice).toBe(false);
    expect(hintsFromSearch("?voice=yes").voice).toBeNull();
  });

  it("ignores junk and blanks", () => {
    expect(hintsFromSearch("?name=%20&role=admin&camera=side&arrows=x")).toEqual({ code: "", name: null, role: null, camera: null, arrowsTurn: null, voice: null });
  });

  it("withoutSecrets scrubs the passcode and the hints but keeps the rest", () => {
    expect(withoutSecrets("?code=ab12&name=Tent&role=both&debug=1")).toBe("?debug=1");
    expect(withoutSecrets("?code=ab12&camera=user&arrows=turn")).toBe("");
    expect(withoutSecrets("?voice=1&debug=1")).toBe("?debug=1");
    expect(withoutSecrets("")).toBe("");
  });

  it("applyHints renames / re-roles a configured device", () => {
    const c = defaultConfig({ eventId: "e1", token: "t" });
    expect(applyHints(c, { name: "Spare laptop", role: null, camera: null, arrowsTurn: false, voice: null })).toMatchObject({ name: "Spare laptop", role: "both", arrowsTurn: false, voice: false });
    expect(applyHints(c, { name: null, role: null, camera: null, arrowsTurn: null, voice: true }).voice).toBe(true);
  });

  it("the voice link is off by default (the tent laptop is the tent's own terminal)", () => {
    expect(defaultConfig({ eventId: "e1", token: "t" }).voice).toBe(false);
  });
});

describe("stored config", () => {
  it("round-trips, and is forgotten", () => {
    const s = new MemoryStorage();
    const c = defaultConfig({ eventId: "e1", token: "t", name: "Tent tablet", role: "station", voice: true });
    saveConfig(c, s);
    expect(loadConfig(s)).toEqual(c);
    dropConfig(s);
    expect(loadConfig(s)).toBeNull();
  });

  it("refuses a config without an event or a token, or that isn't JSON", () => {
    const s = new MemoryStorage();
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "e1" }));
    expect(loadConfig(s)).toBeNull();
    s.setItem(CONFIG_KEY, "{nope");
    expect(loadConfig(s)).toBeNull();
    expect(loadConfig(null)).toBeNull();
  });

  it("repairs bad fields with the defaults", () => {
    const s = new MemoryStorage();
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "e1", token: "t", role: "admin", name: "  ", camera: 3, arrowsTurn: "yes", voice: "on" }));
    expect(loadConfig(s)).toEqual(defaultConfig({ eventId: "e1", token: "t" }));
  });

  it("the API base is event-scoped", () => {
    expect(baseOf({ eventId: "ev 1" })).toBe("/e/ev%201");
  });
});

describe("provision", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (routes: Record<string, { status: number; body: unknown }>) => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const r = routes[url] ?? { status: 404, body: { error: "nope" } };
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    return calls;
  };

  it("trades a moderator passcode for a token and keeps the hints", async () => {
    const calls = respond({
      "/api/resolve-code": { status: 200, body: { eventId: "e1", role: "mod", title: "Trapped" } },
      "/e/e1/api/mod/login": { status: 200, body: { token: "mod-token" } },
    });
    const c = await provision("ab12", { name: "Tent tablet", role: null, camera: "environment", arrowsTurn: null, voice: null });
    expect(c).toEqual(defaultConfig({ eventId: "e1", token: "mod-token", title: "Trapped", name: "Tent tablet", camera: "environment" }));
    expect(calls.map((x) => x.url)).toEqual(["/api/resolve-code", "/e/e1/api/mod/login"]);
    expect(calls[1]!.body).toEqual({ passcode: "ab12" });
  });

  it("refuses a guest or performer code, and an unknown one", async () => {
    respond({ "/api/resolve-code": { status: 200, body: { eventId: "e1", role: "prime" } } });
    await expect(provision("p", { name: null, role: null, camera: null, arrowsTurn: null, voice: null })).rejects.toThrow(/performer code/);
    respond({});
    await expect(provision("x", { name: null, role: null, camera: null, arrowsTurn: null, voice: null })).rejects.toThrow(/No event answers/);
  });
});
