import { describe, expect, it } from "vitest";
import { CONFIG_KEY, DEFAULT_TV_ROOM, defaultConfig, hintsFromSearch, loadConfig, saveConfig, tvRoomOf, withoutSecrets } from "../src/config.ts";

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
  it("keeps the TV's view and room; a blank room is the Desktop", () => {
    const s = memory();
    saveConfig(defaultConfig({ eventId: "evt", token: "t", view: "tv", room: "The Kitchen" }), s);
    expect(loadConfig(s)).toMatchObject({ view: "tv", room: "The Kitchen" });
    expect(tvRoomOf(loadConfig(s)!)).toBe("The Kitchen");
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", view: "tv", room: 3 }));
    expect(tvRoomOf(loadConfig(s)!)).toBe(DEFAULT_TV_ROOM);
    expect(DEFAULT_TV_ROOM).toBe("The Desktop");
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
    expect(h).toEqual({ code: "MOD111", name: "Kitchen", character: "Trabolta", camera: "environment", engine: "browser", spot: "kitchen", view: "world", room: null });
    expect(withoutSecrets("?code=MOD111&name=Kitchen&spot=kitchen&view=mirror&keep=1")).toBe("?keep=1");
    expect(withoutSecrets("?code=MOD111")).toBe("");
    // The TV (K-18): view=tv + the room it speaks for.
    expect(hintsFromSearch("?code=M&name=TV&spot=desktop-tv&view=tv&room=The%20Desktop")).toMatchObject({ view: "tv", room: "The Desktop", spot: "desktop-tv" });
    expect(withoutSecrets("?view=tv&room=The%20Desktop&keep=1")).toBe("?keep=1");
    expect(hintsFromSearch("?camera=sideways&engine=loud&view=hologram&spot=%20")).toMatchObject({ camera: null, engine: null, code: "", view: null, spot: null });
  });
});
