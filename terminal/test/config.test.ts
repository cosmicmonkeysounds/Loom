import { describe, expect, it } from "vitest";
import { CONFIG_KEY, defaultConfig, hintsFromSearch, loadConfig, saveConfig, withoutSecrets } from "../src/config.ts";

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
}

describe("terminal config", () => {
  it("round-trips, filling defaults for older stored shapes", () => {
    const s = memory();
    saveConfig(defaultConfig({ eventId: "evt", token: "t", name: "Kitchen" }), s);
    const back = loadConfig(s);
    expect(back).toMatchObject({ eventId: "evt", token: "t", name: "Kitchen", character: "Trabolta", engine: "auto", camera: "user", speed: 1 });
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t" }));
    expect(loadConfig(s)?.character).toBe("Trabolta");
  });
  it("refuses a config with no event or token, or junk", () => {
    const s = memory();
    expect(loadConfig(s)).toBeNull();
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt" }));
    expect(loadConfig(s)).toBeNull();
    s.setItem(CONFIG_KEY, "{not json");
    expect(loadConfig(s)).toBeNull();
  });
  it("reads provisioning hints off the URL and scrubs them back out", () => {
    const h = hintsFromSearch("?code=MOD111&name=Kitchen&character=Trabolta&camera=environment&engine=browser&keep=1");
    expect(h).toEqual({ code: "MOD111", name: "Kitchen", character: "Trabolta", camera: "environment", engine: "browser" });
    expect(withoutSecrets("?code=MOD111&name=Kitchen&keep=1")).toBe("?keep=1");
    expect(withoutSecrets("?code=MOD111")).toBe("");
    expect(hintsFromSearch("?camera=sideways&engine=loud")).toMatchObject({ camera: null, engine: null, code: "" });
  });
});
