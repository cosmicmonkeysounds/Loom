import { describe, expect, it } from "vitest";
import { deviceHealth, deviceQuery, watchBattery } from "../src/health.ts";
import { VOICE_OFF, voiceStatus } from "../src/voice/status.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("device health (SW-SCR-21)", () => {
  it("encodes only what is known, battery clamped and rounded", () => {
    expect(deviceQuery({ audio: true, visible: false, battery: 99.6, charging: false, version: "v1" })).toEqual({ ver: "v1", audio: "1", vis: "h", bat: "100" });
    expect(deviceQuery({ audio: null, visible: null, battery: -5, charging: true, version: "v1" })).toEqual({ ver: "v1", bat: "0c" });
    expect(deviceQuery({ audio: null, visible: null, battery: Number.NaN, charging: null, version: "v1" })).toEqual({ ver: "v1" });
  });

  it("says whether the screen is full screen (fs), only when it can know", () => {
    const h = { audio: null, visible: null, battery: null, charging: null, version: "v1" };
    expect(deviceQuery({ ...h, fullscreen: true })).toEqual({ ver: "v1", fs: "1" });
    expect(deviceQuery({ ...h, fullscreen: false })).toEqual({ ver: "v1", fs: "0" });
    expect(deviceQuery({ ...h, fullscreen: null })).toEqual({ ver: "v1" });
  });

  it("says the voice link's microphone (mic, wave 19), only when there is something to say", () => {
    const h = { audio: null, visible: null, battery: null, charging: null, version: "v1" };
    for (const mic of ["live", "muted", "denied", "insecure", "off"] as const) expect(deviceQuery({ ...h, mic })).toEqual({ ver: "v1", mic });
    expect(deviceQuery({ ...h, mic: null })).toEqual({ ver: "v1" });
    voiceStatus.set({ ...VOICE_OFF, report: "denied" });
    expect(deviceHealth().mic).toBe("denied");
    voiceStatus.set(VOICE_OFF);
    expect(deviceHealth().mic).toBe("off");
  });

  it("reads getBattery once and follows its events", async () => {
    const listeners: Record<string, () => void> = {};
    const b = { level: 0.42, charging: false, addEventListener: (t: string, f: () => void) => (listeners[t] = f) };
    const w = watchBattery({ getBattery: () => Promise.resolve(b) });
    expect(w.read()).toBeNull(); // not answered yet
    await flush();
    expect(w.read()).toEqual({ level: 42, charging: false });
    b.level = 0.4;
    b.charging = true;
    listeners["chargingchange"]!();
    expect(w.read()).toEqual({ level: 40, charging: true });
  });

  it("no API, a refusal or a throw is just no reading (the heartbeat never stops)", async () => {
    expect(watchBattery({}).read()).toBeNull();
    expect(watchBattery(null).read()).toBeNull();
    const refused = watchBattery({ getBattery: () => Promise.reject(new Error("no")) });
    const throws = watchBattery({
      getBattery: () => {
        throw new Error("Fully WebView");
      },
    });
    const noEvents = watchBattery({ getBattery: () => Promise.resolve({ level: 0.5, charging: false, addEventListener: () => { throw new Error("x"); } }) });
    await flush();
    expect(refused.read()).toBeNull();
    expect(throws.read()).toBeNull();
    expect(noEvents.read()).toEqual({ level: 50, charging: false });
  });

  it("deviceHealth never throws without a DOM and always names the build", () => {
    const h = deviceHealth();
    expect(h.version).not.toBe("");
    expect(h.visible).toBeNull();
    expect(h.audio).toBe(false);
  });
});
