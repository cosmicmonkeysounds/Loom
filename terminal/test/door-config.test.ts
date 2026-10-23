import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG_KEY, defaultConfig, hintsFromSearch, loadConfig, provision, saveConfig, withoutSecrets } from "../src/config.ts";
import { deviceQuery } from "../src/health.ts";
import { screenStateUrl } from "../src/screen.ts";
import { DOOR_OFF, doorHeartbeat, doorStatusText } from "../src/serial/door-status.ts";

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 };
}

afterEach(() => vi.unstubAllGlobals());

describe("the door sensor + keyboard config (wave 20)", () => {
  it("defaults to no sensor and a keyboard; round-trips both", () => {
    const s = memory();
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "e", token: "t" })); // an older stored shape
    expect(loadConfig(s)).toMatchObject({ door: "off", keys: true });
    saveConfig(defaultConfig({ eventId: "e", token: "t", door: "serial", keys: false }), s);
    expect(loadConfig(s)).toMatchObject({ door: "serial", keys: false });
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "e", token: "t", door: "usb", keys: "no" }));
    expect(loadConfig(s)).toMatchObject({ door: "off", keys: true });
  });

  it("reads door= and keys= off the URL and scrubs them", () => {
    expect(hintsFromSearch("?code=X&door=serial&keys=0")).toMatchObject({ door: "serial", keys: false });
    expect(hintsFromSearch("?code=X&door=sim&keys=1")).toMatchObject({ door: "sim", keys: true });
    expect(hintsFromSearch("?code=X&door=bogus")).toMatchObject({ door: null, keys: null });
    expect(withoutSecrets("?code=X&door=serial&keys=0&debug=1")).toBe("?debug=1");
  });

  it("provisions them from the link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.endsWith("/api/resolve-code") ? { eventId: "evt", role: "mod", title: "T", characters: [] } : { token: "tok" };
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    expect(await provision("MOD", hintsFromSearch("?code=MOD&spot=server-room&door=serial&keys=0"))).toMatchObject({ door: "serial", keys: false });
    expect(await provision("MOD", hintsFromSearch("?code=MOD"))).toMatchObject({ door: "off", keys: true });
  });

  it("the heartbeat carries the door keys only when a sensor is configured", () => {
    const h = { audio: null, visible: null, battery: null, charging: null, version: "v1" };
    expect(deviceQuery({ ...h, door: {} })).toEqual({ ver: "v1" });
    expect(deviceQuery({ ...h, door: { door: "closed", dlv: "2410", dwn: "ldr_open" } })).toEqual({ ver: "v1", door: "closed", dlv: "2410", dwn: "ldr_open" });
    const c = defaultConfig({ eventId: "e", token: "t", name: "Heart", spot: "server-room", view: "face" });
    expect(screenStateUrl(c, null, { ...h, door: { door: "fault", dft: "no_port" } })).toBe("/e/e/api/screen/state?name=Heart&spot=server-room&view=face&character=Trabolta&ver=v1&door=fault&dft=no_port");
    expect(doorHeartbeat(0, DOOR_OFF)).toEqual({});
    expect(doorHeartbeat(0, { ...DOOR_OFF, configured: true, kind: "serial" })).toEqual({ door: "fault", dft: "no_port" });
    expect(doorHeartbeat(100, { ...DOOR_OFF, configured: true, kind: "sim", connected: true, sensor: { open: true, level: 0, fault: null, warn: null, at: 50 } })).toEqual({ door: "open", dlv: "0" });
  });

  it("⚙'s line says what the sensor is doing", () => {
    expect(doorStatusText(DOOR_OFF)).toMatch(/no door sensor/);
    expect(doorStatusText({ ...DOOR_OFF, configured: true, kind: "serial", unsupported: true })).toMatch(/desktop Chrome on https/);
    expect(doorStatusText({ ...DOOR_OFF, configured: true, kind: "serial" })).toMatch(/Connect door sensor/);
    const on = { ...DOOR_OFF, configured: true, kind: "serial" as const, connected: true };
    expect(doorStatusText({ ...on, sensor: { open: false, level: 2410, fault: null, warn: null, at: 0 } }, 10)).toBe("door sensor: SHUT · level 2410");
    expect(doorStatusText({ ...on, sensor: { open: true, level: 0, fault: "ldr_saturated", warn: null, at: 0 } }, 10)).toMatch(/FAULT \(ldr_saturated\)/);
    // Once the board has said what it runs, the LED's wiring follows (`mod` is the pulsed LED).
    const board = { fw: "door-m4 1.1.0", mode: "steady" as const, auto: false, close: 1800, open: 1200, settle: 150, cal: false, sense: false };
    const shut = { open: false, level: 3900, fault: null, warn: null, at: 0 };
    expect(doorStatusText({ ...on, board, sensor: shut }, 10)).toBe("door sensor: SHUT · level 3900 · steady");
    expect(doorStatusText({ ...on, board: { ...board, mode: "mod", auto: true }, sensor: shut }, 10)).toBe("door sensor: SHUT · level 3900 · pulsed (auto)");
  });
});
