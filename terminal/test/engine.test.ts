import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENGINE_LABEL,
  ServerEngine,
  SpeechQueue,
  VoiceFloor,
  fullyOf,
  pickDeviceEngine,
  readingMs,
  syntheticLevel,
  voiceNote,
  type DeviceEnv,
  type Prepared,
  type SpeechEngine,
} from "../src/speech/engine.ts";

const env = (o: Partial<DeviceEnv> = {}): DeviceEnv => ({ speech: true, voices: 12, speechDead: false, fully: false, ...o });

describe("the native ladder", () => {
  it("speechSynthesis with voices → Fully Kiosk → text only", () => {
    expect(pickDeviceEngine(env())).toBe("browser");
    expect(pickDeviceEngine(env({ voices: 0, fully: true }))).toBe("fully"); // a WebView with a speechSynthesis stub
    expect(pickDeviceEngine(env({ speech: false, voices: 0, fully: true }))).toBe("fully"); // no speechSynthesis at all (K-02)
    expect(pickDeviceEngine(env({ speechDead: true, fully: true }))).toBe("fully"); // speak() never started
    expect(pickDeviceEngine(env({ speech: false, voices: 0 }))).toBe("silent");
    expect(pickDeviceEngine(env({ voices: 0 }))).toBe("silent");
    expect(pickDeviceEngine(env({ speechDead: true }))).toBe("silent");
  });
  it("honours a Fully-first or text-only choice while it can", () => {
    expect(pickDeviceEngine(env({ fully: true }), "fully")).toBe("fully");
    expect(pickDeviceEngine(env({ fully: false }), "fully")).toBe("browser"); // not in Fully: back to the ladder
    expect(pickDeviceEngine(env({ fully: true }), "silent")).toBe("silent");
  });
  it("finds Fully's JavaScript Interface only when textToSpeech is there", () => {
    expect(fullyOf({})).toBeNull();
    expect(fullyOf(undefined)).toBeNull();
    expect(fullyOf({ fully: {} })).toBeNull();
    expect(fullyOf({ fully: { textToSpeech: "no" } })).toBeNull();
    const fully = { textToSpeech: () => {} };
    expect(fullyOf({ fully })).toBe(fully);
  });
});

describe("the synthesised mouth", () => {
  it("opens and closes like speech, within 0..0.3", () => {
    const levels = Array.from({ length: 400 }, (_, i) => syntheticLevel(i / 100));
    expect(Math.min(...levels)).toBe(0);
    expect(Math.max(...levels)).toBeLessThanOrEqual(0.3);
    expect(Math.max(...levels)).toBeGreaterThan(0.2);
    // Gaps between "words": a good share of frames is closed.
    const closed = levels.filter((l) => l === 0).length / levels.length;
    expect(closed).toBeGreaterThan(0.1);
    expect(closed).toBeLessThan(0.5);
  });
  it("paces a chunk by its length and speed, with a floor and a cap", () => {
    expect(readingMs("Hi.")).toBe(900);
    expect(readingMs("x".repeat(50))).toBe(3100);
    expect(readingMs("x".repeat(50), 2)).toBe(1550);
    expect(readingMs("x".repeat(1000))).toBe(8000);
  });
});

describe("the status note", () => {
  it("says why this isn't the voice that was asked for", () => {
    expect(voiceNote("browser", "browser", false)).toBeNull();
    expect(voiceNote("browser", "fully", false)).toBeNull();
    expect(voiceNote("browser", null, false)).toBeNull();
    expect(voiceNote("browser", "silent", false)).toMatch(/text only/);
    expect(voiceNote("silent", "silent", false)).toBeNull();
    expect(voiceNote("server", "server", false)).toBeNull();
    expect(voiceNote("server", "browser", true)).toMatch(/no server voice/);
    expect(voiceNote("server", "browser", false)).toMatch(/missed/);
    expect(Object.keys(ENGINE_LABEL).sort()).toEqual(["browser", "fully", "server", "silent"]);
  });
});

// --- the floor + the queue ------------------------------------------------------

/** A fake engine whose `play` waits for the test to say the chunk is over. */
function fakeEngine(kind: "browser" | "server", log: string[], o: { prepare?: (t: string) => Prepared | null } = {}) {
  const pending: Array<() => void> = [];
  const engine: SpeechEngine = {
    kind,
    prepare: async (text) => (o.prepare ? o.prepare(text) : { kind: "browser", text }),
    play: (p) =>
      new Promise<void>((resolve) => {
        log.push(`${kind}:${p.kind === "server" ? "audio" : p.text}`);
        pending.push(resolve);
      }),
    stop: () => {
      for (const r of pending.splice(0)) r();
    },
  };
  return { engine, finish: () => pending.shift()?.() };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const quiet = { level: () => {}, chunk: () => {}, done: () => {}, idle: () => {} };

describe("VoiceFloor", () => {
  it("hands the floor out first come, first served", async () => {
    const floor = new VoiceFloor();
    const order: string[] = [];
    const a = await floor.acquire();
    const b = floor.acquire().then((release) => (order.push("b"), release));
    const c = floor.acquire().then((release) => (order.push("c"), release));
    expect(floor.busy).toBe(true);
    await flush();
    expect(order).toEqual([]);
    a();
    a(); // releasing twice is harmless
    (await b)();
    (await c)();
    expect(order).toEqual(["b", "c"]);
    expect(floor.busy).toBe(false);
  });
});

describe("SpeechQueue", () => {
  it("an announcement waits for the end of the line being said, never cuts it mid-sentence", async () => {
    const floor = new VoiceFloor();
    const log: string[] = [];
    const character = fakeEngine("browser", log);
    const house = fakeEngine("browser", log);
    const q1 = new SpeechQueue({ primary: character.engine, fallback: null }, quiet, floor);
    const q2 = new SpeechQueue({ primary: house.engine, fallback: null }, quiet, floor);
    q1.say({ id: 1, chunks: ["I have been expecting you.", "Sit down."] });
    await flush();
    let chimed = false;
    q2.say({ id: 9, chunks: ["Go to the living room."], before: async () => void (chimed = true) });
    q1.say({ id: 2, chunks: ["Where was I?"] });
    await flush();
    expect(log).toEqual(["browser:I have been expecting you."]);
    character.finish(); // sentence 1 done — the announcement still waits
    await flush();
    expect(log).toEqual(["browser:I have been expecting you.", "browser:Sit down."]);
    expect(chimed).toBe(false);
    character.finish(); // the line is over: the chime, then the announcement
    await flush();
    expect(chimed).toBe(true);
    expect(log.at(-1)).toBe("browser:Go to the living room.");
    house.finish(); // and only then the character's next line
    await flush();
    expect(log.at(-1)).toBe("browser:Where was I?");
    character.finish();
    await flush();
    expect(q1.busy || q2.busy).toBe(false);
  });

  it("a say() right after a stop() is still spoken", async () => {
    const floor = new VoiceFloor();
    const log: string[] = [];
    const e = fakeEngine("browser", log);
    const q = new SpeechQueue({ primary: e.engine, fallback: null }, quiet, floor);
    q.say({ id: 1, chunks: ["One."] });
    await flush();
    q.stop();
    q.say({ id: 2, chunks: ["Two."] });
    await flush();
    expect(log).toEqual(["browser:One.", "browser:Two."]);
    e.finish();
    await flush();
    expect(q.busy).toBe(false);
  });

  it("reports the engine that spoke each chunk", async () => {
    const log: string[] = [];
    const server = fakeEngine("server", log, { prepare: () => null }); // the server can't say it
    const device = fakeEngine("browser", log);
    const used: string[] = [];
    const q = new SpeechQueue({ primary: server.engine, fallback: device.engine }, { ...quiet, engine: (k) => used.push(k) }, new VoiceFloor());
    q.say({ id: 1, chunks: ["Hello."] });
    await flush();
    expect(used).toEqual(["browser"]);
    device.finish();
  });
});

describe("ServerEngine — the opt-in server voice", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a 503 latches it off: no more asking, every chunk goes to the device voice", async () => {
    vi.stubGlobal("window", { AudioContext: class { state = "running"; async decodeAudioData() { return {}; } } });
    const fetchFn = vi.fn(async () => new Response("no server voice", { status: 503 }));
    let latches = 0;
    const server = new ServerEngine({ base: "/e/evt", token: "t", voice: "", speed: 1, fetchFn: fetchFn as unknown as typeof fetch }, () => latches++);
    expect(await server.prepare("One.")).toBeNull();
    expect(server.latched).toBe(true);
    expect(await server.prepare("Two.")).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(latches).toBe(1);
  });

  it("a 500 (one bad line) is a miss, not a latch; a good answer is audio", async () => {
    vi.stubGlobal("window", { AudioContext: class { state = "running"; async decodeAudioData() { return { duration: 1 }; } } });
    const answers = [new Response("boom", { status: 500 }), new Response(new Uint8Array([1, 2, 3]), { status: 200 })];
    const fetchFn = vi.fn(async () => answers.shift()!);
    const server = new ServerEngine({ base: "/e/evt", token: "t", voice: "am_michael", speed: 1, fetchFn: fetchFn as unknown as typeof fetch });
    expect(await server.prepare("One.")).toBeNull();
    expect(server.latched).toBe(false);
    expect((await server.prepare("Two."))?.kind).toBe("server");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
