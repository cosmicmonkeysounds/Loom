import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { ADAFRUIT_VID, doorSignalRequest, patchSignalRequest, pickPort, postDoorSignal, requestDoorPort, startDoorLink, type SerialLike, type SerialPortLike } from "../src/serial/door-serial.ts";
import { DOOR_SETTINGS_KEY } from "../src/serial/door-protocol.ts";
import { doorActions, doorHeartbeat, doorStatus, doorStatusText, patchStatusText } from "../src/serial/door-status.ts";

const config = defaultConfig({ eventId: "evt", token: "MODTOK", name: "Heart", door: "sim" });
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A fake window for the sim's keys + its 1 s line. */
function keyTarget() {
  let onKey: ((e: KeyboardEvent) => void) | null = null;
  return {
    target: {
      addEventListener: (_: string, fn: unknown) => void (onKey = fn as (e: KeyboardEvent) => void),
      removeEventListener: () => void (onKey = null),
      setInterval: () => 0,
      clearInterval: () => {},
    } as unknown as Pick<Window, "addEventListener" | "removeEventListener" | "setInterval" | "clearInterval">,
    press: (key: string, tagName = "BODY") => onKey?.({ key, code: "", target: { tagName }, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false } as unknown as KeyboardEvent),
    /** Shift + a digit (the sim's cables). */
    digit: (d: number, shift = true) => onKey?.({ key: shift ? "!@#$%^&*()"[(d + 9) % 10]! : String(d), code: `Digit${d}`, target: { tagName: "BODY" }, metaKey: false, ctrlKey: false, altKey: false, shiftKey: shift } as unknown as KeyboardEvent),
  };
}

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

afterEach(() => vi.useRealTimers());

describe("the door bridge's post", () => {
  it("is a mod signal with the x-loom-token header, the level and the terminal's label", () => {
    const { url, init } = doorSignalRequest(config, "door_sensor_opened", 35.4);
    expect(url).toBe("/e/evt/api/mod/signal");
    expect(init.headers).toEqual({ "content-type": "application/json", "x-loom-token": "MODTOK" });
    expect((init.headers as Record<string, string>)["authorization"]).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({ name: "door_sensor_opened", args: { level: 35 }, label: "Terminal · Heart" });
  });
  it("a combination is patch_changed with the pairs as `combo`, nothing else", () => {
    const { url, init } = patchSignalRequest(config, "V1-D2,V3-D1,V5-D4,V8-D6");
    expect(url).toBe("/e/evt/api/mod/signal");
    expect(init.headers).toEqual({ "content-type": "application/json", "x-loom-token": "MODTOK" });
    expect(JSON.parse(String(init.body))).toEqual({ name: "patch_changed", args: { combo: "V1-D2,V3-D1,V5-D4,V8-D6" }, label: "Terminal · Heart" });
    expect(() => patchSignalRequest(config, "V1-D2,DROP")).toThrow();
  });
  it("reads ok / refused / network", async () => {
    expect(await postDoorSignal(config, "door_sensor_closed", 1, async () => new Response("{}", { status: 200 }))).toBe("ok");
    expect(await postDoorSignal(config, "door_sensor_closed", 1, async () => new Response("{}", { status: 409 }))).toBe("refused");
    expect(await postDoorSignal(config, "door_sensor_closed", 1, async () => Promise.reject(new TypeError("offline")))).toBe("network");
  });
});

describe("the sim door (door=sim)", () => {
  it("O / C / F drive the bridge; keys in a field never do", async () => {
    const k = keyTarget();
    const posts: unknown[] = [];
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      posts.push(JSON.parse(String(init.body)).name);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const link = startDoorLink(config, { fetchFn, keys: k.target, store: memory() });
    link.screen({ server_door: "closed", door_override: false });
    expect(doorStatus()).toMatchObject({ configured: true, kind: "sim", connected: true });
    k.press("o");
    await tick();
    expect(posts).toEqual(["door_sensor_opened"]);
    k.press("c", "INPUT"); // typed into the composer
    await tick();
    expect(posts).toHaveLength(1);
    k.press("C");
    await tick();
    expect(posts).toEqual(["door_sensor_opened", "door_sensor_closed"]);
    k.press("f"); // a fault: nothing posted, red on the heartbeat
    await tick();
    expect(posts).toHaveLength(2);
    expect(doorHeartbeat()).toMatchObject({ door: "fault", dft: "ldr_saturated" });
    link.stop();
    expect(doorStatus().configured).toBe(false);
    expect(doorActions()).toBeNull();
  });

  it("calibration stores the thresholds the board answers and saves them", async () => {
    const k = keyTarget();
    const store = memory();
    const link = startDoorLink(config, { fetchFn: (async () => new Response("{}")) as unknown as typeof fetch, keys: k.target, store });
    const answer = await doorActions()!.calibrate("closed");
    expect(answer).toMatchObject({ t: "cal", which: "closed" });
    expect(JSON.parse(store.m.get(DOOR_SETTINGS_KEY)!)).toMatchObject({ close: 1800, open: 1200 });
    link.stop();
  });
});

describe("the sim patch bay (door=sim, Shift + digits)", () => {
  it("fakes cables, posts a new set of four once, and reports counts on the heartbeat", async () => {
    const k = keyTarget();
    const bodies: Array<{ name: string; args: Record<string, unknown> }> = [];
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const link = startDoorLink(config, { fetchFn, keys: k.target, store: memory() });
    link.screen({ server_door: "closed", door_override: false, patch_override: false });
    expect(doorStatus().bay).toBe(true);
    const plug = (v: number, d: number) => {
      k.digit(v);
      k.digit(d);
    };
    k.digit(3, false); // a bare digit is the heart's: no cable
    plug(1, 2);
    plug(3, 1);
    plug(5, 4);
    expect(doorHeartbeat()).toMatchObject({ pb: "3", pbc: "0", pbx: "0" });
    expect(patchStatusText(doorStatus())).toBe("simulated patch bay: 3 cables");
    plug(8, 6);
    await tick();
    const patches = bodies.filter((b) => b.name === "patch_changed");
    expect(patches).toEqual([{ name: "patch_changed", args: { combo: "V1-D2,V3-D1,V5-D4,V8-D6" }, label: "Terminal · Heart" }]);
    expect(doorHeartbeat()).toMatchObject({ pb: "4", pbc: "1" });
    expect(patchStatusText(doorStatus())).toBe("simulated patch bay: 4 cables · COMPLETE · 1 posted");
    // V5 moved from D4 to D7: a new set.
    plug(5, 7);
    await tick();
    expect(bodies.filter((b) => b.name === "patch_changed").map((b) => b.args["combo"])).toEqual(["V1-D2,V3-D1,V5-D4,V8-D6", "V1-D2,V3-D1,V5-D7,V8-D6"]);
    // The buttons have the bay: nothing posts.
    link.screen({ server_door: "closed", door_override: false, patch_override: true });
    plug(5, 4);
    await tick();
    expect(bodies.filter((b) => b.name === "patch_changed")).toHaveLength(2);
    k.digit(0); // every cable out
    expect(doorHeartbeat()).toMatchObject({ pb: "0" });
    link.stop();
  });

  it("learns, saves and resets through ⚙'s actions", async () => {
    const k = keyTarget();
    const link = startDoorLink(config, { fetchFn: (async () => new Response("{}")) as unknown as typeof fetch, keys: k.target, store: memory() });
    expect(await doorActions()!.bay({ c: "pb", op: "learn", source: 2 })).toEqual({ t: "err", error: "pb: need exactly one cable", cmd: "pb learn V2" });
    k.digit(2);
    k.digit(5);
    expect(await doorActions()!.bay({ c: "pb", op: "learn", source: 2 })).toMatchObject({ t: "pbcal", src: 2, raw: 921 });
    expect(await doorActions()!.bay({ c: "pb", op: "save" })).toMatchObject({ t: "pbcal", src: 0 });
    expect(doorStatus().pbcal).toMatchObject({ t: "pbcal", levels: [445, 921, 1338, 1848, 2247, 2757, 3174, 3650] });
    link.stop();
  });

  it("bay=0 reads the door alone: no posts, no bay keys", async () => {
    const k = keyTarget();
    const bodies: string[] = [];
    const fetchFn = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)).name);
      return new Response("{}");
    }) as unknown as typeof fetch;
    const link = startDoorLink({ ...config, bay: false }, { fetchFn, keys: k.target, store: memory() });
    link.screen({ server_door: "closed", door_override: false, patch_override: false });
    for (const [v, d] of [[1, 2], [3, 1], [5, 4], [8, 6]] as const) {
      k.digit(v);
      k.digit(d);
    }
    await tick();
    expect(bodies).toEqual([]);
    expect(doorStatus().bay).toBe(false);
    expect(Object.keys(doorHeartbeat())).toEqual(["door", "dlv"]);
    expect(await doorActions()!.bay({ c: "pb", op: "get" })).toMatchObject({ t: "err", error: "pb: no bay" });
    link.stop();
  });
});

/** A fake granted Grand Central: lines written to it are recorded; `say` feeds lines back. */
function fakeBoard() {
  let push: (s: string) => void = () => {};
  const written: string[] = [];
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      push = (s) => c.enqueue(new TextEncoder().encode(s));
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(new TextDecoder().decode(chunk));
    },
  });
  const port: SerialPortLike = { readable, writable, open: vi.fn(async () => {}), close: vi.fn(async () => {}), getInfo: () => ({ usbVendorId: ADAFRUIT_VID }) };
  const serial: SerialLike = { getPorts: async () => [port], requestPort: async () => port, addEventListener: () => {}, removeEventListener: () => {} };
  return { port, serial, written, say: (s: string) => push(s) };
}

describe("Web Serial (door=serial)", () => {
  it("bridges the bay a 1.2.0 board reports, posting its new sets of four", async () => {
    const b = fakeBoard();
    const bodies: Array<{ name: string; args: Record<string, unknown> }> = [];
    const fetchFn = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response("{}");
    }) as unknown as typeof fetch;
    const link = startDoorLink({ ...config, door: "serial" }, { serial: b.serial, store: memory(), fetchFn });
    for (let i = 0; i < 5; i++) await tick();
    const patch = (seq: number, pairs: string, src: number[], complete: boolean) =>
      `{"t":"patch","seq":${seq},"pairs":"${pairs}","count":${src.filter((k) => k > 0).length},"complete":${complete},"raw":[${src.map((k) => (k > 0 ? 400 * k : 0)).join(",")}],"src":[${src.join(",")}],"stable":true}\n`;
    // Lines before the hello: no bay known yet, nothing read.
    b.say(patch(1, "", [0, 0, 0, 0, 0, 0, 0], false));
    for (let i = 0; i < 5; i++) await tick();
    expect(doorStatus().patch).toBeNull();
    b.say('{"t":"hello","fw":"door-m4 1.2.0","mode":"steady","auto":false,"close":1800,"open":1200,"settle":150,"cal":false,"sense":false,"pbv":8,"pbd":7}\n');
    link.screen({ server_door: "closed", door_override: false, patch_override: false });
    b.say(patch(2, "", [0, 0, 0, 0, 0, 0, 0], false));
    b.say(patch(3, "V1-D2,V3-D1,V5-D4,V8-D6", [3, 1, 0, 5, 0, 8, 0], true));
    b.say(patch(4, "V1-D2,V3-D1,V5-D4,V8-D6", [3, 1, 0, 5, 0, 8, 0], true));
    for (let i = 0; i < 5; i++) await tick();
    expect(bodies.filter((x) => x.name === "patch_changed").map((x) => x.args)).toEqual([{ combo: "V1-D2,V3-D1,V5-D4,V8-D6" }]);
    expect(doorHeartbeat()).toMatchObject({ pb: "4", pbc: "1", pbx: "0" });
    // Unplugged: the bay is still known, so the heartbeat says so.
    link.stop();
    expect(doorHeartbeat()).toEqual({});
  });

  it("an older board (no pbd) has no bay: its heartbeat has door keys only", async () => {
    const b = fakeBoard();
    const link = startDoorLink({ ...config, door: "serial" }, { serial: b.serial, store: memory(), fetchFn: (async () => new Response("{}")) as unknown as typeof fetch });
    for (let i = 0; i < 5; i++) await tick();
    b.say('{"t":"hello","fw":"door-m4 1.1.0","mode":"steady","auto":false,"close":1800,"open":1200,"settle":150,"cal":false,"sense":false}\n');
    b.say('{"t":"door","seq":1,"open":false,"level":2410,"lit":2410,"dark":0,"fault":null,"warn":null}\n');
    for (let i = 0; i < 5; i++) await tick();
    expect(doorStatus().bay).toBe(false);
    expect(doorHeartbeat()).toEqual({ door: "closed", dlv: "2410" });
    expect(patchStatusText(doorStatus())).toBeNull();
    link.stop();
  });

  it("picks the Adafruit board among the granted ports", () => {
    const other: SerialPortLike = { readable: null, writable: null, open: async () => {}, close: async () => {}, getInfo: () => ({ usbVendorId: 0x1234 }) };
    const ada: SerialPortLike = { ...other, getInfo: () => ({ usbVendorId: ADAFRUIT_VID }) };
    expect(pickPort([other, ada])).toBe(ada);
    expect(pickPort([other])).toBe(other);
    expect(pickPort([])).toBeNull();
  });

  it("says when the browser has no Web Serial", async () => {
    expect(await requestDoorPort(null)).toMatch(/desktop Chrome on https/);
    const link = startDoorLink({ ...config, door: "serial" }, { serial: null, store: memory() });
    expect(doorStatus()).toMatchObject({ unsupported: true });
    expect(doorHeartbeat()).toEqual({ door: "fault", dft: "no_port" });
    link.stop();
  });

  it("reopens a granted port at 115200, asks get, re-sends the stored thresholds and posts its edges", async () => {
    const b = fakeBoard();
    const store = memory();
    store.setItem(DOOR_SETTINGS_KEY, JSON.stringify({ close: 1900, open: 1300 }));
    const posts: string[] = [];
    const fetchFn = (async (_u: string, init: RequestInit) => {
      posts.push(JSON.parse(String(init.body)).name);
      return new Response("{}");
    }) as unknown as typeof fetch;
    const link = startDoorLink({ ...config, door: "serial" }, { serial: b.serial, store, fetchFn });
    for (let i = 0; i < 5; i++) await tick();
    expect(b.port.open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(doorStatus().connected).toBe(true);
    b.say('{"t":"cfg","fw":"door-m4 1.1.0","mode":"mod","auto":false,"close":1800,"open":1200,"settle":150,"cal":true,"sense":false,"saved":true}\n');
    for (let i = 0; i < 5; i++) await tick();
    expect(b.written.join("")).toBe("get\nset close 1900\nset open 1300\n");
    link.screen({ server_door: "closed", door_override: false });
    b.say('{"t":"door","seq":1,"open":false,"level":2410,"lit":3020,"dark":610,"fault":null,"warn":null}\n{"t":"door","seq":2,"open":true,"level":35,');
    b.say('"lit":640,"dark":605,"fault":null,"warn":null}\n');
    for (let i = 0; i < 5; i++) await tick();
    expect(posts).toEqual(["door_sensor_opened"]);
    expect(doorHeartbeat()).toEqual({ door: "open", dlv: "35" });
    link.stop();
  });

  it("after the LED moves to D2 (a pulsed build), a steady calibration is not re-sent: ⚙ asks for a new one", async () => {
    const b = fakeBoard();
    const store = memory();
    store.setItem(DOOR_SETTINGS_KEY, JSON.stringify({ close: 3600, open: 2900, mode: "steady", settle: 150 }));
    const link = startDoorLink({ ...config, door: "serial" }, { serial: b.serial, store, fetchFn: (async () => new Response("{}")) as unknown as typeof fetch });
    for (let i = 0; i < 5; i++) await tick();
    b.say('{"t":"hello","fw":"door-m4 1.1.0","mode":"mod","auto":false,"close":1800,"open":1200,"settle":150,"cal":false,"sense":true}\n');
    b.say('{"t":"door","seq":1,"open":false,"level":2410,"lit":3020,"dark":610,"fault":null,"warn":null}\n');
    for (let i = 0; i < 5; i++) await tick();
    expect(b.written.join("")).toBe("get\n"); // no set mode, no thresholds
    expect(doorStatus().recal).toBe(true);
    expect(doorStatusText(doorStatus())).toBe("door sensor: SHUT · level 2410 · pulsed · ⚠ calibrate again: the sensor's wiring changed");
    // A calibration on the new wiring stores its mode and clears the ask.
    b.say('{"t":"cal","which":"open","ref":120,"close":2100,"open":900}\n');
    for (let i = 0; i < 5; i++) await tick();
    expect(doorStatus().recal).toBe(false);
    expect(JSON.parse(store.m.get(DOOR_SETTINGS_KEY)!)).toEqual({ close: 2100, open: 900, mode: "mod", settle: 150 });
    link.stop();
  });

  it("a calibration on an auto board stores the mode it probed, so the steady build that replaces it keeps it", async () => {
    const b = fakeBoard();
    const store = memory();
    const link = startDoorLink({ ...config, door: "serial" }, { serial: b.serial, store, fetchFn: (async () => new Response("{}")) as unknown as typeof fetch });
    for (let i = 0; i < 5; i++) await tick();
    b.say('{"t":"hello","fw":"door-m4 1.0.0","mode":"steady","auto":true,"close":1800,"open":1200,"settle":150,"cal":false,"sense":false}\n');
    for (let i = 0; i < 5; i++) await tick();
    b.say('{"t":"cal","which":"open","ref":2900,"close":3600,"open":3100}\n');
    for (let i = 0; i < 5; i++) await tick();
    expect(JSON.parse(store.m.get(DOOR_SETTINGS_KEY)!)).toEqual({ close: 3600, open: 3100, mode: "steady", settle: 150 });
    link.stop();
    // Reflashed 1.1.0 (LED_STEADY, flash wiped): the stored thresholds go back on.
    const b2 = fakeBoard();
    const link2 = startDoorLink({ ...config, door: "serial" }, { serial: b2.serial, store, fetchFn: (async () => new Response("{}")) as unknown as typeof fetch });
    for (let i = 0; i < 5; i++) await tick();
    b2.say('{"t":"hello","fw":"door-m4 1.1.0","mode":"steady","auto":false,"close":1800,"open":1200,"settle":150,"cal":false,"sense":false}\n');
    for (let i = 0; i < 5; i++) await tick();
    expect(doorStatus().recal).toBe(false);
    expect(b2.written.join("")).toBe("get\nset close 3600\nset open 3100\n");
    link2.stop();
  });
});
