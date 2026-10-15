import { describe, expect, it } from "vitest";
import { CONFIG_KEY, DEFAULT_TV_ROOM, defaultConfig, hintsFromSearch, loadConfig, saveConfig, tvRoomOf, voiceChoiceOf, withoutSecrets } from "../src/config.ts";

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
    expect(back).toMatchObject({ eventId: "evt", token: "t", name: "Kitchen", character: "Trabolta", engine: "browser", camera: "user", speed: 1, spot: "", view: "auto", announce: false });
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t" }));
    expect(loadConfig(s)).toMatchObject({ character: "Trabolta", spot: "", view: "auto" });
  });
  it("keeps a placed spot and view, and repairs junk ones", () => {
    const s = memory();
    saveConfig(defaultConfig({ eventId: "evt", token: "t", spot: "start-bar", view: "mirror" }), s);
    expect(loadConfig(s)).toMatchObject({ spot: "start-bar", view: "mirror" });
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
    const h = hintsFromSearch("?code=MOD111&name=Kitchen&character=Trabolta&camera=environment&engine=browser&spot=start-bar&view=world&keep=1");
    expect(h).toEqual({ code: "MOD111", name: "Kitchen", character: "Trabolta", camera: "environment", engine: "browser", spot: "start-bar", view: "world", room: null, announce: null });
    expect(withoutSecrets("?code=MOD111&name=Kitchen&spot=start-bar&view=mirror&keep=1")).toBe("?keep=1");
    expect(withoutSecrets("?code=MOD111")).toBe("");
    // The TV (K-18): view=tv + the room it speaks for.
    expect(hintsFromSearch("?code=M&name=TV&spot=desktop-tv&view=tv&room=The%20Desktop")).toMatchObject({ view: "tv", room: "The Desktop", spot: "desktop-tv" });
    expect(withoutSecrets("?view=tv&room=The%20Desktop&keep=1")).toBe("?keep=1");
    expect(hintsFromSearch("?camera=sideways&engine=loud&view=hologram&spot=%20")).toMatchObject({ camera: null, engine: null, code: "", view: null, spot: null });
  });
  it("the device's own voice is the default; the old `auto` reads as it, `server` stays an opt-in", () => {
    const s = memory();
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", engine: "auto" }));
    expect(loadConfig(s)?.engine).toBe("browser");
    for (const engine of ["server", "fully", "silent", "browser"] as const) {
      s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", engine }));
      expect(loadConfig(s)?.engine).toBe(engine);
    }
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", engine: "kokoro" }));
    expect(loadConfig(s)?.engine).toBe("browser");
    expect(voiceChoiceOf(undefined)).toBe("browser");
    expect(hintsFromSearch("?engine=auto").engine).toBe("browser");
    expect(hintsFromSearch("?engine=fully").engine).toBe("fully");
    expect(hintsFromSearch("?engine=server").engine).toBe("server");
    expect(hintsFromSearch("").engine).toBeNull();
  });
  it("announcements are off unless provisioned on (N-09)", () => {
    const s = memory();
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t" }));
    expect(loadConfig(s)?.announce).toBe(false);
    saveConfig(defaultConfig({ eventId: "evt", token: "t", announce: true }), s);
    expect(loadConfig(s)?.announce).toBe(true);
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", announce: "yes" }));
    expect(loadConfig(s)?.announce).toBe(false);
    expect(hintsFromSearch("?announce=1").announce).toBe(true);
    expect(hintsFromSearch("?announce=on").announce).toBe(true);
    expect(hintsFromSearch("?announce=0").announce).toBe(false);
    expect(hintsFromSearch("?announce=maybe").announce).toBeNull();
    expect(withoutSecrets("?announce=1&keep=1")).toBe("?keep=1");
  });
});
