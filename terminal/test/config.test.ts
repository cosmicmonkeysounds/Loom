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
    expect(back).toMatchObject({ eventId: "evt", token: "t", name: "Kitchen", character: "Trabolta", engine: "auto", camera: "user", speed: 1, spot: "", view: "auto" });
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t" }));
    expect(loadConfig(s)).toMatchObject({ character: "Trabolta", spot: "", view: "auto" });
  });
  it("keeps a placed spot and view, and repairs junk ones", () => {
    const s = memory();
    saveConfig(defaultConfig({ eventId: "evt", token: "t", spot: "kitchen", view: "mirror" }), s);
    expect(loadConfig(s)).toMatchObject({ spot: "kitchen", view: "mirror" });
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", spot: 7, view: "hologram" }));
    expect(loadConfig(s)).toMatchObject({ spot: "", view: "auto" });
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
    const h = hintsFromSearch("?code=MOD111&name=Kitchen&character=Trabolta&camera=environment&engine=browser&spot=kitchen&view=world&keep=1");
    expect(h).toEqual({ code: "MOD111", name: "Kitchen", character: "Trabolta", camera: "environment", engine: "browser", spot: "kitchen", view: "world" });
    expect(withoutSecrets("?code=MOD111&name=Kitchen&spot=kitchen&view=mirror&keep=1")).toBe("?keep=1");
    expect(withoutSecrets("?code=MOD111")).toBe("");
    expect(hintsFromSearch("?camera=sideways&engine=loud&view=hologram&spot=%20")).toMatchObject({ camera: null, engine: null, code: "", view: null, spot: null });
  });
});
