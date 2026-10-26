import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANNOUNCE_GAPS,
  BrowserEngine,
  CHUNK_GAP_MS,
  DEFAULT_GAPS,
  DeviceEngine,
  ENGINE_LABEL,
  START_TIMEOUT_MS,
  LINE_GAP_MS,
  ServerEngine,
  SpeechQueue,
  VoiceFloor,
  fullyOf,
  gapsFor,
  pauseOf,
  pickDeviceEngine,
  readingMs,
  syntheticLevel,
  unlock,
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
/** No pauses: the floor tests step chunk by chunk with no clock. */
const NO_GAPS = { chunk: 0, line: 0 };

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
    const q1 = new SpeechQueue({ primary: character.engine, fallback: null }, quiet, floor, NO_GAPS);
    const q2 = new SpeechQueue({ primary: house.engine, fallback: null }, quiet, floor, NO_GAPS);
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

describe("SpeechQueue pacing (wave 26, V2)", () => {
  afterEach(() => vi.useRealTimers());

  it("0.3 s between sentences, 0.7 s between lines, adjustable per screen", () => {
    expect(DEFAULT_GAPS).toEqual({ chunk: CHUNK_GAP_MS, line: LINE_GAP_MS });
    expect([CHUNK_GAP_MS, LINE_GAP_MS]).toEqual([300, 700]);
    expect(gapsFor({ pause: 1 })).toEqual({ chunk: 300, line: 700 });
    expect(gapsFor({ pause: 2 })).toEqual({ chunk: 600, line: 1400 });
    expect(gapsFor({ pause: 0 })).toEqual({ chunk: 0, line: 0 });
    expect(gapsFor({})).toEqual(DEFAULT_GAPS);
    expect(gapsFor(null)).toEqual(DEFAULT_GAPS);
    expect(gapsFor({ pause: 9 })).toEqual({ chunk: 900, line: 2100 }); // capped at 3
    expect(pauseOf(Number.NaN)).toBe(1);
    expect(pauseOf(-1)).toBe(0);
    expect(pauseOf("2")).toBe(1);
    expect(ANNOUNCE_GAPS).toEqual({ chunk: 250, line: 0 });
  });

  it("pauses between chunks and before the next line, never after the last, holding the floor", async () => {
    vi.useFakeTimers();
    const floor = new VoiceFloor();
    const log: string[] = [];
    const e = fakeEngine("browser", log);
    const events: string[] = [];
    const q = new SpeechQueue({ primary: e.engine, fallback: null }, { ...quiet, chunk: (id, i) => events.push(`chunk ${id}.${i}`), done: (id) => events.push(`done ${id}`), idle: () => events.push("idle") }, floor);
    q.say({ id: 1, chunks: ["One.", "Two."] });
    q.say({ id: 2, chunks: ["Three."] });
    await flush();
    expect(log).toEqual(["browser:One."]);
    e.finish();
    await flush();
    expect(log).toEqual(["browser:One."]); // the sentence pause
    expect(floor.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(CHUNK_GAP_MS - 1);
    expect(log).toEqual(["browser:One."]);
    await vi.advanceTimersByTimeAsync(1);
    expect(log).toEqual(["browser:One.", "browser:Two."]);
    e.finish();
    await flush();
    expect(events).toEqual(["chunk 1.0", "chunk 1.1", "done 1"]);
    await vi.advanceTimersByTimeAsync(LINE_GAP_MS - 1); // the line pause
    expect(log.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(log.at(-1)).toBe("browser:Three.");
    e.finish();
    await flush();
    // Nothing after the last: idle at once.
    expect(events.slice(-2)).toEqual(["done 2", "idle"]);
    expect(q.busy).toBe(false);
    expect(floor.busy).toBe(false);
  });

  it("a line queued long after the last one waits for nothing", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const e = fakeEngine("browser", log);
    const q = new SpeechQueue({ primary: e.engine, fallback: null }, quiet, new VoiceFloor());
    q.say({ id: 1, chunks: ["One."] });
    await flush();
    e.finish();
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    q.say({ id: 2, chunks: ["Two."] });
    await flush();
    expect(log).toEqual(["browser:One.", "browser:Two."]);
    e.finish();
  });

  it("stop() during a pause ends the run; the next line starts with no pause", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const e = fakeEngine("browser", log);
    let idles = 0;
    const floor = new VoiceFloor();
    const q = new SpeechQueue({ primary: e.engine, fallback: null }, { ...quiet, idle: () => idles++ }, floor);
    q.say({ id: 1, chunks: ["One.", "Two."] });
    await flush();
    e.finish();
    await flush();
    q.stop(); // mid-pause
    await flush();
    expect(log).toEqual(["browser:One."]);
    expect(idles).toBe(1);
    expect(floor.busy).toBe(false);
    q.say({ id: 2, chunks: ["Three."] });
    await flush();
    expect(log).toEqual(["browser:One.", "browser:Three."]);
    e.finish();
  });

  it("the gaps can change (⚙) and a zero gap never touches a timer", async () => {
    const log: string[] = [];
    const e = fakeEngine("browser", log);
    const q = new SpeechQueue({ primary: e.engine, fallback: null }, quiet, new VoiceFloor());
    q.setGaps(NO_GAPS);
    q.say({ id: 1, chunks: ["One.", "Two."] });
    await flush();
    e.finish();
    await flush();
    expect(log).toEqual(["browser:One.", "browser:Two."]);
    e.finish();
  });
});

describe("SpeechQueue pronunciation (wave 26, V3)", () => {
  it("hands the engines the said text while the callbacks index the written chunks", async () => {
    const log: string[] = [];
    const prepared: string[] = [];
    const e = fakeEngine("browser", log, { prepare: (t) => (prepared.push(t), { kind: "browser", text: t }) });
    const chunks: Array<[number, number]> = [];
    const q = new SpeechQueue({ primary: e.engine, fallback: null }, { ...quiet, chunk: (id, i) => chunks.push([id, i]) }, new VoiceFloor(), NO_GAPS);
    q.say({ id: 7, chunks: ["Antivirus, you know what to do.", "Norton Anti-Virus stays."] });
    await flush();
    e.finish();
    await flush();
    e.finish();
    await flush();
    expect(prepared).toEqual(["Anti Virus, you know what to do.", "Norton Anti-Virus stays."]);
    expect(log).toEqual(["browser:Anti Virus, you know what to do.", "browser:Norton Anti-Virus stays."]);
    expect(chunks).toEqual([
      [7, 0],
      [7, 1],
    ]);
  });

  it("the fallback (and so the server voice's cache key) gets the said text too", async () => {
    const log: string[] = [];
    const asked: string[] = [];
    const server = fakeEngine("server", log, { prepare: (t) => (asked.push(`server:${t}`), null) });
    const device = fakeEngine("browser", log, { prepare: (t) => (asked.push(`device:${t}`), { kind: "browser", text: t }) });
    const q = new SpeechQueue({ primary: server.engine, fallback: device.engine }, quiet, new VoiceFloor(), NO_GAPS);
    q.say({ id: 1, chunks: ["The Antiviruses march."] });
    await flush();
    expect(asked).toEqual(["server:The Anti Viruses march.", "device:The Anti Viruses march."]);
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

describe("BrowserEngine — a speak() that never starts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // A page whose speechSynthesis lists voices but ignores speak() — Safari
  // before the first tap, or a WebView stub.
  function ignoringSpeech(): { speak: ReturnType<typeof vi.fn> } {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(readonly text: string) {} });
    const synth = {
      speak: vi.fn(),
      cancel: vi.fn(),
      resume: vi.fn(),
      paused: false,
      getVoices: () => [{ name: "Samantha", lang: "en-US", voiceURI: "samantha", default: true, localService: true }],
    };
    vi.stubGlobal("speechSynthesis", synth);
    return synth;
  }

  it("is written off until the next tap, then tried again", async () => {
    ignoringSpeech();
    const device = new DeviceEngine({ voice: "", speed: 1 });
    expect(device.current()).toBe("browser");
    const played = device.browser.play({ kind: "browser", text: "Doors open at nine." }, () => {});
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    await played;
    expect(device.browser.dead).toBe(true);
    expect(device.current()).toBe("silent"); // no Fully here: text only meanwhile
    expect(await device.browser.prepare("Again.")).toBeNull();
    await unlock(); // TOUCH TO WAKE
    expect(device.browser.dead).toBe(false);
    expect(device.current()).toBe("browser");
    expect((await device.browser.prepare("Again."))?.kind).toBe("browser");
  });

  it("a write-off made after the tap holds until the next one", async () => {
    ignoringSpeech();
    await unlock();
    const browser = new BrowserEngine({ voice: "", speed: 1 });
    const played = browser.play({ kind: "browser", text: "Hello." }, () => {});
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    await played;
    expect(browser.dead).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(browser.dead).toBe(true);
    await unlock();
    expect(browser.dead).toBe(false);
  });
});

describe("decodeAudio on old Safari (OB-12)", () => {
  it("takes the callback form (webkitAudioContext) and the promise form alike, and rejects a failure", async () => {
    const { decodeAudio } = await import("../src/speech/engine.ts");
    const buf = { duration: 1 } as unknown as AudioBuffer;
    const callbackOnly = { decodeAudioData: (_b: ArrayBuffer, ok?: (b: AudioBuffer) => void) => void ok?.(buf) } as never;
    await expect(decodeAudio(callbackOnly, new ArrayBuffer(4))).resolves.toBe(buf);
    const promised = { decodeAudioData: () => Promise.resolve(buf) } as never;
    await expect(decodeAudio(promised, new ArrayBuffer(4))).resolves.toBe(buf);
    const bad = { decodeAudioData: (_b: ArrayBuffer, _ok?: unknown, fail?: (e: unknown) => void) => void fail?.(new Error("bad")) } as never;
    await expect(decodeAudio(bad, new ArrayBuffer(4))).rejects.toThrow("bad");
  });
});
